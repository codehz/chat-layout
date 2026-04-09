import type {
  Context,
  DynValue,
  InlineSpan,
  TextEllipsisPosition,
  TextOverflowMode,
  TextOverflowWrapMode,
  TextWhiteSpaceMode,
  TextWordBreakMode,
} from "../types";
import {
  ELLIPSIS_GLYPH,
  MIN_CONTENT_WIDTH_EPSILON,
  buildPrefixWidths,
  buildSuffixWidths,
  measureEllipsisWidth,
  measureFontShift,
  normalizeMaxLines,
  selectEllipsisUnitCounts,
} from "./core";
import {
  collectAtomsInRange,
  createRichSourceItems,
  forEachAtomFromCursorToEnd,
  forEachAtomInRange,
  getPreparedLineStart,
  getRichPreparedKey,
  layoutNextPreparedLine,
  materializePreparedLineText,
  measureAtomsWidth,
  measurePreparedLineStats,
  walkPreparedLineRanges,
  type InlineAtom,
  type PreparedInlineLayout,
  type PreparedInlineLineRange,
} from "./inline-engine";
import { measurePreparedMinContentWidth, readPreparedInlineLayout } from "./inline-engine";

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

function withFont<C extends CanvasRenderingContext2D, T>(ctx: Context<C>, font: string, cb: () => T): T {
  const previousFont = ctx.graphics.font;
  ctx.graphics.font = font;
  try {
    return cb();
  } finally {
    ctx.graphics.font = previousFont;
  }
}

function readRichPrepared<C extends CanvasRenderingContext2D>(
  spans: InlineSpan<C>[],
  defaultFont: string,
  whiteSpace: TextWhiteSpaceMode,
  wordBreak: TextWordBreakMode,
): PreparedInlineLayout {
  return readPreparedInlineLayout(
    getRichPreparedKey(spans, defaultFont, whiteSpace, wordBreak),
    createRichSourceItems(spans, defaultFont),
    whiteSpace,
    wordBreak,
  );
}

function measureRichFragmentShift<C extends CanvasRenderingContext2D>(ctx: Context<C>, font: string): number {
  return withFont(ctx, font, () => measureFontShift(ctx));
}

function materializeRichFragments<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultColor: DynValue<C, string>,
  atoms: readonly InlineAtom[],
): RichFragmentLayout[] {
  const fragments: RichFragmentLayout[] = [];
  let pendingGapBefore = 0;

  for (const atom of atoms) {
    const occupiedWidth = atom.width + atom.extraWidthAfter;
    if (atom.kind === "space" && !atom.preservesLineEnd && atom.atomicGroupId == null) {
      pendingGapBefore += occupiedWidth;
      continue;
    }

    const span = spans[atom.itemIndex];
    const font = span?.font ?? atom.font;
    const color = span?.color ?? defaultColor;
    const previous = fragments[fragments.length - 1];
    if (previous != null && previous.itemIndex === atom.itemIndex && previous.font === font && pendingGapBefore === 0) {
      previous.text += atom.text;
      previous.occupiedWidth += occupiedWidth;
      continue;
    }

    fragments.push({
      itemIndex: atom.itemIndex,
      text: atom.text,
      font,
      color: color as DynValue<any, string>,
      gapBefore: pendingGapBefore,
      occupiedWidth,
      shift: measureRichFragmentShift(ctx, font),
    });
    pendingGapBefore = 0;
  }

  return fragments;
}

function appendRichFragment<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultColor: DynValue<C, string>,
  fragments: RichFragmentLayout[],
  atom: InlineAtom,
  pendingGapBefore: number,
): number {
  const occupiedWidth = atom.width + atom.extraWidthAfter;
  if (atom.kind === "space" && !atom.preservesLineEnd && atom.atomicGroupId == null) {
    return pendingGapBefore + occupiedWidth;
  }

  const span = spans[atom.itemIndex];
  const font = span?.font ?? atom.font;
  const color = span?.color ?? defaultColor;
  const previous = fragments[fragments.length - 1];
  if (previous != null && previous.itemIndex === atom.itemIndex && previous.font === font && pendingGapBefore === 0) {
    previous.text += atom.text;
    previous.occupiedWidth += occupiedWidth;
    return 0;
  }

  fragments.push({
    itemIndex: atom.itemIndex,
    text: atom.text,
    font,
    color: color as DynValue<any, string>,
    gapBefore: pendingGapBefore,
    occupiedWidth,
    shift: measureRichFragmentShift(ctx, font),
  });
  return 0;
}

