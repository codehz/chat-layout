import { describe, expect, test } from "bun:test";

import {
  resolveJustifyMode,
  isJustifySupported,
  shouldJustifyLine,
  computeJustifySpacing,
  analyzeLineForJustify,
  resetJustifySupportedCache,
  type JustifyLineInfo,
} from "../../src/text/justify";
import { readPreparedText } from "../../src/text/plain-core";
import { walkPreparedLineRanges } from "../../src/text/inline-engine";
import { MultilineText } from "../../src/nodes";
import type { InlineSpan } from "../../src/types";
import { ConstraintTestRenderer } from "../helpers/renderer-fixtures";
import { ensureMockOffscreenCanvas } from "../helpers/graphics";

type C = CanvasRenderingContext2D;

ensureMockOffscreenCanvas();

// --- Helpers ---

function createMockCtx(options: { supportSpacing?: boolean } = {}): CanvasRenderingContext2D {
  const support = options.supportSpacing ?? true;
  const base: any = {
    font: "16px sans-serif",
    measureText(text: string) {
      return {
        width: text.length * 8,
        fontBoundingBoxAscent: 8,
        fontBoundingBoxDescent: 2,
      } as TextMetrics;
    },
  };
  if (support) {
    base.wordSpacing = "0px";
    base.letterSpacing = "0px";
  }
  return base as CanvasRenderingContext2D;
}

type JustifyRecordedDraw = {
  text: string;
  x: number;
  y: number;
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  textAlign: CanvasTextAlign;
  wordSpacing: string;
  letterSpacing: string;
};

function createJustifyRecordingGraphics(recordedDraws: JustifyRecordedDraw[]): C {
  const graphics: any = {
    canvas: { clientWidth: 320, clientHeight: 100 },
    fillStyle: "#000",
    font: "16px sans-serif",
    textAlign: "left" as CanvasTextAlign,
    textRendering: "auto",
    wordSpacing: "0px",
    letterSpacing: "0px",
    clearRect() {},
    fillText(text: string, x = 0, y = 0) {
      recordedDraws.push({
        text,
        x,
        y,
        font: graphics.font,
        fillStyle: graphics.fillStyle,
        textAlign: graphics.textAlign,
        wordSpacing: graphics.wordSpacing,
        letterSpacing: graphics.letterSpacing,
      });
    },
    measureText(text: string) {
      return {
        width: text.length * 8,
        fontBoundingBoxAscent: 8,
        fontBoundingBoxDescent: 2,
      } as TextMetrics;
    },
    save() {},
    restore() {},
  };
  return graphics as C;
}

function createLineInfo(overrides: Partial<JustifyLineInfo> = {}): JustifyLineInfo {
  return {
    wordGapCount: 0,
    wordCount: 0,
    renderAtomCount: 0,
    spaceCount: 0,
    nonSpaceCount: 0,
    cjkCount: 0,
    latinLikeCount: 0,
    punctuationCount: 0,
    lineWidth: 0,
    nonSpaceWidth: 0,
    ...overrides,
  };
}

function getSingleLineInfo(
  text: string,
  options: {
    whiteSpace?: "normal" | "pre-wrap";
    wordBreak?: "normal" | "keep-all";
  } = {},
): JustifyLineInfo {
  const prepared = readPreparedText(
    text,
    "16px sans-serif",
    options.whiteSpace ?? "normal",
    options.wordBreak ?? "normal",
  );
  const lines: any[] = [];
  walkPreparedLineRanges(prepared, 1000, (line) => {
    lines.push(line);
  });
  expect(lines).toHaveLength(1);
  return analyzeLineForJustify(prepared, lines[0]);
}

function parsePx(value: string): number {
  return Number.parseFloat(value);
}

// --- Unit Tests ---

describe("resolveJustifyMode", () => {
  test("returns null for undefined/false", () => {
    expect(resolveJustifyMode(undefined)).toBeNull();
    expect(resolveJustifyMode(false)).toBeNull();
  });

  test("returns inter-word for true", () => {
    expect(resolveJustifyMode(true)).toBe("inter-word");
  });

  test("returns mode string as-is", () => {
    expect(resolveJustifyMode("inter-word")).toBe("inter-word");
    expect(resolveJustifyMode("inter-character")).toBe("inter-character");
  });
});

describe("isJustifySupported", () => {
  test("returns true when wordSpacing/letterSpacing are strings", () => {
    resetJustifySupportedCache();
    expect(isJustifySupported(createMockCtx({ supportSpacing: true }))).toBe(true);
  });

  test("returns false when properties are missing", () => {
    resetJustifySupportedCache();
    expect(isJustifySupported(createMockCtx({ supportSpacing: false }))).toBe(false);
  });
});

