import { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";
import type { Context, TextWhitespaceMode } from "./types";

export interface TextLayout {
  width: number;
  text: string;
  shift: number;
}

function preprocessSegments(text: string, whitespace: TextWhitespaceMode = "preserve"): string[] {
  const segments = text.split("\n");
  if (whitespace === "trim-and-collapse") {
    return segments
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  return segments;
}

function measureShift<C extends CanvasRenderingContext2D>(ctx: Context<C>, text: string): number {
  const {
    fontBoundingBoxAscent: ascent = 0,
    fontBoundingBoxDescent: descent = 0,
  } = ctx.graphics.measureText(text);
  return ascent - descent;
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
  return {
    width: ctx.graphics.measureText(segment).width,
    text: segment,
    shift: measureShift(ctx, segment),
  };
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

  let width = 0;
  const lines: TextLayout[] = [];
  for (const segment of segments) {
    const measuredWidth = ctx.graphics.measureText(segment).width;
    width = Math.max(width, measuredWidth);
    lines.push({
      width: measuredWidth,
      text: segment,
      shift: measureShift(ctx, segment),
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
  const shift = measureShift(ctx, segment);
  if (maxWidth === 0) {
    return { width: 0, text: "", shift };
  }
  const prepared = prepareWithSegments(segment, ctx.graphics.font);
  const { lines } = layoutWithLines(prepared, maxWidth, 0);
  if (lines.length === 0) {
    return { width: 0, text: "", shift };
  }
  return { width: lines[0].width, text: lines[0].text, shift };
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
  let width = 0;
  const lines: TextLayout[] = [];

  for (const segment of segments) {
    const shift = measureShift(ctx, segment);
    if (segment.length === 0) {
      lines.push({ width: 0, text: "", shift });
      continue;
    }
    const prepared = prepareWithSegments(segment, font);
    const { lines: segLines } = layoutWithLines(prepared, maxWidth, 0);
    for (const segLine of segLines) {
      width = Math.max(width, segLine.width);
      lines.push({ width: segLine.width, text: segLine.text, shift });
    }
  }

  return { width, lines };
}