function materializeRichFragmentsInRange<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultColor: DynValue<C, string>,
  prepared: PreparedInlineLayout,
  start: PreparedInlineLineRange["start"],
  end: PreparedInlineLineRange["end"],
): RichFragmentLayout[] {
  const fragments: RichFragmentLayout[] = [];
  let pendingGapBefore = 0;
  forEachAtomInRange(prepared, start, end, (atom) => {
    pendingGapBefore = appendRichFragment(ctx, spans, defaultColor, fragments, atom, pendingGapBefore);
  });
  return fragments;
}

function materializeRichLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultColor: DynValue<C, string>,
  prepared: PreparedInlineLayout,
  line: PreparedInlineLineRange,
  overflowed: boolean,
): RichLineLayout {
  return {
    width: line.width,
    fragments: materializeRichFragmentsInRange(ctx, spans, defaultColor, prepared, line.start, line.end),
    overflowed,
  };
}

function getFirstLineRange(prepared: PreparedInlineLayout): PreparedInlineLineRange | undefined {
  const start = getPreparedLineStart(prepared);
  if (start == null) {
    return undefined;
  }
  return layoutNextPreparedLine(prepared, start, Number.POSITIVE_INFINITY) ?? undefined;
}

function walkLines(prepared: PreparedInlineLayout, maxWidth: number): PreparedInlineLineRange[] {
  const lines: PreparedInlineLineRange[] = [];
  walkPreparedLineRanges(prepared, maxWidth, (line) => {
    lines.push(line);
  });
  return lines;
}

function collectVisibleLines(
  prepared: PreparedInlineLayout,
  maxWidth: number,
  maxLines: number,
): { lines: PreparedInlineLineRange[]; overflowed: boolean } {
  const lines: PreparedInlineLineRange[] = [];
  let overflowed = false;
  walkPreparedLineRanges(prepared, maxWidth, (line) => {
    if (lines.length < maxLines) {
      lines.push(line);
      return true;
    }
    overflowed = true;
    return false;
  });
  return { lines, overflowed };
}

function createRichEllipsisFragment<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  font: string,
  color: DynValue<C, string>,
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
  color: DynValue<C, string>,
): RichLineLayout {
  const fragment = createRichEllipsisFragment(ctx, font, color);
  if (fragment.occupiedWidth > maxWidth) {
    return { width: 0, fragments: [], overflowed: true };
  }
  return { width: fragment.occupiedWidth, fragments: [fragment], overflowed: true };
}

