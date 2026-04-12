import { describe, expect, test } from "bun:test";

import type { ListAnchorMode } from "../../src/renderer";
import {
  ListRenderer,
  ListState,
  type ListPadding,
  type ListUnderflowAlign,
} from "../../src/renderer";
import type {
  Box,
  Context,
  HitTest,
  Node,
  RenderFeedback,
} from "../../src/types";
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

function createRenderer<T extends {}>(
  viewportHeight: number,
  options: {
    anchorMode: ListAnchorMode;
    underflowAlign?: ListUnderflowAlign;
    padding?: ListPadding;
    list: ListState<T>;
    renderItem: (item: T) => Node<C>;
  },
): ListRenderer<C, T> {
  return new ListRenderer(createGraphics(viewportHeight), options);
}

describe("virtualized visible window", () => {
  test("top-anchor hittest is stable before the first render", () => {
    const hits: ProbeHit[] = [];
    const list = new ListState<number>();
    list.push(20);
    const node = createHitNode(20, hits);
    const renderer = createRenderer(100, {
      anchorMode: "top",
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

  test("bottom-anchor hittest is stable before the first render", () => {
    const hits: ProbeHit[] = [];
    const list = new ListState<number>();
    list.push(20);
    const node = createHitNode(20, hits);
    const renderer = createRenderer(100, {
      anchorMode: "bottom",
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

  test("bottom underflow alignment places short-list hittest at the rendered bottom edge", () => {
    const hits: ProbeHit[] = [];
    const list = new ListState<number>();
    list.push(20);
    const node = createHitNode(20, hits);
    const renderer = createRenderer(100, {
      anchorMode: "top",
      underflowAlign: "bottom",
      list,
      renderItem: () => node,
    });

    expect(renderer.hittest({ x: 12, y: 10, type: "click" })).toBe(false);
    expect(renderer.hittest({ x: 12, y: 90, type: "click" })).toBe(true);
    expect(hits).toEqual([{ x: 12, y: 10 }]);

    renderer.render();
    expect(list.position).toBe(0);
    expect(list.offset).toBe(0);
    expect(renderer.hittest({ x: 12, y: 10, type: "click" })).toBe(false);
    expect(renderer.hittest({ x: 12, y: 90, type: "click" })).toBe(true);
    expect(hits.at(-1)).toEqual({ x: 12, y: 10 });
  });

  test("top-anchor render and hittest inspect the same visible window", () => {
    const list = new ListState<number>();
    list.push(0, 1, 2, 3, 4, 5);

    const renderSeen: number[] = [];
    const renderRenderer = createRenderer(60, {
      anchorMode: "top",
      list,
      renderItem: (item) => {
        renderSeen.push(item);
        return createNode(20);
      },
    });
    renderRenderer.render();

    const hittestSeen: number[] = [];
    const hittestRenderer = createRenderer(60, {
      anchorMode: "top",
      list,
      renderItem: (item) => {
        hittestSeen.push(item);
        return createNode(20);
      },
    });
    hittestRenderer.hittest({ x: 0, y: 25, type: "click" });

    expect(hittestSeen).toEqual(renderSeen);
  });

  test("bottom-anchor hittest scales with the visible window instead of the full history", () => {
    const items = Array.from({ length: 1000 }, (_, idx) => idx);
    const measureCount = { count: 0 };
    const list = new ListState<number>();
    list.pushAll(items);

    const renderer = createRenderer(120, {
      anchorMode: "bottom",
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

  test("top-anchor reports a monotonic visible range for an oversized item", () => {
    const list = new ListState<number>();
    list.push(200);

    const renderer = createRenderer(100, {
      anchorMode: "top",
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
    expect(feedback.canAutoFollowTop).toBe(true);
    expect(feedback.canAutoFollowBottom).toBe(false);
  });

  test("bottom-anchor reports a monotonic visible range for an oversized item", () => {
    const list = new ListState<number>();
    list.push(200);

    const renderer = createRenderer(100, {
      anchorMode: "bottom",
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
    expect(feedback.canAutoFollowTop).toBe(false);
    expect(feedback.canAutoFollowBottom).toBe(true);
  });

  test("top-anchor keeps feedback finite and smooth while crossing into an oversized item", () => {
    const list = new ListState<number>();
    list.push(40, 300, 40);

    const renderer = createRenderer(100, {
      anchorMode: "top",
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
        expect(feedback.min - previous.min).toBeLessThanOrEqual(
          0.25 + Number.EPSILON,
        );
        expect(feedback.max - previous.max).toBeLessThanOrEqual(
          0.25 + Number.EPSILON,
        );
      }

      previous = { ...feedback };
    }
  });

  test("bottom-anchor keeps feedback finite and smooth while crossing into an oversized item", () => {
    const list = new ListState<number>();
    list.push(40, 300, 40);

    const renderer = createRenderer(100, {
      anchorMode: "bottom",
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
        expect(previous.min - feedback.min).toBeLessThanOrEqual(
          0.25 + Number.EPSILON,
        );
        expect(previous.max - feedback.max).toBeLessThanOrEqual(
          0.25 + Number.EPSILON,
        );
      }

      previous = { ...feedback };
    }
  });

  test("top-anchor reports edge indices for mixed partially visible items", () => {
    const list = new ListState<number>();
    list.push(50, 50, 50);
    list.applyScroll(-25);

    const renderer = createRenderer(100, {
      anchorMode: "top",
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

  test("bottom-anchor reports edge indices for mixed partially visible items", () => {
    const list = new ListState<number>();
    list.push(50, 50, 50);
    list.applyScroll(25);

    const renderer = createRenderer(100, {
      anchorMode: "bottom",
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

    const renderer = createRenderer(100, {
      anchorMode: "top",
      list,
      renderItem: (height) => createNode(height),
    });

    const feedback = createFeedback();
    renderer.render(feedback);
    expectFiniteFeedback(feedback);

    list.reset();
    renderer.render(feedback);
    expectNaNFeedback(feedback);
    expect(feedback.canAutoFollowTop).toBe(false);
    expect(feedback.canAutoFollowBottom).toBe(false);
  });

  test("zero-height items do not contaminate feedback", () => {
    const list = new ListState<number>();
    list.push(50, 0, 100);

    const renderer = createRenderer(100, {
      anchorMode: "top",
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

  test("feedback reports top and bottom auto-follow capabilities from the rendered window", () => {
    const list = new ListState<number>();
    list.push(50, 50, 50);

    const renderer = createRenderer(100, {
      anchorMode: "top",
      list,
      renderItem: (height) => createNode(height),
    });

    const topFeedback = createFeedback();
    renderer.render(topFeedback);
    expect(topFeedback.canAutoFollowTop).toBe(true);
    expect(topFeedback.canAutoFollowBottom).toBe(false);

    list.applyScroll(-25);
    const middleFeedback = createFeedback();
    renderer.render(middleFeedback);
    expect(middleFeedback.canAutoFollowTop).toBe(false);
    expect(middleFeedback.canAutoFollowBottom).toBe(false);

    renderer.jumpToBottom({ animated: false });
    const bottomFeedback = createFeedback();
    renderer.render(bottomFeedback);
    expect(bottomFeedback.canAutoFollowTop).toBe(false);
    expect(bottomFeedback.canAutoFollowBottom).toBe(true);
  });

  test("short fully visible lists can auto-follow both boundaries", () => {
    const list = new ListState<number>();
    list.push(20, 20);

    const renderer = createRenderer(120, {
      anchorMode: "top",
      list,
      renderItem: (height) => createNode(height),
    });

    const feedback = createFeedback();
    renderer.render(feedback);

    expect(feedback.canAutoFollowTop).toBe(true);
    expect(feedback.canAutoFollowBottom).toBe(true);
  });

  test("viewport width changes strictly recompute the latched auto-follow state", () => {
    const list = new ListState<number>();
    list.push(0);

    const renderer = createRenderer(100, {
      anchorMode: "top",
      list,
      renderItem: () => ({
        measure(ctx: Context<C>): Box {
          return {
            width: 320,
            height: (ctx.constraints?.maxWidth ?? 320) <= 160 ? 120 : 40,
          };
        },
        draw(_ctx: Context<C>, _x: number, _y: number): boolean {
          return false;
        },
        hittest(_ctx: Context<C>, _test: HitTest): boolean {
          return false;
        },
      }),
    });

    const wideFeedback = createFeedback();
    renderer.render(wideFeedback);
    expect(wideFeedback.canAutoFollowTop).toBe(true);
    expect(wideFeedback.canAutoFollowBottom).toBe(true);

    (
      renderer.graphics.canvas as unknown as { clientWidth: number }
    ).clientWidth = 120;

    const narrowFeedback = createFeedback();
    renderer.render(narrowFeedback);
    expect(narrowFeedback.canAutoFollowTop).toBe(true);
    expect(narrowFeedback.canAutoFollowBottom).toBe(false);
  });

  test("padding areas still draw content and allow hittest while feedback only counts the content viewport", () => {
    const hits: ProbeHit[] = [];
    const list = new ListState<number>();
    list.push(50, 50);

    const renderer = createRenderer(100, {
      anchorMode: "top",
      padding: { top: 10, bottom: 10 },
      list,
      renderItem: (height) => createHitNode(height, hits),
    });

    const feedback = createFeedback();
    renderer.render(feedback);

    expect(renderer.hittest({ x: 10, y: 95, type: "click" })).toBe(true);
    expect(hits.at(-1)).toEqual({ x: 10, y: 35 });
    expect(feedback.minIdx).toBe(0);
    expect(feedback.maxIdx).toBe(1);
    expect(feedback.min).toBeCloseTo(0);
    expect(feedback.max).toBeCloseTo(1.6);
  });

  test("collapsed content viewport still allows draw and hittest through padding while feedback stays empty", () => {
    const hits: ProbeHit[] = [];
    const list = new ListState<number>();
    list.push(30);

    const renderer = createRenderer(100, {
      anchorMode: "top",
      padding: { top: 60, bottom: 50 },
      list,
      renderItem: (height) => createHitNode(height, hits),
    });

    const feedback = createFeedback();
    renderer.render(feedback);

    expect(renderer.hittest({ x: 10, y: 70, type: "click" })).toBe(true);
    expect(hits.at(-1)).toEqual({ x: 10, y: 10 });
    expectNaNFeedback(feedback);
  });
});
