import {
  layoutNextLine,
  layoutWithLines,
  measureLineStats,
  measureNaturalWidth,
  prepareWithSegments,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";
import {
  materializeRichInlineLineRange,
  measureRichInlineStats,
  prepareRichInline,
  walkRichInlineLineRanges,
  type PreparedRichInline,
  type RichInlineLineRange,
} from "@chenglou/pretext/rich-inline";
import type {
  Context,
  DynValue,
  InlineSpan,
  TextEllipsisPosition,
  TextOverflowMode,
  TextOverflowWrapMode,
  TextWhiteSpaceMode,
  TextWordBreakMode,
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
const INTRINSIC_MAX_WIDTH = Number.POSITIVE_INFINITY;
const PREPARED_TEXT_CACHE_CAPACITY = 512;
const FONT_SHIFT_CACHE_CAPACITY = 64;
const ELLIPSIS_WIDTH_CACHE_CAPACITY = 64;
const LINE_START_CURSOR = { segmentIndex: 0, graphemeIndex: 0 } as const;
const MIN_CONTENT_WIDTH_EPSILON = 0.001;

const preparedTextCache = new Map<string, PreparedTextWithSegments>();
const fontShiftCache = new Map<string, number>();
const ellipsisWidthCache = new Map<string, number>();
const preparedUnitCache = new WeakMap<PreparedTextWithSegments, PreparedTextUnit[]>();

type PreparedTextUnit = {
  text: string;
  width: number;
};

let sharedGraphemeSegmenter: Intl.Segmenter | null | undefined;

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

function getPreparedTextCacheKey(
  text: string,
  font: string,
  whiteSpace: TextWhiteSpaceMode,
  wordBreak: TextWordBreakMode,
): string {
  return `${font}\u0000${whiteSpace}\u0000${wordBreak}\u0000${text}`;
}

function readPreparedText(
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

function readPreparedFirstLine<C extends CanvasRenderingContext2D>(
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
      const breakableWidths = prepared.breakableFitAdvances[i];
      const minContentWidth = overflowWrap === "anywhere" && breakableWidths != null && breakableWidths.length > 0
        ? breakableWidths.reduce((widest, width) => Math.max(widest, width), 0)
        : segmentWidth;
      maxWidth = Math.max(maxWidth, minContentWidth);
    }
  }
  return maxWidth > 0 ? maxWidth : maxAnyWidth;
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
    const breakableWidths = prepared.breakableFitAdvances[i];
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
  const intrinsicWidth = measureNaturalWidth(prepared);
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
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): TextLayout {
  const firstLine = readPreparedFirstLine(ctx, text, whiteSpace, wordBreak);
  if (firstLine == null) {
    return { width: 0, text: "", shift: 0 };
  }
  const shift = measureFontShift(ctx);
  return {
    width: measureNaturalWidth(firstLine.prepared),
    text: firstLine.text,
    shift,
  };
}

export function measureTextIntrinsic<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): TextMeasurement {
  const prepared = readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak);
  const { maxLineWidth: width, lineCount } = measureLineStats(prepared, INTRINSIC_MAX_WIDTH);
  if (lineCount === 0) {
    return { width: 0, lineCount: 0 };
  }
  return { width, lineCount };
}

export function layoutTextIntrinsic<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): { width: number; lines: TextLayout[] } {
  const intrinsic = layoutWithLines(
    readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak),
    INTRINSIC_MAX_WIDTH,
    0,
  );
  if (intrinsic.lines.length === 0) {
    return { width: 0, lines: [] };
  }

  const shift = measureFontShift(ctx);
  const lines = intrinsic.lines.map((line) => ({ width: line.width, text: line.text, shift }));
  const width = lines.reduce((maxLineWidth, line) => Math.max(maxLineWidth, line.width), 0);

  return { width, lines };
}

export function layoutFirstLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): TextLayout {
  if (maxWidth < 0) {
    maxWidth = 0;
  }
  const shift = measureFontShift(ctx);
  if (maxWidth === 0) {
    return { width: 0, text: "", shift };
  }
  const prepared = readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak);
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
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): OverflowTextLayout {
  if (maxWidth < 0) {
    maxWidth = 0;
  }
  const firstLine = readPreparedFirstLine(ctx, text, whiteSpace, wordBreak);
  if (firstLine == null) {
    return { width: 0, text: "", shift: 0, overflowed: false };
  }
  const shift = measureFontShift(ctx);
  if (maxWidth === 0) {
    return { width: 0, text: "", shift, overflowed: true };
  }
  return layoutPreparedEllipsis(ctx, firstLine.prepared, firstLine.text, maxWidth, shift, ellipsisPosition);
}

function layoutForcedEllipsizedLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
  shift: number,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): OverflowTextLayout {
  if (text.length === 0) {
    return createEllipsisOnlyLayout(ctx, maxWidth, shift);
  }
  const prepared = readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak);
  return layoutPreparedEllipsis(ctx, prepared, text, maxWidth, shift, "end", true);
}

export function measureText<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): TextMeasurement {
  if (maxWidth < 0) {
    maxWidth = 0;
  }
  if (maxWidth === 0) {
    return { width: 0, lineCount: 0 };
  }

  const prepared = readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak);
  const { maxLineWidth: width, lineCount } = measureLineStats(prepared, maxWidth);

  return { width, lineCount };
}

export function measureTextMinContent<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
  overflowWrap: TextOverflowWrapMode = "break-word",
): TextMeasurement {
  const prepared = readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak);
  if (prepared.widths.length === 0) {
    return { width: 0, lineCount: 0 };
  }

  const width = measurePreparedMinContentWidth(prepared, overflowWrap);
  const lineMaxWidth = Math.max(width, MIN_CONTENT_WIDTH_EPSILON);
  const { lineCount } = measureLineStats(prepared, lineMaxWidth);

  return { width, lineCount };
}

export function layoutText<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): { width: number; lines: TextLayout[] } {
  if (maxWidth < 0) {
    maxWidth = 0;
  }
  if (maxWidth === 0) {
    return { width: 0, lines: [] };
  }

  const layout = layoutWithLines(readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak), maxWidth, 0);
  if (layout.lines.length === 0) {
    return { width: 0, lines: [] };
  }

  const shift = measureFontShift(ctx);
  const lines = layout.lines.map((line) => ({ width: line.width, text: line.text, shift }));
  const width = lines.reduce((maxLineWidth, line) => Math.max(maxLineWidth, line.width), 0);

  return { width, lines };
}

export function layoutTextWithOverflow<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
  options: {
    whiteSpace?: TextWhiteSpaceMode;
    wordBreak?: TextWordBreakMode;
    overflow?: TextOverflowMode;
    maxLines?: number;
  } = {},
): OverflowTextBlockLayout {
  const whiteSpace = options.whiteSpace ?? "normal";
  const wordBreak = options.wordBreak ?? "normal";
  const overflow = options.overflow ?? "clip";
  const normalizedMaxLines = normalizeMaxLines(options.maxLines);

  const layout = layoutText(ctx, text, maxWidth, whiteSpace, wordBreak);
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
    : layoutForcedEllipsizedLine(ctx, lastVisibleLine.text, maxWidth, shift, whiteSpace, wordBreak);

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

// ─── Rich inline (InlineSpan) layout ────────────────────────────────────────

const RICH_PREPARED_CACHE_CAPACITY = 256;
const richPreparedCache = new Map<string, PreparedRichInline>();

export interface RichFragmentLayout {
  itemIndex: number;
  text: string;
  font: string;
  style: DynValue<any, string> | undefined;
  gapBefore: number;
  occupiedWidth: number;
  shift: number;
}

export interface RichLineLayout {
  width: number;
  fragments: RichFragmentLayout[];
  overflowed: boolean;
}

export interface RichBlockLayout {
  width: number;
  lines: RichLineLayout[];
  overflowed: boolean;
}

export interface RichMeasurement {
  width: number;
  lineCount: number;
}

function getRichPreparedCacheKey<C extends CanvasRenderingContext2D>(
  spans: InlineSpan<C>[],
  defaultFont: string,
): string {
  return spans
    .map((s) => `${s.font ?? defaultFont}\u0000${s.text}\u0000${s.break ?? ""}\u0000${s.extraWidth ?? 0}`)
    .join("\u0001");
}

function readRichPrepared<C extends CanvasRenderingContext2D>(
  spans: InlineSpan<C>[],
  defaultFont: string,
): PreparedRichInline {
  const key = getRichPreparedCacheKey(spans, defaultFont);
  const cached = readLruValue(richPreparedCache, key);
  if (cached != null) return cached;
  const items = spans.map((s) => ({
    text: s.text,
    font: s.font ?? defaultFont,
    break: s.break,
    extraWidth: s.extraWidth,
  }));
  return writeLruValue(richPreparedCache, key, prepareRichInline(items), RICH_PREPARED_CACHE_CAPACITY);
}

function materializeRichLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultFont: string,
  defaultStyle: DynValue<C, string>,
  lineRange: RichInlineLineRange,
  overflowed: boolean,
): RichLineLayout {
  const prepared = readRichPrepared(spans, defaultFont);
  const richLine = materializeRichInlineLineRange(prepared, lineRange);
  // Set the font for measuring shift per-fragment based on fragment font
  const fragments: RichFragmentLayout[] = richLine.fragments.map((frag) => {
    const span = spans[frag.itemIndex];
    const fragFont = span?.font ?? defaultFont;
    const fragStyle = span?.style ?? defaultStyle;
    const prevFont = ctx.graphics.font;
    ctx.graphics.font = fragFont;
    const shift = measureFontShift(ctx);
    ctx.graphics.font = prevFont;
    return {
      itemIndex: frag.itemIndex,
      text: frag.text,
      font: fragFont,
      style: fragStyle as DynValue<any, string>,
      gapBefore: frag.gapBefore,
      occupiedWidth: frag.occupiedWidth,
      shift,
    };
  });
  return { width: richLine.width, fragments, overflowed };
}

