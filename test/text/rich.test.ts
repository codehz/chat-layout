import { describe, expect, test } from "bun:test";

import {
  layoutRichEllipsizedFirstLine,
  layoutRichFirstLine,
  layoutRichText,
  layoutRichTextWithOverflow,
  measureRichText,
  measureRichTextIntrinsic,
  measureRichTextMinContent,
} from "../../src/text";
import type { Context } from "../../src/types";
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

  test("rich text preserves pre-wrap whitespace and hard breaks", () => {
    const ctx = createMeasuredContext("16px rich-pre-wrap");
    const spans: InlineSpan<C>[] = [
      { text: "hello world\n  foo" },
      { text: " bar baz", font: "600 16px rich-pre-wrap-bold", color: "#f00" },
    ];

    const layout = layoutRichText(ctx, spans, 40, "16px rich-pre-wrap", "#000", "pre-wrap");
    expect(layout.lines.map((line) => line.fragments.map((frag) => frag.text).join(""))).toEqual([
      "hello ",
      "world",
      "  foo ",
      "bar ",
      "baz",
    ]);
  });

  test("rich text keep-all honors CJK punctuation across span boundaries", () => {
    const ctx = createMeasuredContext("16px rich-keep-all");
    const spans: InlineSpan<C>[] = [
      { text: "你好", color: "#111" },
      { text: "，", font: "600 16px rich-keep-all-bold", color: "#f00" },
      { text: "世界你好", color: "#222" },
    ];

    const layout = layoutRichText(ctx, spans, 16, "16px rich-keep-all", "#000", "normal", "keep-all");
    expect(layout.lines.map((line) => line.fragments.map((frag) => frag.text).join(""))).toEqual([
      "你好",
      "，",
      "世界",
      "你好",
    ]);
  });

  test("rich text min-content anywhere uses grapheme opportunities across spans", () => {
    const ctx = createMeasuredContext("16px rich-anywhere");
    const spans: InlineSpan<C>[] = [
      { text: "abc", color: "#111" },
      { text: "def", font: "600 16px rich-anywhere-bold", color: "#f00" },
    ];

    expect(measureRichTextMinContent(ctx, spans, "16px rich-anywhere", "anywhere")).toEqual({
      width: 8,
      lineCount: 6,
    });
  });

  test("rich text keeps break-never spans atomic and counts extra width", () => {
    const ctx = createMeasuredContext("16px rich-break-never");
    const spans: InlineSpan<C>[] = [
      { text: "ab", break: "never", extraWidth: 8, color: "#111" },
      { text: "c", color: "#222" },
    ];

    const layout = layoutRichText(ctx, spans, 16, "16px rich-break-never", "#000");
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[0]).toMatchObject({
      width: 24,
      fragments: [
        {
          itemIndex: 0,
          text: "ab",
          occupiedWidth: 24,
        },
      ],
    });
    expect(layout.lines[1]?.fragments.map((frag) => frag.text).join("")).toBe("c");
  });

  test("rich text single-line ellipsis can truncate across span boundaries", () => {
    const ctx = createMeasuredContext("16px rich-ellipsis-cross-span");
    const spans: InlineSpan<C>[] = [
      { text: "alpha ", color: "#111" },
      { text: "beta", font: "600 16px rich-ellipsis-cross-span-bold", color: "#f00" },
      { text: " gamma", color: "#222" },
    ];

    const layout = layoutRichEllipsizedFirstLine(ctx, spans, 64, "16px rich-ellipsis-cross-span", "#000");
    expect(layout.width).toBe(64);
    expect(layout.fragments.map((frag) => frag.text)).toEqual(["alpha", "b", "…"]);
  });

  test("font metrics are cached per font for rich layout and ellipsis", () => {
    const measuredTexts: string[] = [];
    const ctx = {
      graphics: {
        font: "16px rich-font-cache",
        measureText(text: string) {
          measuredTexts.push(`${this.font}:${text}`);
          return {
            width: text.length * 8,
            fontBoundingBoxAscent: 8,
            fontBoundingBoxDescent: 2,
          } as TextMetrics;
        },
      },
    } as unknown as Context<C>;
    const spans: InlineSpan<C>[] = [
      { text: "alpha ", color: "#111" },
      { text: "beta", font: "600 16px rich-font-cache-bold", color: "#f00" },
      { text: " gamma", color: "#222" },
    ];

    layoutRichText(ctx, spans, 48, "16px rich-font-cache", "#000");
    layoutRichText(ctx, spans, 48, "16px rich-font-cache", "#000");
    layoutRichEllipsizedFirstLine(ctx, spans, 64, "16px rich-font-cache", "#000");
    layoutRichEllipsizedFirstLine(ctx, spans, 64, "16px rich-font-cache", "#000");

    expect(measuredTexts).toEqual([
      "16px rich-font-cache:M",
      "600 16px rich-font-cache-bold:M",
      "16px rich-font-cache:…",
      "600 16px rich-font-cache-bold:…",
    ]);
  });
});
