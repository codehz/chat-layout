import { describe, expect, test } from "bun:test";

import { ChatRenderer, ListState, TimelineRenderer, memoRenderItem } from "./renderer";
import type { Box, Context, HitTest, Node, RenderFeedback } from "./types";

type C = CanvasRenderingContext2D;

function createGraphics(viewportHeight: number): C {
  return {
    canvas: {
      clientWidth: 320,
      clientHeight: viewportHeight,
    },
    textRendering: "auto",
    clearRect() {},
    save() {},
    restore() {},
  } as unknown as C;
}

function createNode(height: number): Node<C> {
  return {
    flex: false,
    measure(_ctx: Context<C>): Box {
      return { width: 320, height };
    },
    draw(_ctx: Context<C>, _x: number, _y: number): boolean {
      return false;
    },
    hittest(_ctx: Context<C>, _test: HitTest): boolean {
      return false;
    },
  };
}

function createFeedback(): RenderFeedback {
  return {
    minIdx: Number.NaN,
    maxIdx: Number.NaN,
    min: Number.NaN,
    max: Number.NaN,
  };
}

function expectFiniteFeedback(feedback: RenderFeedback): void {
  expect(Number.isFinite(feedback.min)).toBe(true);
  expect(Number.isFinite(feedback.max)).toBe(true);
  expect(Number.isFinite(feedback.minIdx)).toBe(true);
  expect(Number.isFinite(feedback.maxIdx)).toBe(true);
  expect(feedback.max).toBeGreaterThanOrEqual(feedback.min);
  expect(feedback.maxIdx).toBeGreaterThanOrEqual(feedback.minIdx);
}

function expectNaNFeedback(feedback: RenderFeedback): void {
  expect(Number.isNaN(feedback.minIdx)).toBe(true);
  expect(Number.isNaN(feedback.maxIdx)).toBe(true);
  expect(Number.isNaN(feedback.min)).toBe(true);
  expect(Number.isNaN(feedback.max)).toBe(true);
}

function mockPerformanceNow(now: { current: number }): () => void {
  const original = performance.now;
  Object.defineProperty(performance, "now", {
    configurable: true,
    value: () => now.current,
  });
  return () => {
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: original,
    });
  };
}

function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length - 1);
}

function readTimelineAnchor(list: ListState<number>, heights: number[]): number {
  const position = clampIndex(Number.isFinite(list.position) ? Math.trunc(list.position) : 0, heights.length);
  const height = heights[position];
  return height > 0 ? position - list.offset / height : position;
}

function readChatAnchor(list: ListState<number>, heights: number[]): number {
  const fallback = heights.length - 1;
  const position = clampIndex(Number.isFinite(list.position) ? Math.trunc(list.position) : fallback, heights.length);
  const height = heights[position];
  return height > 0 ? position + 1 - list.offset / height : position + 1;
}

function readAnchorAtOffset(heights: number[], index: number, offset: number): number {
  let currentIndex = clampIndex(index, heights.length);
  let remaining = Number.isFinite(offset) ? offset : 0;

  while (true) {
    if (remaining < 0) {
      if (currentIndex === 0) {
        return 0;
      }
      currentIndex -= 1;
      const height = heights[currentIndex];
      if (height > 0) {
        remaining += height;
      }
      continue;
    }

    const height = heights[currentIndex];
    if (height > 0) {
      if (remaining <= height) {
        return currentIndex + remaining / height;
      }
      remaining -= height;
    } else if (remaining === 0) {
      return currentIndex;
    }

    if (currentIndex === heights.length - 1) {
      return heights.length;
    }
    currentIndex += 1;
  }
}

function expectedTimelineAnchor(
  heights: number[],
  viewportHeight: number,
  index: number,
  block: "start" | "center" | "end",
): number {
  const height = heights[index];
  switch (block) {
    case "start":
      return readAnchorAtOffset(heights, index, 0);
    case "center":
      return readAnchorAtOffset(heights, index, height / 2 - viewportHeight / 2);
    case "end":
      return readAnchorAtOffset(heights, index, height - viewportHeight);
  }
}