export function measureRichText<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  maxWidth: number,
  defaultFont: string,
): RichMeasurement {
  if (spans.length === 0) return { width: 0, lineCount: 0 };
  const prepared = readRichPrepared(spans, defaultFont);
  const { maxLineWidth: width, lineCount } = measureRichInlineStats(prepared, maxWidth);
  return { width, lineCount };
}

export function measureRichTextIntrinsic<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultFont: string,
): RichMeasurement {
  if (spans.length === 0) return { width: 0, lineCount: 0 };
  const prepared = readRichPrepared(spans, defaultFont);
  const { maxLineWidth: width, lineCount } = measureRichInlineStats(prepared, INTRINSIC_MAX_WIDTH);
  return { width, lineCount };
}

export function measureRichTextMinContent<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultFont: string,
  overflowWrap: TextOverflowWrapMode = "break-word",
): RichMeasurement {
  if (spans.length === 0) return { width: 0, lineCount: 0 };
  // Measure min-content per span independently, take the max. This is an MVP
  // approximation; `break: "never"` cross-span groups are not modeled precisely.
  let maxWidth = 0;
  for (const span of spans) {
    if (span.text.trim().length === 0) continue;
    const font = span.font ?? defaultFont;
    const prep = readPreparedText(span.text, font, "normal", "normal");
    const spanMin = measurePreparedMinContentWidth(prep, overflowWrap) + (span.extraWidth ?? 0);
    if (spanMin > maxWidth) maxWidth = spanMin;
  }
  if (maxWidth === 0) return { width: 0, lineCount: 0 };
  const prepared = readRichPrepared(spans, defaultFont);
  const lineMaxWidth = Math.max(maxWidth, MIN_CONTENT_WIDTH_EPSILON);
  const { lineCount } = measureRichInlineStats(prepared, lineMaxWidth);
  return { width: maxWidth, lineCount };
}

export function layoutRichText<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  maxWidth: number,
  defaultFont: string,
  defaultStyle: DynValue<C, string>,
): RichBlockLayout {
  if (spans.length === 0) return { width: 0, lines: [], overflowed: false };
  const prepared = readRichPrepared(spans, defaultFont);
  const lineRanges: RichInlineLineRange[] = [];
  walkRichInlineLineRanges(prepared, maxWidth, (line) => lineRanges.push(line));
  if (lineRanges.length === 0) return { width: 0, lines: [], overflowed: false };
  const lines = lineRanges.map((lr) => materializeRichLine(ctx, spans, defaultFont, defaultStyle, lr, false));
  const width = lines.reduce((max, line) => Math.max(max, line.width), 0);
  return { width, lines, overflowed: false };
}

export function layoutRichTextIntrinsic<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultFont: string,
  defaultStyle: DynValue<C, string>,
): RichBlockLayout {
  return layoutRichText(ctx, spans, INTRINSIC_MAX_WIDTH, defaultFont, defaultStyle);
}