function layoutRichEllipsisFromAtoms<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultFont: string,
  defaultColor: DynValue<C, string>,
  atoms: readonly InlineAtom[],
  maxWidth: number,
  position: TextEllipsisPosition,
  forceEllipsis = false,
): RichLineLayout {
  const intrinsicWidth = measureAtomsWidth(atoms);
  if (!forceEllipsis && intrinsicWidth <= maxWidth) {
    return {
      width: intrinsicWidth,
      fragments: materializeRichFragments(ctx, spans, defaultColor, atoms),
      overflowed: false,
    };
  }

  const ellipsisWidth = measureEllipsisWidth(ctx);
  if (ellipsisWidth > maxWidth) {
    return { width: 0, fragments: [], overflowed: true };
  }
  if (atoms.length === 0) {
    return createRichEllipsisOnlyLayout(ctx, maxWidth, defaultFont, defaultColor);
  }

  const widths = atoms.map((atom) => atom.width + atom.extraWidthAfter);
  const prefixWidths = buildPrefixWidths(widths);
  const suffixWidths = buildSuffixWidths(widths);
  const { prefixCount, suffixCount } = selectEllipsisUnitCounts({
    position,
    prefixWidths,
    suffixWidths,
    unitCount: atoms.length,
    availableWidth: Math.max(0, maxWidth - ellipsisWidth),
  });

  const prefixAtoms = atoms.slice(0, prefixCount);
  const suffixAtoms = atoms.slice(atoms.length - suffixCount);
  const ellipsisSource =
    position === "start"
      ? (suffixAtoms[0] ?? atoms[0])
      : position === "middle"
        ? (prefixAtoms[prefixAtoms.length - 1] ?? suffixAtoms[0] ?? atoms[atoms.length - 1])
        : (prefixAtoms[prefixAtoms.length - 1] ?? atoms[atoms.length - 1]);
  const ellipsisSpan = ellipsisSource == null ? undefined : spans[ellipsisSource.itemIndex];
  const ellipsisFragment = createRichEllipsisFragment(
    ctx,
    ellipsisSpan?.font ?? ellipsisSource?.font ?? defaultFont,
    (ellipsisSpan?.color ?? defaultColor) as DynValue<C, string>,
  );
  const prefixFragments = materializeRichFragments(ctx, spans, defaultColor, prefixAtoms);
  const suffixFragments = materializeRichFragments(ctx, spans, defaultColor, suffixAtoms);

  return {
    width:
      position === "start"
        ? ellipsisFragment.occupiedWidth + (suffixWidths[suffixCount] ?? 0)
        : position === "middle"
          ? (prefixWidths[prefixCount] ?? 0) + ellipsisFragment.occupiedWidth + (suffixWidths[suffixCount] ?? 0)
          : (prefixWidths[prefixCount] ?? 0) + ellipsisFragment.occupiedWidth,
    fragments:
      position === "start"
        ? [ellipsisFragment, ...suffixFragments]
        : position === "middle"
          ? [...prefixFragments, ellipsisFragment, ...suffixFragments]
          : [...prefixFragments, ellipsisFragment],
    overflowed: true,
  };
}

function layoutRichEndEllipsisFromCursor<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultFont: string,
  defaultColor: DynValue<C, string>,
  prepared: PreparedInlineLayout,
  start: PreparedInlineLineRange["start"],
  maxWidth: number,
): RichLineLayout {
  const ellipsisWidth = measureEllipsisWidth(ctx);
  if (ellipsisWidth > maxWidth) {
    return { width: 0, fragments: [], overflowed: true };
  }

  const widths: number[] = [];
  forEachAtomFromCursorToEnd(prepared, start, (atom) => {
    widths.push(atom.width + atom.extraWidthAfter);
  });

  if (widths.length === 0) {
    return createRichEllipsisOnlyLayout(ctx, maxWidth, defaultFont, defaultColor);
  }

  const prefixWidths = buildPrefixWidths(widths);
  const { prefixCount } = selectEllipsisUnitCounts({
    position: "end",
    prefixWidths,
    suffixWidths: [0],
    unitCount: widths.length,
    availableWidth: Math.max(0, maxWidth - ellipsisWidth),
  });

  const fragments: RichFragmentLayout[] = [];
  let atomIndex = 0;
  let pendingGapBefore = 0;
  let lastVisibleAtom: InlineAtom | undefined;
  let lastAtom: InlineAtom | undefined;
  forEachAtomFromCursorToEnd(prepared, start, (atom) => {
    lastAtom = atom;
    if (atomIndex < prefixCount) {
      pendingGapBefore = appendRichFragment(ctx, spans, defaultColor, fragments, atom, pendingGapBefore);
      lastVisibleAtom = atom;
    }
    atomIndex += 1;
  });

  const ellipsisSource = lastVisibleAtom ?? lastAtom;
  const ellipsisSpan = ellipsisSource == null ? undefined : spans[ellipsisSource.itemIndex];
  fragments.push(createRichEllipsisFragment(
    ctx,
    ellipsisSpan?.font ?? ellipsisSource?.font ?? defaultFont,
    (ellipsisSpan?.color ?? defaultColor) as DynValue<C, string>,
  ));

  return {
    width: (prefixWidths[prefixCount] ?? 0) + ellipsisWidth,
    fragments,
    overflowed: true,
  };
}

