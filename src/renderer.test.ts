import { describe, expect, test } from "bun:test";

import { ChatRenderer, ListState, TimelineRenderer } from "./renderer";
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
});
