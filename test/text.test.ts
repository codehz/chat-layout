import { describe, expect, test } from "bun:test";

import {
  layoutEllipsizedFirstLine,
  layoutText,
  layoutTextIntrinsic,
  layoutTextWithOverflow,
  measureText,
  measureTextIntrinsic,
  measureTextMinContent,
} from "../src/text";
import { MultilineText, Text } from "../src/nodes";
import type { Context } from "../src/types";
import { ensureMockOffscreenCanvas } from "./helpers/graphics";
import { ConstraintTestRenderer } from "./helpers/renderer-fixtures";

type C = CanvasRenderingContext2D;

ensureMockOffscreenCanvas();

function createMeasuredContext(font: string): Context<C> {
  return {
    graphics: {
      font,
      measureText(text: string) {
        return {
          width: text.length * 8,
          fontBoundingBoxAscent: 8,
          fontBoundingBoxDescent: 2,
        } as TextMetrics;
      },
    },
  } as Context<C>;
}

function createRecordingGraphics(recordedTexts: string[]): C {
  return {
    canvas: {
      clientWidth: 320,
      clientHeight: 100,
    },
    fillStyle: "#000",
    font: "16px sans-serif",
    textAlign: "left",
    textRendering: "auto",
    clearRect() {},
    fillText(text: string) {
      recordedTexts.push(text);
    },
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

describe("text metrics", () => {
  test("multiline intrinsic layout measures font shift once per layout", () => {
    const measuredTexts: string[] = [];
    const ctx = {
      graphics: {
        font: "16px text-metrics-intrinsic",
        measureText(text: string) {
          measuredTexts.push(text);
          return {
            width: text.length * 8,
            fontBoundingBoxAscent: 8,
            fontBoundingBoxDescent: 2,
          } as TextMetrics;
        },
      },
    } as Context<C>;

    const layout = layoutTextIntrinsic(ctx, "alpha\nbeta\ngamma");

    expect(layout.width).toBe(40);
    expect(layout.lines).toEqual([
      { width: 40, text: "alpha", shift: 6 },
      { width: 32, text: "beta", shift: 6 },
      { width: 40, text: "gamma", shift: 6 },
    ]);
    expect(measuredTexts).toHaveLength(4);
  });

  test("constrained measurement matches drawn multiline layout for preserved blank lines", () => {
    const ctx = {
      graphics: {
        font: "16px text-metrics-preserve",
        measureText(text: string) {
          return {
            width: text.length * 8,
            fontBoundingBoxAscent: 8,
            fontBoundingBoxDescent: 2,
          } as TextMetrics;
        },
      },
    } as Context<C>;

    const text = "你好世界 hello\n\nwrapped words for measurement";
    const measured = measureText(ctx, text, 48, "preserve");
    const layout = layoutText(ctx, text, 48, "preserve");

    expect(measured).toEqual({
      width: layout.width,
      lineCount: layout.lines.length,
    });
    expect(layout.lines.some((line) => line.text === "")).toBe(true);
  });

  test("trim-and-collapse measurement keeps semantic parity with layout", () => {
    const ctx = {
      graphics: {
        font: "16px text-metrics-trim",
        measureText(text: string) {
          return {
            width: text.length * 8,
            fontBoundingBoxAscent: 8,
            fontBoundingBoxDescent: 2,
          } as TextMetrics;
        },
      },
    } as Context<C>;

    const text = "  alpha beta  \n \n  gamma delta  ";
    const intrinsic = measureTextIntrinsic(ctx, text, "trim-and-collapse");
    const constrained = measureText(ctx, text, 40, "trim-and-collapse");
    const layout = layoutText(ctx, text, 40, "trim-and-collapse");

    expect(intrinsic.lineCount).toBe(2);
    expect(constrained).toEqual({
      width: layout.width,
      lineCount: layout.lines.length,
    });
    expect(layout.lines.every((line) => line.text.trim().length > 0)).toBe(true);
  });

  test("min-content measurement uses the longest token and preserves blank lines", () => {
    const ctx = {
      graphics: {
        font: "16px text-min-content-preserve",
        measureText(text: string) {
          return {
            width: text.length * 8,
            fontBoundingBoxAscent: 8,
            fontBoundingBoxDescent: 2,
          } as TextMetrics;
        },
      },
    } as Context<C>;

    expect(measureTextMinContent(ctx, "alpha beta\n\ngamma delta", "preserve")).toEqual({
      width: 40,
      lineCount: 5,
    });
  });

  test("min-content defaults to break-word semantics for unspaced strings", () => {
    const ctx = {
      graphics: {
        font: "16px text-min-content-break-word",
        measureText(text: string) {
          return {
            width: text.length * 8,
            fontBoundingBoxAscent: 8,
            fontBoundingBoxDescent: 2,
          } as TextMetrics;
        },
      },
    } as Context<C>;

    expect(measureTextMinContent(ctx, "abcdefghij")).toEqual({
      width: 80,
      lineCount: 1,
    });
  });

  test("min-content anywhere semantics shrink unspaced strings to the widest grapheme", () => {
    const ctx = {
      graphics: {
        font: "16px text-min-content-anywhere",
        measureText(text: string) {
          return {
            width: text.length * 8,
            fontBoundingBoxAscent: 8,
            fontBoundingBoxDescent: 2,
          } as TextMetrics;
        },
      },
    } as Context<C>;

    expect(measureTextMinContent(ctx, "abcdefghij", "preserve", "anywhere")).toEqual({
      width: 8,
      lineCount: 10,
    });
  });

  test("min-content trim-and-collapse drops empty lines before tokenizing", () => {
    const ctx = {
      graphics: {
        font: "16px text-min-content-trim",
        measureText(text: string) {
          return {
            width: text.length * 8,
            fontBoundingBoxAscent: 8,
            fontBoundingBoxDescent: 2,
          } as TextMetrics;
        },
      },
    } as Context<C>;

    expect(measureTextMinContent(ctx, "  alpha beta  \n \n  gamma ", "trim-and-collapse")).toEqual({
      width: 40,
      lineCount: 3,
    });
  });

  test("single-line end ellipsis keeps the visible prefix within maxWidth", () => {
    const ctx = createMeasuredContext("16px ellipsis-end");

    expect(layoutEllipsizedFirstLine(ctx, "alphabet", 40, "end")).toEqual({
      width: 40,
      text: "alph…",
      shift: 6,
      overflowed: true,
    });
  });

  test("single-line start ellipsis keeps the visible suffix within maxWidth", () => {
    const ctx = createMeasuredContext("16px ellipsis-start");

    expect(layoutEllipsizedFirstLine(ctx, "alphabet", 40, "start")).toEqual({
      width: 40,
      text: "…abet",
      shift: 6,
      overflowed: true,
    });
  });

  test("single-line middle ellipsis keeps both ends when space allows", () => {
    const ctx = createMeasuredContext("16px ellipsis-middle");

    expect(layoutEllipsizedFirstLine(ctx, "alphabet", 40, "middle")).toEqual({
      width: 40,
      text: "al…et",
      shift: 6,
      overflowed: true,
    });
  });

  test("ellipsis helper returns an empty string when even the ellipsis glyph cannot fit", () => {
    const ctx = createMeasuredContext("16px ellipsis-tight");

    expect(layoutEllipsizedFirstLine(ctx, "alphabet", 4, "end")).toEqual({
      width: 0,
      text: "",
      shift: 6,
      overflowed: true,
    });
  });

  test("multiline overflow ellipsis rewrites the last visible line only when truncated", () => {
    const ctx = createMeasuredContext("16px multiline-ellipsis");

    expect(layoutTextWithOverflow(ctx, "abcdefghij", 40, { overflow: "ellipsis", maxLines: 1 })).toEqual({
      width: 40,
      lines: [{ width: 40, text: "abcd…", shift: 6, overflowed: true }],
      overflowed: true,
    });
    expect(layoutTextWithOverflow(ctx, "abcdefghij", 40, { overflow: "ellipsis", maxLines: 3 })).toEqual({
      width: 40,
      lines: [
        { width: 40, text: "abcde", shift: 6, overflowed: false },
        { width: 40, text: "fghij", shift: 6, overflowed: false },
      ],
      overflowed: false,
    });
  });

  test("multiline maxLines clips without ellipsis when overflow stays in clip mode", () => {
    const ctx = createMeasuredContext("16px multiline-clip");

    expect(layoutTextWithOverflow(ctx, "abcdefghij", 40, { maxLines: 1 })).toEqual({
      width: 40,
      lines: [{ width: 40, text: "abcde", shift: 6, overflowed: false }],
      overflowed: true,
    });
  });

  test("multiline ellipsis clamps maxLines values below one to a single visible line", () => {
    const ctx = createMeasuredContext("16px multiline-clamp");

    expect(layoutTextWithOverflow(ctx, "abcdefghijklmno", 40, { overflow: "ellipsis", maxLines: 0 })).toEqual({
      width: 40,
      lines: [{ width: 40, text: "abcd…", shift: 6, overflowed: true }],
      overflowed: true,
    });
  });

  test("multiline ellipsis truncates the last visible line for maxLines=2", () => {
    const ctx = createMeasuredContext("16px multiline-two-lines");

    expect(layoutTextWithOverflow(ctx, "abcdefghijklmno", 40, { overflow: "ellipsis", maxLines: 2 })).toEqual({
      width: 40,
      lines: [
        { width: 40, text: "abcde", shift: 6, overflowed: false },
        { width: 40, text: "fghi…", shift: 6, overflowed: true },
      ],
      overflowed: true,
    });
  });

  test("trim-and-collapse ellipsis drops blank lines before applying maxLines", () => {
    const ctx = createMeasuredContext("16px multiline-trim-ellipsis");

    expect(layoutTextWithOverflow(ctx, "  alpha beta  \n \n  gamma delta  ", 40, {
      overflow: "ellipsis",
      maxLines: 1,
      whitespace: "trim-and-collapse",
    })).toEqual({
      width: 40,
      lines: [{ width: 40, text: "alph…", shift: 6, overflowed: true }],
      overflowed: true,
    });
  });

  test("multiline ellipsis never returns an over-wide last line in ultra-narrow constraints", () => {
    const ctx = createMeasuredContext("16px multiline-tight");

    expect(layoutTextWithOverflow(ctx, "alphabet", 4, { overflow: "ellipsis", maxLines: 1 })).toEqual({
      width: 0,
      lines: [{ width: 0, text: "", shift: 6, overflowed: true }],
      overflowed: true,
    });
  });

  test("Text nodes draw the ellipsized single-line layout", () => {
    const recordedTexts: string[] = [];
    const renderer = new ConstraintTestRenderer(createRecordingGraphics(recordedTexts), {});
    const node = new Text<C>("alphabet", {
      lineHeight: 20,
      font: "16px text-node-ellipsis",
      style: "#000",
      overflow: "ellipsis",
      ellipsisPosition: "middle",
    });

    expect(renderer.measureNode(node, { maxWidth: 40 })).toEqual({ width: 40, height: 20 });
    renderer.drawNode(node, { maxWidth: 40 });

    expect(recordedTexts).toEqual(["al…et"]);
  });

  test("Text nodes honor anywhere min-content sizing for continuous strings", () => {
    const renderer = new ConstraintTestRenderer(createRecordingGraphics([]), {});
    const node = new Text<C>("abcdefghij", {
      lineHeight: 20,
      font: "16px text-node-anywhere",
      style: "#000",
      overflowWrap: "anywhere",
    });

    expect(renderer.measureMinContentNode(node)).toEqual({ width: 8, height: 20 });
  });

  test("MultilineText nodes measure and draw the same truncated layout", () => {
    const recordedTexts: string[] = [];
    const renderer = new ConstraintTestRenderer(createRecordingGraphics(recordedTexts), {});
    const node = new MultilineText<C>("abcdefghijklmno", {
      lineHeight: 20,
      font: "16px multiline-node-ellipsis",
      style: "#000",
      align: "start",
      overflow: "ellipsis",
      maxLines: 2,
    });

    expect(renderer.measureNode(node, { maxWidth: 40 })).toEqual({ width: 40, height: 40 });
    renderer.drawNode(node, { maxWidth: 40 });

    expect(recordedTexts).toEqual(["abcde", "fghi…"]);
  });

  test("MultilineText nodes honor anywhere min-content sizing for continuous strings", () => {
    const renderer = new ConstraintTestRenderer(createRecordingGraphics([]), {});
    const node = new MultilineText<C>("abcdefghij", {
      lineHeight: 20,
      font: "16px multiline-node-anywhere",
      style: "#000",
      align: "start",
      overflowWrap: "anywhere",
    });

    expect(renderer.measureMinContentNode(node)).toEqual({ width: 8, height: 200 });
  });
});
