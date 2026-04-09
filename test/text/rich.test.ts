import { describe, expect, test } from "bun:test";

import {
  layoutRichFirstLine,
  layoutRichText,
  layoutRichTextWithOverflow,
  measureRichText,
  measureRichTextIntrinsic,
  measureRichTextMinContent,
} from "../../src/text";
import type { InlineSpan } from "../../src/types";
import { createMeasuredContext } from "../helpers/text-fixtures";

type C = CanvasRenderingContext2D;

describe("rich text metrics", () => {
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

  test("rich text wraps before a CJK span that would overflow the remaining width", () => {
    const ctx = createMeasuredContext("16px rich-cjk-overflow");
    const spans: InlineSpan<C>[] = [
      { text: "aaaaa", color: "#111" },
      { text: "《帝", font: "600 16px rich-cjk-overflow-bold", color: "#f00" },
      { text: "bbbb", color: "#222" },
    ];

    expect(measureRichText(ctx, spans, 48, "16px rich-cjk-overflow")).toEqual({ width: 48, lineCount: 2 });
    expect(layoutRichFirstLine(ctx, spans, 48, "16px rich-cjk-overflow", "#000")).toEqual({
      width: 40,
      fragments: [
        {
          itemIndex: 0,
          text: "aaaaa",
          font: "16px rich-cjk-overflow",
          color: "#111",
          gapBefore: 0,
          occupiedWidth: 40,
          shift: 6,
        },
      ],
      overflowed: false,
    });

    const layout = layoutRichText(ctx, spans, 48, "16px rich-cjk-overflow", "#000");
    expect(layout.width).toBe(48);
    expect(layout.lines.map((line) => line.fragments.map((frag) => frag.text).join(""))).toEqual(["aaaaa", "《帝bbbb"]);
    expect(layout.lines.every((line) => line.width <= 48)).toBe(true);
  });
});