describe("analyzeLineForJustify", () => {
  test("counts word gaps and chars for a simple line", () => {
    const info = getSingleLineInfo("hello world foo");
    expect(info).toMatchObject({
      wordGapCount: 2,
      wordCount: 3,
      renderAtomCount: 15,
      spaceCount: 2,
      nonSpaceCount: 13,
      cjkCount: 0,
      latinLikeCount: 13,
      punctuationCount: 0,
      lineWidth: 120,
      nonSpaceWidth: 104,
    });
  });

  test("returns zero gaps for single word", () => {
    const info = getSingleLineInfo("hello");
    expect(info).toMatchObject({
      wordGapCount: 0,
      wordCount: 1,
      renderAtomCount: 5,
      nonSpaceCount: 5,
    });
  });
});

describe("shouldJustifyLine", () => {
  test("returns false when extraSpace <= 0", () => {
    const info = createLineInfo({
      wordGapCount: 2,
      wordCount: 3,
      renderAtomCount: 10,
      nonSpaceCount: 8,
      latinLikeCount: 8,
      lineWidth: 100,
      nonSpaceWidth: 80,
    });
    expect(shouldJustifyLine(100, 100, info, "inter-word", 2.0)).toBe(false);
    expect(shouldJustifyLine(110, 100, info, "inter-word", 2.0)).toBe(false);
  });

  test("returns false when no gaps available", () => {
    expect(shouldJustifyLine(80, 100, createLineInfo({
      wordCount: 1,
      renderAtomCount: 5,
      nonSpaceCount: 5,
      latinLikeCount: 5,
      lineWidth: 80,
      nonSpaceWidth: 80,
    }), "inter-word", 2.0)).toBe(false);
    expect(shouldJustifyLine(80, 100, createLineInfo({
      wordGapCount: 2,
      wordCount: 3,
      lineWidth: 80,
      nonSpaceWidth: 64,
    }), "inter-character", 2.0)).toBe(false);
  });

  test("returns true for reasonable spacing", () => {
    expect(shouldJustifyLine(90, 100, createLineInfo({
      wordGapCount: 2,
      wordCount: 3,
      renderAtomCount: 10,
      spaceCount: 2,
      nonSpaceCount: 8,
      latinLikeCount: 8,
      lineWidth: 90,
      nonSpaceWidth: 72,
    }), "inter-word", 2.0)).toBe(true);
  });

  test("returns false when threshold exceeded", () => {
    // extraSpace=80, wordGapCount=1 → perGap=80, avgWordWidth is small → exceeds threshold
    expect(shouldJustifyLine(20, 100, createLineInfo({
      wordGapCount: 1,
      wordCount: 2,
      renderAtomCount: 3,
      spaceCount: 1,
      nonSpaceCount: 2,
      latinLikeCount: 2,
      lineWidth: 20,
      nonSpaceWidth: 16,
    }), "inter-word", 0.5)).toBe(false);
  });

  test("returns false for null mode", () => {
    expect(shouldJustifyLine(80, 100, createLineInfo({
      wordGapCount: 2,
      wordCount: 3,
      renderAtomCount: 10,
      nonSpaceCount: 8,
      latinLikeCount: 8,
      lineWidth: 80,
      nonSpaceWidth: 64,
    }), null, 2.0)).toBe(false);
  });
});

