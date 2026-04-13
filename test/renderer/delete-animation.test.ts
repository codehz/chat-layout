import { describe, expect, test } from "bun:test";

import { writeInternalListScrollState } from "../../src/renderer/list-state";
import { mockPerformanceNow } from "../helpers/graphics";
import {
  createBottomTrackedRenderer as createBottomRenderer,
  createFeedback,
  createTopTrackedRenderer as createTopRenderer,
  expectFiniteFeedback,
  readDrawY,
  type DrawProbe,
  type VirtualizedProbeItem,
} from "../helpers/virtualized-fixtures";

type Item = VirtualizedProbeItem;

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

  test("delete settle keeps a latched bottom follow armed so the next push still auto-follows", () => {
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

      list.scrollToBottom({ animated: false });
      renderer.render();

      writeInternalListScrollState(list, {
        position: 2,
        offset: 35,
      });
      renderer.render();

      list.delete(item, { duration: 100 });

      now.current = 60;
      const settledFeedback = createFeedback();
      renderer.render(settledFeedback);
      expect(settledFeedback.canAutoFollowBottom).toBe(true);

      list.pushAll([{ id: "tail-2", height: 20 }], {
        duration: 200,
        autoFollow: true,
      });

      for (const time of [60, 160, 260]) {
        now.current = time;
        renderer.render();
      }

      const expected = createBottomRenderer(
        [
          { id: "head", height: 40 },
          { id: "middle", height: 40 },
          { id: "tail-2", height: 20 },
        ],
        [],
        [],
        40,
      );
      expected.list.scrollToBottom({ animated: false });
      expected.renderer.render();

      expect(list.position).toBe(expected.list.position);
      expect(list.offset).toBeCloseTo(expected.list.offset);
    } finally {
      restoreNow();
    }
  });

  test("bottom auto-follow promotes to both boundaries when a delete settles from overflow into underflow", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const item = { id: "item", height: 80 };
      const { list, renderer } = createBottomRenderer(
        [{ id: "head", height: 40 }, { id: "middle", height: 40 }, item],
        draws,
        [],
        100,
      );

      list.scrollToBottom({ animated: false });
      const initialFeedback = createFeedback();
      renderer.render(initialFeedback);
      expect(initialFeedback.canAutoFollowTop).toBe(false);
      expect(initialFeedback.canAutoFollowBottom).toBe(true);

      list.delete(item, { duration: 100 });

      now.current = 100;
      const settledFeedback = createFeedback();
      expect(renderer.render(settledFeedback)).toBe(false);
      expect(settledFeedback.canAutoFollowTop).toBe(true);
      expect(settledFeedback.canAutoFollowBottom).toBe(true);
    } finally {
      restoreNow();
    }
  });

  test("hard-cut deletes invalidate boundary follow on the next render", () => {
    const draws: DrawProbe[] = [];
    const item = { id: "item", height: 80 };
    const { list, renderer } = createBottomRenderer(
      [item, { id: "middle", height: 40 }, { id: "tail", height: 40 }],
      draws,
      [],
      100,
    );

    list.scrollToBottom({ animated: false });
    const initialFeedback = createFeedback();
    renderer.render(initialFeedback);
    expect(initialFeedback.canAutoFollowTop).toBe(false);
    expect(initialFeedback.canAutoFollowBottom).toBe(true);

    list.delete(item);

    const settledFeedback = createFeedback();
    expect(renderer.render(settledFeedback)).toBe(false);
    expect(settledFeedback.canAutoFollowTop).toBe(true);
    expect(settledFeedback.canAutoFollowBottom).toBe(true);
  });

  test("bottom auto-follow keeps only the inserted boundary when push leaves underflow", () => {
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
        100,
      );

      list.scrollToBottom({ animated: false });
      const initialFeedback = createFeedback();
      renderer.render(initialFeedback);
      expect(initialFeedback.canAutoFollowTop).toBe(true);
      expect(initialFeedback.canAutoFollowBottom).toBe(true);

      list.pushAll([{ id: "new", height: 80 }], {
        duration: 100,
        autoFollow: true,
      });

      now.current = 100;
      const settledFeedback = createFeedback();
      expect(renderer.render(settledFeedback)).toBe(false);
      expect(settledFeedback.canAutoFollowTop).toBe(false);
      expect(settledFeedback.canAutoFollowBottom).toBe(true);
    } finally {
      restoreNow();
    }
  });

  test("delete ghosts stay visible while fading inside bottom padding", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const item = { id: "ghost", height: 20 };
      const { list, renderer } = createTopRenderer(
        [{ id: "head", height: 40 }, { id: "middle", height: 40 }, item],
        draws,
        [],
        100,
        "top",
        { bottom: 20 },
      );

      renderer.render();
      list.delete(item, { duration: 100 });

      now.current = 50;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.find((draw) => draw.id === "ghost")?.y).toBeCloseTo(80);
      expect(draws.find((draw) => draw.id === "ghost")?.alpha).toBeCloseTo(0.5);
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

  test("top-anchor clipped-leading deletes snap the first visible item to the viewport edge", () => {
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

      writeInternalListScrollState(list, {
        position: 0,
        offset: -50,
      });
      renderer.render();

      draws.length = 0;
      list.delete(item, { duration: 100 });

      now.current = 50;
      expect(renderer.render()).toBe(true);
      expect(draws.map((draw) => draw.id)).toEqual(["middle"]);
      expect(readDrawY(draws, "middle")).toBeCloseTo(0);
      expect(list.items.map((current) => current.id)).toEqual([
        "middle",
        "tail",
      ]);
      expect(list.position).toBe(0);
      expect(list.offset).toBeCloseTo(0);

      now.current = 75;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.map((draw) => draw.id)).toEqual(["middle"]);
      expect(readDrawY(draws, "middle")).toBeCloseTo(0);
      expect(list.items.map((current) => current.id)).toEqual([
        "middle",
        "tail",
      ]);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(readDrawY(draws, "middle")).toBeCloseTo(0);
      expect(list.items.map((current) => current.id)).toEqual([
        "middle",
        "tail",
      ]);
    } finally {
      restoreNow();
    }
  });

  test("top-anchor clipped-leading deletes keep the current scroll stop when user scrolling causes the prune", () => {
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

      writeInternalListScrollState(list, {
        position: 0,
        offset: -35,
      });
      renderer.render();

      list.delete(item, { duration: 100 });

      now.current = 35;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(readDrawY(draws, "middle")).toBeCloseTo(22.46, 2);

      list.applyScroll(-10);
      now.current = 50;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      expect(draws.map((draw) => draw.id)).toEqual(["middle", "tail"]);
      expect(readDrawY(draws, "middle")).toBeCloseTo(-5);
      expect(readDrawY(draws, "tail")).toBeCloseTo(35);
      expect(list.position).toBe(0);
      expect(list.offset).toBeCloseTo(-5);

      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.map((draw) => draw.id)).toEqual(["middle", "tail"]);
      expect(readDrawY(draws, "middle")).toBeCloseTo(-5);
      expect(readDrawY(draws, "tail")).toBeCloseTo(35);
    } finally {
      restoreNow();
    }
  });

  test("bottom-anchor delete-finalize remaps anchors when a hidden leading item disappears", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const items = [
        { id: "head", height: 80 },
        { id: "middle", height: 40 },
        { id: "tail", height: 40 },
      ] as const;
      const { list, renderer } = createBottomRenderer(
        [...items],
        draws,
        [],
        60,
      );

      writeInternalListScrollState(list, {
        position: 0,
        offset: -50,
      });
      renderer.render();

      list.delete(items[0]!, { duration: 100 });

      now.current = 99;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      const middleAt99 = readDrawY(draws, "middle");
      const tailAt99 = readDrawY(draws, "tail");
      expect(middleAt99).toBeCloseTo(0.02384, 4);
      expect(tailAt99).toBeCloseTo(40.02384, 4);
      expect(list.position).toBe(2);
      expect(list.offset).toBeCloseTo(20.02384, 4);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(Math.abs(readDrawY(draws, "middle")! - middleAt99!)).toBeLessThan(
        0.05,
      );
      expect(Math.abs(readDrawY(draws, "tail")! - tailAt99!)).toBeLessThan(
        0.05,
      );
      expect(list.items.map((item) => item.id)).toEqual(["middle", "tail"]);
      expect(list.position).toBe(1);
      expect(list.offset).toBeCloseTo(20, 2);
    } finally {
      restoreNow();
    }
  });

  test("top-anchor delete-finalize remaps anchors when a hidden prior item disappears", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: DrawProbe[] = [];
      const items = [
        { id: "head", height: 80 },
        { id: "middle", height: 40 },
        { id: "tail", height: 40 },
      ] as const;
      const { list, renderer } = createTopRenderer([...items], draws, [], 60);

      writeInternalListScrollState(list, {
        position: 0,
        offset: -90,
      });
      renderer.render();

      list.delete(items[1]!, { duration: 100 });

      now.current = 99;
      draws.length = 0;
      expect(renderer.render()).toBe(true);
      const headAt99 = readDrawY(draws, "head");
      const tailAt99 = readDrawY(draws, "tail");
      expect(headAt99).toBeCloseTo(-60.01192, 4);
      expect(tailAt99).toBeCloseTo(20, 4);
      expect(list.position).toBe(2);
      expect(list.offset).toBeCloseTo(20, 4);

      now.current = 100;
      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(Math.abs(readDrawY(draws, "head")! - headAt99!)).toBeLessThan(
        0.05,
      );
      expect(Math.abs(readDrawY(draws, "tail")! - tailAt99!)).toBeLessThan(
        0.05,
      );
      expect(list.items.map((item) => item.id)).toEqual(["head", "tail"]);
      expect(list.position).toBe(1);
      expect(list.offset).toBeCloseTo(20, 2);
    } finally {
      restoreNow();
    }
  });

  test("bottom-anchor clipped-trailing deletes snap the last visible item to the viewport edge", () => {
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

      writeInternalListScrollState(list, {
        position: 2,
        offset: 50,
      });
      renderer.render();

      draws.length = 0;
      list.delete(item, { duration: 100 });

      now.current = 50;
      expect(renderer.render()).toBe(true);
      expect(draws.map((draw) => draw.id)).toEqual(["middle", "head"]);
      expect(readDrawY(draws, "middle")).toBeCloseTo(0);
      expect(readDrawY(draws, "head")).toBeCloseTo(-40);
      expect(list.items.map((current) => current.id)).toEqual([
        "head",
        "middle",
      ]);
      expect(list.position).toBe(1);
      expect(list.offset).toBeCloseTo(0);

      draws.length = 0;
      expect(renderer.render()).toBe(false);
      expect(draws.map((draw) => draw.id)).toEqual(["middle", "head"]);
      expect(readDrawY(draws, "middle")).toBeCloseTo(0);
      expect(readDrawY(draws, "head")).toBeCloseTo(-40);
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

  test("list-state queued changes: renderer responds to delete and delete-finalize", () => {
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
