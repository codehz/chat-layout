import { describe, expect, test } from "bun:test";

import { Fixed, Flex, FlexItem, MultilineText, Place } from "../../src/nodes";
import { BaseRenderer, ChatRenderer, DebugRenderer, ListState, TimelineRenderer } from "../../src/renderer";
import type { Node } from "../../src/types";
import { createTextGraphics, ensureMockOffscreenCanvas } from "../helpers/graphics";
import { ConstraintTestRenderer, createTextNode } from "../helpers/renderer-fixtures";

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
      align: "start",
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