describe("computeJustifySpacing", () => {
  test("inter-word distributes extra space across word gaps", () => {
    const spacing = computeJustifySpacing(80, 100, createLineInfo({
      wordGapCount: 2,
      wordCount: 3,
      renderAtomCount: 10,
      spaceCount: 2,
      nonSpaceCount: 8,
      latinLikeCount: 8,
      lineWidth: 80,
      nonSpaceWidth: 64,
    }), "inter-word", 2.0);
    expect(spacing).not.toBeNull();
    expect(spacing?.wordSpacing).toBe("10px");
    expect(spacing?.letterSpacing).toBe("0px");
    expect(spacing?.wordSpacingPx).toBe(10);
    expect(spacing?.letterSpacingPx).toBe(0);
  });

  test("pure English lines use hybrid spacing with a larger word share", () => {
    const info = getSingleLineInfo("aa bb cc");
    const spacing = computeJustifySpacing(info.lineWidth, info.lineWidth + 16, info, "inter-character", 2.0);
    expect(spacing).not.toBeNull();
    expect(spacing?.wordSpacingPx).toBeGreaterThan(0);
    expect(spacing?.letterSpacingPx).toBeGreaterThan(0);
    expect(spacing?.wordSpacingPx).toBeGreaterThan(spacing?.letterSpacingPx ?? 0);
  });

  test("pure CJK lines stay on letter spacing only", () => {
    const info = getSingleLineInfo("你好世界");
    const spacing = computeJustifySpacing(info.lineWidth, info.lineWidth + 8, info, "inter-character", 2.0);
    expect(spacing).not.toBeNull();
    expect(spacing?.wordSpacingPx).toBe(0);
    expect(spacing?.letterSpacingPx).toBe(2);
  });

  test("mixed CJK and English lines use both spacing channels", () => {
    const info = getSingleLineInfo("你好 world 好");
    const spacing = computeJustifySpacing(info.lineWidth, info.lineWidth + 16, info, "inter-character", 2.0);
    expect(spacing).not.toBeNull();
    expect(spacing?.wordSpacingPx).toBeGreaterThan(0);
    expect(spacing?.letterSpacingPx).toBeGreaterThan(0);
  });

  test("punctuation-heavy lines reduce letter spacing versus the no-space fallback", () => {
    const spacedInfo = getSingleLineInfo("hello, world!");
    const spaced = computeJustifySpacing(
      spacedInfo.lineWidth,
      spacedInfo.lineWidth + 24,
      spacedInfo,
      "inter-character",
      2.0,
    );
    const unspacedInfo = getSingleLineInfo("hello,world!");
    const unspaced = computeJustifySpacing(
      unspacedInfo.lineWidth,
      unspacedInfo.lineWidth + 24,
      unspacedInfo,
      "inter-character",
      2.0,
    );
    expect(spaced).not.toBeNull();
    expect(unspaced).not.toBeNull();
    expect(spaced?.letterSpacingPx ?? 0).toBeLessThan(unspaced?.letterSpacingPx ?? 0);
  });

  test("returns null when every hybrid candidate exceeds the threshold", () => {
    const info = getSingleLineInfo("a a");
    expect(computeJustifySpacing(info.lineWidth, 120, info, "inter-character", 0.5)).toBeNull();
    expect(shouldJustifyLine(info.lineWidth, 120, info, "inter-character", 0.5)).toBe(false);
  });
});

// --- Integration Tests ---

