import {
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  measureRichInlineStats,
  prepareRichInline,
  type PreparedRichInline,
  type RichInlineCursor,
  type RichInlineFragmentRange,
  type RichInlineLineRange,
} from "@chenglou/pretext/rich-inline";
import type {
  Context,
  DynValue,
  InlineSpan,
  TextEllipsisPosition,
  TextOverflowMode,
  TextOverflowWrapMode,
} from "../types";
import {
  ELLIPSIS_GLYPH,
  INTRINSIC_MAX_WIDTH,
  MIN_CONTENT_WIDTH_EPSILON,
  buildPrefixWidths,
  measureEllipsisWidth,
  measureFontShift,
  normalizeMaxLines,
  readLruValue,
  selectEllipsisUnitCounts,
  writeLruValue,
} from "./core";
import { getPreparedUnits, measurePreparedMinContentWidth, readPreparedText } from "./plain-core";

const RICH_PREPARED_CACHE_CAPACITY = 256;

const LEADING_COLLAPSIBLE_BOUNDARY_RE = /^[ \t\n\f\r]+/;
const TRAILING_COLLAPSIBLE_BOUNDARY_RE = /[ \t\n\f\r]+$/;

type RichPreparedState = {
  prepared: PreparedRichInline;
  preparedItemIndexBySourceItemIndex: (number | undefined)[];
};

// Keep shared caching focused on expensive pretext prepare work.
const richPreparedCache = new Map<string, RichPreparedState>();

