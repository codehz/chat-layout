import { describe, expect, test } from "bun:test";

import {
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
});
