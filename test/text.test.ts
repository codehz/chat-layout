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
import type { Context } from "../src/types";
import { ensureMockOffscreenCanvas } from "./helpers/graphics";

type C = CanvasRenderingContext2D;

ensureMockOffscreenCanvas();

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
    const ctx = {
      graphics: {
        font: "16px ellipsis-end",
        measureText(text: string) {
          return {
            width: text.length * 8,
            fontBoundingBoxAscent: 8,
            fontBoundingBoxDescent: 2,
          } as TextMetrics;
        },
      },
    } as Context<C>;

    expect(layoutEllipsizedFirstLine(ctx, "alphabet", 40, "end")).toEqual({
      width: 40,
      text: "alph…",
      shift: 6,
      overflowed: true,
    });
  });

  test("single-line start ellipsis keeps the visible suffix within maxWidth", () => {
    const ctx = {
      graphics: {
        font: "16px ellipsis-start",
        measureText(text: string) {
          return {
            width: text.length * 8,
            fontBoundingBoxAscent: 8,
            fontBoundingBoxDescent: 2,
          } as TextMetrics;
        },
      },
    } as Context<C>;

    expect(layoutEllipsizedFirstLine(ctx, "alphabet", 40, "start")).toEqual({
      width: 40,
      text: "…abet",
      shift: 6,
      overflowed: true,
    });
  });

  test("single-line middle ellipsis keeps both ends when space allows", () => {
    const ctx = {
      graphics: {
        font: "16px ellipsis-middle",
        measureText(text: string) {
          return {
            width: text.length * 8,
            fontBoundingBoxAscent: 8,
            fontBoundingBoxDescent: 2,
          } as TextMetrics;
        },
      },
    } as Context<C>;

    expect(layoutEllipsizedFirstLine(ctx, "alphabet", 40, "middle")).toEqual({
      width: 40,
      text: "al…et",
      shift: 6,
      overflowed: true,
    });
  });

  test("ellipsis helper returns an empty string when even the ellipsis glyph cannot fit", () => {
    const ctx = {
      graphics: {
        font: "16px ellipsis-tight",
        measureText(text: string) {
          return {
            width: text.length * 8,
            fontBoundingBoxAscent: 8,
            fontBoundingBoxDescent: 2,
          } as TextMetrics;
        },
      },
    } as Context<C>;

    expect(layoutEllipsizedFirstLine(ctx, "alphabet", 4, "end")).toEqual({
      width: 0,
      text: "",
      shift: 6,
      overflowed: true,
    });
  });

  test("multiline overflow ellipsis rewrites the last visible line only when truncated", () => {
    const ctx = {
      graphics: {
        font: "16px multiline-ellipsis",
        measureText(text: string) {
          return {
            width: text.length * 8,
            fontBoundingBoxAscent: 8,
            fontBoundingBoxDescent: 2,
          } as TextMetrics;
        },
      },
    } as Context<C>;

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
    const ctx = {
      graphics: {
        font: "16px multiline-clip",
        measureText(text: string) {
          return {
            width: text.length * 8,
            fontBoundingBoxAscent: 8,
            fontBoundingBoxDescent: 2,
          } as TextMetrics;
        },
      },
    } as Context<C>;

    expect(layoutTextWithOverflow(ctx, "abcdefghij", 40, { maxLines: 1 })).toEqual({
      width: 40,
      lines: [{ width: 40, text: "abcde", shift: 6, overflowed: false }],
      overflowed: true,
    });
  });
});
