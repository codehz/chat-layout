import {
  layoutNextLine,
  layoutWithLines,
  prepareWithSegments,
  walkLineRanges,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";
import type { Context, TextWhitespaceMode } from "./types";

export interface TextLayout {
  width: number;
  text: string;
  shift: number;
}

export interface TextMeasurement {
  width: number;
  lineCount: number;
}

// `fontBoundingBox*` depends on the active font, so one fixed probe is enough.
const FONT_SHIFT_PROBE = "M";
const PREPARED_SEGMENT_CACHE_CAPACITY = 512;
const FONT_SHIFT_CACHE_CAPACITY = 64;
const LINE_START_CURSOR = { segmentIndex: 0, graphemeIndex: 0 } as const;

const preparedSegmentCache = new Map<string, PreparedTextWithSegments>();
const fontShiftCache = new Map<string, number>();

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
