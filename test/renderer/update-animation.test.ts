import { describe, expect, test } from "bun:test";

import {
  ListRenderer,
  ListState,
  memoRenderItem,
  type ListUnderflowAlign,
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

function createTopRenderer(
  items: Item[],
  draws: DrawProbe[],
  hits: string[] = [],
  viewportHeight = 120,
  underflowAlign: ListUnderflowAlign = "top",
): { list: ListState<Item>; renderer: ListRenderer<C, Item> } {
  const list = new ListState<Item>(items);
  const renderItem = memoRenderItem<C, Item>((item) =>
    createProbeNode(item, draws, hits),
  );
  const renderer = new ListRenderer(createGraphics(viewportHeight), {
    anchorMode: "top",
    underflowAlign,
    list,
    renderItem,
  });
  return { list, renderer };
}

function createBottomRenderer(
  items: Item[],
  draws: DrawProbe[],
  hits: string[] = [],
  viewportHeight = 120,
  underflowAlign: ListUnderflowAlign = "top",
): { list: ListState<Item>; renderer: ListRenderer<C, Item> } {
  const list = new ListState<Item>(items);
  const renderItem = memoRenderItem<C, Item>((item) =>
    createProbeNode(item, draws, hits),
  );
  const renderer = new ListRenderer(createGraphics(viewportHeight), {
    anchorMode: "bottom",
    underflowAlign,
    list,
    renderItem,
  });
  return { list, renderer };
}

describe("update animation", () => {
  test("ListState.update hard-cuts by default", () => {
    const draws: DrawProbe[] = [];
    const before = { id: "before", height: 20 };
    const { list, renderer } = createTopRenderer([before], draws);

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

  test("top-anchor crossfades updates and transitions slot height", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const oldItem = { id: "old", height: 20 };
      const { list, renderer } = createTopRenderer(
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

  test("same slot restarts with only the current outgoing and incoming layers", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const itemA = { id: "a", height: 20 };
      const itemB = { id: "b", height: 60 };
      const itemC = { id: "c", height: 40 };
      const { list, renderer } = createTopRenderer(
        [itemA, { id: "tail", height: 10 }],
        draws,
      );

      list.update(itemA, itemB, { duration: 100 });
      now.current = 50;
      list.update(itemB, itemC, { duration: 100 });

      now.current = 75;
      renderer.render();

      const ids = draws.map((draw) => draw.id);
      expect(ids).toEqual(["b", "c", "tail"]);
      expect(draws.find((draw) => draw.id === "a")).toBeUndefined();
      const alphaB = draws.find((draw) => draw.id === "b")!.alpha;
      const alphaC = draws.find((draw) => draw.id === "c")!.alpha;
      expect(alphaB).toBeCloseTo(0.421875);
      expect(alphaC).toBeCloseTo(0.15625);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(40);
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
      const { list, renderer } = createTopRenderer(
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
      const { list, renderer } = createTopRenderer([oldItem], draws);

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
      const { list, renderer } = createTopRenderer(
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

  test("offscreen updates hard-cut without requiring a prior visible snapshot", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const hiddenOld = { id: "hidden-old", height: 20 };
      const { list, renderer } = createTopRenderer(
        [{ id: "head", height: 20 }, { id: "middle", height: 20 }, hiddenOld],
        draws,
        [],
        40,
      );

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

  test("animations stay alive until they become fully invisible", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const animatedOld = { id: "animated-old", height: 20 };
      const { list, renderer } = createTopRenderer(
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

      now.current = 100;
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
      const { list, renderer } = createBottomRenderer(
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

  test("restarting an offscreen update hard-cuts to the latest item", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const oldItem = { id: "old", height: 20 };
      const midItem = { id: "mid", height: 20 };
      const newItem = { id: "new", height: 20 };
      const { list, renderer } = createTopRenderer(
        [oldItem, { id: "middle", height: 20 }, { id: "tail", height: 20 }],
        draws,
        [],
        40,
      );

      renderer.render();
      list.update(oldItem, midItem, { duration: 100 });

      now.current = 50;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.map((draw) => draw.id)).toEqual(["old", "mid", "middle"]);

      list.applyScroll(-20);
      list.update(midItem, newItem, { duration: 100 });

      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.map((draw) => draw.id)).toEqual(["middle", "tail"]);

      list.applyScroll(20);
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.map((draw) => draw.id)).toEqual(["new", "middle"]);
      expect(draws.find((draw) => draw.id === "new")?.alpha).toBeCloseTo(1);
    } finally {
      restoreNow();
    }
  });

  test("chat shrink updates keep animating when the previous visible slot snapshot says the item is visible", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const oldItem = { id: "old", height: 160 };
      const newItem = { id: "new", height: 80 };
      const { list, renderer } = createBottomRenderer(
        [
          { id: "head", height: 20 },
          oldItem,
          { id: "tail-a", height: 20 },
          { id: "tail-b", height: 20 },
        ],
        draws,
        [],
        80,
      );

      list.setAnchor(1, 100);
      renderer.render();

      draws.length = 0;
      list.update(oldItem, newItem, { duration: 100 });

      now.current = 50;
      expect(renderer.render()).toBe(true);
      expect(draws.map((draw) => draw.id)).toContain("old");
      expect(draws.map((draw) => draw.id)).toContain("new");
      expect(draws.find((draw) => draw.id === "old")?.alpha).toBeCloseTo(0.5);
      expect(draws.find((draw) => draw.id === "new")?.alpha).toBeCloseTo(0.5);
    } finally {
      restoreNow();
    }
  });

  test("top-anchor clipped-leading shrink updates end on the first fully invisible frame", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const oldItem = { id: "old", height: 80 };
      const newItem = { id: "new", height: 30 };
      const { list, renderer } = createTopRenderer(
        [oldItem, { id: "middle", height: 40 }, { id: "tail", height: 40 }],
        draws,
        [],
        40,
      );

      list.setAnchor(0, -50);
      renderer.render();

      draws.length = 0;
      list.update(oldItem, newItem, { duration: 100 });

      now.current = 50;
      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "middle")?.y).toBeCloseTo(5);

      now.current = 75;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.map((draw) => draw.id)).toEqual(["middle", "tail"]);
      expect(draws.find((draw) => draw.id === "middle")?.y).toBeCloseTo(-20);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(20);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.find((draw) => draw.id === "middle")?.y).toBeCloseTo(-20);
      expect(list.position).toBe(1);
      expect(list.offset).toBeCloseTo(-20);
    } finally {
      restoreNow();
    }
  });

  test("bottom-anchor clipped-trailing shrink updates end on the first fully invisible frame", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const oldItem = { id: "old", height: 80 };
      const newItem = { id: "new", height: 30 };
      const { list, renderer } = createBottomRenderer(
        [{ id: "head", height: 40 }, { id: "middle", height: 40 }, oldItem],
        draws,
        [],
        40,
      );

      list.setAnchor(2, 50);
      renderer.render();

      draws.length = 0;
      list.update(oldItem, newItem, { duration: 100 });

      now.current = 50;
      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "middle")?.y).toBeCloseTo(-5);

      now.current = 75;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.map((draw) => draw.id)).toEqual(["middle", "head"]);
      expect(draws.find((draw) => draw.id === "middle")?.y).toBeCloseTo(20);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(-20);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.find((draw) => draw.id === "middle")?.y).toBeCloseTo(20);
      expect(list.position).toBe(1);
      expect(list.offset).toBeCloseTo(20);
    } finally {
      restoreNow();
    }
  });

  test("top-anchor animates pushAll on short lists", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const { list, renderer } = createTopRenderer(
        [
          { id: "head", height: 20 },
          { id: "tail", height: 20 },
        ],
        draws,
      );

      renderer.render();

      draws.length = 0;
      list.pushAll([{ id: "new", height: 30 }], {
        duration: 100,
        distance: 24,
      });

      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(0);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(20);
      expect(draws.find((draw) => draw.id === "new")).toBeUndefined();

      now.current = 50;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(52);
      expect(draws.find((draw) => draw.id === "new")?.alpha).toBeCloseTo(0.5);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(40);
      expect(draws.find((draw) => draw.id === "new")?.alpha).toBeCloseTo(1);
    } finally {
      restoreNow();
    }
  });

  test("top-anchor unshiftAll keeps whole-window slide semantics even when distance is provided", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const { list, renderer } = createTopRenderer(
        [
          { id: "head", height: 20 },
          { id: "tail", height: 30 },
        ],
        draws,
      );

      renderer.render();

      draws.length = 0;
      list.unshiftAll([{ id: "new", height: 10 }], {
        duration: 100,
        distance: 24,
      });

      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(0);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(20);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(-10);

      now.current = 50;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(-5);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(5);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(25);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(0);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(10);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(30);
    } finally {
      restoreNow();
    }
  });

  test("top-anchor keeps unshiftAll item spacing fixed across mixed heights", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const { list, renderer } = createTopRenderer(
        [
          { id: "head", height: 20 },
          { id: "middle", height: 35 },
          { id: "tail", height: 15 },
        ],
        draws,
      );

      renderer.render();

      list.unshiftAll(
        [
          { id: "new-a", height: 12 },
          { id: "new-b", height: 18 },
        ],
        { duration: 100 },
      );
      const finalY = new Map([
        ["new-a", 0],
        ["new-b", 12],
        ["head", 30],
        ["middle", 50],
        ["tail", 85],
      ]);

      for (const time of [0, 50, 100]) {
        now.current = time;
        draws.length = 0;
        renderer.render();

        const deltas = draws.map((draw) => draw.y - (finalY.get(draw.id) ?? 0));
        expect(deltas.length).toBeGreaterThan(0);
        for (const delta of deltas) {
          expect(delta).toBeCloseTo(deltas[0]!);
        }
      }
    } finally {
      restoreNow();
    }
  });

  test("top-anchor keeps existing content pinned on the first unshiftAll frame when the insert exceeds the trailing gap", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const { list, renderer } = createTopRenderer(
        [
          { id: "head", height: 20 },
          { id: "tail", height: 60 },
        ],
        draws,
        [],
        100,
      );

      renderer.render();

      draws.length = 0;
      list.unshiftAll([{ id: "new", height: 50 }], {
        duration: 100,
      });

      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(-50);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(0);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(20);

      now.current = 50;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(-40);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(10);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(30);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(-30);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(20);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(40);
    } finally {
      restoreNow();
    }
  });

  test("bottom-underflow unshiftAll animates inserted items from above while keeping existing content pinned", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const { list, renderer } = createBottomRenderer(
        [
          { id: "head", height: 20 },
          { id: "tail", height: 20 },
        ],
        draws,
        [],
        120,
        "bottom",
      );

      renderer.render();

      draws.length = 0;
      list.unshiftAll([{ id: "new", height: 10 }], {
        duration: 100,
        distance: 24,
      });

      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "new")).toBeUndefined();
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(80);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(100);

      now.current = 50;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(58);
      expect(draws.find((draw) => draw.id === "new")?.alpha).toBeCloseTo(0.5);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(80);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(100);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(70);
      expect(draws.find((draw) => draw.id === "new")?.alpha).toBeCloseTo(1);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(80);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(100);
    } finally {
      restoreNow();
    }
  });

  test("bottom-underflow unshiftAll still keeps existing content pinned when the insert exceeds the available top gap", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const { list, renderer } = createBottomRenderer(
        [
          { id: "head", height: 20 },
          { id: "tail", height: 60 },
        ],
        draws,
        [],
        100,
        "bottom",
      );

      renderer.render();

      draws.length = 0;
      list.unshiftAll([{ id: "new", height: 50 }], {
        duration: 100,
      });

      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "new")).toBeUndefined();
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(20);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(40);

      now.current = 50;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(-42);
      expect(draws.find((draw) => draw.id === "new")?.alpha).toBeCloseTo(0.5);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(20);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(40);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(-30);
      expect(draws.find((draw) => draw.id === "new")?.alpha).toBeCloseTo(1);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(20);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(40);
    } finally {
      restoreNow();
    }
  });

  test("bottom-underflow pushAll animates a whole-window upward slide while ignoring distance", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const { list, renderer } = createBottomRenderer(
        [
          { id: "head", height: 20 },
          { id: "tail", height: 20 },
        ],
        draws,
        [],
        120,
        "bottom",
      );

      renderer.render();

      draws.length = 0;
      list.pushAll([{ id: "new", height: 30 }], {
        distance: 24,
      });

      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(80);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(100);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(120);
      expect(draws.find((draw) => draw.id === "new")?.alpha).toBeCloseTo(1);

      now.current = 110;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(65);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(85);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(105);

      now.current = 220;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(50);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(70);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(90);
    } finally {
      restoreNow();
    }
  });

  test("bottom-underflow keeps existing content pinned on the first pushAll frame when the insert exceeds the available top gap", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const { list, renderer } = createBottomRenderer(
        [
          { id: "head", height: 20 },
          { id: "tail", height: 60 },
        ],
        draws,
        [],
        100,
        "bottom",
      );

      renderer.render();

      draws.length = 0;
      list.pushAll([{ id: "new", height: 50 }], {
        duration: 100,
      });

      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(20);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(40);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(100);

      now.current = 50;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(10);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(30);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(90);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(0);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(20);
      expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(80);
    } finally {
      restoreNow();
    }
  });

  test("insert animation disables hittest for the animated slot while neighbors stay interactive", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const hits: string[] = [];
      const { list, renderer } = createTopRenderer(
        [{ id: "head", height: 20, hit: true }],
        draws,
        hits,
      );

      renderer.render();
      list.pushAll([{ id: "new", height: 30, hit: true }], {
        duration: 100,
        distance: 24,
      });
      now.current = 50;

      expect(renderer.hittest({ x: 10, y: 10, type: "click" })).toBe(true);
      expect(renderer.hittest({ x: 10, y: 60, type: "click" })).toBe(false);
      expect(hits).toEqual(["head"]);
    } finally {
      restoreNow();
    }
  });

  test("pushAll and unshiftAll hard-cut when the previous frame already filled the viewport", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const { list, renderer } = createTopRenderer(
        [
          { id: "first", height: 40 },
          { id: "second", height: 40 },
          { id: "third", height: 40 },
        ],
        draws,
      );

      renderer.render();

      draws.length = 0;
      list.unshiftAll([{ id: "new-head", height: 20 }], { duration: 100 });
      expect(renderer.render()).toBe(false);
      expect(draws.map((draw) => draw.id)).not.toContain("new-head");
      expect(draws.find((draw) => draw.id === "first")?.y).toBeCloseTo(0);

      draws.length = 0;
      list.pushAll([{ id: "new-tail", height: 20 }], { duration: 100 });
      expect(renderer.render()).toBe(false);
      expect(draws.map((draw) => draw.id)).not.toContain("new-tail");
    } finally {
      restoreNow();
    }
  });

  test("pushAll and unshiftAll hard-cut without a prior visible snapshot or with zero duration", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const noSnapshotDraws: DrawProbe[] = [];
      const noSnapshot = createTopRenderer(
        [{ id: "head", height: 20 }],
        noSnapshotDraws,
      );

      noSnapshot.list.pushAll([{ id: "new", height: 30 }], {
        duration: 100,
        distance: 24,
      });
      expect(noSnapshot.renderer.render()).toBe(false);
      expect(noSnapshotDraws.find((draw) => draw.id === "new")?.y).toBeCloseTo(
        20,
      );
      expect(
        noSnapshotDraws.find((draw) => draw.id === "new")?.alpha,
      ).toBeCloseTo(1);

      const zeroDurationDraws: DrawProbe[] = [];
      const zeroDuration = createTopRenderer(
        [{ id: "head", height: 20 }],
        zeroDurationDraws,
      );
      zeroDuration.renderer.render();

      zeroDurationDraws.length = 0;
      zeroDuration.list.unshiftAll([{ id: "new-head", height: 10 }], {
        duration: 0,
      });
      expect(zeroDuration.renderer.render()).toBe(false);
      expect(
        zeroDurationDraws.find((draw) => draw.id === "new-head")?.y,
      ).toBeCloseTo(0);
      expect(
        zeroDurationDraws.find((draw) => draw.id === "head")?.y,
      ).toBeCloseTo(10);
    } finally {
      restoreNow();
    }
  });

  test("rendered empty lists animate the first pushAll and unshiftAll from their insertion direction", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const pushDraws: DrawProbe[] = [];
      const pushCase = createTopRenderer([], pushDraws);
      expect(pushCase.renderer.render()).toBe(false);

      pushDraws.length = 0;
      pushCase.list.pushAll([{ id: "push", height: 30 }], {
        duration: 100,
        distance: 24,
      });
      expect(pushCase.renderer.render()).toBe(true);
      expect(pushDraws.find((draw) => draw.id === "push")).toBeUndefined();

      now.current = 50;
      pushDraws.length = 0;
      expect(pushCase.renderer.render()).toBe(true);
      expect(pushDraws.find((draw) => draw.id === "push")?.y).toBeCloseTo(12);
      expect(pushDraws.find((draw) => draw.id === "push")?.alpha).toBeCloseTo(
        0.5,
      );

      now.current = 100;
      pushDraws.length = 0;
      expect(pushCase.renderer.render()).toBe(false);
      expect(pushDraws.find((draw) => draw.id === "push")?.y).toBeCloseTo(0);
      expect(pushDraws.find((draw) => draw.id === "push")?.alpha).toBeCloseTo(
        1,
      );

      now.current = 0;
      const unshiftDraws: DrawProbe[] = [];
      const unshiftCase = createTopRenderer([], unshiftDraws);
      expect(unshiftCase.renderer.render()).toBe(false);

      unshiftDraws.length = 0;
      unshiftCase.list.unshiftAll([{ id: "unshift", height: 30 }], {
        duration: 100,
        distance: 24,
      });
      expect(unshiftCase.renderer.render()).toBe(true);
      expect(
        unshiftDraws.find((draw) => draw.id === "unshift"),
      ).toBeUndefined();

      now.current = 50;
      unshiftDraws.length = 0;
      expect(unshiftCase.renderer.render()).toBe(true);
      expect(unshiftDraws.find((draw) => draw.id === "unshift")?.y).toBeCloseTo(
        -12,
      );
      expect(
        unshiftDraws.find((draw) => draw.id === "unshift")?.alpha,
      ).toBeCloseTo(0.5);

      now.current = 100;
      unshiftDraws.length = 0;
      expect(unshiftCase.renderer.render()).toBe(false);
      expect(unshiftDraws.find((draw) => draw.id === "unshift")?.y).toBeCloseTo(
        0,
      );
      expect(
        unshiftDraws.find((draw) => draw.id === "unshift")?.alpha,
      ).toBeCloseTo(1);
    } finally {
      restoreNow();
    }
  });

  test("rendered empty bottom-underflow lists animate the first item while preserving final layout", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const pushDraws: DrawProbe[] = [];
      const pushCase = createBottomRenderer([], pushDraws, [], 120, "bottom");
      expect(pushCase.renderer.render()).toBe(false);

      pushDraws.length = 0;
      pushCase.list.pushAll([{ id: "push", height: 30 }], {
        duration: 100,
        distance: 24,
      });
      expect(pushCase.renderer.render()).toBe(true);
      expect(pushDraws.find((draw) => draw.id === "push")).toBeUndefined();

      now.current = 50;
      pushDraws.length = 0;
      expect(pushCase.renderer.render()).toBe(true);
      expect(pushDraws.find((draw) => draw.id === "push")?.y).toBeCloseTo(102);
      expect(pushDraws.find((draw) => draw.id === "push")?.alpha).toBeCloseTo(
        0.5,
      );

      now.current = 100;
      pushDraws.length = 0;
      expect(pushCase.renderer.render()).toBe(false);
      expect(pushDraws.find((draw) => draw.id === "push")?.y).toBeCloseTo(90);
      expect(pushDraws.find((draw) => draw.id === "push")?.alpha).toBeCloseTo(
        1,
      );

      now.current = 0;
      const unshiftDraws: DrawProbe[] = [];
      const unshiftCase = createBottomRenderer(
        [],
        unshiftDraws,
        [],
        120,
        "bottom",
      );
      expect(unshiftCase.renderer.render()).toBe(false);

      unshiftDraws.length = 0;
      unshiftCase.list.unshiftAll([{ id: "unshift", height: 30 }], {
        duration: 100,
        distance: 24,
      });
      expect(unshiftCase.renderer.render()).toBe(true);
      expect(
        unshiftDraws.find((draw) => draw.id === "unshift"),
      ).toBeUndefined();

      now.current = 50;
      unshiftDraws.length = 0;
      expect(unshiftCase.renderer.render()).toBe(true);
      expect(unshiftDraws.find((draw) => draw.id === "unshift")?.y).toBeCloseTo(
        78,
      );
      expect(
        unshiftDraws.find((draw) => draw.id === "unshift")?.alpha,
      ).toBeCloseTo(0.5);

      now.current = 100;
      unshiftDraws.length = 0;
      expect(unshiftCase.renderer.render()).toBe(false);
      expect(unshiftDraws.find((draw) => draw.id === "unshift")?.y).toBeCloseTo(
        90,
      );
      expect(
        unshiftDraws.find((draw) => draw.id === "unshift")?.alpha,
      ).toBeCloseTo(1);
    } finally {
      restoreNow();
    }
  });

  test("empty lists still hard-cut on the first insert when no empty snapshot was rendered", () => {
    const draws: DrawProbe[] = [];
    const { list, renderer } = createTopRenderer([], draws);

    list.pushAll([{ id: "new", height: 30 }], {
      duration: 100,
      distance: 24,
    });

    expect(renderer.render()).toBe(false);
    expect(draws.find((draw) => draw.id === "new")?.y).toBeCloseTo(0);
    expect(draws.find((draw) => draw.id === "new")?.alpha).toBeCloseTo(1);
  });
});

