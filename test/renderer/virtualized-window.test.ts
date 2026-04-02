import { describe, expect, test } from "bun:test";

import { ChatRenderer, ListState, TimelineRenderer } from "../../src/renderer";
import type { Box, Context, HitTest, RenderFeedback } from "../../src/types";
import { createGraphics } from "../helpers/graphics";
import {
  createFeedback,
  createHitNode,
  createNode,
  expectFiniteFeedback,
  expectNaNFeedback,
  type ProbeHit,
} from "../helpers/renderer-fixtures";

type C = CanvasRenderingContext2D;

describe("virtualized visible window", () => {
  test("TimelineRenderer hittest is stable before the first render", () => {
    const hits: ProbeHit[] = [];
    const list = new ListState<number>();
    list.push(20);
    const node = createHitNode(20, hits);
    const renderer = new TimelineRenderer(createGraphics(100), {
      list,
      renderItem: () => node,
    });

    expect(list.position).toBeUndefined();

    expect(renderer.hittest({ x: 12, y: 10, type: "click" })).toBe(true);
    expect(hits).toEqual([{ x: 12, y: 10 }]);
    expect(list.position).toBeUndefined();
    expect(list.offset).toBe(0);

    renderer.render();
    expect(list.position).toBe(0);
    expect(list.offset).toBe(0);
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

    expect(list.position).toBeUndefined();

    expect(renderer.hittest({ x: 16, y: 10, type: "click" })).toBe(true);
    expect(hits).toEqual([{ x: 16, y: 10 }]);
    expect(list.position).toBeUndefined();
    expect(list.offset).toBe(0);

    renderer.render();
    expect(list.position).toBe(0);
    expect(list.offset).toBe(0);
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
});
