import type { Context, TextOverflowWrapMode, TextWhiteSpaceMode, TextWordBreakMode } from "../types";
import {
  createPlainSourceItems,
  getPlainPreparedKey,
  getPreparedLineStart,
  getPreparedUnits as getInlinePreparedUnits,
  joinPreparedUnitText,
  layoutNextPreparedLine,
  materializePreparedLineText,
  measurePreparedMinContentWidth as measureInlinePreparedMinContentWidth,
  readPreparedInlineLayout,
  type PreparedInlineLayout,
} from "./inline-engine";

export const PREPARED_TEXT_CACHE_CAPACITY = 512;

export type PreparedTextWithSegments = PreparedInlineLayout;

export type PreparedTextUnit = {
  text: string;
  width: number;
};

export function readPreparedText(
  text: string,
  font: string,
  whiteSpace: TextWhiteSpaceMode,
  wordBreak: TextWordBreakMode,
): PreparedTextWithSegments {
  return readPreparedInlineLayout(
    getPlainPreparedKey(text, font, whiteSpace, wordBreak),
    createPlainSourceItems(text, font),
    whiteSpace,
    wordBreak,
  );
}

export function readPreparedFirstLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  whiteSpace: TextWhiteSpaceMode,
  wordBreak: TextWordBreakMode,
): { text: string; prepared: PreparedTextWithSegments } | undefined {
  const prepared = readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak);
  const start = getPreparedLineStart(prepared);
  if (start == null) {
    return undefined;
  }
  const line = layoutNextPreparedLine(prepared, start, Number.POSITIVE_INFINITY);
  if (line == null) {
    return undefined;
  }
  return {
    text: materializePreparedLineText(prepared, line),
    prepared,
  };
}

export function measurePreparedMinContentWidth(
  prepared: PreparedTextWithSegments,
  overflowWrap: TextOverflowWrapMode = "break-word",
): number {
  return measureInlinePreparedMinContentWidth(prepared, overflowWrap);
}

export function getPreparedUnits(prepared: PreparedTextWithSegments): PreparedTextUnit[] {
  return getInlinePreparedUnits(prepared);
}

export function joinUnitText(units: readonly PreparedTextUnit[], start: number, end: number): string {
  return joinPreparedUnitText(units, start, end);
}