export interface RichFragmentLayout {
  itemIndex: number;
  text: string;
  font: string;
  color: DynValue<any, string> | undefined;
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

type RichUnitLayout = {
  fragmentIndex: number;
  itemIndex: number;
  text: string;
  width: number;
  font: string;
  color: DynValue<any, string> | undefined;
  leadingGap: number;
};

function withFont<C extends CanvasRenderingContext2D, T>(ctx: Context<C>, font: string, cb: () => T): T {
  const previousFont = ctx.graphics.font;
  ctx.graphics.font = font;
  try {
    return cb();
  } finally {
    ctx.graphics.font = previousFont;
  }
}

function getRichPreparedCacheKey<C extends CanvasRenderingContext2D>(
  spans: InlineSpan<C>[],
  defaultFont: string,
): string {
  return spans
    .map((span) => `${span.font ?? defaultFont}\u0000${span.text}\u0000${span.break ?? ""}\u0000${span.extraWidth ?? 0}`)
    .join("\u0001");
}

function readRichPrepared<C extends CanvasRenderingContext2D>(
  spans: InlineSpan<C>[],
  defaultFont: string,
): RichPreparedState {
  const key = getRichPreparedCacheKey(spans, defaultFont);
  const cached = readLruValue(richPreparedCache, key);
  if (cached != null) {
    return cached;
  }
  const items = spans.map((span) => ({
    text: span.text,
    font: span.font ?? defaultFont,
    break: span.break,
    extraWidth: span.extraWidth,
  }));
  const preparedItemIndexBySourceItemIndex = buildPreparedItemIndexBySourceItemIndex(spans);
  return writeLruValue(
    richPreparedCache,
    key,
    {
      prepared: prepareRichInline(items),
      preparedItemIndexBySourceItemIndex,
    },
    RICH_PREPARED_CACHE_CAPACITY,
  );
}

function trimRichInlineBoundaryWhitespace(text: string): string {
  return text
    .replace(LEADING_COLLAPSIBLE_BOUNDARY_RE, "")
    .replace(TRAILING_COLLAPSIBLE_BOUNDARY_RE, "");
}

function buildPreparedItemIndexBySourceItemIndex<C extends CanvasRenderingContext2D>(
  spans: InlineSpan<C>[],
): (number | undefined)[] {
  const preparedItemIndexBySourceItemIndex: (number | undefined)[] = Array.from({ length: spans.length });
  let preparedItemIndex = 0;
  for (let index = 0; index < spans.length; index += 1) {
    if (trimRichInlineBoundaryWhitespace(spans[index]!.text).length === 0) {
      continue;
    }
    preparedItemIndexBySourceItemIndex[index] = preparedItemIndex;
    preparedItemIndex += 1;
  }
  return preparedItemIndexBySourceItemIndex;
}

function getRichFragmentStartCursor(
  prepared: RichPreparedState,
  fragment: RichInlineFragmentRange,
): RichInlineCursor | null {
  const itemIndex = prepared.preparedItemIndexBySourceItemIndex[fragment.itemIndex];
  if (itemIndex == null) {
    return null;
  }
  return {
    itemIndex,
    segmentIndex: fragment.start.segmentIndex,
    graphemeIndex: fragment.start.graphemeIndex,
  };
}

function splitOverflowingRichLineRange(
  prepared: RichPreparedState,
  lineRange: RichInlineLineRange,
  maxWidth: number,
): RichInlineLineRange {
  if (lineRange.width <= maxWidth || lineRange.fragments.length <= 1) {
    return lineRange;
  }

  const trailingFragment = lineRange.fragments[lineRange.fragments.length - 1]!;
  const splitCursor = getRichFragmentStartCursor(prepared, trailingFragment);
  if (splitCursor == null) {
    return lineRange;
  }

  const fragments = lineRange.fragments.slice(0, -1);
  const width = fragments.reduce((total, fragment) => total + fragment.gapBefore + fragment.occupiedWidth, 0);
  return {
    fragments,
    width,
    end: splitCursor,
  };
}

function layoutNextConstrainedRichInlineLineRange(
  prepared: RichPreparedState,
  maxWidth: number,
  start?: RichInlineCursor,
): RichInlineLineRange | null {
  const lineRange = layoutNextRichInlineLineRange(prepared.prepared, maxWidth, start);
  if (lineRange == null) {
    return null;
  }
  return splitOverflowingRichLineRange(prepared, lineRange, maxWidth);
}

function walkConstrainedRichInlineLineRanges(
  prepared: RichPreparedState,
  maxWidth: number,
  onLine: (lineRange: RichInlineLineRange) => void,
): number {
  let lineCount = 0;
  let cursor: RichInlineCursor | undefined;
  while (true) {
    const lineRange = layoutNextConstrainedRichInlineLineRange(prepared, maxWidth, cursor);
    if (lineRange == null) {
      return lineCount;
    }
    onLine(lineRange);
    lineCount += 1;
    cursor = lineRange.end;
  }
}

function measureConstrainedRichInlineStats(
  prepared: RichPreparedState,
  maxWidth: number,
): { lineCount: number; maxLineWidth: number } {
  let lineCount = 0;
  let maxLineWidth = 0;
  walkConstrainedRichInlineLineRanges(prepared, maxWidth, (lineRange) => {
    lineCount += 1;
    if (lineRange.width > maxLineWidth) {
      maxLineWidth = lineRange.width;
    }
  });
  return {
    lineCount,
    maxLineWidth,
  };
}

function measureRichFragmentShift<C extends CanvasRenderingContext2D>(ctx: Context<C>, font: string): number {
  return withFont(ctx, font, () => measureFontShift(ctx));
}

function materializeRichLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultFont: string,
  defaultColor: DynValue<C, string>,
  lineRange: RichInlineLineRange,
  overflowed: boolean,
): RichLineLayout {
  const prepared = readRichPrepared(spans, defaultFont);
  const richLine = materializeRichInlineLineRange(prepared.prepared, lineRange);
  const fragments: RichFragmentLayout[] = richLine.fragments.map((fragment) => {
    const span = spans[fragment.itemIndex];
    const font = span?.font ?? defaultFont;
    const color = span?.color ?? defaultColor;
    return {
      itemIndex: fragment.itemIndex,
      text: fragment.text,
      font,
      color: color as DynValue<any, string>,
      gapBefore: fragment.gapBefore,
      occupiedWidth: fragment.occupiedWidth,
      shift: measureRichFragmentShift(ctx, font),
    };
  });
  return { width: richLine.width, fragments, overflowed };
}

function flattenRichLineUnits(line: RichLineLayout): RichUnitLayout[] {
  const units: RichUnitLayout[] = [];
  for (let fragmentIndex = 0; fragmentIndex < line.fragments.length; fragmentIndex += 1) {
    const fragment = line.fragments[fragmentIndex]!;
    const prepared = readPreparedText(fragment.text, fragment.font, "normal", "normal");
    const fragmentUnits = getPreparedUnits(prepared);
    if (fragmentUnits.length === 0) {
      continue;
    }

    const textWidth = fragmentUnits.reduce((total, unit) => total + unit.width, 0);
    const trailingExtraWidth = Math.max(0, fragment.occupiedWidth - textWidth);

    for (let unitIndex = 0; unitIndex < fragmentUnits.length; unitIndex += 1) {
      const unit = fragmentUnits[unitIndex]!;
      units.push({
        fragmentIndex,
        itemIndex: fragment.itemIndex,
        text: unit.text,
        width: unit.width + (unitIndex === fragmentUnits.length - 1 ? trailingExtraWidth : 0),
        font: fragment.font,
        color: fragment.color,
        leadingGap: unitIndex === 0 ? fragment.gapBefore : 0,
      });
    }
  }
  return units;
}