export function layoutRichTextWithOverflow<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  maxWidth: number,
  defaultFont: string,
  defaultStyle: DynValue<C, string>,
  maxLines?: number,
  overflow: TextOverflowMode = "clip",
): RichBlockLayout {
  if (spans.length === 0) return { width: 0, lines: [], overflowed: false };

  const normalizedMaxLines = normalizeMaxLines(maxLines);
  const layout = layoutRichText(ctx, spans, maxWidth, defaultFont, defaultStyle);

  if (normalizedMaxLines == null || layout.lines.length <= normalizedMaxLines) {
    return layout;
  }

  const visibleLines = layout.lines.slice(0, normalizedMaxLines);

  if (overflow !== "ellipsis") {
    return {
      width: visibleLines.reduce((max, line) => Math.max(max, line.width), 0),
      lines: visibleLines,
      overflowed: true,
    };
  }

  // End-ellipsis on the last visible line
  const lastLine = visibleLines[visibleLines.length - 1];
  if (lastLine == null || lastLine.fragments.length === 0) {
    return {
      width: visibleLines.slice(0, -1).reduce((max, line) => Math.max(max, line.width), 0),
      lines: visibleLines.slice(0, -1),
      overflowed: true,
    };
  }

  // Find the last fragment's font for ellipsis width measurement
  const lastFrag = lastLine.fragments[lastLine.fragments.length - 1]!;
  const prevFont1 = ctx.graphics.font;
  ctx.graphics.font = lastFrag.font;
  const ellipsisWidth = measureEllipsisWidth(ctx);
  ctx.graphics.font = prevFont1;

  if (maxWidth <= 0 || ellipsisWidth > maxWidth) {
    const truncatedLine: RichLineLayout = { width: 0, fragments: [], overflowed: true };
    return {
      width: visibleLines.slice(0, -1).reduce((max, line) => Math.max(max, line.width), 0),
      lines: [...visibleLines.slice(0, -1), truncatedLine],
      overflowed: true,
    };
  }

  // Rebuild last line respecting ellipsis budget
  const budget = maxWidth - ellipsisWidth;
  const resultFragments: RichFragmentLayout[] = [];
  let usedWidth = 0;
  let ellipsisFont = lastFrag.font;
  let ellipsisStyle: DynValue<any, string> | undefined = lastFrag.style;
  let truncated = false;

  for (let fi = 0; fi < lastLine.fragments.length; fi++) {
    const frag = lastLine.fragments[fi]!;
    const neededGap = fi === 0 ? 0 : frag.gapBefore;
    const fragTotal = neededGap + frag.occupiedWidth;

    if (usedWidth + fragTotal <= budget) {
      resultFragments.push({ ...frag, gapBefore: fi === 0 ? 0 : frag.gapBefore });
      usedWidth += fragTotal;
    } else {
      // Try fitting a prefix of this fragment character by character
      ellipsisFont = frag.font;
      ellipsisStyle = frag.style;
      const remaining = budget - usedWidth - neededGap;
      if (remaining > 0 && frag.text.length > 0) {
        // Measure grapheme prefix that fits
        const frag_prep = readPreparedText(frag.text, frag.font, "normal", "normal");
        const units = getPreparedUnits(frag_prep);
        let charWidth = 0;
        let charText = "";
        for (const unit of units) {
          if (charWidth + unit.width > remaining) break;
          charWidth += unit.width;
          charText += unit.text;
        }
        if (charText.length > 0) {
          resultFragments.push({
            ...frag,
            text: charText,
            occupiedWidth: charWidth,
            gapBefore: fi === 0 ? 0 : frag.gapBefore,
          });
          usedWidth += neededGap + charWidth;
        }
      }
      truncated = true;
      break;
    }
  }

  // Append ellipsis as a synthetic fragment
  const prevFont2 = ctx.graphics.font;
  ctx.graphics.font = ellipsisFont;
  const ellipsisShift = measureFontShift(ctx);
  ctx.graphics.font = prevFont2;
  resultFragments.push({
    itemIndex: -1,
    text: ELLIPSIS_GLYPH,
    font: ellipsisFont,
    style: ellipsisStyle,
    gapBefore: 0,
    occupiedWidth: ellipsisWidth,
    shift: ellipsisShift,
  });

  const lastLineResult: RichLineLayout = {
    width: usedWidth + ellipsisWidth,
    fragments: resultFragments,
    overflowed: truncated || layout.lines.length > normalizedMaxLines,
  };

  return {
    width: [...visibleLines.slice(0, -1), lastLineResult].reduce((max, line) => Math.max(max, line.width), 0),
    lines: [...visibleLines.slice(0, -1), lastLineResult],
    overflowed: true,
  };
}
