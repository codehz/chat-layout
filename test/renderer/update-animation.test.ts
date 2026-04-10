import { describe, expect, test } from "bun:test";

import {
  ChatRenderer,
  ListState,
  TimelineRenderer,
  memoRenderItem,
} from "../../src/renderer";
import type { Box, Context, HitTest, Node } from "../../src/types";
import { createGraphics, mockPerformanceNow } from "../helpers/graphics";
import {
  createFeedback,
  expectFiniteFeedback,
} from "../helpers/renderer-fixtures";

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

function createProbeNode(
  item: Item,
  draws: DrawProbe[],
  hits: string[],
): Node<C> {
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

function createTimelineRenderer(
  items: Item[],
  draws: DrawProbe[],
  hits: string[] = [],
  viewportHeight = 120,
): { list: ListState<Item>; renderer: TimelineRenderer<C, Item> } {
  const list = new ListState<Item>(items);
  const renderItem = memoRenderItem<C, Item>((item) =>
    createProbeNode(item, draws, hits),
  );
  const renderer = new TimelineRenderer(createGraphics(viewportHeight), {
    list,
    renderItem,
  });
  return { list, renderer };
}

function createChatRenderer(
  items: Item[],
  draws: DrawProbe[],
  hits: string[] = [],
  viewportHeight = 120,
): { list: ListState<Item>; renderer: ChatRenderer<C, Item> } {
  const list = new ListState<Item>(items);
  const renderItem = memoRenderItem<C, Item>((item) =>
    createProbeNode(item, draws, hits),
  );
  const renderer = new ChatRenderer(createGraphics(viewportHeight), {
    list,
    renderItem,
  });
  return { list, renderer };
}

describe("update animation", () => {
  test("ListState.update hard-cuts by default", () => {
    const draws: DrawProbe[] = [];
    const before = { id: "before", height: 20 };
    const { list, renderer } = createTimelineRenderer([before], draws);

    const afterDefault = { id: "after-default", height: 30 };
    list.update(before, afterDefault);
    renderer.render();
    expect(draws.map((draw) => draw.id)).toEqual(["after-default"]);

    draws.length = 0;
    list.update(
      afterDefault,
      { id: "after-zero", height: 40 },
      { duration: 0 },
    );
    renderer.render();
    expect(draws.map((draw) => draw.id)).toEqual(["after-zero"]);
  });

  test("TimelineRenderer crossfades updates and transitions slot height", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const oldItem = { id: "old", height: 20 };
      const { list, renderer } = createTimelineRenderer(
        [oldItem, { id: "tail", height: 10 }],
        draws,
      );

      list.update(oldItem, { id: "new", height: 60 }, { duration: 100 });

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

  test("same slot supports overlapping update layers", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const itemA = { id: "a", height: 20 };
      const itemB = { id: "b", height: 20 };
      const itemC = { id: "c", height: 20 };
      const { list, renderer } = createTimelineRenderer([itemA], draws);

      list.update(itemA, itemB, { duration: 100 });
      now.current = 50;
      list.update(itemB, itemC, { duration: 100 });

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
      const animatedOld = { id: "animated-old", height: 30, hit: true };
      const { list, renderer } = createTimelineRenderer(
        [animatedOld, { id: "neighbor", height: 30, hit: true }],
        draws,
        hits,
      );

      list.update(
        animatedOld,
        { id: "animated-new", height: 30, hit: true },
        { duration: 100 },
      );
      now.current = 50;

      expect(renderer.hittest({ x: 10, y: 10, type: "click" })).toBe(false);
      expect(renderer.hittest({ x: 10, y: 40, type: "click" })).toBe(true);
      expect(hits).toEqual(["neighbor"]);
    } finally {
      restoreNow();
    }
  });

  test("update alpha proxies through node-owned globalAlpha", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const oldItem = { id: "old", height: 20, innerAlpha: 0.4 };
      const { list, renderer } = createTimelineRenderer([oldItem], draws);

      list.update(
        oldItem,
        { id: "new", height: 20, innerAlpha: 0.25 },
        { duration: 100 },
      );
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
      const tailOld = { id: "tail-old", height: 20 };
      const { list, renderer } = createTimelineRenderer(
        [{ id: "head", height: 20 }, tailOld],
        draws,
      );

      list.update(tailOld, { id: "tail-new", height: 20 }, { duration: 100 });
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

  test("offscreen updates hard-cut once a visible snapshot exists", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const hiddenOld = { id: "hidden-old", height: 20 };
      const { list, renderer } = createTimelineRenderer(
        [{ id: "head", height: 20 }, { id: "middle", height: 20 }, hiddenOld],
        draws,
        [],
        40,
      );

      renderer.render();
      draws.length = 0;

      list.update(
        hiddenOld,
        { id: "hidden-new", height: 20 },
        { duration: 100 },
      );

      expect(renderer.render()).toBe(false);
      expect(draws.map((draw) => draw.id)).toEqual(["head", "middle"]);

      now.current = 50;
      draws.length = 0;
      list.applyScroll(-20);

      expect(renderer.render()).toBe(false);
      expect(draws.map((draw) => draw.id)).toEqual(["middle", "hidden-new"]);
    } finally {
      restoreNow();
    }
  });

  test("animations are canceled after their slot leaves the viewport", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const animatedOld = { id: "animated-old", height: 20 };
      const { list, renderer } = createTimelineRenderer(
        [animatedOld, { id: "middle", height: 20 }, { id: "tail", height: 20 }],
        draws,
        [],
        40,
      );

      renderer.render();

      list.update(
        animatedOld,
        { id: "animated-new", height: 20 },
        { duration: 100 },
      );

      now.current = 50;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.map((draw) => draw.id)).toEqual([
        "animated-old",
        "animated-new",
        "middle",
      ]);

      list.applyScroll(-20);
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.map((draw) => draw.id)).toEqual(["middle", "tail"]);

      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.map((draw) => draw.id)).toEqual(["middle", "tail"]);
    } finally {
      restoreNow();
    }
  });

  test("partially visible chat updates keep animating", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const middleOld = { id: "middle-old", height: 30 };
      const { list, renderer } = createChatRenderer(
        [{ id: "top", height: 20 }, middleOld, { id: "bottom", height: 20 }],
        draws,
        [],
        40,
      );

      renderer.render();

      list.update(
        middleOld,
        { id: "middle-new", height: 30 },
        { duration: 100 },
      );

      now.current = 50;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.map((draw) => draw.id)).toContain("middle-old");
      expect(draws.map((draw) => draw.id)).toContain("middle-new");
      expect(draws.find((draw) => draw.id === "middle-old")?.alpha).toBeCloseTo(
        0.5,
      );
      expect(draws.find((draw) => draw.id === "middle-new")?.alpha).toBeCloseTo(
        0.5,
      );
      expect(draws.find((draw) => draw.id === "middle-old")?.y).toBeCloseTo(
        -10,
      );
      expect(draws.find((draw) => draw.id === "middle-new")?.y).toBeCloseTo(
        -10,
      );
    } finally {
      restoreNow();
    }
  });
});