function buildRichPrefixWidths(units: readonly RichUnitLayout[]): number[] {
  return buildPrefixWidths(units.map((unit) => unit.leadingGap + unit.width));
}

function buildRichSuffixWidths(units: readonly RichUnitLayout[]): number[] {
  const widths = [0];
  let total = 0;
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index]!;
    total += unit.width;
    if (widths.length > 1) {
      total += unit.leadingGap;
    }
    widths.push(total);
  }
  return widths;
}

function materializeRichFragmentsFromUnits(
  units: readonly RichUnitLayout[],
  start: number,
  end: number,
  suppressLeadingGap: boolean,
): RichFragmentLayout[] {
  const fragments: RichFragmentLayout[] = [];
  for (let index = start; index < end; index += 1) {
    const unit = units[index]!;
    const previous = fragments[fragments.length - 1];
    const previousUnit = units[index - 1];
    if (previous != null && previousUnit != null && previousUnit.fragmentIndex === unit.fragmentIndex) {
      previous.text += unit.text;
      previous.occupiedWidth += unit.width;
      continue;
    }

    fragments.push({
      itemIndex: unit.itemIndex,
      text: unit.text,
      font: unit.font,
      color: unit.color,
      gapBefore: fragments.length === 0 && suppressLeadingGap ? 0 : unit.leadingGap,
      occupiedWidth: unit.width,
      shift: 0,
    });
  }
  return fragments;
}

function measureRichFragmentsShift<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  fragments: readonly RichFragmentLayout[],
): RichFragmentLayout[] {
  return fragments.map((fragment) => ({
    ...fragment,
    shift: measureRichFragmentShift(ctx, fragment.font),
  }));
}

function createRichEllipsisFragment<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  font: string,
  color: DynValue<C, string> | undefined,
): RichFragmentLayout {
  return withFont(ctx, font, () => ({
    itemIndex: -1,
    text: ELLIPSIS_GLYPH,
    font,
    color,
    gapBefore: 0,
    occupiedWidth: measureEllipsisWidth(ctx),
    shift: measureFontShift(ctx),
  }));
}

function createRichEllipsisOnlyLayout<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  maxWidth: number,
  font: string,
  color: DynValue<C, string> | undefined,
): RichLineLayout {
  const ellipsis = createRichEllipsisFragment(ctx, font, color);
  if (ellipsis.occupiedWidth > maxWidth) {
    return { width: 0, fragments: [], overflowed: true };
  }
  return { width: ellipsis.occupiedWidth, fragments: [ellipsis], overflowed: true };
}

