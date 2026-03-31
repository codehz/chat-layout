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
    expect(feedback.min).toBe(0);
    expect(feedback.max).toBe(0.5);
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
    expect(feedback.min).toBe(0.5);
    expect(feedback.max).toBe(1);
    expect(feedback.max).toBeGreaterThanOrEqual(feedback.min);
  });
});