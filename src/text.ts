import type { Context } from "./types";

export interface TextLayout {
  width: number;
  text: string;
  shift: number;
}

export function layoutFirstLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
): TextLayout {
  if (maxWidth < 0) {
    maxWidth = 0;
  }
  const line = text.replaceAll(/[^\S\n]+/g, " ").split("\n", 1)[0].trim();
  const {
    width: textWidth,
    fontBoundingBoxAscent: ascent = 0,
    fontBoundingBoxDescent: descent = 0,
  } = ctx.graphics.measureText(line);
  const shift = ascent - descent;
  if (textWidth <= maxWidth) {
    return { width: textWidth, text: line, shift };
  }
  const { width, text: firstLine } = splitToFitText(ctx, line, maxWidth, textWidth);
  return { width, text: firstLine, shift };
}

export function layoutText<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  maxWidth: number,
): { width: number; lines: TextLayout[] } {
  if (maxWidth < 0) {
    maxWidth = 0;
  }

  const inputLines = text
    .replaceAll(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (inputLines.length === 0) {
    return { width: 0, lines: [] };
  }

  let width = 0;
  const lines: TextLayout[] = [];

  for (let line of inputLines) {
    let {
      width: textWidth,
      fontBoundingBoxAscent: ascent = 0,
      fontBoundingBoxDescent: descent = 0,
    } = ctx.graphics.measureText(line);
    const shift = ascent - descent;

    if (textWidth <= maxWidth) {
      width = Math.max(width, textWidth);
      lines.push({ width: textWidth, text: line, shift });
      continue;
    }

    while (textWidth > maxWidth) {
      const splited = splitToFitText(ctx, line, maxWidth, textWidth);
      if (splited.width === 0) {
        return { width: 0, lines: [] };
      }

      width = Math.max(width, splited.width);
      lines.push({ text: splited.text, width: splited.width, shift });
      line = splited.rest;
      ({ width: textWidth } = ctx.graphics.measureText(line));
    }

    if (textWidth > 0) {
      width = Math.max(width, textWidth);
      lines.push({ width: textWidth, text: line, shift });
    }
  }

  return { width, lines };
}

function splitToFitText<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  text: string,
  width: number,
  totalWidth: number,
): { text: string; width: number; rest: string } {
  const arr = ctx.splitText(text);
  let guess = Math.floor((width / totalWidth) * arr.length);
  let guessText = arr.slice(0, guess).join("");
  let { width: guessWidth } = ctx.graphics.measureText(guessText);

  while (!(guessWidth >= width)) {
    guess += 1;
    guessText = arr.slice(0, guess).join("");
    ({ width: guessWidth } = ctx.graphics.measureText(guessText));
  }

  while (guessWidth > width) {
    const lastSpace = arr.lastIndexOf(" ", guess - 1);
    if (lastSpace > 0) {
      guess = lastSpace;
    } else {
      guess -= 1;
    }
    guessText = arr.slice(0, guess).join("");
    ({ width: guessWidth } = ctx.graphics.measureText(guessText));
  }

  return {
    text: guessText,
    width: guessWidth,
    rest: arr.slice(guess).join("").trimStart(),
  };
}
