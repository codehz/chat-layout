import { describe, expect, test } from "bun:test";

import { Fixed, Flex, FlexItem, MultilineText, PaddingBox, Place, Text } from "./nodes";
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

function createChatLikeBubbleTree(
  message: string,
  options: {
    sender?: "A" | "B";
    reply?: {
      sender: string;
      content: string;
    };
  },
) {
  const sender = options.sender ?? "B";
  const reply = options.reply;
  const senderLine = new Flex<C>(
    [
      new PaddingBox(
        new Text("A", {
          lineHeight: 15,
          font: "12px sans-serif",
          style: "#000",
        }),
      ),
      new Fixed(15, 15),
    ],
    { direction: "row", gap: 4, mainAxisSize: "fit-content" },
  );

  const messageText = new FlexItem(
    new MultilineText(message, {
      lineHeight: 20,
      font: "16px sans-serif",
      alignment: "left",
      style: "#000",
    }),
    { alignSelf: "start" },
  );

  const bubbleChildren: Node<C>[] = [];
  let replyPreview: PaddingBox<C> | undefined;
  if (reply != null) {
    replyPreview = new PaddingBox(
      new Flex<C>(
        [
          new Text(reply.sender, {
            lineHeight: 14,
            font: "11px sans-serif",
            style: "#333",
          }),
          new MultilineText(reply.content, {
            lineHeight: 16,
            font: "13px sans-serif",
            alignment: "left",
            style: "#555",
          }),
        ],
        {
          direction: "column",
          gap: 2,
          alignItems: "start",
        },
      ),
      {
        top: 5,
        bottom: 5,
        left: 8,
        right: 8,
      },
    );
    bubbleChildren.push(replyPreview);
  }
  bubbleChildren.push(messageText);

  const bubbleColumn = new Flex<C>(bubbleChildren, {
    direction: "column",
    gap: 6,
    alignItems: reply == null ? "start" : "stretch",
  });

  const bubble = new PaddingBox(
    bubbleColumn,
    {
      top: 6,
      bottom: 6,
      left: 10,
      right: 10,
    },
  );

  const body = new Flex<C>(
    [senderLine, bubble],
    {
      direction: "column",
      alignItems: sender === "A" ? "end" : "start",
    },
  );

  const alignedBody = new Place<C>(
    body,
    { align: sender === "A" ? "end" : "start" },
  );

  const row = new Flex<C>(
    [
      new Fixed(32, 32),
      new FlexItem(alignedBody, { grow: 1 }),
      new Fixed(32, 0),
    ],
    {
      direction: "row",
      gap: 4,
      reverse: sender === "A",
    },
  );

  const padded = new PaddingBox(row, {
    top: 4,
    bottom: 4,
    left: 4,
    right: 4,
  });

  const node = new Place<C>(padded, {
    align: sender === "A" ? "end" : "start",
  });

  return {
    node,
    padded,
    row,
    alignedBody,
    body,
    bubble,
    bubbleColumn,
    replyPreview,
  };
}

function createChatLikeBubble(message: string): Place<C> {
  return createChatLikeBubbleTree(message, {}).node;
}

