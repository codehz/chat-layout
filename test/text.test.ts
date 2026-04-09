import { describe, expect, test } from "bun:test";

import {
  layoutEllipsizedFirstLine,
  layoutRichText,
  layoutRichTextWithOverflow,
  layoutText,
  layoutTextIntrinsic,
  layoutTextWithOverflow,
  measureRichText,
  measureRichTextIntrinsic,
  measureRichTextMinContent,
  measureText,
  measureTextIntrinsic,
  measureTextMinContent,
} from "../src/text";
import { MultilineText, Text } from "../src/nodes";
import type { Context, InlineSpan } from "../src/types";
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

type RecordedDraw = {
  text: string;
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  textAlign: CanvasTextAlign;
  x: number;
  y: number;
};

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

function createRichRecordingGraphics(recordedDraws: RecordedDraw[]): C {
  const graphics = {
    canvas: {
      clientWidth: 320,
      clientHeight: 100,
    },
    fillStyle: "#000",
    font: "16px sans-serif",
    textAlign: "left" as CanvasTextAlign,
    textRendering: "auto",
    clearRect() {},
    fillText(text: string, x = 0, y = 0) {
      recordedDraws.push({
        text,
        font: graphics.font,
        fillStyle: graphics.fillStyle,
        textAlign: graphics.textAlign,
        x,
        y,
      });
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
  };
  return graphics as unknown as C;
}

describe("text metrics", () => {
  test("multiline intrinsic layout follows normal white-space by default", () => {
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

    expect(layout.width).toBe(128);
    expect(layout.lines).toEqual([
      { width: 128, text: "alpha beta gamma", shift: 6 },
    ]);
    expect(measuredTexts).toEqual(["M"]);
  });

  test("pre-wrap constrained measurement matches drawn multiline layout for preserved blank lines", () => {
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
    const measured = measureText(ctx, text, 48, "pre-wrap");
    const layout = layoutText(ctx, text, 48, "pre-wrap");

    expect(measured).toEqual({
      width: layout.width,
      lineCount: layout.lines.length,
    });
    expect(layout.lines.some((line) => line.text === "")).toBe(true);
  });

  test("normal measurement keeps semantic parity with layout", () => {
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
    const intrinsic = measureTextIntrinsic(ctx, text, "normal");
    const constrained = measureText(ctx, text, 40, "normal");
    const layout = layoutText(ctx, text, 40, "normal");

    expect(intrinsic.lineCount).toBe(1);
    expect(constrained).toEqual({
      width: layout.width,
      lineCount: layout.lines.length,
    });
    expect(layout.lines.every((line) => line.text.trim().length > 0)).toBe(true);
  });

  test("pre-wrap min-content measurement uses the longest token and preserves blank lines", () => {
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

    expect(measureTextMinContent(ctx, "alpha beta\n\ngamma delta", "pre-wrap")).toEqual({
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

    expect(measureTextMinContent(ctx, "abcdefghij", "normal", "normal", "anywhere")).toEqual({
      width: 8,
      lineCount: 10,
    });
  });

  test("normal min-content collapses blank lines before tokenizing", () => {
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

    expect(measureTextMinContent(ctx, "  alpha beta  \n \n  gamma ", "normal")).toEqual({
      width: 40,
      lineCount: 3,
    });
  });

  test("keep-all matches pretext's CJK punctuation grouping during constrained layout", () => {
    const ctx = createMeasuredContext("16px keep-all-layout");
    const text = "你好，世界你好";

    expect(layoutText(ctx, text, 16, "normal", "normal").lines.map((line) => line.text)).toEqual([
      "你",
      "好，",
      "世界",
      "你好",
    ]);
    expect(layoutText(ctx, text, 16, "normal", "keep-all").lines.map((line) => line.text)).toEqual([
      "你好",
      "，",
      "世界",
      "你好",
    ]);
  });

  test("keep-all affects overflow truncation the same way as pretext line breaking", () => {
    const ctx = createMeasuredContext("16px keep-all-overflow");
    const text = "你好，世界你好";

    expect(layoutTextWithOverflow(ctx, text, 16, {
      overflow: "ellipsis",
      maxLines: 2,
      wordBreak: "keep-all",
    })).toEqual({
      width: 16,
      lines: [
        { width: 16, text: "你好", shift: 6, overflowed: false },
        { width: 16, text: "，…", shift: 6, overflowed: true },
      ],
      overflowed: true,
    });
  });

  test("pre-wrap constrained layout preserves leading spaces after hard breaks", () => {
    const ctx = createMeasuredContext("16px pre-wrap-leading-space");
    const text = "hello world\n  foo bar baz";
    const measured = measureText(ctx, text, 40, "pre-wrap");
    const layout = layoutText(ctx, text, 40, "pre-wrap");

    expect(measured).toEqual({ width: layout.width, lineCount: layout.lines.length });
    expect(layout.lines.map((line) => line.text)).toEqual(["hello ", "world", "  foo ", "bar ", "baz"]);
  });

  test("pre-wrap constrained layout keeps repeated spaces inside wrapped lines", () => {
    const ctx = createMeasuredContext("16px pre-wrap-repeated-space");
    const text = "a  a  a\n  a  a";
    const layout = layoutText(ctx, text, 40, "pre-wrap");

    expect(layout.lines.map((line) => line.text)).toEqual(["a  a  ", "a", "  a  ", "a"]);
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

  test("normal ellipsis collapses blank lines before applying maxLines", () => {
    const ctx = createMeasuredContext("16px multiline-normal-ellipsis");

    expect(layoutTextWithOverflow(ctx, "  alpha beta  \n \n  gamma delta  ", 40, {
      overflow: "ellipsis",
      maxLines: 1,
      whiteSpace: "normal",
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
      color: "#000",
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
      color: "#000",
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
      color: "#000",
      align: "start",
      overflow: "ellipsis",
      maxLines: 2,
    });

    expect(renderer.measureNode(node, { maxWidth: 40 })).toEqual({ width: 40, height: 40 });
    renderer.drawNode(node, { maxWidth: 40 });

    expect(recordedTexts).toEqual(["abcde", "fghi…"]);
  });

  test("MultilineText nodes preserve spaces with pre-wrap under constrained layout", () => {
    const recordedTexts: string[] = [];
    const renderer = new ConstraintTestRenderer(createRecordingGraphics(recordedTexts), {});
    const node = new MultilineText<C>("hello world\n  foo bar baz", {
      lineHeight: 20,
      font: "16px multiline-node-pre-wrap",
      color: "#000",
      align: "start",
      whiteSpace: "pre-wrap",
    });

    expect(renderer.measureNode(node, { maxWidth: 40 })).toEqual({ width: 48, height: 100 });
    renderer.drawNode(node, { maxWidth: 40 });

    expect(recordedTexts).toEqual(["hello ", "world", "  foo ", "bar ", "baz"]);
  });

  test("MultilineText nodes honor anywhere min-content sizing for continuous strings", () => {
    const renderer = new ConstraintTestRenderer(createRecordingGraphics([]), {});
    const node = new MultilineText<C>("abcdefghij", {
      lineHeight: 20,
      font: "16px multiline-node-anywhere",
      color: "#000",
      align: "start",
      overflowWrap: "anywhere",
    });

    expect(renderer.measureMinContentNode(node)).toEqual({ width: 8, height: 200 });
  });

  test("rich text metrics measure and layout multiline spans", () => {
    const ctx = createMeasuredContext("16px rich-measure");
    const spans: InlineSpan<C>[] = [
      { text: "hello ", color: "#111" },
      { text: "world", font: "600 16px rich-bold", color: "#f00" },
      { text: " again", color: "#222" },
    ];

    expect(measureRichTextIntrinsic(ctx, spans, "16px rich-measure")).toEqual({ width: 136, lineCount: 1 });
    expect(measureRichText(ctx, spans, 48, "16px rich-measure")).toEqual({ width: 40, lineCount: 3 });

    const layout = layoutRichText(ctx, spans, 48, "16px rich-measure", "#000");
    expect(layout.lines.map((line) => line.fragments.map((frag) => frag.text).join(""))).toEqual(["hello", "world", "again"]);
  });

  test("rich text metrics support maxLines ellipsis", () => {
    const ctx = createMeasuredContext("16px rich-overflow");
    const spans: InlineSpan<C>[] = [
      { text: "abcdefghij", color: "#111" },
      { text: "klmno", font: "600 16px rich-overflow-bold", color: "#f00" },
    ];

    const layout = layoutRichTextWithOverflow(ctx, spans, 40, "16px rich-overflow", "#000", 2, "ellipsis");
    expect(layout.overflowed).toBe(true);
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[1]?.fragments.map((frag) => frag.text).join("")).toBe("fghi…");
  });

  test("rich text min-content uses widest span fragment", () => {
    const ctx = createMeasuredContext("16px rich-min");
    const spans: InlineSpan<C>[] = [
      { text: "a", color: "#111" },
      { text: "abcdefgh", font: "600 16px rich-min-bold", color: "#f00" },
      { text: "bc", color: "#222" },
    ];

    expect(measureRichTextMinContent(ctx, spans, "16px rich-min", "anywhere")).toEqual({ width: 8, lineCount: 11 });
  });

  test("MultilineText nodes draw rich spans with per-fragment font and color", () => {
    const recordedDraws: RecordedDraw[] = [];
    const renderer = new ConstraintTestRenderer(createRichRecordingGraphics(recordedDraws), {});
    const node = new MultilineText<C>([
      { text: "hello ", color: "#111" },
      { text: "world", font: "600 16px rich-node-bold", color: "#f00" },
      { text: " again", color: "#222" },
    ], {
      lineHeight: 20,
      font: "16px rich-node",
      color: "#000",
      align: "start",
    });

    expect(renderer.measureNode(node, { maxWidth: 48 })).toEqual({ width: 40, height: 60 });
    renderer.drawNode(node, { maxWidth: 48 });

    expect(recordedDraws.map((draw) => draw.text)).toEqual(["hello", "world", "again"]);
    expect(recordedDraws[0]).toMatchObject({ font: "16px rich-node", fillStyle: "#111", textAlign: "left" });
    expect(recordedDraws[1]).toMatchObject({ font: "600 16px rich-node-bold", fillStyle: "#f00", textAlign: "left" });
    expect(recordedDraws[2]).toMatchObject({ font: "16px rich-node", fillStyle: "#222", textAlign: "left" });
  });
});
