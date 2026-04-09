import { describe, expect, test } from "bun:test";

import {
  layoutEllipsizedFirstLine,
  layoutText,
  layoutTextIntrinsic,
  layoutTextWithOverflow,
  measureText,
  measureTextIntrinsic,
  measureTextMinContent,
} from "../../src/text";
import type { Context } from "../../src/types";
import { createMeasuredContext } from "../helpers/text-fixtures";

type C = CanvasRenderingContext2D;

describe("plain text metrics", () => {
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

  test("keep-all uses the internal engine's CJK punctuation grouping during constrained layout", () => {
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

  test("keep-all affects overflow truncation the same way as constrained line breaking", () => {
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
});