describe("delete animation", () => {
  test("ListState.delete hard-cuts by default", () => {
    const draws: DrawProbe[] = [];
    const item = { id: "item", height: 20 };
    const { list, renderer } = createTopRenderer(
      [item, { id: "tail", height: 10 }],
      draws,
    );
    renderer.render();
    draws.length = 0;

    list.delete(item);
    renderer.render();
    expect(draws.map((d) => d.id)).toEqual(["tail"]);
    expect(list.items.map((i) => i.id)).toEqual(["tail"]);
  });

  test("top-anchor fades out and shrinks slot height when deleting", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const item = { id: "item", height: 20 };
      const { list, renderer } = createTopRenderer(
        [item, { id: "tail", height: 10 }],
        draws,
      );

      renderer.render();
      draws.length = 0;
      list.delete(item, { duration: 100 });

      const feedbackAtStart = createFeedback();
      expect(renderer.render(feedbackAtStart)).toBe(true);
      expect(draws.map((d) => d.id)).toEqual(["item", "tail"]);
      expect(draws.find((d) => d.id === "item")?.alpha).toBeCloseTo(1);
      expect(draws.find((d) => d.id === "tail")?.y).toBeCloseTo(20);
      expectFiniteFeedback(feedbackAtStart);
      expect(list.items.map((i) => i.id)).toEqual(["item", "tail"]);

      now.current = 50;
      draws.length = 0;
      const feedbackAtMid = createFeedback();
      expect(renderer.render(feedbackAtMid)).toBe(true);
      expect(draws.map((d) => d.id)).toEqual(["item", "tail"]);
      expect(draws.find((d) => d.id === "item")?.alpha).toBeCloseTo(0.5);
      expect(draws.find((d) => d.id === "tail")?.y).toBeCloseTo(10);
      expectFiniteFeedback(feedbackAtMid);
      expect(list.items.map((i) => i.id)).toEqual(["item", "tail"]);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.map((d) => d.id)).toEqual(["tail"]);
      expect(draws.find((d) => d.id === "tail")?.y).toBeCloseTo(0);
      expect(list.items.map((i) => i.id)).toEqual(["tail"]);
    } finally {
      restoreNow();
    }
  });

  test("top-anchor bottom-underflow reflows a deleted leading item with the flow layout", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const head = { id: "head", height: 40 };
      const { list, renderer } = createTopRenderer(
        [head, { id: "tail", height: 40 }],
        draws,
        [],
        100,
        "bottom",
      );

      renderer.render();
      draws.length = 0;
      list.delete(head, { duration: 100 });

      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(20);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(60);

      now.current = 50;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(40);
      expect(draws.find((draw) => draw.id === "head")?.alpha).toBeCloseTo(0.5);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(60);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.map((draw) => draw.id)).toEqual(["tail"]);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(60);
    } finally {
      restoreNow();
    }
  });

  test("top-anchor bottom-underflow reflows a deleted trailing item with the flow layout", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const tail = { id: "tail", height: 40 };
      const { list, renderer } = createTopRenderer(
        [{ id: "head", height: 40 }, tail],
        draws,
        [],
        100,
        "bottom",
      );

      renderer.render();
      draws.length = 0;
      list.delete(tail, { duration: 100 });

      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(20);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(60);

      now.current = 50;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(40);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(80);
      expect(draws.find((draw) => draw.id === "tail")?.alpha).toBeCloseTo(0.5);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.map((draw) => draw.id)).toEqual(["head"]);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(60);
    } finally {
      restoreNow();
    }
  });

  test("delete ghosts still follow explicit scrolling outside underflow relayout", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const head = { id: "head", height: 50 };
      const { list, renderer } = createTopRenderer(
        [head, { id: "middle", height: 50 }, { id: "tail", height: 50 }],
        draws,
        [],
        100,
      );

      renderer.render();
      list.delete(head, { duration: 100 });
      now.current = 50;

      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(0);
      expect(draws.find((draw) => draw.id === "middle")?.y).toBeCloseTo(25);

      list.applyScroll(-10);
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(-10);
      expect(draws.find((draw) => draw.id === "middle")?.y).toBeCloseTo(15);
    } finally {
      restoreNow();
    }
  });

  test("bottom-anchor top-underflow delete behavior stays stable", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const head = { id: "head", height: 40 };
      const { list, renderer } = createBottomRenderer(
        [head, { id: "tail", height: 40 }],
        draws,
        [],
        100,
        "top",
      );

      renderer.render();
      draws.length = 0;
      list.delete(head, { duration: 100 });

      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(0);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(40);

      now.current = 50;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(0);
      expect(draws.find((draw) => draw.id === "head")?.alpha).toBeCloseTo(0.5);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(20);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.map((draw) => draw.id)).toEqual(["tail"]);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(0);
    } finally {
      restoreNow();
    }
  });

  test("delete animation disables hittest on the ghost slot", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const hits: string[] = [];
      const item = { id: "item", height: 30, hit: true };
      const { list, renderer } = createTopRenderer(
        [item, { id: "neighbor", height: 30, hit: true }],
        draws,
        hits,
      );

      renderer.render();
      list.delete(item, { duration: 100 });
      now.current = 50;

      expect(renderer.hittest({ x: 10, y: 10, type: "click" })).toBe(false);
      expect(renderer.hittest({ x: 10, y: 40, type: "click" })).toBe(true);
      expect(hits).toEqual(["neighbor"]);
    } finally {
      restoreNow();
    }
  });

  test("offscreen delete hard-removes without leaving a pending ghost", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const hidden = { id: "hidden", height: 20 };
      const { list, renderer } = createTopRenderer(
        [{ id: "head", height: 20 }, { id: "middle", height: 20 }, hidden],
        draws,
        [],
        40,
      );

      renderer.render();
      draws.length = 0;
      list.delete(hidden, { duration: 100 });

      expect(renderer.render()).toBe(false);
      expect(draws.map((d) => d.id)).toEqual(["head", "middle"]);
      expect(list.items.map((i) => i.id)).toEqual(["head", "middle"]);
    } finally {
      restoreNow();
    }
  });

  test("delete animation finalizes on the first frame where the slot is fully invisible", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const item = { id: "item", height: 20 };
      const { list, renderer } = createTopRenderer(
        [item, { id: "middle", height: 20 }, { id: "tail", height: 20 }],
        draws,
        [],
        40,
      );

      renderer.render();
      list.delete(item, { duration: 100 });

      now.current = 50;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.map((d) => d.id)).toContain("item");

      list.applyScroll(-20);
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.map((d) => d.id)).not.toContain("item");
      expect(list.items.map((i) => i.id)).not.toContain("item");

      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.map((d) => d.id)).not.toContain("item");
      expect(list.items.map((i) => i.id)).not.toContain("item");
    } finally {
      restoreNow();
    }
  });

  test("top-anchor clipped-leading deletes finalize on the first fully invisible frame", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const item = { id: "item", height: 80 };
      const { list, renderer } = createTopRenderer(
        [item, { id: "middle", height: 40 }, { id: "tail", height: 40 }],
        draws,
        [],
        40,
      );

      list.setAnchor(0, -50);
      renderer.render();

      draws.length = 0;
      list.delete(item, { duration: 100 });

      now.current = 50;
      expect(renderer.render()).toBe(true);
      expect(draws.map((draw) => draw.id)).toEqual(["tail", "middle"]);
      expect(draws.find((draw) => draw.id === "middle")?.y).toBeCloseTo(-40);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(0);
      expect(list.items.map((current) => current.id)).toEqual([
        "middle",
        "tail",
      ]);

      now.current = 75;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.map((draw) => draw.id)).toEqual(["tail"]);
      expect(draws.find((draw) => draw.id === "tail")?.y).toBeCloseTo(0);
      expect(list.items.map((current) => current.id)).toEqual([
        "middle",
        "tail",
      ]);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(list.items.map((current) => current.id)).toEqual([
        "middle",
        "tail",
      ]);
    } finally {
      restoreNow();
    }
  });

  test("bottom-anchor clipped-trailing deletes finalize on the first fully invisible frame", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const item = { id: "item", height: 80 };
      const { list, renderer } = createBottomRenderer(
        [{ id: "head", height: 40 }, { id: "middle", height: 40 }, item],
        draws,
        [],
        40,
      );

      list.setAnchor(2, 50);
      renderer.render();

      draws.length = 0;
      list.delete(item, { duration: 100 });

      now.current = 50;
      expect(renderer.render()).toBe(true);
      expect(draws.map((draw) => draw.id)).toEqual(["head"]);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(0);
      expect(list.items.map((current) => current.id)).toEqual([
        "head",
        "middle",
      ]);

      now.current = 75;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.map((draw) => draw.id)).toEqual(["head"]);
      expect(draws.find((draw) => draw.id === "head")?.y).toBeCloseTo(0);
      expect(list.items.map((current) => current.id)).toEqual([
        "head",
        "middle",
      ]);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(list.items.map((current) => current.id)).toEqual([
        "head",
        "middle",
      ]);
    } finally {
      restoreNow();
    }
  });

  test("list-state weak subscriptions: renderer responds to delete and delete-finalize", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const item = { id: "item", height: 20 };
      const { list, renderer } = createTopRenderer(
        [item, { id: "tail", height: 10 }],
        draws,
      );

      renderer.render();
      list.delete(item, { duration: 100 });

      now.current = 100;
      draws.length = 0;
      renderer.render();
      expect(draws.map((d) => d.id)).toEqual(["tail"]);
      expect(list.items.map((i) => i.id)).toEqual(["tail"]);
    } finally {
      restoreNow();
    }
  });
});
