import { describe, expect, test } from "bun:test";

import {
  getPreparedUnits,
  joinUnitText,
  measurePreparedMinContentWidth,
  readPreparedFirstLine,
  readPreparedText,
} from "../../src/text/plain-core";
import { createMeasuredContext } from "../helpers/text-fixtures";

describe("plain-core helpers", () => {
  test("readPreparedFirstLine returns undefined for empty and collapsed-whitespace plain text", () => {
    const ctx = createMeasuredContext("16px sans-serif");

    expect(readPreparedFirstLine(ctx, "", "normal", "normal")).toBeUndefined();
    expect(
      readPreparedFirstLine(ctx, "   ", "normal", "normal"),
    ).toBeUndefined();
  });

  test("readPreparedFirstLine collapses normal whitespace but preserves pre-wrap leading spaces", () => {
    const ctx = createMeasuredContext("16px sans-serif");

    expect(
      readPreparedFirstLine(ctx, "  hi  there", "normal", "normal")?.text,
    ).toBe("hi there");
    expect(
      readPreparedFirstLine(ctx, "  hi\n there", "pre-wrap", "normal")?.text,
    ).toBe("  hi");
    expect(
      readPreparedFirstLine(ctx, " \n  hi", "pre-wrap", "normal")?.text,
    ).toBe(" ");
  });

  test("measurePreparedMinContentWidth distinguishes break-word and anywhere semantics", () => {
    const prepared = readPreparedText(
      "abc",
      "16px sans-serif",
      "normal",
      "normal",
    );

    expect(measurePreparedMinContentWidth(prepared, "break-word")).toBe(24);
    expect(measurePreparedMinContentWidth(prepared, "anywhere")).toBe(8);
  });

  test("prepared units and joinUnitText preserve grouped whitespace fragments", () => {
    const prepared = readPreparedText(
      "  hi",
      "16px sans-serif",
      "pre-wrap",
      "normal",
    );
    const units = getPreparedUnits(prepared);

    expect(units).toEqual([
      { text: "  ", width: 16 },
      { text: "h", width: 8 },
      { text: "i", width: 8 },
    ]);
    expect(joinUnitText(units, 0, units.length)).toBe("  hi");
    expect(joinUnitText(units, 1, units.length)).toBe("hi");
  });
});
