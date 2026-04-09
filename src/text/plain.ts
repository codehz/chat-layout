import {
  layoutNextLine,
  layoutWithLines,
  measureLineStats,
  measureNaturalWidth,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";
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
  INTRINSIC_MAX_WIDTH,
  MIN_CONTENT_WIDTH_EPSILON,
  buildPrefixWidths,
  buildSuffixWidths,
  measureEllipsisWidth,
  measureFontShift,
  normalizeMaxLines,
  selectEllipsisUnitCounts,
} from "./core";
import {
  getPreparedUnits,
  joinUnitText,
  measurePreparedMinContentWidth,
  readPreparedFirstLine,
  readPreparedText,
} from "./plain-core";

const LINE_START_CURSOR = { segmentIndex: 0, graphemeIndex: 0 } as const;

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

function toTextBlockLayout(lines: { width: number; text: string }[], shift: number): TextBlockLayout {
  const mappedLines = lines.map((line) => ({ width: line.width, text: line.text, shift }));
  const width = mappedLines.reduce((maxLineWidth, line) => Math.max(maxLineWidth, line.width), 0);
  return { width, lines: mappedLines };
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
  const prefixWidths = buildPrefixWidths(units.map((unit) => unit.width));
  const suffixWidths = buildSuffixWidths(units.map((unit) => unit.width));
  const { prefixCount, suffixCount } = selectEllipsisUnitCounts({
    position,
    prefixWidths,
    suffixWidths,
    unitCount: units.length,
    availableWidth,
  });

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
): TextBlockLayout {
  const intrinsic = layoutWithLines(
    readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak),
    INTRINSIC_MAX_WIDTH,
    0,
  );
  if (intrinsic.lines.length === 0) {
    return { width: 0, lines: [] };
  }
  return toTextBlockLayout(intrinsic.lines, measureFontShift(ctx));
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
  const line = layoutNextLine(prepared, LINE_START_CURSOR, clampedMaxWidth);
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
  const clampedMaxWidth = clampMaxWidth(maxWidth);
  const firstLine = readPreparedFirstLine(ctx, text, whiteSpace, wordBreak);
  if (firstLine == null) {
    return { width: 0, text: "", shift: 0, overflowed: false };
  }
  const shift = measureFontShift(ctx);
  if (clampedMaxWidth === 0) {
    return { width: 0, text: "", shift, overflowed: true };
  }
  return layoutPreparedEllipsis(ctx, firstLine.prepared, firstLine.text, clampedMaxWidth, shift, ellipsisPosition);
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
  const { maxLineWidth: width, lineCount } = measureLineStats(prepared, clampedMaxWidth);
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
): TextBlockLayout {
  const clampedMaxWidth = clampMaxWidth(maxWidth);
  if (clampedMaxWidth === 0) {
    return { width: 0, lines: [] };
  }

  const layout = layoutWithLines(
    readPreparedText(text, ctx.graphics.font, whiteSpace, wordBreak),
    clampedMaxWidth,
    0,
  );
  if (layout.lines.length === 0) {
    return { width: 0, lines: [] };
  }
  return toTextBlockLayout(layout.lines, measureFontShift(ctx));
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

  const layout = layoutText(ctx, text, clampedMaxWidth, whiteSpace, wordBreak);
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
    ? createEllipsisOnlyLayout(ctx, clampedMaxWidth, shift)
    : layoutForcedEllipsizedLine(ctx, lastVisibleLine.text, clampedMaxWidth, shift, whiteSpace, wordBreak);

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