function layoutPreparedRichEllipsis<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  line: RichLineLayout,
  maxWidth: number,
  defaultFont: string,
  defaultColor: DynValue<C, string>,
  position: TextEllipsisPosition,
): RichLineLayout {
  if (!line.overflowed && line.width <= maxWidth) {
    return { ...line, overflowed: false };
  }

  const units = flattenRichLineUnits(line);
  const fallbackFragment = line.fragments[0];
  const fallbackFont = fallbackFragment?.font ?? defaultFont;
  const fallbackColor = (fallbackFragment?.color ?? defaultColor) as DynValue<C, string>;
  const ellipsisOnly = createRichEllipsisOnlyLayout(ctx, maxWidth, fallbackFont, fallbackColor);
  if (ellipsisOnly.fragments.length === 0 || units.length === 0) {
    return ellipsisOnly;
  }

  const ellipsisWidth = ellipsisOnly.width;
  const availableWidth = Math.max(0, maxWidth - ellipsisWidth);
  const prefixWidths = buildRichPrefixWidths(units);
  const suffixWidths = buildRichSuffixWidths(units);
  const { prefixCount, suffixCount } = selectEllipsisUnitCounts({
    position,
    prefixWidths,
    suffixWidths,
    unitCount: units.length,
    availableWidth,
    getMaxSuffixCount: position === "middle"
      ? (nextPrefixCount) => Math.max(0, units.length - nextPrefixCount - 1)
      : undefined,
  });

  const prefixFragments = measureRichFragmentsShift(ctx, materializeRichFragmentsFromUnits(units, 0, prefixCount, false));
  const suffixStartIndex = units.length - suffixCount;
  const suffixFragments = measureRichFragmentsShift(
    ctx,
    materializeRichFragmentsFromUnits(units, suffixStartIndex, units.length, true),
  );

  const ellipsisSource =
    position === "start"
      ? (suffixFragments[0] ?? line.fragments[0])
      : position === "middle"
        ? (prefixFragments[prefixFragments.length - 1] ?? suffixFragments[0] ?? line.fragments[line.fragments.length - 1])
        : (prefixFragments[prefixFragments.length - 1] ?? line.fragments[line.fragments.length - 1]);
  const ellipsis = createRichEllipsisFragment(
    ctx,
    ellipsisSource?.font ?? defaultFont,
    (ellipsisSource?.color ?? defaultColor) as DynValue<C, string>,
  );

  const fragments =
    position === "start"
      ? [ellipsis, ...suffixFragments]
      : position === "middle"
        ? [...prefixFragments, ellipsis, ...suffixFragments]
        : [...prefixFragments, ellipsis];
  const width =
    position === "start"
      ? ellipsis.occupiedWidth + (suffixWidths[suffixCount] ?? 0)
      : position === "middle"
        ? (prefixWidths[prefixCount] ?? 0) + ellipsis.occupiedWidth + (suffixWidths[suffixCount] ?? 0)
        : (prefixWidths[prefixCount] ?? 0) + ellipsis.occupiedWidth;

  return { width, fragments, overflowed: true };
}

export function layoutRichFirstLineIntrinsic<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultFont: string,
  defaultColor: DynValue<C, string>,
): RichLineLayout {
  if (spans.length === 0) {
    return { width: 0, fragments: [], overflowed: false };
  }
  const prepared = readRichPrepared(spans, defaultFont);
  const lineRange = layoutNextRichInlineLineRange(prepared.prepared, INTRINSIC_MAX_WIDTH);
  if (lineRange == null) {
    return { width: 0, fragments: [], overflowed: false };
  }
  return materializeRichLine(ctx, spans, defaultFont, defaultColor, lineRange, false);
}

export function layoutRichFirstLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  maxWidth: number,
  defaultFont: string,
  defaultColor: DynValue<C, string>,
): RichLineLayout {
  const clampedMaxWidth = Math.max(0, maxWidth);
  if (spans.length === 0 || clampedMaxWidth === 0) {
    return { width: 0, fragments: [], overflowed: false };
  }
  const prepared = readRichPrepared(spans, defaultFont);
  const lineRange = layoutNextConstrainedRichInlineLineRange(prepared, clampedMaxWidth);
  if (lineRange == null) {
    return { width: 0, fragments: [], overflowed: false };
  }
  return materializeRichLine(ctx, spans, defaultFont, defaultColor, lineRange, false);
}

export function layoutRichEllipsizedFirstLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  maxWidth: number,
  defaultFont: string,
  defaultColor: DynValue<C, string>,
  ellipsisPosition: TextEllipsisPosition = "end",
): RichLineLayout {
  const clampedMaxWidth = Math.max(0, maxWidth);
  const intrinsicLine = layoutRichFirstLineIntrinsic(ctx, spans, defaultFont, defaultColor);
  if (intrinsicLine.fragments.length === 0) {
    return { ...intrinsicLine, overflowed: false };
  }
  if (clampedMaxWidth === 0) {
    return { width: 0, fragments: [], overflowed: true };
  }
  return layoutPreparedRichEllipsis(ctx, intrinsicLine, clampedMaxWidth, defaultFont, defaultColor, ellipsisPosition);
}

export function measureRichText<C extends CanvasRenderingContext2D>(
  _ctx: Context<C>,
  spans: InlineSpan<C>[],
  maxWidth: number,
  defaultFont: string,
): RichMeasurement {
  if (spans.length === 0) {
    return { width: 0, lineCount: 0 };
  }
  const prepared = readRichPrepared(spans, defaultFont);
  const { maxLineWidth: width, lineCount } = measureConstrainedRichInlineStats(prepared, maxWidth);
  return { width, lineCount };
}