export function layoutRichFirstLineIntrinsic<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultFont: string,
  defaultColor: DynValue<C, string>,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): RichLineLayout {
  const prepared = readRichPrepared(spans, defaultFont, whiteSpace, wordBreak);
  const line = getFirstLineRange(prepared);
  if (line == null) {
    return { width: 0, fragments: [], overflowed: false };
  }
  return materializeRichLine(ctx, spans, defaultColor, prepared, line, false);
}

export function layoutRichFirstLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  maxWidth: number,
  defaultFont: string,
  defaultColor: DynValue<C, string>,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): RichLineLayout {
  const clampedMaxWidth = Math.max(0, maxWidth);
  if (clampedMaxWidth === 0 || spans.length === 0) {
    return { width: 0, fragments: [], overflowed: false };
  }
  const prepared = readRichPrepared(spans, defaultFont, whiteSpace, wordBreak);
  const start = getPreparedLineStart(prepared);
  if (start == null) {
    return { width: 0, fragments: [], overflowed: false };
  }
  const line = layoutNextPreparedLine(prepared, start, clampedMaxWidth);
  if (line == null) {
    return { width: 0, fragments: [], overflowed: false };
  }
  return materializeRichLine(ctx, spans, defaultColor, prepared, line, false);
}

export function layoutRichEllipsizedFirstLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  maxWidth: number,
  defaultFont: string,
  defaultColor: DynValue<C, string>,
  ellipsisPosition: TextEllipsisPosition = "end",
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): RichLineLayout {
  const clampedMaxWidth = Math.max(0, maxWidth);
  const prepared = readRichPrepared(spans, defaultFont, whiteSpace, wordBreak);
  const intrinsicLine = getFirstLineRange(prepared);
  if (intrinsicLine == null) {
    return { width: 0, fragments: [], overflowed: false };
  }
  if (clampedMaxWidth === 0) {
    return { width: 0, fragments: [], overflowed: true };
  }
  return layoutRichEllipsisFromAtoms(
    ctx,
    spans,
    defaultFont,
    defaultColor,
    collectAtomsInRange(prepared, intrinsicLine.start, intrinsicLine.end),
    clampedMaxWidth,
    ellipsisPosition,
  );
}

export function measureRichText<C extends CanvasRenderingContext2D>(
  _ctx: Context<C>,
  spans: InlineSpan<C>[],
  maxWidth: number,
  defaultFont: string,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): RichMeasurement {
  if (spans.length === 0 || maxWidth <= 0) {
    return { width: 0, lineCount: 0 };
  }
  const prepared = readRichPrepared(spans, defaultFont, whiteSpace, wordBreak);
  const { maxLineWidth: width, lineCount } = measurePreparedLineStats(prepared, maxWidth);
  return { width, lineCount };
}

export function measureRichTextIntrinsic<C extends CanvasRenderingContext2D>(
  _ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultFont: string,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): RichMeasurement {
  if (spans.length === 0) {
    return { width: 0, lineCount: 0 };
  }
  const prepared = readRichPrepared(spans, defaultFont, whiteSpace, wordBreak);
  const { maxLineWidth: width, lineCount } = measurePreparedLineStats(prepared, Number.POSITIVE_INFINITY);
  return { width, lineCount };
}

export function measureRichTextMinContent<C extends CanvasRenderingContext2D>(
  _ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultFont: string,
  overflowWrap: TextOverflowWrapMode = "break-word",
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): RichMeasurement {
  if (spans.length === 0) {
    return { width: 0, lineCount: 0 };
  }
  const prepared = readRichPrepared(spans, defaultFont, whiteSpace, wordBreak);
  const width = measurePreparedMinContentWidth(prepared, overflowWrap);
  if (width === 0) {
    return { width: 0, lineCount: 0 };
  }
  const { lineCount } = measurePreparedLineStats(prepared, Math.max(width, MIN_CONTENT_WIDTH_EPSILON));
  return { width, lineCount };
}

