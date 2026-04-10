import { describe, expect, test } from "bun:test";

import { ListState, TimelineRenderer, memoRenderItem } from "../../src/renderer";
import type { Box, Context, HitTest, Node } from "../../src/types";
import { createGraphics, mockPerformanceNow } from "../helpers/graphics";
import { createFeedback, expectFiniteFeedback } from "../helpers/renderer-fixtures";

type C = CanvasRenderingContext2D;

type Item = {
  id: string;
  height: number;
  innerAlpha?: number;
  hit?: boolean;
};

type DrawProbe = {
  id: string;
  alpha: number;
  y: number;
};

function createProbeNode(item: Item, draws: DrawProbe[], hits: string[]): Node<C> {
  return {
    measure(_ctx: Context<C>): Box {
      return { width: 320, height: item.height };
    },
    draw(ctx: Context<C>, _x: number, y: number): boolean {
      ctx.with((g) => {
        g.globalAlpha *= item.innerAlpha ?? 1;
        draws.push({
          id: item.id,
          alpha: g.globalAlpha,
          y,
        });
      });
      return false;
    },
    hittest(_ctx: Context<C>, _test: HitTest): boolean {
      hits.push(item.id);
      return item.hit ?? true;
    },
  };
}

function createRenderer(
  items: Item[],
  draws: DrawProbe[],
  hits: string[] = [],
  viewportHeight = 120,
): { list: ListState<Item>; renderer: TimelineRenderer<C, Item> } {
  const list = new ListState<Item>(items);
  const renderItem = memoRenderItem<C, Item>((item) => createProbeNode(item, draws, hits));
  const renderer = new TimelineRenderer(createGraphics(viewportHeight), {
    list,
    renderItem,
  });
  return { list, renderer };
}

describe("replacement animation", () => {
  test("ListState.replace validates indices and hard-cuts by default", () => {
    const draws: DrawProbe[] = [];
    const { list, renderer } = createRenderer(
      [
        { id: "before", height: 20 },
      ],
      draws,
    );

    list.replace(0, { id: "after-default", height: 30 });
    renderer.render();
    expect(draws.map((draw) => draw.id)).toEqual(["after-default"]);

    draws.length = 0;
    list.replace(0, { id: "after-zero", height: 40 }, { duration: 0 });
    renderer.render();
    expect(draws.map((draw) => draw.id)).toEqual(["after-zero"]);

    expect(() => list.replace(-1, { id: "bad", height: 10 })).toThrow(RangeError);
    expect(() => list.replace(1, { id: "bad", height: 10 })).toThrow(RangeError);
  });

  test("ListState.replace accepts updater functions", () => {
    const draws: DrawProbe[] = [];
    const { list, renderer } = createRenderer(
      [
        { id: "before", height: 20 },
      ],
      draws,
    );

    list.replace(0, (prevItem) => ({
      ...prevItem,
      id: `${prevItem.id}-next`,
      height: prevItem.height + 10,
    }));

    renderer.render();
    expect(list.items[0]).toEqual({ id: "before-next", height: 30 });
    expect(draws.map((draw) => draw.id)).toEqual(["before-next"]);
  });

  test("TimelineRenderer crossfades replacement and transitions slot height", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const { list, renderer } = createRenderer(
        [
          { id: "old", height: 20 },
          { id: "tail", height: 10 },
        ],
        draws,
      );

      list.replace(0, { id: "new", height: 60 }, { duration: 100 });

      const feedbackAtStart = createFeedback();
      expect(renderer.render(feedbackAtStart)).toBe(true);
      expect(draws.map((draw) => draw.id)).toEqual(["old", "tail"]);
      expect(draws.find((draw) => draw.id === "old")?.alpha).toBeCloseTo(1);
      expect(draws.find((draw) => draw.id === "new")).toBeUndefined();
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(20);
      expectFiniteFeedback(feedbackAtStart);

      now.current = 50;
      draws.length = 0;
      const feedbackAtMid = createFeedback();
      expect(renderer.render(feedbackAtMid)).toBe(true);
      expect(draws.map((draw) => draw.id)).toEqual(["old", "new", "tail"]);
      expect(draws.find((draw) => draw.id === "old")?.alpha).toBeCloseTo(0.5);
      expect(draws.find((draw) => draw.id === "new")?.alpha).toBeCloseTo(0.5);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(40);
      expectFiniteFeedback(feedbackAtMid);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.map((draw) => draw.id)).toEqual(["new", "tail"]);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(60);
    } finally {
      restoreNow();
    }
  });

  test("same slot supports overlapping replacement layers", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const { list, renderer } = createRenderer(
        [
          { id: "a", height: 20 },
        ],
        draws,
      );

      list.replace(0, { id: "b", height: 20 }, { duration: 100 });
      now.current = 50;
      list.replace(0, { id: "c", height: 20 }, { duration: 100 });

      now.current = 75;
      renderer.render();

      const ids = draws.map((draw) => draw.id);
      expect(ids).toEqual(["a", "b", "c"]);
      const alphaA = draws.find((draw) => draw.id === "a")!.alpha;
      const alphaB = draws.find((draw) => draw.id === "b")!.alpha;
      const alphaC = draws.find((draw) => draw.id === "c")!.alpha;
      expect(alphaA).toBeCloseTo(0.15625);
      expect(alphaB).toBeCloseTo(0.421875);
      expect(alphaC).toBeCloseTo(0.15625);
    } finally {
      restoreNow();
    }
  });

  test("animated slot disables hittest while neighbors remain interactive", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const hits: string[] = [];
      const { list, renderer } = createRenderer(
        [
          { id: "animated-old", height: 30, hit: true },
          { id: "neighbor", height: 30, hit: true },
        ],
        draws,
        hits,
      );

      list.replace(0, { id: "animated-new", height: 30, hit: true }, { duration: 100 });
      now.current = 50;

      expect(renderer.hittest({ x: 10, y: 10, type: "click" })).toBe(false);
      expect(renderer.hittest({ x: 10, y: 40, type: "click" })).toBe(true);
      expect(hits).toEqual(["neighbor"]);
    } finally {
      restoreNow();
    }
  });

  test("replacement alpha proxies through node-owned globalAlpha", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const { list, renderer } = createRenderer(
        [
          { id: "old", height: 20, innerAlpha: 0.4 },
        ],
        draws,
      );

      list.replace(0, { id: "new", height: 20, innerAlpha: 0.25 }, { duration: 100 });
      now.current = 50;
      renderer.render();

      expect(draws.find((draw) => draw.id === "old")?.alpha).toBeCloseTo(0.2);
      expect(draws.find((draw) => draw.id === "new")?.alpha).toBeCloseTo(0.125);
    } finally {
      restoreNow();
    }
  });

  test("unshift and push keep animated slot positions stable", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const { list, renderer } = createRenderer(
        [
          { id: "head", height: 20 },
          { id: "tail-old", height: 20 },
        ],
        draws,
      );

      list.replace(1, { id: "tail-new", height: 20 }, { duration: 100 });
      list.unshift({ id: "prefix", height: 5 });
      list.push({ id: "suffix", height: 15 });

      now.current = 50;
      renderer.render();

      expect(draws.find((draw) => draw.id === "tail-old")?.y).toBeCloseTo(25);
      expect(draws.find((draw) => draw.id === "tail-new")?.y).toBeCloseTo(25);
      expect(draws.find((draw) => draw.id === "suffix")?.y).toBeCloseTo(45);
    } finally {
      restoreNow();
    }
  });
});