export function measureRichTextIntrinsic<C extends CanvasRenderingContext2D>(
  _ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultFont: string,
): RichMeasurement {
  if (spans.length === 0) {
    return { width: 0, lineCount: 0 };
  }
  const prepared = readRichPrepared(spans, defaultFont);
  const { maxLineWidth: width, lineCount } = measureRichInlineStats(prepared.prepared, INTRINSIC_MAX_WIDTH);
  return { width, lineCount };
}

export function measureRichTextMinContent<C extends CanvasRenderingContext2D>(
  _ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultFont: string,
  overflowWrap: TextOverflowWrapMode = "break-word",
): RichMeasurement {
  if (spans.length === 0) {
    return { width: 0, lineCount: 0 };
  }
  let maxWidth = 0;
  for (const span of spans) {
    if (span.text.trim().length === 0) {
      continue;
    }
    const font = span.font ?? defaultFont;
    const prepared = readPreparedText(span.text, font, "normal", "normal");
    const spanMinWidth = measurePreparedMinContentWidth(prepared, overflowWrap) + (span.extraWidth ?? 0);
    if (spanMinWidth > maxWidth) {
      maxWidth = spanMinWidth;
    }
  }
  if (maxWidth === 0) {
    return { width: 0, lineCount: 0 };
  }
  const prepared = readRichPrepared(spans, defaultFont);
  const lineMaxWidth = Math.max(maxWidth, MIN_CONTENT_WIDTH_EPSILON);
  const { lineCount } = measureConstrainedRichInlineStats(prepared, lineMaxWidth);
  return { width: maxWidth, lineCount };
}

export function layoutRichText<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  maxWidth: number,
  defaultFont: string,
  defaultColor: DynValue<C, string>,
): RichBlockLayout {
  if (spans.length === 0) {
    return { width: 0, lines: [], overflowed: false };
  }
  const prepared = readRichPrepared(spans, defaultFont);
  const lineRanges: RichInlineLineRange[] = [];
  walkConstrainedRichInlineLineRanges(prepared, maxWidth, (lineRange) => lineRanges.push(lineRange));
  if (lineRanges.length === 0) {
    return { width: 0, lines: [], overflowed: false };
  }
  const lines = lineRanges.map((lineRange) => materializeRichLine(ctx, spans, defaultFont, defaultColor, lineRange, false));
  const width = lines.reduce((maxLineWidth, line) => Math.max(maxLineWidth, line.width), 0);
  return { width, lines, overflowed: false };
}

export function layoutRichTextIntrinsic<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultFont: string,
  defaultColor: DynValue<C, string>,
): RichBlockLayout {
  return layoutRichText(ctx, spans, INTRINSIC_MAX_WIDTH, defaultFont, defaultColor);
}

export function layoutRichTextWithOverflow<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  maxWidth: number,
  defaultFont: string,
  defaultColor: DynValue<C, string>,
  maxLines?: number,
  overflow: TextOverflowMode = "clip",
): RichBlockLayout {
  if (spans.length === 0) {
    return { width: 0, lines: [], overflowed: false };
  }

  const normalizedMaxLines = normalizeMaxLines(maxLines);
  const layout = layoutRichText(ctx, spans, maxWidth, defaultFont, defaultColor);
  if (normalizedMaxLines == null || layout.lines.length <= normalizedMaxLines) {
    return layout;
  }

  const visibleLines = layout.lines.slice(0, normalizedMaxLines);
  if (overflow !== "ellipsis") {
    return {
      width: visibleLines.reduce((maxLineWidth, line) => Math.max(maxLineWidth, line.width), 0),
      lines: visibleLines,
      overflowed: true,
    };
  }

  const lastVisibleLine = visibleLines[visibleLines.length - 1];
  const ellipsizedLastLine = lastVisibleLine == null
    ? { width: 0, fragments: [], overflowed: true }
    : layoutPreparedRichEllipsis(
        ctx,
        { ...lastVisibleLine, overflowed: true },
        maxWidth,
        defaultFont,
        defaultColor,
        "end",
      );

  const lines = [...visibleLines.slice(0, -1), ellipsizedLastLine];
  return {
    width: lines.reduce((maxLineWidth, line) => Math.max(maxLineWidth, line.width), 0),
    lines,
    overflowed: true,
  };
}
