import { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";
import type { Context } from "./types";

export interface TextLayout {
  width: number;
  text: string;
  shift: number;
}

function preprocessSegments(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function layoutFirstLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
): TextLayout {
  if (maxWidth < 0) {
    maxWidth = 0;
  }
  const segments = preprocessSegments(text);
  const segment = segments[0];
  if (!segment) {
    return { width: 0, text: "", shift: 0 };
  }
  const {
    fontBoundingBoxAscent: ascent = 0,
    fontBoundingBoxDescent: descent = 0,
  } = ctx.graphics.measureText(segment);
  const shift = ascent - descent;
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
): { width: number; lines: TextLayout[] } {
  if (maxWidth < 0) {
    maxWidth = 0;
  }

  const segments = preprocessSegments(text);
  if (segments.length === 0 || maxWidth === 0) {
    return { width: 0, lines: [] };
  }

  const font = ctx.graphics.font;
  let width = 0;
  const lines: TextLayout[] = [];

  for (const segment of segments) {
    const {
      fontBoundingBoxAscent: ascent = 0,
      fontBoundingBoxDescent: descent = 0,
    } = ctx.graphics.measureText(segment);
    const shift = ascent - descent;
    const prepared = prepareWithSegments(segment, font);
    const { lines: segLines } = layoutWithLines(prepared, maxWidth, 0);
    for (const segLine of segLines) {
      width = Math.max(width, segLine.width);
      lines.push({ width: segLine.width, text: segLine.text, shift });
    }
  }

  return { width, lines };
}
