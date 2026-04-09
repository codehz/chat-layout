import type {
  Context,
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
  collectAtomsFromCursorToEnd,
  flattenPreparedLineAtoms,
  getPreparedLineStart,
  layoutNextPreparedLine,
  materializePreparedLineText,
  measurePreparedLineStats,
  measurePreparedNaturalWidth,
  walkPreparedLineRanges,
  type InlineAtom,
  type PreparedInlineLineRange,
} from "./inline-engine";
import {
  measurePreparedMinContentWidth,
  readPreparedText,
  type PreparedTextWithSegments,
} from "./plain-core";

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

type TextBlockLayout = {
  width: number;
  lines: TextLayout[];
};

function clampMaxWidth(maxWidth: number): number {
  return Math.max(0, maxWidth);
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

function toTextBlockLayout(lines: PreparedInlineLineRange[], prepared: PreparedTextWithSegments, shift: number): TextBlockLayout {
  const mappedLines = lines.map((line) => ({
    width: line.width,
    text: materializePreparedLineText(prepared, line),
    shift,
  }));
  const width = mappedLines.reduce((maxLineWidth, line) => Math.max(maxLineWidth, line.width), 0);
  return { width, lines: mappedLines };
}

function collectEllipsisLayout<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  atoms: readonly InlineAtom[],
  maxWidth: number,
  shift: number,
  position: TextEllipsisPosition,
  forceEllipsis = false,
): OverflowTextLayout {
  const widths = atoms.map((atom) => atom.width + atom.extraWidthAfter);
  const intrinsicWidth = widths.reduce((total, width) => total + width, 0);
  if (!forceEllipsis && intrinsicWidth <= maxWidth) {
    return {
      width: intrinsicWidth,
      text: atoms.map((atom) => atom.text).join(""),
      shift,
      overflowed: false,
    };
  }

  const ellipsisWidth = measureEllipsisWidth(ctx);
  if (ellipsisWidth > maxWidth) {
    return { width: 0, text: "", shift, overflowed: true };
  }
  if (atoms.length === 0) {
    return createEllipsisOnlyLayout(ctx, maxWidth, shift);
  }

  const prefixWidths = buildPrefixWidths(widths);
  const suffixWidths = buildSuffixWidths(widths);
  const { prefixCount, suffixCount } = selectEllipsisUnitCounts({
    position,
    prefixWidths,
    suffixWidths,
    unitCount: atoms.length,
    availableWidth: Math.max(0, maxWidth - ellipsisWidth),
  });

  const prefixText = atoms.slice(0, prefixCount).map((atom) => atom.text).join("");
  const suffixText = atoms.slice(atoms.length - suffixCount).map((atom) => atom.text).join("");
  const width =
    position === "start"
      ? ellipsisWidth + (suffixWidths[suffixCount] ?? 0)
      : position === "middle"
        ? (prefixWidths[prefixCount] ?? 0) + ellipsisWidth + (suffixWidths[suffixCount] ?? 0)
        : (prefixWidths[prefixCount] ?? 0) + ellipsisWidth;

  return {
    width,
    text:
      position === "start"
        ? `${ELLIPSIS_GLYPH}${suffixText}`
        : position === "middle"
          ? `${prefixText}${ELLIPSIS_GLYPH}${suffixText}`
          : `${prefixText}${ELLIPSIS_GLYPH}`,
    shift,
    overflowed: true,
  };
}

function getFirstLineRange(prepared: PreparedTextWithSegments): PreparedInlineLineRange | undefined {
  const start = getPreparedLineStart(prepared);
  if (start == null) {
    return undefined;
  }
  return layoutNextPreparedLine(prepared, start, Number.POSITIVE_INFINITY) ?? undefined;
}

function walkLines(prepared: PreparedTextWithSegments, maxWidth: number): PreparedInlineLineRange[] {
  const lines: PreparedInlineLineRange[] = [];
  walkPreparedLineRanges(prepared, maxWidth, (line) => lines.push(line));
  return lines;
}

function layoutForcedEllipsizedLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  prepared: PreparedTextWithSegments,
  line: PreparedInlineLineRange,
  maxWidth: number,
  shift: number,
): OverflowTextLayout {
  return collectEllipsisLayout(ctx, flattenPreparedLineAtoms(prepared, line), maxWidth, shift, "end", true);
}

export function layoutFirstLineIntrinsic<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): TextLayout {
  const prepared = readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak);
  const line = getFirstLineRange(prepared);
  if (line == null) {
    return { width: 0, text: "", shift: 0 };
  }
  return {
    width: line.width,
    text: materializePreparedLineText(prepared, line),
    shift: measureFontShift(ctx),
  };
}

export function measureTextIntrinsic<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): TextMeasurement {
  const prepared = readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak);
  const { maxLineWidth: width, lineCount } = measurePreparedLineStats(prepared, Number.POSITIVE_INFINITY);
  return { width, lineCount };
}

