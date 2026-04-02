import { describe, expect, test } from "bun:test";

import { layoutTextIntrinsic } from "../src/text";
import type { Context } from "../src/types";

type C = CanvasRenderingContext2D;

describe("text metrics", () => {
  test("multiline intrinsic layout measures font shift once per layout", () => {
    const measuredTexts: string[] = [];
    const ctx = {
      graphics: {
        font: "16px sans-serif",
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
});