function expectedChatAnchor(
  heights: number[],
  viewportHeight: number,
  index: number,
  block: "start" | "center" | "end",
): number {
  const height = heights[index];
  switch (block) {
    case "start":
      return readAnchorAtOffset(heights, index, viewportHeight);
    case "center":
      return readAnchorAtOffset(heights, index, height / 2 + viewportHeight / 2);
    case "end":
      return readAnchorAtOffset(heights, index, height);
  }
}

describe("RenderFeedback", () => {
  test("TimelineRenderer reports a monotonic visible range for an oversized item", () => {
    const list = new ListState<number>();
    list.push(200);

    const renderer = new TimelineRenderer(createGraphics(100), {
      list,
      renderItem: (height) => createNode(height),
    });

    const feedback = createFeedback();
    renderer.render(feedback);

    expect(feedback.minIdx).toBe(0);
    expect(feedback.maxIdx).toBe(0);
    expect(feedback.min).toBeCloseTo(0);
    expect(feedback.max).toBeCloseTo(0.5);
    expect(feedback.max).toBeGreaterThanOrEqual(feedback.min);
  });

  test("ChatRenderer reports a monotonic visible range for an oversized item", () => {
    const list = new ListState<number>();
    list.push(200);

    const renderer = new ChatRenderer(createGraphics(100), {
      list,
      renderItem: (height) => createNode(height),
    });

    const feedback = createFeedback();
    renderer.render(feedback);

    expect(feedback.minIdx).toBe(0);
    expect(feedback.maxIdx).toBe(0);
    expect(feedback.min).toBeCloseTo(0.5);
    expect(feedback.max).toBeCloseTo(1);
    expect(feedback.max).toBeGreaterThanOrEqual(feedback.min);
  });

  test("TimelineRenderer keeps feedback finite and smooth while crossing into an oversized item", () => {
    const list = new ListState<number>();
    list.push(40, 300, 40);

    const renderer = new TimelineRenderer(createGraphics(100), {
      list,
      renderItem: (height) => createNode(height),
    });

    let previous: RenderFeedback | undefined;
    for (const delta of [0, -10, -10, -10, -10, -10, -10, -10, -10]) {
      list.applyScroll(delta);
      const feedback = createFeedback();
      renderer.render(feedback);

      expectFiniteFeedback(feedback);
      if (previous != null) {
        expect(feedback.min).toBeGreaterThanOrEqual(previous.min);
        expect(feedback.max).toBeGreaterThanOrEqual(previous.max);
        expect(feedback.min - previous.min).toBeLessThanOrEqual(0.25 + Number.EPSILON);
        expect(feedback.max - previous.max).toBeLessThanOrEqual(0.25 + Number.EPSILON);
      }

      previous = { ...feedback };
    }
  });

  test("ChatRenderer keeps feedback finite and smooth while crossing into an oversized item", () => {
    const list = new ListState<number>();
    list.push(40, 300, 40);

    const renderer = new ChatRenderer(createGraphics(100), {
      list,
      renderItem: (height) => createNode(height),
    });

    let previous: RenderFeedback | undefined;
    for (const delta of [0, 10, 10, 10, 10, 10, 10, 10, 10]) {
      list.applyScroll(delta);
      const feedback = createFeedback();
      renderer.render(feedback);

      expectFiniteFeedback(feedback);
      if (previous != null) {
        expect(feedback.min).toBeLessThanOrEqual(previous.min);
        expect(feedback.max).toBeLessThanOrEqual(previous.max);
        expect(previous.min - feedback.min).toBeLessThanOrEqual(0.25 + Number.EPSILON);
        expect(previous.max - feedback.max).toBeLessThanOrEqual(0.25 + Number.EPSILON);
      }

      previous = { ...feedback };
    }
  });

  test("TimelineRenderer reports edge indices for mixed partially visible items", () => {
    const list = new ListState<number>();
    list.push(50, 50, 50);
    list.applyScroll(-25);

    const renderer = new TimelineRenderer(createGraphics(100), {
      list,
      renderItem: (height) => createNode(height),
    });

    const feedback = createFeedback();
    renderer.render(feedback);

    expect(feedback.minIdx).toBe(0);
    expect(feedback.maxIdx).toBe(2);
    expect(feedback.min).toBeCloseTo(0.5);
    expect(feedback.max).toBeCloseTo(2.5);
  });

  test("ChatRenderer reports edge indices for mixed partially visible items", () => {
    const list = new ListState<number>();
    list.push(50, 50, 50);
    list.applyScroll(25);

    const renderer = new ChatRenderer(createGraphics(100), {
      list,
      renderItem: (height) => createNode(height),
    });

    const feedback = createFeedback();
    renderer.render(feedback);

    expect(feedback.minIdx).toBe(0);
    expect(feedback.maxIdx).toBe(2);
    expect(feedback.min).toBeCloseTo(0.5);
    expect(feedback.max).toBeCloseTo(2.5);
  });

  test("renderer resets a reused feedback object when no items are visible", () => {
    const list = new ListState<number>();
    list.push(200);

    const renderer = new TimelineRenderer(createGraphics(100), {
      list,
      renderItem: (height) => createNode(height),
    });

    const feedback = createFeedback();
    renderer.render(feedback);
    expectFiniteFeedback(feedback);

    list.reset();
    renderer.render(feedback);
    expectNaNFeedback(feedback);
  });

  test("zero-height items do not contaminate feedback", () => {
    const list = new ListState<number>();
    list.push(50, 0, 100);

    const renderer = new TimelineRenderer(createGraphics(100), {
      list,
      renderItem: (height) => createNode(height),
    });

    const feedback = createFeedback();
    renderer.render(feedback);

    expectFiniteFeedback(feedback);
    expect(feedback.minIdx).toBe(0);
    expect(feedback.maxIdx).toBe(2);
    expect(feedback.min).toBeCloseTo(0);
    expect(feedback.max).toBeCloseTo(2.5);
  });

  test("TimelineRenderer jumpTo without animation matches direct positioning", () => {
    const heights = [40, 50, 60, 70, 80];
    const jumpedList = new ListState<number>();
    jumpedList.pushAll(heights);
    const jumpedRenderer = new TimelineRenderer(createGraphics(100), {
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
    const manualRenderer = new TimelineRenderer(createGraphics(100), {
      list: manualList,
      renderItem: (height) => createNode(height),
    });
    const manualFeedback = createFeedback();
    manualRenderer.render(manualFeedback);

    expect(jumpedList.position).toBe(manualList.position);
    expect(jumpedList.offset).toBeCloseTo(manualList.offset);
    expect(jumpedFeedback).toEqual(manualFeedback);
  });

  test("ChatRenderer jumpTo without animation matches direct positioning", () => {
    const heights = [40, 50, 60, 70, 80];
    const jumpedList = new ListState<number>();
    jumpedList.pushAll(heights);
    const jumpedRenderer = new ChatRenderer(createGraphics(100), {
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
    const manualRenderer = new ChatRenderer(createGraphics(100), {
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
    const emptyTimeline = new TimelineRenderer(createGraphics(100), {
      list: emptyTimelineList,
      renderItem: (height) => createNode(height),
    });
    emptyTimeline.jumpTo(10);
    expect(emptyTimeline.render()).toBe(false);

    const timelineList = new ListState<number>();
    timelineList.push(20, 20, 20);
    const timeline = new TimelineRenderer(createGraphics(100), {
      list: timelineList,
      renderItem: (height) => createNode(height),
    });
    timeline.jumpTo(-10, { animated: false });
    timeline.render();
    expect(timelineList.position).toBe(0);

    const chatList = new ListState<number>();
    chatList.push(20, 20, 20);
    const chat = new ChatRenderer(createGraphics(100), {
      list: chatList,
      renderItem: (height) => createNode(height),
    });
    chat.jumpTo(99, { animated: false });
    chat.render();
    expect(chatList.position).toBe(2);
  });

  test("TimelineRenderer block start matches the default jump target", () => {
    const heights = [40, 50, 60, 70];
    const viewportHeight = 100;
    const defaultList = new ListState<number>();
    defaultList.pushAll(heights);
    const defaultRenderer = new TimelineRenderer(createGraphics(viewportHeight), {
      list: defaultList,
      renderItem: (height) => createNode(height),
    });

    const explicitList = new ListState<number>();
    explicitList.pushAll(heights);
    const explicitRenderer = new TimelineRenderer(createGraphics(viewportHeight), {
      list: explicitList,
      renderItem: (height) => createNode(height),
    });

    defaultRenderer.jumpTo(2, { animated: false });
    explicitRenderer.jumpTo(2, { animated: false, block: "start" });
    defaultRenderer.render();
    explicitRenderer.render();

    expect(readTimelineAnchor(defaultList, heights)).toBeCloseTo(readTimelineAnchor(explicitList, heights));
  });

  test("ChatRenderer block end matches the default jump target", () => {
    const heights = [40, 50, 60, 70];
    const viewportHeight = 100;
    const defaultList = new ListState<number>();
    defaultList.pushAll(heights);
    const defaultRenderer = new ChatRenderer(createGraphics(viewportHeight), {
      list: defaultList,
      renderItem: (height) => createNode(height),
    });

    const explicitList = new ListState<number>();
    explicitList.pushAll(heights);
    const explicitRenderer = new ChatRenderer(createGraphics(viewportHeight), {
      list: explicitList,
      renderItem: (height) => createNode(height),
    });

    defaultRenderer.jumpTo(1, { animated: false });
    explicitRenderer.jumpTo(1, { animated: false, block: "end" });
    defaultRenderer.render();
    explicitRenderer.render();

    expect(readChatAnchor(defaultList, heights)).toBeCloseTo(readChatAnchor(explicitList, heights));
  });

  test("TimelineRenderer block center aligns the item center to the viewport center", () => {
    const heights = [30, 40, 120, 50];
    const viewportHeight = 100;
    const list = new ListState<number>();
    list.pushAll(heights);
    const renderer = new TimelineRenderer(createGraphics(viewportHeight), {
      list,
      renderItem: (height) => createNode(height),
    });

    renderer.jumpTo(2, { animated: false, block: "center" });
    renderer.render();

    expect(readTimelineAnchor(list, heights)).toBeCloseTo(expectedTimelineAnchor(heights, viewportHeight, 2, "center"));
  });

  test("ChatRenderer block center aligns the item center to the viewport center", () => {
    const heights = [30, 120, 40, 50];
    const viewportHeight = 100;
    const list = new ListState<number>();
    list.pushAll(heights);
    const renderer = new ChatRenderer(createGraphics(viewportHeight), {
      list,
      renderItem: (height) => createNode(height),
    });

    renderer.jumpTo(1, { animated: false, block: "center" });
    renderer.render();

    expect(readChatAnchor(list, heights)).toBeCloseTo(expectedChatAnchor(heights, viewportHeight, 1, "center"));
  });

  test("TimelineRenderer block end aligns the item bottom to the viewport bottom", () => {
    const heights = [40, 60, 80, 50];
    const viewportHeight = 100;
    const list = new ListState<number>();
    list.pushAll(heights);
    const renderer = new TimelineRenderer(createGraphics(viewportHeight), {
      list,
      renderItem: (height) => createNode(height),
    });

    renderer.jumpTo(2, { animated: false, block: "end" });
    renderer.render();

    expect(readTimelineAnchor(list, heights)).toBeCloseTo(expectedTimelineAnchor(heights, viewportHeight, 2, "end"));
  });

  test("ChatRenderer block start aligns the item top to the viewport top", () => {
    const heights = [40, 60, 80, 50];
    const viewportHeight = 100;
    const list = new ListState<number>();
    list.pushAll(heights);
    const renderer = new ChatRenderer(createGraphics(viewportHeight), {
      list,
      renderItem: (height) => createNode(height),
    });

    renderer.jumpTo(1, { animated: false, block: "start" });
    renderer.render();

    expect(readChatAnchor(list, heights)).toBeCloseTo(expectedChatAnchor(heights, viewportHeight, 1, "start"));
  });

  test("block center on an oversized item keeps the target centered", () => {
    const heights = [40, 180, 40];
    const viewportHeight = 100;

    const timelineList = new ListState<number>();
    timelineList.pushAll(heights);
    const timeline = new TimelineRenderer(createGraphics(viewportHeight), {
      list: timelineList,
      renderItem: (height) => createNode(height),
    });
    timeline.jumpTo(1, { animated: false, block: "center" });
    timeline.render();
    expect(readTimelineAnchor(timelineList, heights)).toBeCloseTo(expectedTimelineAnchor(heights, viewportHeight, 1, "center"));

    const chatList = new ListState<number>();
    chatList.pushAll(heights);
    const chat = new ChatRenderer(createGraphics(viewportHeight), {
      list: chatList,
      renderItem: (height) => createNode(height),
    });
    chat.jumpTo(1, { animated: false, block: "center" });
    chat.render();
    expect(readChatAnchor(chatList, heights)).toBeCloseTo(expectedChatAnchor(heights, viewportHeight, 1, "center"));
  });

  test("block alignment clamps cleanly near list edges", () => {
    const heights = [40, 40, 40];
    const viewportHeight = 100;

    const timelineList = new ListState<number>();
    timelineList.pushAll(heights);
    const timeline = new TimelineRenderer(createGraphics(viewportHeight), {
      list: timelineList,
      renderItem: (height) => createNode(height),
    });
    timeline.jumpTo(0, { animated: false, block: "end" });
    timeline.render();
    expect(readTimelineAnchor(timelineList, heights)).toBeCloseTo(expectedTimelineAnchor(heights, viewportHeight, 0, "end"));
    expect(Number.isFinite(timelineList.position)).toBe(true);
    expect(Number.isFinite(timelineList.offset)).toBe(true);

    const chatList = new ListState<number>();
    chatList.pushAll(heights);
    const chat = new ChatRenderer(createGraphics(viewportHeight), {
      list: chatList,
      renderItem: (height) => createNode(height),
    });
    chat.jumpTo(2, { animated: false, block: "start" });
    chat.render();
    expect(readChatAnchor(chatList, heights)).toBeCloseTo(expectedChatAnchor(heights, viewportHeight, 2, "start"));
    expect(Number.isFinite(chatList.position)).toBe(true);
    expect(Number.isFinite(chatList.offset)).toBe(true);
  });

  test("jumpTo onComplete runs immediately for non-animated success", () => {
    const list = new ListState<number>();
    list.push(40, 50, 60);
    const renderer = new TimelineRenderer(createGraphics(100), {
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

  test("TimelineRenderer default jumpTo animates smoothly and settles", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const heights = [40, 40, 40, 40, 40, 40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = new TimelineRenderer(createGraphics(100), {
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
        anchors.push(readTimelineAnchor(list, heights));
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

  test("ChatRenderer default jumpTo animates smoothly and settles", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const heights = [40, 40, 40, 40, 40, 40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = new ChatRenderer(createGraphics(100), {
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
        anchors.push(readChatAnchor(list, heights));
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
      const renderer = new TimelineRenderer(createGraphics(100), {
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
      const renderer = new TimelineRenderer(createGraphics(100), {
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
      const expected = new TimelineRenderer(createGraphics(100), {
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
      const renderer = new TimelineRenderer(createGraphics(100), {
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
      const renderer = new ChatRenderer(createGraphics(100), {
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
      const expected = new ChatRenderer(createGraphics(100), {
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
      const renderer = new ChatRenderer(createGraphics(100), {
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

  test("far jump renders without measuring the whole list", () => {
    type Item = { height: number };

    const makeItems = (): Item[] => Array.from({ length: 1000 }, () => ({ height: 12 }));
    const measureCount = { count: 0 };
    const renderItem = memoRenderItem<C, Item>((item) => ({
      flex: false,
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
    const renderer = new TimelineRenderer(createGraphics(120), {
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
      const renderer = new ChatRenderer(createGraphics(viewportHeight), {
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      renderer.jumpTo(1, { block: "start", duration: 200 });

      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      expect(readChatAnchor(list, heights)).toBeCloseTo(expectedChatAnchor(heights, viewportHeight, 1, "start"));
    } finally {
      restoreNow();
    }
  });
});
