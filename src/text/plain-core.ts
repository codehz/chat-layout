import { layoutNextLine, prepareWithSegments, type PreparedTextWithSegments } from "@chenglou/pretext";
import type { Context, TextOverflowWrapMode, TextWhiteSpaceMode, TextWordBreakMode } from "../types";
import { INTRINSIC_MAX_WIDTH, readLruValue, splitGraphemes, writeLruValue } from "./core";

export const PREPARED_TEXT_CACHE_CAPACITY = 512;

const LINE_START_CURSOR = { segmentIndex: 0, graphemeIndex: 0 } as const;

const preparedTextCache = new Map<string, PreparedTextWithSegments>();
const preparedUnitCache = new WeakMap<PreparedTextWithSegments, PreparedTextUnit[]>();

export type PreparedTextUnit = {
  text: string;
  width: number;
};

function getPreparedTextCacheKey(
  text: string,
  font: string,
  whiteSpace: TextWhiteSpaceMode,
  wordBreak: TextWordBreakMode,
): string {
  return `${font}\u0000${whiteSpace}\u0000${wordBreak}\u0000${text}`;
}

export function readPreparedText(
  text: string,
  font: string,
  whiteSpace: TextWhiteSpaceMode,
  wordBreak: TextWordBreakMode,
): PreparedTextWithSegments {
  const key = getPreparedTextCacheKey(text, font, whiteSpace, wordBreak);
  const cached = readLruValue(preparedTextCache, key);
  if (cached != null) {
    return cached;
  }
  return writeLruValue(
    preparedTextCache,
    key,
    prepareWithSegments(text, font, { whiteSpace, wordBreak }),
    PREPARED_TEXT_CACHE_CAPACITY,
  );
}

export function readPreparedFirstLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  whiteSpace: TextWhiteSpaceMode,
  wordBreak: TextWordBreakMode,
): { text: string; prepared: PreparedTextWithSegments } | undefined {
  const prepared = readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak);
  const line = layoutNextLine(prepared, LINE_START_CURSOR, INTRINSIC_MAX_WIDTH);
  if (line == null) {
    return undefined;
  }
  return {
    text: line.text,
    prepared: readPreparedText(line.text, ctx.graphics.font, whiteSpace, wordBreak),
  };
}

export function measurePreparedMinContentWidth(
  prepared: PreparedTextWithSegments,
  overflowWrap: TextOverflowWrapMode = "break-word",
): number {
  let maxWidth = 0;
  let maxAnyWidth = 0;
  for (let index = 0; index < prepared.widths.length; index += 1) {
    const segmentWidth = prepared.widths[index] ?? 0;
    maxAnyWidth = Math.max(maxAnyWidth, segmentWidth);
    const segment = prepared.segments[index];
    if (segment != null && segment.trim().length > 0) {
      const breakableWidths = prepared.breakableFitAdvances[index];
      const minContentWidth = overflowWrap === "anywhere" && breakableWidths != null && breakableWidths.length > 0
        ? breakableWidths.reduce((widest, width) => Math.max(widest, width), 0)
        : segmentWidth;
      maxWidth = Math.max(maxWidth, minContentWidth);
    }
  }
  return maxWidth > 0 ? maxWidth : maxAnyWidth;
}

export function getPreparedUnits(prepared: PreparedTextWithSegments): PreparedTextUnit[] {
  const cached = preparedUnitCache.get(prepared);
  if (cached != null) {
    return cached;
  }

  const units: PreparedTextUnit[] = [];
  for (let index = 0; index < prepared.segments.length; index += 1) {
    const segment = prepared.segments[index] ?? "";
    const segmentWidth = prepared.widths[index] ?? 0;
    const breakableWidths = prepared.breakableFitAdvances[index];
    if (breakableWidths != null && segment.length > 0) {
      const graphemes = splitGraphemes(segment);
      if (graphemes.length === breakableWidths.length) {
        for (let graphemeIndex = 0; graphemeIndex < graphemes.length; graphemeIndex += 1) {
          units.push({
            text: graphemes[graphemeIndex] ?? "",
            width: breakableWidths[graphemeIndex] ?? 0,
          });
        }
        continue;
      }
    }

    if (segment.length > 0 || segmentWidth > 0) {
      units.push({ text: segment, width: segmentWidth });
    }
  }

  preparedUnitCache.set(prepared, units);
  return units;
}

export function joinUnitText(units: readonly PreparedTextUnit[], start: number, end: number): string {
  if (start >= end) {
    return "";
  }
  return units.slice(start, end).map((unit) => unit.text).join("");
}
