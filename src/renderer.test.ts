import { describe, expect, test } from "bun:test";

import { Fixed, Flex, FlexItem, MultilineText, Place, Text } from "./nodes";
import { BaseRenderer, ChatRenderer, DebugRenderer, ListState, TimelineRenderer, memoRenderItem, memoRenderItemBy } from "./renderer";
import type { Box, Context, HitTest, LayoutConstraints, Node, RenderFeedback } from "./types";
import { registerNodeParent, unregisterNodeParent } from "./registry";

type C = CanvasRenderingContext2D;

// @ts-expect-error memoRenderItem now requires object items; use memoRenderItemBy for primitive keys.
const _primitiveMemoContract = memoRenderItem<C, number>((item) => createNode(item));
void _primitiveMemoContract;

class MockOffscreenCanvasRenderingContext2D {
  font = "16px sans-serif";

  measureText(text: string): TextMetrics {
    return {
      width: text.length * 8,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 2,
    } as TextMetrics;
  }
}

class MockOffscreenCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  getContext(type: string): MockOffscreenCanvasRenderingContext2D | null {
    if (type !== "2d") {
      return null;
    }
    return new MockOffscreenCanvasRenderingContext2D();
  }
}

if (typeof globalThis.OffscreenCanvas === "undefined") {
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    configurable: true,
    writable: true,
    value: MockOffscreenCanvas,
  });
}

function createGraphics(viewportHeight: number): C {
  return {
    canvas: {
      clientWidth: 320,
      clientHeight: viewportHeight,
    },
    textRendering: "auto",
    clearRect() {},
    fillText() {},
    measureText() {
      return {
        width: 0,
        fontBoundingBoxAscent: 8,
        fontBoundingBoxDescent: 2,
      } as TextMetrics;
    },
    save() {},
    restore() {},
  } as unknown as C;
}

function createTextGraphics(viewportWidth = 320, viewportHeight = 100): C {
  return {
    canvas: {
      clientWidth: viewportWidth,
      clientHeight: viewportHeight,
    },
    fillStyle: "#000",
    font: "16px sans-serif",
    textAlign: "left",
    textRendering: "auto",
    clearRect() {},
    fillText() {},
    measureText(text: string) {
      return {
        width: text.length * 8,
        fontBoundingBoxAscent: 8,
        fontBoundingBoxDescent: 2,
      } as TextMetrics;
    },
    save() {},
    restore() {},
  } as unknown as C;
}

