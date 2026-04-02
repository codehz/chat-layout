import { describe, expect, test } from "bun:test";

import { AlignBox, Fixed, PaddingBox, Place, Text } from "./nodes";
import { BaseRenderer } from "./renderer";
import type { Context, HitTest, LayoutConstraints, Node } from "./types";

type C = CanvasRenderingContext2D;

type ProbeCall = {
  x: number;
  y: number;
};

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

function createGraphics(viewportWidth = 320, viewportHeight = 100): C {
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
    if (constraints?.maxWidth != null) {
      ctx.remainingWidth = constraints.maxWidth;
    }
    return ctx;
  }

  drawNode(node: Node<C>, constraints?: LayoutConstraints): boolean {
    return node.draw(this.#contextWithConstraints(constraints), 0, 0);
  }

  hittestNode(node: Node<C>, test: HitTest, constraints?: LayoutConstraints): boolean {
    return node.hittest(this.#contextWithConstraints(constraints), test);
  }
}

function createProbeNode(): {
  node: Node<C>;
  draws: ProbeCall[];
  hits: ProbeCall[];
} {
  const draws: ProbeCall[] = [];
  const hits: ProbeCall[] = [];
  return {
    draws,
    hits,
    node: {
      flex: false,
      measure() {
        return { width: 20, height: 10 };
      },
      draw(_ctx, x, y) {
        draws.push({ x, y });
        return false;
      },
      hittest(_ctx, test) {
        hits.push({ x: test.x, y: test.y });
        return true;
      },
    },
  };
}

function createBubble(): PaddingBox<C> {
  return new PaddingBox(
    new Text("alpha beta gamma delta epsilon zeta eta theta", {
      lineHeight: 20,
      font: "16px sans-serif",
      style: "#000",
    }),
    {
      top: 6,
      bottom: 6,
      left: 10,
      right: 10,
    },
  );
}

describe("Place", () => {
  test("produces expected child rects for start, center, and end alignment", () => {
    const renderer = new BaseRenderer(createGraphics(), {});
    const constraints = { maxWidth: 100 };

    for (const [align, expectedX] of [
      ["start", 0],
      ["center", 40],
      ["end", 80],
    ] as const) {
      const node = new Place<C>(new Fixed(20, 10), { align });
      const box = renderer.measureNode(node, constraints);
      const layout = renderer.getLayoutResult(node, constraints);

      expect(box).toEqual({ width: 100, height: 10 });
      expect(layout?.containerBox).toEqual({ x: 0, y: 0, width: 100, height: 10 });
      expect(layout?.children[0]?.rect).toEqual({ x: expectedX, y: 0, width: 20, height: 10 });
    }
  });

  test("uses layout results consistently for draw and hittest", () => {
    const { node: probe, draws, hits } = createProbeNode();
    const renderer = new ConstraintTestRenderer(createGraphics(), {});
    const place = new Place<C>(probe, { align: "center" });
    const constraints = { maxWidth: 100 };

    renderer.measureNode(place, constraints);
    renderer.drawNode(place, constraints);
  expect(draws).toHaveLength(1);
    expect(draws[0]).toEqual({ x: 40, y: 0 });

    expect(renderer.hittestNode(place, { x: 50, y: 5, type: "click" }, constraints)).toBe(true);
    expect(hits[0]).toEqual({ x: 10, y: 5 });
    expect(renderer.hittestNode(place, { x: 5, y: 5, type: "click" }, constraints)).toBe(false);
  });

  test("matches AlignBox for a padded text bubble migration", () => {
    const renderer = new BaseRenderer(createGraphics(), {});
    const constraints = { maxWidth: 180 };
    const legacy = new AlignBox<C>(createBubble(), { alignment: "right" });
    const modern = new Place<C>(createBubble(), { align: "end" });

    const legacyBox = renderer.measureNode(legacy, constraints);
    const modernBox = renderer.measureNode(modern, constraints);
    const legacyLayout = renderer.getLayoutResult(legacy, constraints);
    const modernLayout = renderer.getLayoutResult(modern, constraints);

    expect(modernBox).toEqual(legacyBox);
    expect(modernLayout?.containerBox).toEqual(legacyLayout?.containerBox);
    expect(modernLayout?.children[0]?.rect).toEqual(legacyLayout?.children[0]?.rect);
  });
});
