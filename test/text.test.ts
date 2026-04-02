import { describe, expect, test } from "bun:test";

import { layoutText, layoutTextIntrinsic, measureText, measureTextIntrinsic } from "../src/text";
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
});