class ConstraintTestRenderer extends BaseRenderer<C> {
  #contextWithConstraints(constraints?: LayoutConstraints): Context<C> {
    const ctx = this.context;
    ctx.constraints = constraints;
    return ctx;
  }

  drawNode(node: Node<C>, constraints?: LayoutConstraints): boolean {
    return node.draw(this.#contextWithConstraints(constraints), 0, 0);
  }

  hittestNode(node: Node<C>, test: HitTest, constraints?: LayoutConstraints): boolean {
    return node.hittest(this.#contextWithConstraints(constraints), test);
  }
}

function createTextNode(text: string): Text<C> {
  return new Text(text, {
    lineHeight: 20,
    font: "16px sans-serif",
    style: "#000",
  });
}

function createNode(height: number): Node<C> {
  return {
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

type ProbeHit = {
  x: number;
  y: number;
};

function createHitNode(height: number, hits: ProbeHit[]): Node<C> {
  return {
    measure(_ctx: Context<C>): Box {
      return { width: 320, height };
    },
    draw(_ctx: Context<C>, _x: number, _y: number): boolean {
      return false;
    },
    hittest(_ctx: Context<C>, test: HitTest): boolean {
      hits.push({ x: test.x, y: test.y });
      return true;
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
  test("TimelineRenderer hittest is stable before the first render", () => {
    const hits: ProbeHit[] = [];
    const list = new ListState<number>();
    list.push(20);
    const node = createHitNode(20, hits);
    const renderer = new TimelineRenderer(createGraphics(100), {
      list,
      renderItem: () => node,
    });

    expect(renderer.hittest({ x: 12, y: 10, type: "click" })).toBe(true);
    expect(hits).toEqual([{ x: 12, y: 10 }]);

    renderer.render();
    expect(renderer.hittest({ x: 12, y: 10, type: "click" })).toBe(true);
    expect(hits.at(-1)).toEqual({ x: 12, y: 10 });
    expect(renderer.hittest({ x: 12, y: 40, type: "click" })).toBe(false);
  });

  test("ChatRenderer hittest is stable before the first render", () => {
    const hits: ProbeHit[] = [];
    const list = new ListState<number>();
    list.push(20);
    const node = createHitNode(20, hits);
    const renderer = new ChatRenderer(createGraphics(100), {
      list,
      renderItem: () => node,
    });

    expect(renderer.hittest({ x: 16, y: 10, type: "click" })).toBe(true);
    expect(hits).toEqual([{ x: 16, y: 10 }]);

    renderer.render();
    expect(renderer.hittest({ x: 16, y: 10, type: "click" })).toBe(true);
    expect(hits.at(-1)).toEqual({ x: 16, y: 10 });
    expect(renderer.hittest({ x: 16, y: 40, type: "click" })).toBe(false);
  });

  test("TimelineRenderer render and hittest inspect the same visible window", () => {
    const list = new ListState<number>();
    list.push(0, 1, 2, 3, 4, 5);

    const renderSeen: number[] = [];
    const renderRenderer = new TimelineRenderer(createGraphics(60), {
      list,
      renderItem: (item) => {
        renderSeen.push(item);
        return createNode(20);
      },
    });
    renderRenderer.render();

    const hittestSeen: number[] = [];
    const hittestRenderer = new TimelineRenderer(createGraphics(60), {
      list,
      renderItem: (item) => {
        hittestSeen.push(item);
        return createNode(20);
      },
    });
    hittestRenderer.hittest({ x: 0, y: 25, type: "click" });

    expect(hittestSeen).toEqual(renderSeen);
  });

  test("ChatRenderer hittest scales with the visible window instead of the full history", () => {
    const items = Array.from({ length: 1000 }, (_, idx) => idx);
    const measureCount = { count: 0 };
    const list = new ListState<number>();
    list.pushAll(items);

    const renderer = new ChatRenderer(createGraphics(120), {
      list,
      renderItem: () => ({
        measure(_ctx: Context<C>): Box {
          measureCount.count += 1;
          return { width: 320, height: 12 };
        },
        draw(_ctx: Context<C>, _x: number, _y: number): boolean {
          return false;
        },
        hittest(_ctx: Context<C>, _test: HitTest): boolean {
          return false;
        },
      }),
    });

    renderer.hittest({ x: 0, y: 60, type: "hover" });

    expect(measureCount.count).toBeLessThan(20);
  });

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

describe("constraint-aware cache", () => {
  function createMutableGraphics(width: number): C {
    const canvas = { clientWidth: width, clientHeight: 100 };
    return { canvas, textRendering: "auto", clearRect() {}, save() {}, restore() {} } as unknown as C;
  }

  function createConstraintAwareNode(measureFn: (constraints: LayoutConstraints | undefined) => Box): Node<C> {
    return {
      measure(ctx: Context<C>): Box {
        return measureFn(ctx.constraints);
      },
      draw(_ctx: Context<C>, _x: number, _y: number): boolean {
        return false;
      },
      hittest(_ctx: Context<C>, _test: HitTest): boolean {
        return false;
      },
    };
  }

  test("different constraints produce independent cache entries", () => {
    let calls = 0;
    const node = createConstraintAwareNode((constraints) => {
      calls++;
      return { width: constraints?.maxWidth ?? 320, height: 40 };
    });

    const renderer = new BaseRenderer(createMutableGraphics(320), {});

    const box200 = renderer.measureNode(node, { maxWidth: 200 });
    const box100 = renderer.measureNode(node, { maxWidth: 100 });
    expect(box200.width).toBe(200);
    expect(box100.width).toBe(100);
    expect(calls).toBe(2);

    // 第二次调用应命中缓存，不触发 measure
    const box200b = renderer.measureNode(node, { maxWidth: 200 });
    const box100b = renderer.measureNode(node, { maxWidth: 100 });
    expect(box200b.width).toBe(200);
    expect(box100b.width).toBe(100);
    expect(calls).toBe(2);
  });

  test("unconstrained and constrained measurements are cached separately", () => {
    let calls = 0;
    const node = createConstraintAwareNode((constraints) => {
      calls++;
      return { width: constraints?.maxWidth ?? 320, height: 40 };
    });

    const renderer = new BaseRenderer(createMutableGraphics(320), {});

    const boxUnconstrained = renderer.measureNode(node);
    const boxConstrained = renderer.measureNode(node, { maxWidth: 200 });
    expect(boxUnconstrained.width).toBe(320);
    expect(boxConstrained.width).toBe(200);
    expect(calls).toBe(2);

    // 再次调用应命中缓存
    renderer.measureNode(node);
    renderer.measureNode(node, { maxWidth: 200 });
    expect(calls).toBe(2);
  });

  test("invalidateNode clears all constraint variants for the node", () => {
    let calls = 0;
    const node = createConstraintAwareNode((constraints) => {
      calls++;
      return { width: constraints?.maxWidth ?? 320, height: 40 };
    });

    const renderer = new BaseRenderer(createMutableGraphics(320), {});
    renderer.measureNode(node, { maxWidth: 200 });
    renderer.measureNode(node, { maxWidth: 100 });
    expect(calls).toBe(2);

    renderer.invalidateNode(node);

    // 失效后两个约束都需要重新测量
    renderer.measureNode(node, { maxWidth: 200 });
    renderer.measureNode(node, { maxWidth: 100 });
    expect(calls).toBe(4);
  });

  test("invalidateNode also invalidates ancestor caches for all constraint variants", () => {
    let childCalls = 0;
    let parentCalls = 0;

    const child = createConstraintAwareNode((constraints) => {
      childCalls++;
      return { width: constraints?.maxWidth ?? 100, height: 20 };
    });

    const parent = createConstraintAwareNode((_constraints) => {
      parentCalls++;
      return { width: 200, height: 40 };
    });

    registerNodeParent(child, parent);
    try {
      const renderer = new BaseRenderer(createMutableGraphics(320), {});
      renderer.measureNode(parent, { maxWidth: 300 });
      renderer.measureNode(parent, { maxWidth: 200 });
      renderer.measureNode(child, { maxWidth: 100 });
      expect(parentCalls).toBe(2);
      expect(childCalls).toBe(1);

      // 失效子节点应同时失效父节点的全部缓存
      renderer.invalidateNode(child);

      renderer.measureNode(parent, { maxWidth: 300 });
      renderer.measureNode(parent, { maxWidth: 200 });
      expect(parentCalls).toBe(4);
    } finally {
      unregisterNodeParent(child);
    }
  });

  test("invalidateNode follows the current ownership chain after replacing a wrapper child", () => {
    function createMutableNode(initialWidth: number): {
      node: Node<C>;
      setWidth: (width: number) => void;
    } {
      let width = initialWidth;
      return {
        setWidth(nextWidth) {
          width = nextWidth;
        },
        node: {
          measure(): Box {
            return { width, height: 20 };
          },
          draw(): boolean {
            return false;
          },
          hittest(): boolean {
            return false;
          },
        },
      };
    }

    const first = createMutableNode(20);
    const second = createMutableNode(40);
    const wrapper = new Place<C>(first.node, { align: "start", expand: false });
    const renderer = new BaseRenderer(createTextGraphics(), {});

    expect(renderer.measureNode(wrapper).width).toBe(20);

    wrapper.inner = second.node;
    second.setWidth(60);
    expect(renderer.measureNode(wrapper).width).toBe(60);

    first.setWidth(100);
    renderer.invalidateNode(first.node);
    expect(renderer.measureNode(wrapper).width).toBe(60);

    second.setWidth(80);
    renderer.invalidateNode(second.node);
    expect(renderer.measureNode(wrapper).width).toBe(80);
  });

  test("Flex copies constructor children so external array mutation cannot alter the tree", () => {
    const source = [new Fixed<C>(10, 10)];
    const flex = new Flex<C>(source, {
      direction: "row",
      gap: 5,
      mainAxisSize: "fit-content",
    });
    const renderer = new BaseRenderer(createTextGraphics(), {});

    expect(flex.children).toHaveLength(1);
    expect(renderer.measureNode(flex).width).toBe(10);

    source.push(new Fixed<C>(20, 10));

    expect(flex.children).toHaveLength(1);
    expect(renderer.measureNode(flex).width).toBe(10);
  });

  test("replaceChildren refreshes ownership and cached layout automatically", () => {
    function createMutableNode(initialWidth: number): {
      node: Node<C>;
      setWidth: (width: number) => void;
    } {
      let width = initialWidth;
      return {
        setWidth(nextWidth) {
          width = nextWidth;
        },
        node: {
          measure(): Box {
            return { width, height: 20 };
          },
          draw(): boolean {
            return false;
          },
          hittest(): boolean {
            return false;
          },
        },
      };
    }

    const first = createMutableNode(20);
    const second = createMutableNode(40);
    const flex = new Flex<C>([first.node], {
      direction: "row",
      mainAxisSize: "fit-content",
    });
    const renderer = new BaseRenderer(createTextGraphics(), {});

    expect(renderer.measureNode(flex).width).toBe(20);

    flex.replaceChildren([second.node]);
    second.setWidth(60);
    expect(renderer.measureNode(flex).width).toBe(60);

    expect(() => new Place<C>(first.node, { align: "start" })).not.toThrow();
    expect(() => new Place<C>(second.node, { align: "start" })).toThrow(
      "A node can only be attached to one parent. Shared nodes are not supported.",
    );

    second.setWidth(80);
    renderer.invalidateNode(second.node);
    expect(renderer.measureNode(flex).width).toBe(80);
  });

  test("canvas width change clears all constraint variants", () => {
    let calls = 0;
    const node = createConstraintAwareNode((constraints) => {
      calls++;
      return { width: constraints?.maxWidth ?? 320, height: 40 };
    });

    const graphics = createMutableGraphics(320);
    const renderer = new BaseRenderer(graphics, {});

    renderer.measureNode(node, { maxWidth: 200 });
    renderer.measureNode(node, { maxWidth: 100 });
    expect(calls).toBe(2);

    // 模拟视口宽度变化
    (graphics.canvas as unknown as { clientWidth: number }).clientWidth = 480;

    // 宽度变化后所有约束变体都应重新测量
    renderer.measureNode(node, { maxWidth: 200 });
    renderer.measureNode(node, { maxWidth: 100 });
    expect(calls).toBe(4);
  });

  test("cache inner map does not grow beyond MAX_CONSTRAINT_VARIANTS", () => {
    let calls = 0;
    const node = createConstraintAwareNode((constraints) => {
      calls++;
      return { width: constraints?.maxWidth ?? 320, height: 40 };
    });

    const renderer = new BaseRenderer(createMutableGraphics(320), {});

    // 用远超 MAX_CONSTRAINT_VARIANTS (8) 个不同约束测量同一节点
    const N = 100;
    for (let w = 1; w <= N; w++) {
      const box = renderer.measureNode(node, { maxWidth: w });
      expect(box.width).toBe(w);
    }
    expect(calls).toBe(N);

    // 缓存只保留最后 8 个条目（MAX_CONSTRAINT_VARIANTS），最近测量的不应再触发 measure
    const callsBefore = calls;
    for (let w = N - 7; w <= N; w++) {
      renderer.measureNode(node, { maxWidth: w });
    }
    expect(calls).toBe(callsBefore); // 最后 8 个应全部命中缓存

    // 早期被驱逐的条目需要重新测量
    renderer.measureNode(node, { maxWidth: 1 });
    expect(calls).toBe(callsBefore + 1);
  });
});

describe("memoized render items", () => {
  test("memoRenderItemBy supports primitive keys with explicit reset", () => {
    let renders = 0;
    const renderItem = memoRenderItemBy<C, number, number>(
      (item) => item,
      (item) => {
        renders += 1;
        return createNode(item);
      },
    );

    const first = renderItem(1);
    const second = renderItem(1);
    const third = renderItem(2);

    expect(first).toBe(second);
    expect(third).not.toBe(first);
    expect(renders).toBe(2);

    expect(renderItem.resetKey(1)).toBe(true);
    const fourth = renderItem(1);
    expect(fourth).not.toBe(first);
    expect(renders).toBe(3);
  });

  test("memoRenderItem throws a clear runtime error for primitive items", () => {
    const renderItem = memoRenderItem<C, { value: number }>((item) => createNode(item.value));
    const unsafe = renderItem as unknown as (item: number) => Node<C>;

    expect(() => unsafe(1)).toThrow(
      "memoRenderItem() only supports object items. Use memoRenderItemBy() for primitive keys.",
    );
  });
});

describe("root constraints", () => {
  test("DebugRenderer supplies viewport maxWidth to root draw and hittest", () => {
    const seen: Array<number | undefined> = [];
    const node: Node<C> = {
      measure(ctx) {
        seen.push(ctx.constraints?.maxWidth);
        return { width: 0, height: 0 };
      },
      draw(ctx) {
        seen.push(ctx.constraints?.maxWidth);
        return false;
      },
      hittest(ctx) {
        seen.push(ctx.constraints?.maxWidth);
        return true;
      },
    };

    const renderer = new DebugRenderer(createTextGraphics(180, 100), {});
    renderer.draw(node);
    renderer.hittest(node, { x: 0, y: 0, type: "click" });

    expect(seen).toEqual([180, 180, 180]);
  });

  test("DebugRenderer measures layout nodes before root draw and hittest", () => {
    const drawXs: number[] = [];
    const hitXs: number[] = [];
    const leaf: Node<C> = {
      measure() {
        return { width: 20, height: 20 };
      },
      draw(_ctx, x) {
        drawXs.push(x);
        return false;
      },
      hittest(_ctx, test) {
        hitXs.push(test.x);
        return true;
      },
    };

    const node = new Place<C>(leaf, { align: "end" });
    const renderer = new DebugRenderer(createTextGraphics(100, 100), {});

    renderer.draw(node);
    expect(drawXs).toEqual([80]);

    renderer.hittest(node, { x: 90, y: 10, type: "click" });
    expect(hitXs).toEqual([10]);
  });

  test("virtualized renderers measure items with viewport maxWidth", () => {
    const timelineWidths: Array<number | undefined> = [];
    const chatWidths: Array<number | undefined> = [];
    const list = new ListState<number>();
    list.push(1);

    const timeline = new TimelineRenderer(createTextGraphics(180, 100), {
      list,
      renderItem: () => ({
        measure(ctx) {
          timelineWidths.push(ctx.constraints?.maxWidth);
          return { width: 0, height: 20 };
        },
        draw() {
          return false;
        },
        hittest() {
          return false;
        },
      }),
    });

    const chatList = new ListState<number>();
    chatList.push(1);
    const chat = new ChatRenderer(createTextGraphics(220, 100), {
      list: chatList,
      renderItem: () => ({
        measure(ctx) {
          chatWidths.push(ctx.constraints?.maxWidth);
          return { width: 0, height: 20 };
        },
        draw() {
          return false;
        },
        hittest() {
          return false;
        },
      }),
    });

    timeline.render();
    chat.render();

    expect(timelineWidths).toContain(180);
    expect(chatWidths).toContain(220);
  });
});

describe("stateless layout results", () => {
  test("place layout results stay isolated across repeated constraint measurements", () => {
    const drawXs: number[] = [];
    const hitXs: number[] = [];
    const follower: Node<C> = {
      measure() {
        return { width: 20, height: 20 };
      },
      draw(_ctx, x) {
        drawXs.push(x);
        return false;
      },
      hittest(_ctx, test) {
        hitXs.push(test.x);
        return true;
      },
    };

    const node = new Place<C>(follower, {
      align: "end",
    });
    const renderer = new ConstraintTestRenderer(createTextGraphics(), {});

    renderer.measureNode(node, { maxWidth: 200 });
    renderer.measureNode(node, { maxWidth: 100 });

    renderer.drawNode(node, { maxWidth: 200 });
    expect(drawXs.at(-1)).toBe(180);

    expect(renderer.hittestNode(node, { x: 190, y: 10, type: "click" }, { maxWidth: 200 })).toBe(true);
    expect(hitXs.at(-1)).toBe(10);
  });

  test("nested groups draw and hittest with their own child constraints", () => {
    const drawXs: number[] = [];
    const hitXs: number[] = [];
    const tail: Node<C> = {
      measure() {
        return { width: 20, height: 20 };
      },
      draw(_ctx, x) {
        drawXs.push(x);
        return false;
      },
      hittest(_ctx, test) {
        hitXs.push(test.x);
        return true;
      },
    };

    const nested = new Place<C>(tail, {
      align: "end",
    });
    const root = new Flex<C>([
      new Fixed(30, 20),
      new FlexItem(nested, { grow: 1 }),
    ], {
      direction: "row",
    });
    const renderer = new ConstraintTestRenderer(createTextGraphics(), {});

    renderer.measureNode(root, { maxWidth: 200 });
    renderer.measureNode(root, { maxWidth: 100 });

    renderer.drawNode(root, { maxWidth: 200 });
    expect(drawXs.at(-1)).toBe(180);

    expect(renderer.hittestNode(root, { x: 190, y: 10, type: "click" }, { maxWidth: 200 })).toBe(true);
    expect(hitXs.at(-1)).toBe(10);
  });

  test("text nodes measure safely across multiple constraint variants", () => {
    const renderer = new BaseRenderer(createTextGraphics(), {});
    const singleLine = createTextNode("alpha beta gamma delta epsilon zeta eta theta");
    const multiLine = new MultilineText<C>("alpha beta gamma delta epsilon zeta eta theta\niota kappa lambda mu nu xi omicron", {
      alignment: "left",
      lineHeight: 20,
      font: "16px sans-serif",
      style: "#000",
    });

    const wideSingle = renderer.measureNode(singleLine, { maxWidth: 200 });
    const narrowSingle = renderer.measureNode(singleLine, { maxWidth: 60 });
    const wideSingleAgain = renderer.measureNode(singleLine, { maxWidth: 200 });
    expect(wideSingleAgain).toEqual(wideSingle);
    expect(narrowSingle.width).toBeLessThanOrEqual(60);
    expect(wideSingle.width).toBeGreaterThanOrEqual(narrowSingle.width);

    const wideMulti = renderer.measureNode(multiLine, { maxWidth: 200 });
    const narrowMulti = renderer.measureNode(multiLine, { maxWidth: 60 });
    const wideMultiAgain = renderer.measureNode(multiLine, { maxWidth: 200 });
    expect(wideMultiAgain).toEqual(wideMulti);
    expect(narrowMulti.width).toBeLessThanOrEqual(60);
    expect(narrowMulti.height).toBeGreaterThanOrEqual(wideMulti.height);
  });
});
