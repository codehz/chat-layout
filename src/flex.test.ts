import { describe, expect, test } from "bun:test";

import { Fixed, Flex, FlexItem } from "./nodes";
import { BaseRenderer } from "./renderer";
import type { Context, HitTest, LayoutConstraints, Node } from "./types";

type C = CanvasRenderingContext2D;

type ProbeHit = {
  x: number;
  y: number;
  label: string;
};

type ProbeDraw = {
  x: number;
  y: number;
  label: string;
};

function createGraphics(viewportWidth = 320, viewportHeight = 120): C {
  return {
    canvas: {
      clientWidth: viewportWidth,
      clientHeight: viewportHeight,
    },
    textRendering: "auto",
    clearRect() {},
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

function createProbe(label: string, width = 10, height = 10, draws: ProbeDraw[] = [], hits: ProbeHit[] = []): Node<C> {
  return {
    flex: false,
    measure() {
      return { width, height };
    },
    draw(_ctx, x, y) {
      draws.push({ x, y, label });
      return false;
    },
    hittest(_ctx, test) {
      hits.push({ x: test.x, y: test.y, label });
      return true;
    },
  };
}

describe("Flex", () => {
  test("row direction distributes grow space proportionally and keeps content boxes separate", () => {
    const renderer = new BaseRenderer(createGraphics(), {});
    const constraints = { maxWidth: 100 };
    const node = new Flex<C>([
      new Fixed(10, 10),
      new FlexItem(new Fixed(10, 10), { grow: 1 }),
      new FlexItem(new Fixed(10, 10), { grow: 2 }),
    ], {
      direction: "row",
      gap: 5,
    });

    const box = renderer.measureNode(node, constraints);
    const layout = renderer.getLayoutResult(node, constraints);

    expect(box).toEqual({ width: 100, height: 10 });
    expect(layout?.children).toHaveLength(3);
    expect(layout?.children[0]?.rect).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(layout?.children[1]?.rect.x).toBeCloseTo(15);
    expect(layout?.children[1]?.rect.width).toBeCloseTo(80 / 3);
    expect(layout?.children[1]?.contentBox.width).toBe(10);
    expect(layout?.children[2]?.rect.x).toBeCloseTo(15 + 80 / 3 + 5);
    expect(layout?.children[2]?.rect.width).toBeCloseTo((80 * 2) / 3);
    expect(layout?.children[2]?.contentBox.width).toBe(10);
  });

  test("column direction uses y as the main axis", () => {
    const renderer = new BaseRenderer(createGraphics(), {});
    const constraints = { maxHeight: 60 };
    const node = new Flex<C>([new Fixed(20, 10), new Fixed(10, 15)], {
      direction: "column",
      gap: 5,
    });

    renderer.measureNode(node, constraints);
    const layout = renderer.getLayoutResult(node, constraints);

    expect(layout?.containerBox).toEqual({ x: 0, y: 0, width: 20, height: 60 });
    expect(layout?.children[0]?.rect).toEqual({ x: 0, y: 0, width: 20, height: 10 });
    expect(layout?.children[1]?.rect).toEqual({ x: 0, y: 15, width: 10, height: 15 });
  });

  test("justifyContent distributes remaining main-axis space", () => {
    const renderer = new BaseRenderer(createGraphics(), {});
    const constraints = { maxWidth: 100 };

    for (const [justifyContent, expected] of [
      ["center", [40, 50]],
      ["end", [80, 90]],
      ["space-between", [0, 90]],
    ] as const) {
      const node = new Flex<C>([new Fixed(10, 10), new Fixed(10, 10)], {
        direction: "row",
        justifyContent,
      });
      renderer.measureNode(node, constraints);
      const layout = renderer.getLayoutResult(node, constraints);
      expect(layout?.children[0]?.rect.x).toBeCloseTo(expected[0]);
      expect(layout?.children[1]?.rect.x).toBeCloseTo(expected[1]);
    }
  });

  test("alignItems, alignSelf, and stretch use the cross axis consistently", () => {
    const renderer = new BaseRenderer(createGraphics(), {});
    const constraints = { maxWidth: 100, maxHeight: 40 };
    const node = new Flex<C>([
      new Fixed(10, 10),
      new FlexItem(new Fixed(10, 20), { alignSelf: "end" }),
      new Fixed(10, 10),
    ], {
      direction: "row",
      alignItems: "center",
      gap: 5,
    });

    renderer.measureNode(node, constraints);
    const layout = renderer.getLayoutResult(node, constraints);

    expect(layout?.containerBox).toEqual({ x: 0, y: 0, width: 100, height: 40 });
    expect(layout?.children[0]?.rect.y).toBeCloseTo(15);
    expect(layout?.children[1]?.rect.y).toBeCloseTo(20);
    expect(layout?.children[2]?.rect.y).toBeCloseTo(15);

    const stretched = new Flex<C>([new Fixed(10, 10)], {
      direction: "row",
      alignItems: "stretch",
    });
    renderer.measureNode(stretched, constraints);
    const stretchedLayout = renderer.getLayoutResult(stretched, constraints);
    expect(stretchedLayout?.children[0]?.rect.height).toBe(40);
    expect(stretchedLayout?.children[0]?.contentBox.height).toBe(10);

    const unstretched = new Flex<C>([new Fixed(10, 10)], {
      direction: "row",
      alignItems: "stretch",
    });
    renderer.measureNode(unstretched, { maxWidth: 100 });
    const unstretchedLayout = renderer.getLayoutResult(unstretched, { maxWidth: 100 });
    expect(unstretchedLayout?.children[0]?.rect.height).toBe(10);
  });

  test("reverse, gap, draw, and hittest all follow the generated content boxes", () => {
    const draws: ProbeDraw[] = [];
    const hits: ProbeHit[] = [];
    const renderer = new ConstraintTestRenderer(createGraphics(), {});
    const node = new Flex<C>([
      createProbe("A", 10, 10, draws, hits),
      createProbe("B", 10, 10, draws, hits),
    ], {
      direction: "row",
      reverse: true,
      gap: 10,
    });
    const constraints = { maxWidth: 50 };

    renderer.measureNode(node, constraints);
    renderer.drawNode(node, constraints);
    expect(draws).toEqual([
      { x: 0, y: 0, label: "B" },
      { x: 20, y: 0, label: "A" },
    ]);

    expect(renderer.hittestNode(node, { x: 5, y: 5, type: "click" }, constraints)).toBe(true);
    expect(hits[0]).toEqual({ x: 5, y: 5, label: "B" });
    expect(renderer.hittestNode(node, { x: 25, y: 5, type: "click" }, constraints)).toBe(true);
    expect(hits[1]).toEqual({ x: 5, y: 5, label: "A" });
  });

  test("hittest ignores the extra frame area of grow items when content is smaller", () => {
    const hits: ProbeHit[] = [];
    const renderer = new ConstraintTestRenderer(createGraphics(), {});
    const probe = createProbe("grow", 10, 10, [], hits);
    const node = new Flex<C>([new FlexItem(probe, { grow: 1 })], {
      direction: "row",
    });
    const constraints = { maxWidth: 100 };

    renderer.measureNode(node, constraints);
    expect(renderer.hittestNode(node, { x: 5, y: 5, type: "click" }, constraints)).toBe(true);
    expect(hits[0]).toEqual({ x: 5, y: 5, label: "grow" });
    expect(renderer.hittestNode(node, { x: 50, y: 5, type: "click" }, constraints)).toBe(false);
  });
});