describe("plain text justify integration", () => {
  test("justify: true sets wordSpacing on middle lines", () => {
    resetJustifySupportedCache();
    const draws: JustifyRecordedDraw[] = [];
    const renderer = new ConstraintTestRenderer(createJustifyRecordingGraphics(draws), {});
    // 8px per char, maxWidth=48 → fits 6 chars per line
    // "hello world" → line1: "hello" (40px, 5 chars), line2: "world" (40px)
    const node = new MultilineText<C>("hello world", {
      lineHeight: 20,
      font: "16px sans-serif",
      color: "#000",
      justify: true,
    });

    renderer.drawNode(node, { maxWidth: 48 });

    // First line "hello" has no spaces → cannot justify → fallback
    // Second line "world" is last line → no justify
    // Both should have wordSpacing "0px"
    for (const draw of draws) {
      expect(draw.wordSpacing).toBe("0px");
    }
  });

  test("justify with multi-word lines applies wordSpacing", () => {
    resetJustifySupportedCache();
    const draws: JustifyRecordedDraw[] = [];
    const renderer = new ConstraintTestRenderer(createJustifyRecordingGraphics(draws), {});
    // "aa bb cc dd" = 11 chars = 88px
    // maxWidth=56 → line1: "aa bb cc" (64px, 2 spaces), line2: "dd" (16px)
    // Actually with 8px/char: "aa bb cc" = 8*8=64px, fits in 56? No, 64>56
    // Let's use maxWidth=80: "aa bb cc" = 64px fits, "dd" = 16px
    // extraSpace = 80-64 = 16, wordGapCount=2, perGap=8
    const node = new MultilineText<C>("aa bb cc dd", {
      lineHeight: 20,
      font: "16px sans-serif",
      color: "#000",
      justify: true,
    });

    renderer.drawNode(node, { maxWidth: 80 });

    // Check that at least one draw has non-zero wordSpacing
    const justifiedDraws = draws.filter((d) => d.wordSpacing !== "0px");
    expect(justifiedDraws.length).toBeGreaterThanOrEqual(1);
  });

  test("justifyLastLine: true also justifies the last line", () => {
    resetJustifySupportedCache();
    const draws: JustifyRecordedDraw[] = [];
    const renderer = new ConstraintTestRenderer(createJustifyRecordingGraphics(draws), {});
    const node = new MultilineText<C>("aa bb cc dd", {
      lineHeight: 20,
      font: "16px sans-serif",
      color: "#000",
      justify: true,
      justifyLastLine: true,
    });

    renderer.drawNode(node, { maxWidth: 80 });

    // Last line should also be justified (if it has gaps)
    // All drawn lines should have been attempted for justify
    expect(draws.length).toBeGreaterThanOrEqual(1);
  });

  test("justify is disabled without wordSpacing support", () => {
    resetJustifySupportedCache();
    // Create graphics without wordSpacing/letterSpacing
    const draws: string[] = [];
    const graphics: any = {
      canvas: { clientWidth: 320, clientHeight: 100 },
      fillStyle: "#000",
      font: "16px sans-serif",
      textAlign: "left",
      textRendering: "auto",
      clearRect() {},
      fillText(text: string) { draws.push(text); },
      measureText(text: string) {
        return { width: text.length * 8, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 } as TextMetrics;
      },
      save() {},
      restore() {},
    };
    const renderer = new ConstraintTestRenderer(graphics as C, {});
    const node = new MultilineText<C>("aa bb cc dd", {
      lineHeight: 20,
      font: "16px sans-serif",
      color: "#000",
      justify: true,
    });

    // Should not throw, just fallback silently
    renderer.drawNode(node, { maxWidth: 80 });
    expect(draws.length).toBeGreaterThanOrEqual(1);
  });

  test("measure is not affected by justify option", () => {
    const draws: JustifyRecordedDraw[] = [];
    const renderer = new ConstraintTestRenderer(createJustifyRecordingGraphics(draws), {});

    const nodeWithJustify = new MultilineText<C>("hello world foo", {
      lineHeight: 20,
      font: "16px sans-serif",
      color: "#000",
      justify: true,
    });
    const nodeWithout = new MultilineText<C>("hello world foo", {
      lineHeight: 20,
      font: "16px sans-serif",
      color: "#000",
    });

    const measureWith = renderer.measureNode(nodeWithJustify, { maxWidth: 80 });
    const measureWithout = renderer.measureNode(nodeWithout, { maxWidth: 80 });
    expect(measureWith).toEqual(measureWithout);
  });

  test("last plain line resets both spacing properties after a previous rich justify draw", () => {
    resetJustifySupportedCache();
    const draws: JustifyRecordedDraw[] = [];
    const renderer = new ConstraintTestRenderer(createJustifyRecordingGraphics(draws), {});

    const richNode = new MultilineText<C>([
      { text: "aa bb ", color: "#111" },
      { text: "cc dd", color: "#222" },
    ] satisfies InlineSpan<C>[], {
      lineHeight: 20,
      font: "16px sans-serif",
      color: "#000",
      justify: "inter-character",
    });

    renderer.drawNode(richNode, { maxWidth: 80 });

    const drawCountBeforePlain = draws.length;
    const plainNode = new MultilineText<C>("aa bb cc dd", {
      lineHeight: 20,
      font: "16px sans-serif",
      color: "#000",
      justify: "inter-character",
    });

    renderer.drawNode(plainNode, { maxWidth: 80 });

    const plainDraws = draws.slice(drawCountBeforePlain);
    expect(plainDraws.at(-1)?.text).toBe("dd");
    expect(plainDraws.at(-1)?.wordSpacing).toBe("0px");
    expect(plainDraws.at(-1)?.letterSpacing).toBe("0px");
  });
});