export function layoutRichText<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  maxWidth: number,
  defaultFont: string,
  defaultColor: DynValue<C, string>,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): RichBlockLayout {
  if (spans.length === 0 || maxWidth <= 0) {
    return { width: 0, lines: [], overflowed: false };
  }
  const prepared = readRichPrepared(spans, defaultFont, whiteSpace, wordBreak);
  const lines = walkLines(prepared, maxWidth).map((line) => materializeRichLine(ctx, spans, defaultColor, prepared, line, false));
  return {
    width: lines.reduce((maxLineWidth, line) => Math.max(maxLineWidth, line.width), 0),
    lines,
    overflowed: false,
  };
}

export function layoutRichTextIntrinsic<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  defaultFont: string,
  defaultColor: DynValue<C, string>,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): RichBlockLayout {
  const prepared = readRichPrepared(spans, defaultFont, whiteSpace, wordBreak);
  const lines = walkLines(prepared, Number.POSITIVE_INFINITY).map((line) =>
    materializeRichLine(ctx, spans, defaultColor, prepared, line, false)
  );
  return {
    width: lines.reduce((maxLineWidth, line) => Math.max(maxLineWidth, line.width), 0),
    lines,
    overflowed: false,
  };
}

export function layoutRichTextWithOverflow<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  maxWidth: number,
  defaultFont: string,
  defaultColor: DynValue<C, string>,
  maxLines?: number,
  overflow: TextOverflowMode = "clip",
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): RichBlockLayout {
  if (spans.length === 0 || maxWidth <= 0) {
    return { width: 0, lines: [], overflowed: false };
  }
  const normalizedMaxLines = normalizeMaxLines(maxLines);
  const prepared = readRichPrepared(spans, defaultFont, whiteSpace, wordBreak);
  if (normalizedMaxLines == null) {
    const lineRanges = walkLines(prepared, maxWidth);
    const lines = lineRanges.map((line) => materializeRichLine(ctx, spans, defaultColor, prepared, line, false));
    return {
      width: lines.reduce((maxLineWidth, line) => Math.max(maxLineWidth, line.width), 0),
      lines,
      overflowed: false,
    };
  }
  const { lines: visibleRanges, overflowed } = collectVisibleLines(prepared, maxWidth, normalizedMaxLines);
  if (!overflowed) {
    const lines = visibleRanges.map((line) => materializeRichLine(ctx, spans, defaultColor, prepared, line, false));
    return {
      width: lines.reduce((maxLineWidth, line) => Math.max(maxLineWidth, line.width), 0),
      lines,
      overflowed: false,
    };
  }
  const visibleLines = visibleRanges.map((line) => materializeRichLine(ctx, spans, defaultColor, prepared, line, false));
  if (overflow !== "ellipsis") {
    return {
      width: visibleLines.reduce((maxLineWidth, line) => Math.max(maxLineWidth, line.width), 0),
      lines: visibleLines,
      overflowed: true,
    };
  }

  const lastVisibleRange = visibleRanges[visibleRanges.length - 1];
  const ellipsizedLastLine = lastVisibleRange == null
    ? { width: 0, fragments: [], overflowed: true }
    : layoutRichEndEllipsisFromCursor(ctx, spans, defaultFont, defaultColor, prepared, lastVisibleRange.start, maxWidth);
  const lines = [...visibleLines.slice(0, -1), ellipsizedLastLine];
  return {
    width: lines.reduce((maxLineWidth, line) => Math.max(maxLineWidth, line.width), 0),
    lines,
    overflowed: true,
  };
}

export function materializeRichLineText(line: RichLineLayout): string {
  return line.fragments.map((fragment) => fragment.text).join("");
}

export function materializePreparedRichLineText(prepared: PreparedInlineLayout, line: PreparedInlineLineRange): string {
  return materializePreparedLineText(prepared, line);
}
