import {
  layoutNextLine,
  layoutWithLines,
  prepareWithSegments,
  walkLineRanges,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";
import type {
  Context,
  TextEllipsisPosition,
  TextOverflowMode,
  TextOverflowWrapMode,
  TextWhitespaceMode,
} from "./types";

export interface TextLayout {
  width: number;
  text: string;
  shift: number;
}

export interface TextMeasurement {
  width: number;
  lineCount: number;
}

export interface OverflowTextLayout extends TextLayout {
  overflowed: boolean;
}

export interface OverflowTextBlockLayout {
  width: number;
  lines: OverflowTextLayout[];
  overflowed: boolean;
}

// `fontBoundingBox*` depends on the active font, so one fixed probe is enough.
const FONT_SHIFT_PROBE = "M";
const ELLIPSIS_GLYPH = "…";
const PREPARED_SEGMENT_CACHE_CAPACITY = 512;
const FONT_SHIFT_CACHE_CAPACITY = 64;
const ELLIPSIS_WIDTH_CACHE_CAPACITY = 64;
const LINE_START_CURSOR = { segmentIndex: 0, graphemeIndex: 0 } as const;
const MIN_CONTENT_WIDTH_EPSILON = 0.001;

const preparedSegmentCache = new Map<string, PreparedTextWithSegments>();
const fontShiftCache = new Map<string, number>();
const ellipsisWidthCache = new Map<string, number>();
const preparedUnitCache = new WeakMap<PreparedTextWithSegments, PreparedTextUnit[]>();

type PreparedTextUnit = {
  text: string;
  width: number;
};

let sharedGraphemeSegmenter: Intl.Segmenter | null | undefined;

function preprocessSegments(text: string, whitespace: TextWhitespaceMode = "preserve"): string[] {
  const segments = text.split("\n");
  if (whitespace === "trim-and-collapse") {
    return segments
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  return segments;
}

function readLruValue<T>(cache: Map<string, T>, key: string): T | undefined {
  const cached = cache.get(key);
  if (cached == null) {
    return undefined;
  }
  cache.delete(key);
  cache.set(key, cached);
  return cached;
}

function writeLruValue<T>(cache: Map<string, T>, key: string, value: T, capacity: number): T {
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

function getPreparedSegmentCacheKey(segment: string, font: string): string {
  return `${font}\u0000${segment}`;
}

function readPreparedSegment(segment: string, font: string): PreparedTextWithSegments {
  const key = getPreparedSegmentCacheKey(segment, font);
  const cached = readLruValue(preparedSegmentCache, key);
  if (cached != null) {
    return cached;
  }
  return writeLruValue(preparedSegmentCache, key, prepareWithSegments(segment, font), PREPARED_SEGMENT_CACHE_CAPACITY);
}

function measureFontShift<C extends CanvasRenderingContext2D>(ctx: Context<C>): number {
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

function measurePreparedMinContentWidth(
  prepared: PreparedTextWithSegments,
  overflowWrap: TextOverflowWrapMode = "break-word",
): number {
  let maxWidth = 0;
  let maxAnyWidth = 0;
  for (let i = 0; i < prepared.widths.length; i += 1) {
    const segmentWidth = prepared.widths[i] ?? 0;
    maxAnyWidth = Math.max(maxAnyWidth, segmentWidth);
    const segment = prepared.segments[i];
    if (segment != null && segment.trim().length > 0) {
      const breakableWidths = prepared.breakableWidths[i];
      const minContentWidth = overflowWrap === "anywhere" && breakableWidths != null && breakableWidths.length > 0
        ? breakableWidths.reduce((widest, width) => Math.max(widest, width), 0)
        : segmentWidth;
      maxWidth = Math.max(maxWidth, minContentWidth);
    }
  }
  return maxWidth > 0 ? maxWidth : maxAnyWidth;
}

function measurePreparedWidth(prepared: PreparedTextWithSegments): number {
  let width = 0;
  for (const segmentWidth of prepared.widths) {
    width += segmentWidth ?? 0;
  }
  return width;
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

function splitGraphemes(text: string): string[] {
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

function getPreparedUnits(prepared: PreparedTextWithSegments): PreparedTextUnit[] {
  const cached = preparedUnitCache.get(prepared);
  if (cached != null) {
    return cached;
  }

  const units: PreparedTextUnit[] = [];
  for (let i = 0; i < prepared.segments.length; i += 1) {
    const segment = prepared.segments[i] ?? "";
    const segmentWidth = prepared.widths[i] ?? 0;
    const breakableWidths = prepared.breakableWidths[i];
    if (breakableWidths != null && segment.length > 0) {
      const graphemes = splitGraphemes(segment);
      if (graphemes.length === breakableWidths.length) {
        for (let j = 0; j < graphemes.length; j += 1) {
          units.push({ text: graphemes[j] ?? "", width: breakableWidths[j] ?? 0 });
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

function buildUnitPrefixWidths(units: PreparedTextUnit[]): number[] {
  const widths = [0];
  let total = 0;
  for (const unit of units) {
    total += unit.width;
    widths.push(total);
  }
  return widths;
}

function buildUnitSuffixWidths(units: PreparedTextUnit[]): number[] {
  const widths = [0];
  let total = 0;
  for (let i = units.length - 1; i >= 0; i -= 1) {
    total += units[i]?.width ?? 0;
    widths.push(total);
  }
  return widths;
}

function findMaxFittingCount(cumulativeWidths: number[], maxWidth: number): number {
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

function joinUnitText(units: PreparedTextUnit[], start: number, end: number): string {
  if (start >= end) {
    return "";
  }
  return units.slice(start, end).map((unit) => unit.text).join("");
}

function measureEllipsisWidth<C extends CanvasRenderingContext2D>(ctx: Context<C>): number {
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

function createEllipsisOnlyLayout<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  maxWidth: number,
  shift: number,
): OverflowTextLayout {
  const ellipsisWidth = measureEllipsisWidth(ctx);
  if (ellipsisWidth > maxWidth) {
    return { width: 0, text: "", shift, overflowed: true };
  }
  return { width: ellipsisWidth, text: ELLIPSIS_GLYPH, shift, overflowed: true };
}

function layoutPreparedEllipsis<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  prepared: PreparedTextWithSegments,
  text: string,
  maxWidth: number,
  shift: number,
  position: TextEllipsisPosition,
  forceEllipsis = false,
): OverflowTextLayout {
  const intrinsicWidth = measurePreparedWidth(prepared);
  if (!forceEllipsis && intrinsicWidth <= maxWidth) {
    return { width: intrinsicWidth, text, shift, overflowed: false };
  }

  const ellipsisWidth = measureEllipsisWidth(ctx);
  if (ellipsisWidth > maxWidth) {
    return { width: 0, text: "", shift, overflowed: true };
  }

  const units = getPreparedUnits(prepared);
  if (units.length === 0) {
    return createEllipsisOnlyLayout(ctx, maxWidth, shift);
  }

  const availableWidth = Math.max(0, maxWidth - ellipsisWidth);
  const prefixWidths = buildUnitPrefixWidths(units);
  const suffixWidths = buildUnitSuffixWidths(units);

  let prefixCount = 0;
  let suffixCount = 0;
  switch (position) {
    case "start":
      suffixCount = Math.min(units.length, findMaxFittingCount(suffixWidths, availableWidth));
      break;
    case "middle": {
      let bestVisibleUnits = -1;
      let bestBalanceScore = Number.NEGATIVE_INFINITY;
      for (let nextPrefixCount = 0; nextPrefixCount <= units.length; nextPrefixCount += 1) {
        const prefixWidth = prefixWidths[nextPrefixCount] ?? 0;
        if (prefixWidth > availableWidth) {
          break;
        }
        const remainingWidth = availableWidth - prefixWidth;
        const maxSuffixCount = units.length - nextPrefixCount;
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
      prefixCount = Math.min(units.length, findMaxFittingCount(prefixWidths, availableWidth));
      break;
  }

  const prefixWidth = prefixWidths[prefixCount] ?? 0;
  const suffixWidth = suffixWidths[suffixCount] ?? 0;
  const prefixText = joinUnitText(units, 0, prefixCount);
  const suffixText = joinUnitText(units, units.length - suffixCount, units.length);

  return {
    width: prefixWidth + ellipsisWidth + suffixWidth,
    text: `${prefixText}${ELLIPSIS_GLYPH}${suffixText}`,
    shift,
    overflowed: true,
  };
}

function normalizeMaxLines(maxLines: number | undefined): number | undefined {
  if (maxLines == null || !Number.isFinite(maxLines)) {
    return undefined;
  }
  return Math.max(1, Math.trunc(maxLines));
}

export function layoutFirstLineIntrinsic<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  whitespace: TextWhitespaceMode = "preserve",
): TextLayout {
  const segments = preprocessSegments(text, whitespace);
  const segment = segments[0];
  if (!segment) {
    return { width: 0, text: "", shift: 0 };
  }
  const shift = measureFontShift(ctx);
  return {
    width: ctx.graphics.measureText(segment).width,
    text: segment,
    shift,
  };
}

export function measureTextIntrinsic<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  whitespace: TextWhitespaceMode = "preserve",
): TextMeasurement {
  const segments = preprocessSegments(text, whitespace);
  if (segments.length === 0) {
    return { width: 0, lineCount: 0 };
  }

  let width = 0;
  for (const segment of segments) {
    width = Math.max(width, ctx.graphics.measureText(segment).width);
  }

  return { width, lineCount: segments.length };
}

export function layoutTextIntrinsic<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  whitespace: TextWhitespaceMode = "preserve",
): { width: number; lines: TextLayout[] } {
  const segments = preprocessSegments(text, whitespace);
  if (segments.length === 0) {
    return { width: 0, lines: [] };
  }

  const shift = measureFontShift(ctx);
  let width = 0;
  const lines: TextLayout[] = [];
  for (const segment of segments) {
    const measuredWidth = ctx.graphics.measureText(segment).width;
    width = Math.max(width, measuredWidth);
    lines.push({
      width: measuredWidth,
      text: segment,
      shift,
    });
  }

  return { width, lines };
}

export function layoutFirstLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
  whitespace: TextWhitespaceMode = "preserve",
): TextLayout {
  if (maxWidth < 0) {
    maxWidth = 0;
  }
  const segments = preprocessSegments(text, whitespace);
  const segment = segments[0];
  if (!segment) {
    return { width: 0, text: "", shift: 0 };
  }
  const shift = measureFontShift(ctx);
  if (maxWidth === 0) {
    return { width: 0, text: "", shift };
  }
  const prepared = readPreparedSegment(segment, ctx.graphics.font);
  const line = layoutNextLine(prepared, LINE_START_CURSOR, maxWidth);
  if (line == null) {
    return { width: 0, text: "", shift };
  }
  return { width: line.width, text: line.text, shift };
}

export function layoutEllipsizedFirstLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
  ellipsisPosition: TextEllipsisPosition = "end",
  whitespace: TextWhitespaceMode = "preserve",
): OverflowTextLayout {
  if (maxWidth < 0) {
    maxWidth = 0;
  }
  const segments = preprocessSegments(text, whitespace);
  const segment = segments[0];
  if (!segment) {
    return { width: 0, text: "", shift: 0, overflowed: false };
  }
  const shift = measureFontShift(ctx);
  if (maxWidth === 0) {
    return { width: 0, text: "", shift, overflowed: true };
  }
  const prepared = readPreparedSegment(segment, ctx.graphics.font);
  return layoutPreparedEllipsis(ctx, prepared, segment, maxWidth, shift, ellipsisPosition);
}

function layoutForcedEllipsizedLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
  shift: number,
): OverflowTextLayout {
  if (text.length === 0) {
    return createEllipsisOnlyLayout(ctx, maxWidth, shift);
  }
  const prepared = readPreparedSegment(text, ctx.graphics.font);
  return layoutPreparedEllipsis(ctx, prepared, text, maxWidth, shift, "end", true);
}

export function measureText<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
  whitespace: TextWhitespaceMode = "preserve",
): TextMeasurement {
  if (maxWidth < 0) {
    maxWidth = 0;
  }

  const segments = preprocessSegments(text, whitespace);
  if (segments.length === 0 || maxWidth === 0) {
    return { width: 0, lineCount: 0 };
  }

  const font = ctx.graphics.font;
  let width = 0;
  let lineCount = 0;

  for (const segment of segments) {
    if (segment.length === 0) {
      lineCount += 1;
      continue;
    }
    const prepared = readPreparedSegment(segment, font);
    lineCount += walkLineRanges(prepared, maxWidth, (line) => {
      width = Math.max(width, line.width);
    });
  }

  return { width, lineCount };
}

export function measureTextMinContent<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  whitespace: TextWhitespaceMode = "preserve",
  overflowWrap: TextOverflowWrapMode = "break-word",
): TextMeasurement {
  const segments = preprocessSegments(text, whitespace);
  if (segments.length === 0) {
    return { width: 0, lineCount: 0 };
  }

  const font = ctx.graphics.font;
  let width = 0;

  for (const segment of segments) {
    if (segment.length === 0) {
      continue;
    }
    const prepared = readPreparedSegment(segment, font);
    width = Math.max(width, measurePreparedMinContentWidth(prepared, overflowWrap));
  }

  let lineCount = 0;
  const lineMaxWidth = Math.max(width, MIN_CONTENT_WIDTH_EPSILON);
  for (const segment of segments) {
    if (segment.length === 0) {
      lineCount += 1;
      continue;
    }
    const prepared = readPreparedSegment(segment, font);
    lineCount += walkLineRanges(prepared, lineMaxWidth, () => {});
  }

  return { width, lineCount };
}

export function layoutText<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
  whitespace: TextWhitespaceMode = "preserve",
): { width: number; lines: TextLayout[] } {
  if (maxWidth < 0) {
    maxWidth = 0;
  }

  const segments = preprocessSegments(text, whitespace);
  if (segments.length === 0 || maxWidth === 0) {
    return { width: 0, lines: [] };
  }

  const font = ctx.graphics.font;
  const shift = measureFontShift(ctx);
  let width = 0;
  const lines: TextLayout[] = [];

  for (const segment of segments) {
    if (segment.length === 0) {
      lines.push({ width: 0, text: "", shift });
      continue;
    }
    const prepared = readPreparedSegment(segment, font);
    const { lines: segLines } = layoutWithLines(prepared, maxWidth, 0);
    for (const segLine of segLines) {
      width = Math.max(width, segLine.width);
      lines.push({ width: segLine.width, text: segLine.text, shift });
    }
  }

  return { width, lines };
}

export function layoutTextWithOverflow<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
  options: {
    whitespace?: TextWhitespaceMode;
    overflow?: TextOverflowMode;
    maxLines?: number;
  } = {},
): OverflowTextBlockLayout {
  const whitespace = options.whitespace ?? "preserve";
  const overflow = options.overflow ?? "clip";
  const normalizedMaxLines = normalizeMaxLines(options.maxLines);

  const layout = layoutText(ctx, text, maxWidth, whitespace);
  if (normalizedMaxLines == null || layout.lines.length <= normalizedMaxLines) {
    return {
      width: layout.width,
      lines: layout.lines.map((line) => ({ ...line, overflowed: false })),
      overflowed: false,
    };
  }

  const visibleLines = layout.lines.slice(0, normalizedMaxLines);
  if (overflow !== "ellipsis") {
    return {
      width: visibleLines.reduce((lineWidth, line) => Math.max(lineWidth, line.width), 0),
      lines: visibleLines.map((line) => ({ ...line, overflowed: false })),
      overflowed: true,
    };
  }

  const shift = visibleLines[visibleLines.length - 1]?.shift ?? measureFontShift(ctx);
  const lastVisibleLine = visibleLines[visibleLines.length - 1];
  const ellipsizedLastLine = lastVisibleLine == null || lastVisibleLine.text.length === 0
    ? createEllipsisOnlyLayout(ctx, Math.max(0, maxWidth), shift)
    : layoutForcedEllipsizedLine(ctx, lastVisibleLine.text, maxWidth, shift);

  const lines = [
    ...visibleLines.slice(0, -1).map((line) => ({ ...line, overflowed: false })),
    { ...ellipsizedLastLine, shift },
  ];
  return {
    width: lines.reduce((lineWidth, line) => Math.max(lineWidth, line.width), 0),
    lines,
    overflowed: true,
  };
}
