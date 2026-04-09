import type { Context, TextEllipsisPosition } from "../types";

export const FONT_SHIFT_PROBE = "M";
export const ELLIPSIS_GLYPH = "…";
export const INTRINSIC_MAX_WIDTH = Number.POSITIVE_INFINITY;
export const MIN_CONTENT_WIDTH_EPSILON = 0.001;
export const FONT_SHIFT_CACHE_CAPACITY = 64;
export const ELLIPSIS_WIDTH_CACHE_CAPACITY = 64;

const fontShiftCache = new Map<string, number>();
const ellipsisWidthCache = new Map<string, number>();

let sharedGraphemeSegmenter: Intl.Segmenter | null | undefined;

export function readLruValue<T>(cache: Map<string, T>, key: string): T | undefined {
  const cached = cache.get(key);
  if (cached == null) {
    return undefined;
  }
  cache.delete(key);
  cache.set(key, cached);
  return cached;
}

export function writeLruValue<T>(cache: Map<string, T>, key: string, value: T, capacity: number): T {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= capacity) {
    const firstKey = cache.keys().next().value;
    if (firstKey != null) {
      cache.delete(firstKey);
    }
  }
  cache.set(key, value);
  return value;
}

export function measureFontShift<C extends CanvasRenderingContext2D>(ctx: Context<C>): number {
  const font = ctx.graphics.font;
  const cached = readLruValue(fontShiftCache, font);
  if (cached != null) {
    return cached;
  }
  const {
    fontBoundingBoxAscent: ascent = 0,
    fontBoundingBoxDescent: descent = 0,
  } = ctx.graphics.measureText(FONT_SHIFT_PROBE);
  return writeLruValue(fontShiftCache, font, ascent - descent, FONT_SHIFT_CACHE_CAPACITY);
}

export function measureEllipsisWidth<C extends CanvasRenderingContext2D>(ctx: Context<C>): number {
  const font = ctx.graphics.font;
  const cached = readLruValue(ellipsisWidthCache, font);
  if (cached != null) {
    return cached;
  }
  return writeLruValue(
    ellipsisWidthCache,
    font,
    ctx.graphics.measureText(ELLIPSIS_GLYPH).width,
    ELLIPSIS_WIDTH_CACHE_CAPACITY,
  );
}

function getGraphemeSegmenter(): Intl.Segmenter | null {
  if (sharedGraphemeSegmenter !== undefined) {
    return sharedGraphemeSegmenter;
  }
  sharedGraphemeSegmenter = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
  return sharedGraphemeSegmenter;
}

export function splitGraphemes(text: string): string[] {
  const segmenter = getGraphemeSegmenter();
  if (segmenter == null) {
    return Array.from(text);
  }
  const graphemes: string[] = [];
  for (const part of segmenter.segment(text)) {
    graphemes.push(part.segment);
  }
  return graphemes;
}

export function buildPrefixWidths(widths: readonly number[]): number[] {
  const cumulativeWidths = [0];
  let total = 0;
  for (const width of widths) {
    total += width;
    cumulativeWidths.push(total);
  }
  return cumulativeWidths;
}

export function buildSuffixWidths(widths: readonly number[]): number[] {
  const cumulativeWidths = [0];
  let total = 0;
  for (let index = widths.length - 1; index >= 0; index -= 1) {
    total += widths[index] ?? 0;
    cumulativeWidths.push(total);
  }
  return cumulativeWidths;
}

export function findMaxFittingCount(cumulativeWidths: readonly number[], maxWidth: number): number {
  if (maxWidth <= 0) {
    return 0;
  }
  let low = 0;
  let high = cumulativeWidths.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if ((cumulativeWidths[mid] ?? 0) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

export function normalizeMaxLines(maxLines: number | undefined): number | undefined {
  if (maxLines == null || !Number.isFinite(maxLines)) {
    return undefined;
  }
  return Math.max(1, Math.trunc(maxLines));
}

export function selectEllipsisUnitCounts({
  position,
  prefixWidths,
  suffixWidths,
  unitCount,
  availableWidth,
  getMaxSuffixCount = (prefixCount) => unitCount - prefixCount,
}: {
  position: TextEllipsisPosition;
  prefixWidths: readonly number[];
  suffixWidths: readonly number[];
  unitCount: number;
  availableWidth: number;
  getMaxSuffixCount?: (prefixCount: number) => number;
}): { prefixCount: number; suffixCount: number } {
  let prefixCount = 0;
  let suffixCount = 0;

  switch (position) {
    case "start":
      suffixCount = Math.min(unitCount, findMaxFittingCount(suffixWidths, availableWidth));
      break;
    case "middle": {
      let bestVisibleUnits = -1;
      let bestBalanceScore = Number.NEGATIVE_INFINITY;
      for (let nextPrefixCount = 0; nextPrefixCount <= unitCount; nextPrefixCount += 1) {
        const prefixWidth = prefixWidths[nextPrefixCount] ?? 0;
        if (prefixWidth > availableWidth) {
          break;
        }
        const remainingWidth = availableWidth - prefixWidth;
        const maxSuffixCount = Math.max(0, getMaxSuffixCount(nextPrefixCount));
        const nextSuffixCount = Math.min(maxSuffixCount, findMaxFittingCount(suffixWidths, remainingWidth));
        const visibleUnits = nextPrefixCount + nextSuffixCount;
        const balanceScore = -Math.abs(nextPrefixCount - nextSuffixCount);
        if (
          visibleUnits > bestVisibleUnits ||
          (visibleUnits === bestVisibleUnits && balanceScore > bestBalanceScore) ||
          (visibleUnits === bestVisibleUnits && balanceScore === bestBalanceScore && nextPrefixCount > prefixCount)
        ) {
          prefixCount = nextPrefixCount;
          suffixCount = nextSuffixCount;
          bestVisibleUnits = visibleUnits;
          bestBalanceScore = balanceScore;
        }
      }
      break;
    }
    case "end":
      prefixCount = Math.min(unitCount, findMaxFittingCount(prefixWidths, availableWidth));
      break;
  }

  return { prefixCount, suffixCount };
}