export function layoutTextIntrinsic<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): TextBlockLayout {
  const prepared = readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak);
  const lines = walkLines(prepared, Number.POSITIVE_INFINITY);
  return toTextBlockLayout(lines, prepared, measureFontShift(ctx));
}

export function layoutFirstLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): TextLayout {
  const clampedMaxWidth = clampMaxWidth(maxWidth);
  const shift = measureFontShift(ctx);
  if (clampedMaxWidth === 0) {
    return { width: 0, text: "", shift };
  }
  const prepared = readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak);
  const start = getPreparedLineStart(prepared);
  if (start == null) {
    return { width: 0, text: "", shift };
  }
  const line = layoutNextPreparedLine(prepared, start, clampedMaxWidth);
  if (line == null) {
    return { width: 0, text: "", shift };
  }
  return {
    width: line.width,
    text: materializePreparedLineText(prepared, line),
    shift,
  };
}

export function layoutEllipsizedFirstLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
  ellipsisPosition: TextEllipsisPosition = "end",
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): OverflowTextLayout {
  const clampedMaxWidth = clampMaxWidth(maxWidth);
  const shift = measureFontShift(ctx);
  if (clampedMaxWidth === 0) {
    return { width: 0, text: "", shift, overflowed: true };
  }

  const prepared = readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak);
  const intrinsicLine = getFirstLineRange(prepared);
  if (intrinsicLine == null) {
    return { width: 0, text: "", shift: 0, overflowed: false };
  }
  return collectEllipsisLayout(
    ctx,
    flattenPreparedLineAtoms(prepared, intrinsicLine),
    clampedMaxWidth,
    shift,
    ellipsisPosition,
  );
}

export function measureText<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): TextMeasurement {
  const clampedMaxWidth = clampMaxWidth(maxWidth);
  if (clampedMaxWidth === 0) {
    return { width: 0, lineCount: 0 };
  }
  const prepared = readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak);
  const { maxLineWidth: width, lineCount } = measurePreparedLineStats(prepared, clampedMaxWidth);
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
  const width = measurePreparedMinContentWidth(prepared, overflowWrap);
  if (width === 0) {
    return { width: 0, lineCount: 0 };
  }
  const { lineCount } = measurePreparedLineStats(prepared, Math.max(width, MIN_CONTENT_WIDTH_EPSILON));
  return { width, lineCount };
}

export function layoutText<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): TextBlockLayout {
  const clampedMaxWidth = clampMaxWidth(maxWidth);
  if (clampedMaxWidth === 0) {
    return { width: 0, lines: [] };
  }
  const prepared = readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak);
  const lines = walkLines(prepared, clampedMaxWidth);
  return toTextBlockLayout(lines, prepared, measureFontShift(ctx));
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
  const clampedMaxWidth = clampMaxWidth(maxWidth);
  const whiteSpace = options.whiteSpace ?? "normal";
  const wordBreak = options.wordBreak ?? "normal";
  const overflow = options.overflow ?? "clip";
  const normalizedMaxLines = normalizeMaxLines(options.maxLines);

  const prepared = readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak);
  const lines = walkLines(prepared, clampedMaxWidth);
  const shift = measureFontShift(ctx);
  if (normalizedMaxLines == null || lines.length <= normalizedMaxLines) {
    const layout = toTextBlockLayout(lines, prepared, shift);
    return {
      width: layout.width,
      lines: layout.lines.map((line) => ({ ...line, overflowed: false })),
      overflowed: false,
    };
  }

  const visibleRanges = lines.slice(0, normalizedMaxLines);
  const visibleLines = visibleRanges.map((line) => ({
    width: line.width,
    text: materializePreparedLineText(prepared, line),
    shift,
    overflowed: false,
  }));

  if (overflow !== "ellipsis") {
    return {
      width: visibleLines.reduce((maxLineWidth, line) => Math.max(maxLineWidth, line.width), 0),
      lines: visibleLines,
      overflowed: true,
    };
  }

  const lastVisibleRange = visibleRanges[visibleRanges.length - 1];
  const ellipsizedLastLine = lastVisibleRange == null
    ? createEllipsisOnlyLayout(ctx, clampedMaxWidth, shift)
    : collectEllipsisLayout(
        ctx,
        collectAtomsFromCursorToEnd(prepared, lastVisibleRange.start),
        clampedMaxWidth,
        shift,
        "end",
        true,
      );

  const mergedLines = [
    ...visibleLines.slice(0, -1),
    ellipsizedLastLine,
  ];
  return {
    width: mergedLines.reduce((maxLineWidth, line) => Math.max(maxLineWidth, line.width), 0),
    lines: mergedLines,
    overflowed: true,
  };
}

export function measureTextNaturalWidth<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  whiteSpace: TextWhiteSpaceMode = "normal",
  wordBreak: TextWordBreakMode = "normal",
): number {
  const prepared = readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak);
  return measurePreparedNaturalWidth(prepared);
}
