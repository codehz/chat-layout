import { describe, expect, test } from "bun:test";

import {
  ListRenderer,
  ListState,
  memoRenderItem,
  type ListPadding,
} from "../../src/renderer";
import type { ListAnchorMode } from "../../src/renderer";
import type {
  Box,
  Context,
  HitTest,
  Node,
  RenderFeedback,
} from "../../src/types";
import { createGraphics, mockPerformanceNow } from "../helpers/graphics";
import {
  createFeedback,
  createNode,
  expectedAnchor,
  readAnchor,
} from "../helpers/renderer-fixtures";

type C = CanvasRenderingContext2D;
type DrawProbe = { id: string; y: number };

function createRenderer<T extends {}>(
  viewportHeight: number,
  options: {
    anchorMode: ListAnchorMode;
    padding?: ListPadding;
    list: ListState<T>;
    renderItem: (item: T) => Node<C>;
  },
): ListRenderer<C, T> {
  return new ListRenderer(createGraphics(viewportHeight), options);
}

function createProbeNode(
  id: string,
  height: number,
  draws: DrawProbe[],
): Node<C> {
  return {
    measure(_ctx: Context<C>): Box {
      return { width: 320, height };
    },
    draw(_ctx: Context<C>, _x: number, y: number): boolean {
      draws.push({ id, y });
      return false;
    },
    hittest(_ctx: Context<C>, _test: HitTest): boolean {
      return false;
    },
  };
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function pixelAtAnchor(heights: number[], anchor: number): number {
  const clampedAnchor = Math.min(Math.max(anchor, 0), heights.length);
  let remaining = clampedAnchor;
  let pixel = 0;

  for (const height of heights) {
    if (remaining <= 0) {
      break;
    }
    const portion = Math.min(remaining, 1);
    if (height > 0 && portion > 0) {
      pixel += portion * height;
    }
    remaining -= portion;
  }

  return pixel;
}

function expectedPixelAtTime(
  start: number,
  target: number,
  time: number,
  duration: number,
): number {
  const progress = Math.min(Math.max(time / duration, 0), 1);
  const eased = progress >= 1 ? 1 : smoothstep(progress);
  return start + (target - start) * eased;
}

describe("jumpTo", () => {
  test("ListState exposes explicit seed, reset, and anchor helpers", () => {
    const list = new ListState<number>([1, 2, 3]);

    expect(list.items).toEqual([1, 2, 3]);
    expect(list.position).toBeUndefined();
    expect(list.offset).toBe(0);

    list.setAnchor(4.9, 12);
    expect(list.position).toBe(4);
    expect(list.offset).toBe(12);

    list.reset([9, 10]);
    expect(list.items).toEqual([9, 10]);
    expect(list.position).toBeUndefined();
    expect(list.offset).toBe(0);
  });

  test("ListRenderer top-anchor jumpTo without animation matches direct positioning", () => {
    const heights = [40, 50, 60, 70, 80];
    const jumpedList = new ListState<number>();
    jumpedList.pushAll(heights);
    const jumpedRenderer = createRenderer(100, {
      anchorMode: "top",
      list: jumpedList,
      renderItem: (height) => createNode(height),
    });

    jumpedRenderer.jumpTo(3, { animated: false });
    const jumpedFeedback = createFeedback();
    jumpedRenderer.render(jumpedFeedback);

    const manualList = new ListState<number>();
    manualList.pushAll(heights);
    manualList.position = 3;
    manualList.offset = 0;
    const manualRenderer = createRenderer(100, {
      anchorMode: "top",
      list: manualList,
      renderItem: (height) => createNode(height),
    });
    const manualFeedback = createFeedback();
    manualRenderer.render(manualFeedback);

    expect(jumpedList.position).toBe(manualList.position);
    expect(jumpedList.offset).toBeCloseTo(manualList.offset);
    expect(jumpedFeedback).toEqual(manualFeedback);
  });

  test("ListRenderer bottom-anchor jumpTo without animation matches direct positioning", () => {
    const heights = [40, 50, 60, 70, 80];
    const jumpedList = new ListState<number>();
    jumpedList.pushAll(heights);
    const jumpedRenderer = createRenderer(100, {
      anchorMode: "bottom",
      list: jumpedList,
      renderItem: (height) => createNode(height),
    });

    jumpedRenderer.jumpTo(1, { animated: false });
    const jumpedFeedback = createFeedback();
    jumpedRenderer.render(jumpedFeedback);

    const manualList = new ListState<number>();
    manualList.pushAll(heights);
    manualList.position = 1;
    manualList.offset = 0;
    const manualRenderer = createRenderer(100, {
      anchorMode: "bottom",
      list: manualList,
      renderItem: (height) => createNode(height),
    });
    const manualFeedback = createFeedback();
    manualRenderer.render(manualFeedback);

    expect(jumpedList.position).toBe(manualList.position);
    expect(jumpedList.offset).toBe(manualList.offset);
    expect(jumpedFeedback).toEqual(manualFeedback);
  });

  test("jumpTo clamps indices and ignores empty lists", () => {
    const emptyTimelineList = new ListState<number>();
    const emptyTimeline = createRenderer(100, {
      anchorMode: "top",
      list: emptyTimelineList,
      renderItem: (height) => createNode(height),
    });
    emptyTimeline.jumpTo(10);
    expect(emptyTimeline.render()).toBe(false);

    const timelineList = new ListState<number>();
    timelineList.push(20, 20, 20);
    const timeline = createRenderer(100, {
      anchorMode: "top",
      list: timelineList,
      renderItem: (height) => createNode(height),
    });
    timeline.jumpTo(-10, { animated: false });
    timeline.render();
    expect(timelineList.position).toBe(0);

    const chatList = new ListState<number>();
    chatList.push(20, 20, 20);
    const chat = createRenderer(100, {
      anchorMode: "bottom",
      list: chatList,
      renderItem: (height) => createNode(height),
    });
    chat.jumpTo(99, { animated: false });
    chat.render();
    expect(chatList.position).toBe(2);
  });

  test("top-anchor block start matches the default jump target", () => {
    const heights = [40, 50, 60, 70];
    const viewportHeight = 100;
    const defaultList = new ListState<number>();
    defaultList.pushAll(heights);
    const defaultRenderer = createRenderer(viewportHeight, {
      anchorMode: "top",
      list: defaultList,
      renderItem: (height) => createNode(height),
    });

    const explicitList = new ListState<number>();
    explicitList.pushAll(heights);
    const explicitRenderer = createRenderer(viewportHeight, {
      anchorMode: "top",
      list: explicitList,
      renderItem: (height) => createNode(height),
    });

    defaultRenderer.jumpTo(2, { animated: false });
    explicitRenderer.jumpTo(2, { animated: false, block: "start" });
    defaultRenderer.render();
    explicitRenderer.render();

    expect(readAnchor(defaultList, heights, "top")).toBeCloseTo(
      readAnchor(explicitList, heights, "top"),
    );
  });

  test("bottom-anchor block end matches the default jump target", () => {
    const heights = [40, 50, 60, 70];
    const viewportHeight = 100;
    const defaultList = new ListState<number>();
    defaultList.pushAll(heights);
    const defaultRenderer = createRenderer(viewportHeight, {
      anchorMode: "bottom",
      list: defaultList,
      renderItem: (height) => createNode(height),
    });

    const explicitList = new ListState<number>();
    explicitList.pushAll(heights);
    const explicitRenderer = createRenderer(viewportHeight, {
      anchorMode: "bottom",
      list: explicitList,
      renderItem: (height) => createNode(height),
    });

    defaultRenderer.jumpTo(1, { animated: false });
    explicitRenderer.jumpTo(1, { animated: false, block: "end" });
    defaultRenderer.render();
    explicitRenderer.render();

    expect(readAnchor(defaultList, heights, "bottom")).toBeCloseTo(
      readAnchor(explicitList, heights, "bottom"),
    );
  });

  test("top-anchor block center aligns the item center to the viewport center", () => {
    const heights = [30, 40, 120, 50];
    const viewportHeight = 100;
    const list = new ListState<number>();
    list.pushAll(heights);
    const renderer = createRenderer(viewportHeight, {
      anchorMode: "top",
      list,
      renderItem: (height) => createNode(height),
    });

    renderer.jumpTo(2, { animated: false, block: "center" });
    renderer.render();

    expect(readAnchor(list, heights, "top")).toBeCloseTo(
      expectedAnchor(heights, viewportHeight, 2, "center", "top"),
    );
  });

  test("bottom-anchor block center aligns the item center to the viewport center", () => {
    const heights = [30, 120, 40, 50];
    const viewportHeight = 100;
    const list = new ListState<number>();
    list.pushAll(heights);
    const renderer = createRenderer(viewportHeight, {
      anchorMode: "bottom",
      list,
      renderItem: (height) => createNode(height),
    });

    renderer.jumpTo(1, { animated: false, block: "center" });
    renderer.render();

    expect(readAnchor(list, heights, "bottom")).toBeCloseTo(
      expectedAnchor(heights, viewportHeight, 1, "center", "bottom"),
    );
  });

  test("top-anchor block end aligns the item bottom to the viewport bottom", () => {
    const heights = [40, 60, 80, 50];
    const viewportHeight = 100;
    const list = new ListState<number>();
    list.pushAll(heights);
    const renderer = createRenderer(viewportHeight, {
      anchorMode: "top",
      list,
      renderItem: (height) => createNode(height),
    });

    renderer.jumpTo(2, { animated: false, block: "end" });
    renderer.render();

    expect(readAnchor(list, heights, "top")).toBeCloseTo(
      expectedAnchor(heights, viewportHeight, 2, "end", "top"),
    );
  });

  test("bottom-anchor block start aligns the item top to the viewport top", () => {
    const heights = [40, 60, 80, 50];
    const viewportHeight = 100;
    const list = new ListState<number>();
    list.pushAll(heights);
    const renderer = createRenderer(viewportHeight, {
      anchorMode: "bottom",
      list,
      renderItem: (height) => createNode(height),
    });

    renderer.jumpTo(1, { animated: false, block: "start" });
    renderer.render();

    expect(readAnchor(list, heights, "bottom")).toBeCloseTo(
      expectedAnchor(heights, viewportHeight, 1, "start", "bottom"),
    );
  });

  test("block center on an oversized item keeps the target centered", () => {
    const heights = [40, 180, 40];
    const viewportHeight = 100;

    const timelineList = new ListState<number>();
    timelineList.pushAll(heights);
    const timeline = createRenderer(viewportHeight, {
      anchorMode: "top",
      list: timelineList,
      renderItem: (height) => createNode(height),
    });
    timeline.jumpTo(1, { animated: false, block: "center" });
    timeline.render();
    expect(readAnchor(timelineList, heights, "top")).toBeCloseTo(
      expectedAnchor(heights, viewportHeight, 1, "center", "top"),
    );

    const chatList = new ListState<number>();
    chatList.pushAll(heights);
    const chat = createRenderer(viewportHeight, {
      anchorMode: "bottom",
      list: chatList,
      renderItem: (height) => createNode(height),
    });
    chat.jumpTo(1, { animated: false, block: "center" });
    chat.render();
    expect(readAnchor(chatList, heights, "bottom")).toBeCloseTo(
      expectedAnchor(heights, viewportHeight, 1, "center", "bottom"),
    );
  });

  test("block alignment clamps cleanly near list edges", () => {
    const heights = [40, 40, 40];
    const viewportHeight = 100;

    const timelineList = new ListState<number>();
    timelineList.pushAll(heights);
    const timeline = createRenderer(viewportHeight, {
      anchorMode: "top",
      list: timelineList,
      renderItem: (height) => createNode(height),
    });
    timeline.jumpTo(0, { animated: false, block: "end" });
    timeline.render();
    expect(readAnchor(timelineList, heights, "top")).toBeCloseTo(
      expectedAnchor(heights, viewportHeight, 0, "end", "top"),
    );
    expect(Number.isFinite(timelineList.position)).toBe(true);
    expect(Number.isFinite(timelineList.offset)).toBe(true);

    const chatList = new ListState<number>();
    chatList.pushAll(heights);
    const chat = createRenderer(viewportHeight, {
      anchorMode: "bottom",
      list: chatList,
      renderItem: (height) => createNode(height),
    });
    chat.jumpTo(2, { animated: false, block: "start" });
    chat.render();
    expect(readAnchor(chatList, heights, "bottom")).toBeCloseTo(
      expectedAnchor(heights, viewportHeight, 2, "start", "bottom"),
    );
    expect(Number.isFinite(chatList.position)).toBe(true);
    expect(Number.isFinite(chatList.offset)).toBe(true);
  });

  test("jump blocks align against the padded content viewport", () => {
    const draws: DrawProbe[] = [];
    const list = new ListState([
      { id: "a", height: 30 },
      { id: "b", height: 30 },
      { id: "c", height: 30 },
      { id: "d", height: 30 },
      { id: "e", height: 30 },
    ]);
    const renderer = createRenderer(100, {
      anchorMode: "top",
      padding: { top: 20, bottom: 10 },
      list,
      renderItem: (item) => createProbeNode(item.id, item.height, draws),
    });

    renderer.jumpTo(1, { animated: false, block: "start" });
    renderer.render();
    expect(draws.find((draw) => draw.id === "b")?.y).toBeCloseTo(20);

    draws.length = 0;
    renderer.jumpTo(2, { animated: false, block: "end" });
    renderer.render();
    expect(draws.find((draw) => draw.id === "c")?.y).toBeCloseTo(60);
  });

  test("changing padding keeps the visual anchor inside the content viewport", () => {
    const draws: DrawProbe[] = [];
    const list = new ListState([
      { id: "a", height: 40 },
      { id: "b", height: 40 },
      { id: "c", height: 40 },
    ]);
    list.applyScroll(-10);
    const renderer = createRenderer(100, {
      anchorMode: "top",
      list,
      renderItem: (item) => createProbeNode(item.id, item.height, draws),
    });

    renderer.render();
    const before = draws.find((draw) => draw.id === "a")?.y;

    draws.length = 0;
    renderer.padding = { top: 15, bottom: 5 };
    renderer.render();
    const after = draws.find((draw) => draw.id === "a")?.y;

    expect(before).toBeCloseTo(-10);
    expect(after).toBeCloseTo(5);
    expect(list.position).toBe(0);
    expect(list.offset).toBeCloseTo(-10);
  });

  test("jumpTo onComplete runs immediately for non-animated success", () => {
    const list = new ListState<number>();
    list.push(40, 50, 60);
    const renderer = createRenderer(100, {
      anchorMode: "top",
      list,
      renderItem: (height) => createNode(height),
    });

    let completed = 0;
    renderer.jumpTo(1, {
      animated: false,
      onComplete: () => {
        completed += 1;
      },
    });

    expect(completed).toBe(1);
    renderer.render();
    expect(list.position).toBe(1);
    expect(list.offset).toBe(0);
  });

  test("top-anchor default jumpTo animates smoothly and settles", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const heights = [40, 40, 40, 40, 40, 40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(100, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      renderer.jumpTo(3);

      const anchors: number[] = [];
      const feedbacks: RenderFeedback[] = [];
      const returns: boolean[] = [];

      for (const time of [0, 80, 160, 240, 320]) {
        now.current = time;
        const feedback = createFeedback();
        returns.push(renderer.render(feedback));
        anchors.push(readAnchor(list, heights, "top"));
        feedbacks.push({ ...feedback });
      }

      expect(returns.slice(0, -1).every(Boolean)).toBe(true);
      expect(returns[returns.length - 1]).toBe(false);
      for (let i = 1; i < anchors.length; i += 1) {
        expect(anchors[i]).toBeGreaterThanOrEqual(anchors[i - 1]);
        expect(feedbacks[i].min).toBeGreaterThanOrEqual(feedbacks[i - 1].min);
        expect(feedbacks[i].max).toBeGreaterThanOrEqual(feedbacks[i - 1].max);
      }
      expect(anchors[anchors.length - 1]).toBeCloseTo(3);
    } finally {
      restoreNow();
    }
  });

  test("bottom-anchor default jumpTo animates smoothly and settles", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const heights = [40, 40, 40, 40, 40, 40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(100, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      renderer.jumpTo(4);

      const anchors: number[] = [];
      const feedbacks: RenderFeedback[] = [];
      const returns: boolean[] = [];

      for (const time of [0, 80, 160, 240, 320]) {
        now.current = time;
        const feedback = createFeedback();
        returns.push(renderer.render(feedback));
        anchors.push(readAnchor(list, heights, "bottom"));
        feedbacks.push({ ...feedback });
      }

      expect(returns.slice(0, -1).every(Boolean)).toBe(true);
      expect(returns[returns.length - 1]).toBe(false);
      for (let i = 1; i < anchors.length; i += 1) {
        expect(anchors[i]).toBeLessThanOrEqual(anchors[i - 1]);
        expect(feedbacks[i].min).toBeLessThanOrEqual(feedbacks[i - 1].min);
        expect(feedbacks[i].max).toBeLessThanOrEqual(feedbacks[i - 1].max);
      }
      expect(anchors[anchors.length - 1]).toBeCloseTo(5);
    } finally {
      restoreNow();
    }
  });

  test("jumpTo onComplete runs after animated success settles", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const list = new ListState<number>();
      list.push(40, 40, 40, 40, 40);
      const renderer = createRenderer(100, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      let completed = 0;
      renderer.jumpTo(3, {
        duration: 200,
        onComplete: () => {
          completed += 1;
        },
      });

      for (const [time, expectedCompleted] of [
        [0, 0],
        [100, 0],
        [200, 1],
      ] as const) {
        now.current = time;
        renderer.render();
        expect(completed).toBe(expectedCompleted);
      }
    } finally {
      restoreNow();
    }
  });

  test("new jumpTo overrides an in-flight animation", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const heights = [40, 40, 40, 40, 40, 40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(100, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      renderer.jumpTo(6);
      now.current = 80;
      renderer.render();

      renderer.jumpTo(2);
      for (const time of [80, 160, 240, 320]) {
        now.current = time;
        renderer.render();
      }

      const expectedList = new ListState<number>();
      expectedList.pushAll(heights);
      expectedList.position = 2;
      expectedList.offset = 0;
      const expected = createRenderer(100, {
        anchorMode: "top",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expected.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("cancelled jumpTo onComplete does not fire after override", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const list = new ListState<number>();
      list.push(40, 40, 40, 40, 40, 40, 40, 40);
      const renderer = createRenderer(100, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      let firstCompleted = 0;
      let secondCompleted = 0;
      renderer.jumpTo(6, {
        duration: 200,
        onComplete: () => {
          firstCompleted += 1;
        },
      });

      now.current = 100;
      renderer.render();

      renderer.jumpTo(2, {
        duration: 200,
        onComplete: () => {
          secondCompleted += 1;
        },
      });

      for (const time of [100, 200, 300]) {
        now.current = time;
        renderer.render();
      }

      expect(firstCompleted).toBe(0);
      expect(secondCompleted).toBe(1);
    } finally {
      restoreNow();
    }
  });

  test("external scroll changes cancel an in-flight animation", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const heights = [40, 40, 40, 40, 40, 40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(100, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      renderer.jumpTo(2);
      now.current = 80;
      expect(renderer.render()).toBe(true);

      list.position = 6;
      list.offset = 5;
      now.current = 160;
      expect(renderer.render()).toBe(false);

      const expectedList = new ListState<number>();
      expectedList.pushAll(heights);
      expectedList.position = 6;
      expectedList.offset = 5;
      const expected = createRenderer(100, {
        anchorMode: "bottom",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expected.render();

      now.current = 320;
      renderer.render();
      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBe(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("cancelled jumpTo onComplete does not fire after external scroll", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const list = new ListState<number>();
      list.push(40, 40, 40, 40, 40, 40, 40, 40);
      const renderer = createRenderer(100, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      let completed = 0;
      renderer.jumpTo(2, {
        duration: 200,
        onComplete: () => {
          completed += 1;
        },
      });

      now.current = 100;
      expect(renderer.render()).toBe(true);

      list.position = 6;
      list.offset = 5;
      now.current = 200;
      expect(renderer.render()).toBe(false);
      expect(completed).toBe(0);
    } finally {
      restoreNow();
    }
  });

  test("jumpToBottom arms bottom auto-follow before the first render", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      renderer.jumpToBottom({ duration: 200 });
      list.pushAll([30], {
        duration: 200,
        autoFollow: true,
      });

      const feedbacks: RenderFeedback[] = [];
      for (const time of [0, 100, 200, 300]) {
        now.current = time;
        const feedback = createFeedback();
        renderer.render(feedback);
        feedbacks.push({ ...feedback });
      }

      const expectedHeights = [...heights, 30];
      const expectedList = new ListState<number>();
      expectedList.pushAll(expectedHeights);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpToBottom({ animated: false });
      expectedRenderer.render();

      expect(feedbacks[0]?.canAutoFollowBottom).toBe(true);
      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("jumpToTop arms top auto-follow before the first render", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      renderer.jumpToTop({ duration: 200 });
      list.unshiftAll([30], {
        duration: 200,
        autoFollow: true,
      });

      const feedbacks: RenderFeedback[] = [];
      for (const time of [0, 100, 200, 300]) {
        now.current = time;
        const feedback = createFeedback();
        renderer.render(feedback);
        feedbacks.push({ ...feedback });
      }

      const expectedHeights = [30, ...heights];
      const expectedList = new ListState<number>();
      expectedList.pushAll(expectedHeights);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpToTop({ animated: false });
      expectedRenderer.render();

      expect(feedbacks[0]?.canAutoFollowTop).toBe(true);
      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("plain jumpTo does not pre-arm boundary auto-follow during the animation", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      renderer.jumpTo(heights.length - 1, {
        duration: 200,
        block: "end",
      });
      list.pushAll([30], {
        duration: 200,
        autoFollow: true,
      });

      const feedback = createFeedback();
      now.current = 0;
      renderer.render(feedback);

      expect(feedback.canAutoFollowBottom).toBe(false);
      expect(list.position).toBe(0);
      expect(list.offset).toBe(0);
    } finally {
      restoreNow();
    }
  });

  test("plain jumpTo enables boundary auto-follow after settling at the boundary", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      renderer.jumpTo(heights.length - 1, {
        duration: 200,
        block: "end",
      });

      const feedbacks: RenderFeedback[] = [];
      for (const time of [0, 100, 200]) {
        now.current = time;
        const feedback = createFeedback();
        renderer.render(feedback);
        feedbacks.push({ ...feedback });
      }

      expect(feedbacks[0]?.canAutoFollowBottom).toBe(false);
      expect(feedbacks.at(-1)?.canAutoFollowBottom).toBe(true);

      list.pushAll([20], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [200, 300, 400]) {
        now.current = time;
        renderer.render();
      }

      const expectedAfterFollowList = new ListState<number>();
      expectedAfterFollowList.pushAll([...heights, 20]);
      const expectedAfterFollowRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list: expectedAfterFollowList,
        renderItem: (height) => createNode(height),
      });
      expectedAfterFollowRenderer.jumpToBottom({ animated: false });
      expectedAfterFollowRenderer.render();

      expect(list.position).toBe(expectedAfterFollowList.position);
      expect(list.offset).toBeCloseTo(expectedAfterFollowList.offset);
    } finally {
      restoreNow();
    }
  });

  test("pushAll auto-follows the end boundary when pinned there", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.jumpTo(heights.length - 1, {
        animated: false,
        block: "end",
      });
      renderer.render();

      list.pushAll([50], {
        duration: 200,
        distance: 999,
        autoFollow: true,
      });

      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      const expectedHeights = [...heights, 50];
      const expectedList = new ListState<number>();
      expectedList.pushAll(expectedHeights);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpTo(expectedHeights.length - 1, {
        animated: false,
        block: "end",
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("unshiftAll auto-follows the start boundary when pinned there", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.jumpTo(0, {
        animated: false,
        block: "start",
      });
      renderer.render();

      list.unshiftAll([30], {
        duration: 200,
        distance: 999,
        autoFollow: true,
      });

      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      const expectedHeights = [30, ...heights];
      const expectedList = new ListState<number>();
      expectedList.pushAll(expectedHeights);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpTo(0, {
        animated: false,
        block: "start",
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("fully visible short lists can auto-follow both insertion edges", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 120;
      const heights = [20, 20];

      const pushList = new ListState<number>();
      pushList.pushAll(heights);
      const pushRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list: pushList,
        renderItem: (height) => createNode(height),
      });
      pushRenderer.render();
      pushList.pushAll([30], {
        autoFollow: true,
      });
      for (const time of [0, 110, 220]) {
        now.current = time;
        pushRenderer.render();
      }
      const expectedPushList = new ListState<number>();
      expectedPushList.pushAll([...heights, 30]);
      const expectedPushRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list: expectedPushList,
        renderItem: (height) => createNode(height),
      });
      expectedPushRenderer.jumpTo(2, {
        animated: false,
        block: "end",
      });
      expectedPushRenderer.render();
      expect(pushList.position).toBe(expectedPushList.position);
      expect(pushList.offset).toBeCloseTo(expectedPushList.offset);

      now.current = 0;
      const unshiftList = new ListState<number>();
      unshiftList.pushAll(heights);
      const unshiftRenderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list: unshiftList,
        renderItem: (height) => createNode(height),
      });
      unshiftRenderer.render();
      unshiftList.unshiftAll([30], {
        autoFollow: true,
      });
      for (const time of [0, 110, 220]) {
        now.current = time;
        unshiftRenderer.render();
      }
      const expectedUnshiftList = new ListState<number>();
      expectedUnshiftList.pushAll([30, ...heights]);
      const expectedUnshiftRenderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list: expectedUnshiftList,
        renderItem: (height) => createNode(height),
      });
      expectedUnshiftRenderer.jumpTo(0, {
        animated: false,
        block: "start",
      });
      expectedUnshiftRenderer.render();
      expect(unshiftList.position).toBe(expectedUnshiftList.position);
      expect(unshiftList.offset).toBeCloseTo(expectedUnshiftList.offset);
    } finally {
      restoreNow();
    }
  });

  test("pushAll does not auto-follow when the viewport is away from the end boundary", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const list = new ListState<number>();
      list.pushAll([40, 40, 40]);
      const renderer = createRenderer(100, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      list.pushAll([50], {
        duration: 200,
        autoFollow: true,
      });

      now.current = 0;
      expect(renderer.render()).toBe(false);
      expect(list.position).toBe(0);
      expect(list.offset).toBe(0);
    } finally {
      restoreNow();
    }
  });

  test("same-direction follow inserts retarget to the latest boundary item", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      list.pushAll([30], {
        duration: 200,
        autoFollow: true,
      });

      now.current = 100;
      expect(renderer.render()).toBe(true);

      list.pushAll([20], {
        duration: 200,
        autoFollow: true,
      });

      now.current = 200;
      expect(renderer.render()).toBe(true);

      now.current = 300;
      expect(renderer.render()).toBe(false);

      const expectedHeights = [...heights, 30, 20];
      const expectedList = new ListState<number>();
      expectedList.pushAll(expectedHeights);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpTo(expectedHeights.length - 1, {
        animated: false,
        block: "end",
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("pushAll keeps auto-following after a settled boundary follow", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.jumpTo(heights.length - 1, {
        animated: false,
        block: "end",
      });
      renderer.render();

      list.pushAll([30], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      list.pushAll([20], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [200, 300, 400]) {
        now.current = time;
        renderer.render();
      }

      const expectedHeights = [...heights, 30, 20];
      const expectedList = new ListState<number>();
      expectedList.pushAll(expectedHeights);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpTo(expectedHeights.length - 1, {
        animated: false,
        block: "end",
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("unshiftAll keeps auto-following after a settled boundary follow", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.jumpTo(0, {
        animated: false,
        block: "start",
      });
      renderer.render();

      list.unshiftAll([30], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      list.unshiftAll([20], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [200, 300, 400]) {
        now.current = time;
        renderer.render();
      }

      const expectedHeights = [20, 30, ...heights];
      const expectedList = new ListState<number>();
      expectedList.pushAll(expectedHeights);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpTo(0, {
        animated: false,
        block: "start",
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("manual scroll resets the settled auto-follow latch", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.jumpTo(heights.length - 1, {
        animated: false,
        block: "end",
      });
      renderer.render();

      list.pushAll([30], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      list.applyScroll(-10);
      const expectedPosition = list.position;
      const expectedOffset = list.offset;

      list.pushAll([20], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [200, 300, 400]) {
        now.current = time;
        renderer.render();
      }

      const expectedList = new ListState<number>();
      expectedList.pushAll([...heights, 30, 20]);
      expectedList.position = expectedPosition;
      expectedList.offset = expectedOffset;
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("manual scroll before a new frame resets the settled unshift auto-follow latch", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.jumpTo(0, {
        animated: false,
        block: "start",
      });
      renderer.render();

      list.unshiftAll([30], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      list.applyScroll(-10);
      renderer.render();
      const expectedPosition = list.position;
      const expectedOffset = list.offset;

      list.unshiftAll([20], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [200, 300, 400]) {
        now.current = time;
        renderer.render();
      }

      const expectedList = new ListState<number>();
      expectedList.pushAll([20, 30, ...heights]);
      expectedList.position =
        expectedPosition == null ? undefined : expectedPosition + 1;
      expectedList.offset = expectedOffset;
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("jumpTo resets the settled auto-follow latch", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.jumpTo(heights.length - 1, {
        animated: false,
        block: "end",
      });
      renderer.render();

      list.pushAll([30], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      renderer.jumpTo(1, {
        animated: false,
      });
      renderer.render();

      list.pushAll([20], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [200, 300, 400]) {
        now.current = time;
        renderer.render();
      }

      const expectedList = new ListState<number>();
      expectedList.pushAll([...heights, 30, 20]);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpTo(1, {
        animated: false,
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("manual scroll cancels an in-flight auto-follow jump", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const list = new ListState<number>();
      list.pushAll([40, 40, 40]);
      const renderer = createRenderer(100, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      list.pushAll([30], {
        duration: 200,
        autoFollow: true,
      });

      now.current = 100;
      expect(renderer.render()).toBe(true);

      list.position = 1;
      list.offset = 5;

      const expectedList = new ListState<number>();
      expectedList.pushAll([40, 40, 40, 30]);
      expectedList.position = 1;
      expectedList.offset = 5;
      const expectedRenderer = createRenderer(100, {
        anchorMode: "bottom",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });

      now.current = 200;
      expect(renderer.render()).toBe(false);
      expectedRenderer.render();
      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBe(expectedList.offset);

      now.current = 300;
      renderer.render();
      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBe(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("far jump renders without measuring the whole list", () => {
    type Item = { height: number };

    const makeItems = (): Item[] =>
      Array.from({ length: 1000 }, () => ({ height: 12 }));
    const measureCount = { count: 0 };
    const renderItem = memoRenderItem<C, Item>((item) => ({
      measure(_ctx: Context<C>): Box {
        measureCount.count += 1;
        return { width: 320, height: item.height };
      },
      draw(_ctx: Context<C>, _x: number, _y: number): boolean {
        return false;
      },
      hittest(_ctx: Context<C>, _test: HitTest): boolean {
        return false;
      },
    }));

    const list = new ListState<Item>();
    list.pushAll(makeItems());
    const renderer = createRenderer(120, {
      anchorMode: "top",
      list,
      renderItem,
    });

    renderer.jumpTo(700, { animated: false });
    renderer.render();

    expect(measureCount.count).toBeLessThan(20);
  });

  test("animated block jump settles at the requested alignment", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const heights = [40, 60, 80, 50, 30];
      const viewportHeight = 100;
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      renderer.jumpTo(1, { block: "start", duration: 200 });

      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      expect(readAnchor(list, heights, "bottom")).toBeCloseTo(
        expectedAnchor(heights, viewportHeight, 1, "start", "bottom"),
      );
    } finally {
      restoreNow();
    }
  });

  test("auto-duration uses real pixel distance instead of item span", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const shortHeights = [40, 40, 40, 40];
      const shortList = new ListState<number>();
      shortList.pushAll(shortHeights);
      const shortRenderer = createRenderer(100, {
        anchorMode: "top",
        list: shortList,
        renderItem: (height) => createNode(height),
      });

      const tallHeights = [80, 80, 80, 80];
      const tallList = new ListState<number>();
      tallList.pushAll(tallHeights);
      const tallRenderer = createRenderer(100, {
        anchorMode: "top",
        list: tallList,
        renderItem: (height) => createNode(height),
      });

      shortRenderer.render();
      tallRenderer.render();
      shortRenderer.jumpTo(1);
      tallRenderer.jumpTo(1);

      now.current = 200;
      expect(shortRenderer.render()).toBe(false);
      expect(readAnchor(shortList, shortHeights, "top")).toBeCloseTo(1);

      expect(tallRenderer.render()).toBe(true);
      expect(readAnchor(tallList, tallHeights, "top")).toBeLessThan(1);

      now.current = 240;
      expect(tallRenderer.render()).toBe(false);
      expect(readAnchor(tallList, tallHeights, "top")).toBeCloseTo(1);
    } finally {
      restoreNow();
    }
  });

  test("top-anchor animated jumps follow eased pixel travel across mixed heights", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const heights = [20, 100, 20];
      const viewportHeight = 40;
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      const startPixel = pixelAtAnchor(
        heights,
        readAnchor(list, heights, "top"),
      );
      renderer.jumpTo(1, { block: "end", duration: 200 });
      const targetPixel = pixelAtAnchor(
        heights,
        expectedAnchor(heights, viewportHeight, 1, "end", "top"),
      );

      for (const time of [0, 50, 100, 150, 200]) {
        now.current = time;
        renderer.render();
        expect(
          pixelAtAnchor(heights, readAnchor(list, heights, "top")),
        ).toBeCloseTo(expectedPixelAtTime(startPixel, targetPixel, time, 200));
      }
    } finally {
      restoreNow();
    }
  });

  test("bottom-anchor animated jumps follow eased pixel travel across mixed heights", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const heights = [20, 100, 20];
      const viewportHeight = 40;
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      const startPixel = pixelAtAnchor(
        heights,
        readAnchor(list, heights, "bottom"),
      );
      renderer.jumpTo(1, { block: "start", duration: 200 });
      const targetPixel = pixelAtAnchor(
        heights,
        expectedAnchor(heights, viewportHeight, 1, "start", "bottom"),
      );

      for (const time of [0, 50, 100, 150, 200]) {
        now.current = time;
        renderer.render();
        expect(
          pixelAtAnchor(heights, readAnchor(list, heights, "bottom")),
        ).toBeCloseTo(expectedPixelAtTime(startPixel, targetPixel, time, 200));
      }
    } finally {
      restoreNow();
    }
  });
});
