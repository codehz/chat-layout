import { describe, expect, test } from "bun:test";

import { Fixed, Flex, FlexItem, MultilineText, Place } from "../../src/nodes";
import {
  BaseRenderer,
  DebugRenderer,
  ListRenderer,
  ListState,
} from "../../src/renderer";
import type { Node } from "../../src/types";
import {
  createTextGraphics,
  ensureMockOffscreenCanvas,
} from "../helpers/graphics";
import {
  ConstraintTestRenderer,
  createTextNode,
} from "../helpers/renderer-fixtures";

type C = CanvasRenderingContext2D;

ensureMockOffscreenCanvas();

describe("layout context", () => {
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
    const topWidths: Array<number | undefined> = [];
    const bottomWidths: Array<number | undefined> = [];
    const topList = new ListState<number>();
    topList.push(1);

    const topRenderer = new ListRenderer(createTextGraphics(180, 100), {
      anchorMode: "top",
      list: topList,
      renderItem: () => ({
        measure(ctx) {
          topWidths.push(ctx.constraints?.maxWidth);
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

    const bottomList = new ListState<number>();
    bottomList.push(1);
    const bottomRenderer = new ListRenderer(createTextGraphics(220, 100), {
      anchorMode: "bottom",
      list: bottomList,
      renderItem: () => ({
        measure(ctx) {
          bottomWidths.push(ctx.constraints?.maxWidth);
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

    topRenderer.render();
    bottomRenderer.render();

    expect(topWidths).toContain(180);
    expect(bottomWidths).toContain(220);
  });

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

    expect(
      renderer.hittestNode(
        node,
        { x: 190, y: 10, type: "click" },
        { maxWidth: 200 },
      ),
    ).toBe(true);
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
    const root = new Flex<C>(
      [new Fixed(30, 20), new FlexItem(nested, { grow: 1 })],
      {
        direction: "row",
      },
    );
    const renderer = new ConstraintTestRenderer(createTextGraphics(), {});

    renderer.measureNode(root, { maxWidth: 200 });
    renderer.measureNode(root, { maxWidth: 100 });

    renderer.drawNode(root, { maxWidth: 200 });
    expect(drawXs.at(-1)).toBe(180);

    expect(
      renderer.hittestNode(
        root,
        { x: 190, y: 10, type: "click" },
        { maxWidth: 200 },
      ),
    ).toBe(true);
    expect(hitXs.at(-1)).toBe(10);
  });

  test("draw walks all siblings even when an earlier child requests redraw", () => {
    const drawOrder: string[] = [];
    const root = new Flex<C>(
      [
        {
          measure() {
            return { width: 20, height: 20 };
          },
          draw() {
            drawOrder.push("first");
            return true;
          },
          hittest() {
            return false;
          },
        },
        {
          measure() {
            return { width: 20, height: 20 };
          },
          draw() {
            drawOrder.push("second");
            return false;
          },
          hittest() {
            return false;
          },
        },
      ],
      {
        direction: "row",
      },
    );
    const renderer = new ConstraintTestRenderer(createTextGraphics(), {});

    renderer.measureNode(root, { maxWidth: 200 });

    expect(renderer.drawNode(root, { maxWidth: 200 })).toBe(true);
    expect(drawOrder).toEqual(["first", "second"]);
  });

  test("shrink layouts reuse final child constraints for draw and hittest", () => {
    const seenMeasureWidths: Array<number | undefined> = [];
    const seenDrawWidths: Array<number | undefined> = [];
    const seenHitWidths: Array<number | undefined> = [];
    const tail: Node<C> = {
      measure(ctx) {
        seenMeasureWidths.push(ctx.constraints?.maxWidth);
        return { width: ctx.constraints?.maxWidth ?? 50, height: 20 };
      },
      measureMinContent() {
        return { width: 10, height: 20 };
      },
      draw(ctx) {
        seenDrawWidths.push(ctx.constraints?.maxWidth);
        return false;
      },
      hittest(ctx) {
        seenHitWidths.push(ctx.constraints?.maxWidth);
        return true;
      },
    };

    const root = new Flex<C>(
      [new Fixed(20, 20), new FlexItem(tail, { shrink: 1 })],
      {
        direction: "row",
      },
    );
    const renderer = new ConstraintTestRenderer(createTextGraphics(), {});
    const constraints = { maxWidth: 60 };

    renderer.measureNode(root, constraints);
    renderer.drawNode(root, constraints);
    renderer.hittestNode(root, { x: 30, y: 10, type: "click" }, constraints);

    expect(seenMeasureWidths).toEqual([undefined, 40]);
    expect(seenDrawWidths).toEqual([40]);
    expect(seenHitWidths).toEqual([40]);
  });

  test("text nodes measure safely across multiple constraint variants", () => {
    const renderer = new BaseRenderer(createTextGraphics(), {});
    const singleLine = createTextNode(
      "alpha beta gamma delta epsilon zeta eta theta",
    );
    const multiLine = new MultilineText<C>(
      "alpha beta gamma delta epsilon zeta eta theta\niota kappa lambda mu nu xi omicron",
      {
        align: "start",
        lineHeight: 20,
        font: "16px sans-serif",
        color: "#000",
      },
    );

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