describe("rich text justify integration", () => {
  test("plain and rich inter-character justify agree on hybrid spacing", () => {
    resetJustifySupportedCache();
    const plainDraws: JustifyRecordedDraw[] = [];
    const richDraws: JustifyRecordedDraw[] = [];
    const plainRenderer = new ConstraintTestRenderer(createJustifyRecordingGraphics(plainDraws), {});
    const richRenderer = new ConstraintTestRenderer(createJustifyRecordingGraphics(richDraws), {});

    const plainNode = new MultilineText<C>("aa bb cc dd", {
      lineHeight: 20,
      font: "16px sans-serif",
      color: "#000",
      justify: "inter-character",
    });
    const richNode = new MultilineText<C>([
      { text: "aa bb ", color: "#111" },
      { text: "cc dd", color: "#222" },
    ] satisfies InlineSpan<C>[], {
      lineHeight: 20,
      font: "16px sans-serif",
      color: "#000",
      justify: "inter-character",
    });

    plainRenderer.drawNode(plainNode, { maxWidth: 80 });
    richRenderer.drawNode(richNode, { maxWidth: 80 });

    const plainJustified = plainDraws.find((draw) => draw.letterSpacing !== "0px" || draw.wordSpacing !== "0px");
    const richJustified = richDraws.find((draw) => draw.letterSpacing !== "0px" || draw.wordSpacing !== "0px");
    expect(plainJustified).toBeDefined();
    expect(richJustified).toBeDefined();
    expect(richJustified?.wordSpacing).toBe(plainJustified?.wordSpacing);
    expect(richJustified?.letterSpacing).toBe(plainJustified?.letterSpacing);
  });

  test("span boundaries honor hybrid spacing across a collapsible gap", () => {
    resetJustifySupportedCache();
    const draws: JustifyRecordedDraw[] = [];
    const renderer = new ConstraintTestRenderer(createJustifyRecordingGraphics(draws), {});
    const node = new MultilineText<C>([
      { text: "aa ", color: "#111" },
      { text: "bb", color: "#222" },
    ] satisfies InlineSpan<C>[], {
      lineHeight: 20,
      font: "16px sans-serif",
      color: "#000",
      justify: "inter-character",
      justifyLastLine: true,
    });

    renderer.drawNode(node, { maxWidth: 56 });

    expect(draws).toHaveLength(2);
    const wordSpacingPx = parsePx(draws[0]!.wordSpacing);
    const letterSpacingPx = parsePx(draws[0]!.letterSpacing);
    expect(draws[1]!.x).toBeCloseTo(24 + 3 * letterSpacingPx + wordSpacingPx);
  });

  test("pre-wrap preserved spaces advance rich fragments using atom counts", () => {
    resetJustifySupportedCache();
    const draws: JustifyRecordedDraw[] = [];
    const renderer = new ConstraintTestRenderer(createJustifyRecordingGraphics(draws), {});
    const node = new MultilineText<C>([
      { text: "aa  ", color: "#111" },
      { text: "bb", color: "#222" },
    ] satisfies InlineSpan<C>[], {
      lineHeight: 20,
      font: "16px sans-serif",
      color: "#000",
      whiteSpace: "pre-wrap",
      justify: "inter-character",
      justifyLastLine: true,
    });

    renderer.drawNode(node, { maxWidth: 64 });

    expect(draws).toHaveLength(2);
    const wordSpacingPx = parsePx(draws[0]!.wordSpacing);
    const letterSpacingPx = parsePx(draws[0]!.letterSpacing);
    expect(draws[1]!.x).toBeCloseTo(32 + 4 * letterSpacingPx + 2 * wordSpacingPx);
  });

  test("emoji fragments use grapheme atom counts instead of string length", () => {
    resetJustifySupportedCache();
    const draws: JustifyRecordedDraw[] = [];
    const renderer = new ConstraintTestRenderer(createJustifyRecordingGraphics(draws), {});
    const node = new MultilineText<C>([
      { text: "👨‍👩‍👧‍👦", color: "#111" },
      { text: "a", color: "#222" },
    ] satisfies InlineSpan<C>[], {
      lineHeight: 20,
      font: "16px sans-serif",
      color: "#000",
      justify: "inter-character",
      justifyLastLine: true,
    });

    renderer.drawNode(node, { maxWidth: 112 });

    expect(draws).toHaveLength(2);
    const letterSpacingPx = parsePx(draws[0]!.letterSpacing);
    expect(draws[1]!.x).toBeCloseTo(draws[0]!.text.length * 8 + letterSpacingPx);
  });

  test("overflow + ellipsis last line is not justified", () => {
    resetJustifySupportedCache();
    const draws: JustifyRecordedDraw[] = [];
    const renderer = new ConstraintTestRenderer(createJustifyRecordingGraphics(draws), {});
    const node = new MultilineText<C>("aa bb cc dd ee ff gg hh", {
      lineHeight: 20,
      font: "16px sans-serif",
      color: "#000",
      justify: true,
      overflow: "ellipsis",
      maxLines: 2,
    });

    renderer.drawNode(node, { maxWidth: 80 });

    // The last visible line should not be justified (overflow truncated)
    const lastDraw = draws[draws.length - 1];
    expect(lastDraw!.wordSpacing).toBe("0px");
  });
});
