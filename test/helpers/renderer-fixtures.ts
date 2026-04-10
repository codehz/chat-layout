import { expect } from "bun:test";

import { Text } from "../../src/nodes";
import { BaseRenderer, ListState } from "../../src/renderer";
import type { ListAnchorMode } from "../../src/renderer";
import type {
  Box,
  Context,
  HitTest,
  LayoutConstraints,
  Node,
  RenderFeedback,
} from "../../src/types";

type C = CanvasRenderingContext2D;

export type ProbeHit = {
  x: number;
  y: number;
};

export class ConstraintTestRenderer extends BaseRenderer<C> {
  #contextWithConstraints(constraints?: LayoutConstraints): Context<C> {
    const ctx = this.context;
    ctx.constraints = constraints;
    return ctx;
  }

  measureMinContentNode(node: Node<C>, constraints?: LayoutConstraints): Box {
    const ctx = this.#contextWithConstraints(constraints);
    return node.measureMinContent?.(ctx) ?? node.measure(ctx);
  }

  drawNode(node: Node<C>, constraints?: LayoutConstraints): boolean {
    return node.draw(this.#contextWithConstraints(constraints), 0, 0);
  }

  hittestNode(
    node: Node<C>,
    test: HitTest,
    constraints?: LayoutConstraints,
  ): boolean {
    return node.hittest(this.#contextWithConstraints(constraints), test);
  }
}

export function createTextNode(text: string): Text<C> {
  return new Text(text, {
    lineHeight: 20,
    font: "16px sans-serif",
    color: "#000",
  });
}

export function createNode(height: number): Node<C> {
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

export function createHitNode(height: number, hits: ProbeHit[]): Node<C> {
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

export function createFeedback(): RenderFeedback {
  return {
    minIdx: Number.NaN,
    maxIdx: Number.NaN,
    min: Number.NaN,
    max: Number.NaN,
  };
}

export function expectFiniteFeedback(feedback: RenderFeedback): void {
  expect(Number.isFinite(feedback.min)).toBe(true);
  expect(Number.isFinite(feedback.max)).toBe(true);
  expect(Number.isFinite(feedback.minIdx)).toBe(true);
  expect(Number.isFinite(feedback.maxIdx)).toBe(true);
  expect(feedback.max).toBeGreaterThanOrEqual(feedback.min);
  expect(feedback.maxIdx).toBeGreaterThanOrEqual(feedback.minIdx);
}

export function expectNaNFeedback(feedback: RenderFeedback): void {
  expect(Number.isNaN(feedback.minIdx)).toBe(true);
  expect(Number.isNaN(feedback.maxIdx)).toBe(true);
  expect(Number.isNaN(feedback.min)).toBe(true);
  expect(Number.isNaN(feedback.max)).toBe(true);
}

function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length - 1);
}

export function readAnchor(
  list: ListState<number>,
  heights: number[],
  anchorMode: ListAnchorMode,
): number {
  const currentPosition = list.position;
  const position = clampIndex(
    typeof currentPosition === "number" && Number.isFinite(currentPosition)
      ? Math.trunc(currentPosition)
      : anchorMode === "top"
        ? 0
        : heights.length - 1,
    heights.length,
  );
  const height = heights[position];
  if (anchorMode === "top") {
    return height > 0 ? position - list.offset / height : position;
  }
  return height > 0 ? position + 1 - list.offset / height : position + 1;
}

function readAnchorAtOffset(
  heights: number[],
  index: number,
  offset: number,
): number {
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

export function expectedAnchor(
  heights: number[],
  viewportHeight: number,
  index: number,
  block: "start" | "center" | "end",
  anchorMode: ListAnchorMode,
): number {
  const height = heights[index];
  if (anchorMode === "top") {
    switch (block) {
      case "start":
        return readAnchorAtOffset(heights, index, 0);
      case "center":
        return readAnchorAtOffset(
          heights,
          index,
          height / 2 - viewportHeight / 2,
        );
      case "end":
        return readAnchorAtOffset(heights, index, height - viewportHeight);
    }
  }

  switch (block) {
    case "start":
      return readAnchorAtOffset(heights, index, viewportHeight);
    case "center":
      return readAnchorAtOffset(
        heights,
        index,
        height / 2 + viewportHeight / 2,
      );
    case "end":
      return readAnchorAtOffset(heights, index, height);
  }
}