function measureChatLikeBubbleTree(
  renderer: BaseRenderer<C>,
  tree: ReturnType<typeof createChatLikeBubbleTree>,
  constraints?: LayoutConstraints,
) {
  renderer.measureNode(tree.node, constraints);
  const placeLayout = renderer.getLayoutResult(tree.node, constraints)!;
  const paddedLayout = renderer.getLayoutResult(tree.padded, placeLayout.children[0]!.constraints)!;
  const rowLayout = renderer.getLayoutResult(tree.row, paddedLayout.children[0]!.constraints)!;
  const alignedBodyLayout = renderer.getLayoutResult(tree.alignedBody, rowLayout.children[1]!.constraints)!;
  const bodyLayout = renderer.getLayoutResult(tree.body, alignedBodyLayout.children[0]!.constraints)!;
  const bubbleLayout = renderer.getLayoutResult(tree.bubble, bodyLayout.children[1]!.constraints)!;
  const bubbleColumnLayout = renderer.getLayoutResult(tree.bubbleColumn, bubbleLayout.children[0]!.constraints)!;

  return {
    placeLayout,
    paddedLayout,
    rowLayout,
    alignedBodyLayout,
    bodyLayout,
    bubbleLayout,
    bubbleColumnLayout,
  };
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

  test("shrink-wraps when no maxWidth constraint is available", () => {
    const renderer = new BaseRenderer(createGraphics(), {});
    const node = new Place<C>(new Fixed(20, 10), { align: "end" });

    const box = renderer.measureNode(node);
    const layout = renderer.getLayoutResult(node);

    expect(box).toEqual({ width: 20, height: 10 });
    expect(layout?.containerBox).toEqual({ x: 0, y: 0, width: 20, height: 10 });
    expect(layout?.children[0]?.rect).toEqual({ x: 0, y: 0, width: 20, height: 10 });
  });

  test("chat bubbles wrap under maxWidth without forcing the bubble itself full width", () => {
    const renderer = new BaseRenderer(createGraphics(320, 200), {});
    const tree = createChatLikeBubbleTree("long message ".repeat(30), {});

    const unconstrainedBox = renderer.measureNode(tree.node);
    const unconstrainedLayout = renderer.getLayoutResult(tree.node);
    const constrained = measureChatLikeBubbleTree(renderer, tree, { maxWidth: 320 });

    expect(unconstrainedBox.width).toBeGreaterThan(constrained.placeLayout.containerBox.width);
    expect(unconstrainedLayout?.children[0]?.rect.width).toBeLessThanOrEqual(unconstrainedBox.width);
    expect(constrained.placeLayout.containerBox.width).toBe(320);
    expect(constrained.rowLayout.children[1]!.rect.width).toBeGreaterThan(constrained.bodyLayout.children[1]!.rect.width);
    expect(constrained.bodyLayout.children[1]!.rect.width).toBeLessThan(320);
  });

  test("reply preview stretches across the bubble while the bubble stays shrink-wrapped", () => {
    const renderer = new BaseRenderer(createGraphics(320, 200), {});
    const tree = createChatLikeBubbleTree(
      "short message",
      {
        reply: {
          sender: "B",
          content: "tiny reply preview",
        },
      },
    );

    const constrained = measureChatLikeBubbleTree(renderer, tree, { maxWidth: 320 });

    expect(constrained.rowLayout.children[1]!.rect.width).toBeGreaterThan(constrained.bodyLayout.children[1]!.rect.width);
    expect(constrained.bubbleColumnLayout.children[0]!.rect.width).toBe(constrained.bubbleColumnLayout.containerBox.width);
    expect(constrained.bubbleColumnLayout.children[1]!.rect.width).toBeLessThan(
      constrained.bubbleColumnLayout.children[0]!.rect.width,
    );
  });

  test("outgoing chat bubbles stay right-aligned inside the grow slot", () => {
    const renderer = new BaseRenderer(createGraphics(320, 200), {});
    const tree = createChatLikeBubbleTree(
      "update timeline layout bubble render update update layout",
      {
        sender: "A",
        reply: {
          sender: "B",
          content: "测试aa中文aaa",
        },
      },
    );

    const constrained = measureChatLikeBubbleTree(renderer, tree, { maxWidth: 320 });
    const bodyRect = constrained.alignedBodyLayout.children[0]!.rect;

    expect(bodyRect.x).toBeGreaterThan(0);
    expect(bodyRect.x + bodyRect.width).toBe(constrained.alignedBodyLayout.containerBox.width);
  });

  test("does not synthesize child maxWidth constraints when expand=false", () => {
    const renderer = new BaseRenderer(createGraphics(160, 100), {});
    const node = new Place<C>(
      new MultilineText("wide text ".repeat(10), {
        lineHeight: 20,
        font: "16px sans-serif",
        alignment: "left",
        style: "#000",
      }),
      { align: "start", expand: false },
    );

    renderer.measureNode(node);
    const layout = renderer.getLayoutResult(node);

    expect(layout?.children[0]?.constraints).toBeUndefined();
  });

  test("column end alignment keeps a narrower sender line flush with the bubble's right edge", () => {
    const renderer = new BaseRenderer(createGraphics(320, 100), {});
    const senderLine = new Flex<C>(
      [
        new PaddingBox(
          new Text("A", {
            lineHeight: 15,
            font: "12px sans-serif",
            style: "#000",
          }),
        ),
        new Fixed(15, 15),
      ],
      { direction: "row", gap: 4, mainAxisSize: "fit-content" },
    );
    const content = new PaddingBox(
      new MultilineText("longer bubble content", {
        lineHeight: 20,
        font: "16px sans-serif",
        alignment: "left",
        style: "#000",
      }),
      {
        top: 6,
        bottom: 6,
        left: 10,
        right: 10,
      },
    );
    const column = new Flex<C>([senderLine, content], {
      direction: "column",
      alignItems: "end",
    });

    renderer.measureNode(column, { maxWidth: 240 });
    const layout = renderer.getLayoutResult(column, { maxWidth: 240 });

    expect(layout?.children[0]?.rect.x).toBeGreaterThan(0);
    expect(layout?.children[1]?.rect.x).toBe(0);
    expect(layout!.children[0]!.rect.x + layout!.children[0]!.rect.width).toBe(
      layout!.children[1]!.rect.x + layout!.children[1]!.rect.width,
    );
  });

  test("PaddingBox uses its cached layout result for draw and hittest", () => {
    const { node: probe, draws, hits } = createProbeNode();
    const renderer = new ConstraintTestRenderer(createGraphics(), {});
    const padded = new PaddingBox<C>(probe, {
      top: 5,
      bottom: 5,
      left: 10,
      right: 10,
    });
    const constraints = { maxWidth: 60 };

    renderer.measureNode(padded, constraints);
    renderer.measureNode(padded, { maxWidth: 40 });
    renderer.drawNode(padded, constraints);
    expect(draws[0]).toEqual({ x: 10, y: 5 });

    expect(renderer.hittestNode(padded, { x: 15, y: 7, type: "click" }, constraints)).toBe(true);
    expect(hits[0]).toEqual({ x: 5, y: 2 });
  });
});
