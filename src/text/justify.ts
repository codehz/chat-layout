import type { TextJustifyMode } from "../types";
import {
  forEachAtomInRange,
  type PreparedInlineLayout,
  type PreparedInlineLineRange,
} from "./inline-engine";

// -------- Feature detection --------

let _justifySupported: boolean | undefined;

export function isJustifySupported(ctx: CanvasRenderingContext2D): boolean {
  if (_justifySupported !== undefined) return _justifySupported;
  _justifySupported =
    typeof (ctx as any).wordSpacing === "string" &&
    typeof (ctx as any).letterSpacing === "string";
  return _justifySupported;
}

/** Reset cached detection result (for testing). */
export function resetJustifySupportedCache(): void {
  _justifySupported = undefined;
}

// -------- Mode resolution --------

export type ResolvedJustifyMode = TextJustifyMode | null;

export function resolveJustifyMode(
  justify: boolean | TextJustifyMode | undefined,
): ResolvedJustifyMode {
  if (justify === true) return "inter-word";
  if (justify === "inter-word" || justify === "inter-character") return justify;
  return null;
}

// -------- Line analysis --------

export interface JustifyLineInfo {
  /** Number of word gaps (space units) in the line. */
  wordGapCount: number;
  /** Total number of characters in the line (for inter-character gap count). */
  charCount: number;
}

export function analyzeLineForJustify(
  prepared: PreparedInlineLayout,
  line: PreparedInlineLineRange,
): JustifyLineInfo {
  let wordGapCount = 0;
  let charCount = 0;

  forEachAtomInRange(prepared, line.start, line.end, (atom) => {
    charCount++;
    if (atom.kind === "space" && !atom.preservesLineEnd && atom.atomicGroupId == null) {
      wordGapCount++;
    }
  });

  return { wordGapCount, charCount };
}

// -------- Threshold check --------

export function shouldJustifyLine(
  lineWidth: number,
  maxWidth: number,
  info: JustifyLineInfo,
  mode: ResolvedJustifyMode,
  threshold: number,
): boolean {
  const extraSpace = maxWidth - lineWidth;
  if (extraSpace <= 0 || mode == null) return false;

  if (mode === "inter-word") {
    if (info.wordGapCount === 0) return false;
    const perGap = extraSpace / info.wordGapCount;
    // Average word width approximation: non-space content / word count
    // wordCount = wordGapCount + 1 for a line with gaps
    const wordCount = info.charCount - info.wordGapCount;
    const avgWordWidth = wordCount > 0 ? lineWidth / Math.max(wordCount, 1) : lineWidth;
    return perGap <= threshold * avgWordWidth;
  }

  // inter-character: charCount includes all atoms; gap positions = charCount - 1
  // But letterSpacing applies after every char including last, so total gaps = charCount
  if (info.charCount === 0) return false;
  const perGap = extraSpace / info.charCount;
  const avgCharWidth = lineWidth / info.charCount;
  return perGap <= threshold * avgCharWidth;
}

// -------- Spacing computation --------

export interface JustifySpacing {
  wordSpacing: string;
  letterSpacing: string;
}

export function computeJustifySpacing(
  lineWidth: number,
  maxWidth: number,
  info: JustifyLineInfo,
  mode: ResolvedJustifyMode,
): JustifySpacing {
  const extraSpace = maxWidth - lineWidth;

  if (mode === "inter-word" && info.wordGapCount > 0) {
    const perGap = extraSpace / info.wordGapCount;
    return { wordSpacing: `${perGap}px`, letterSpacing: "0px" };
  }

  if (mode === "inter-character" && info.charCount > 0) {
    // letterSpacing applies after every character including the last one
    const perGap = extraSpace / info.charCount;
    return { wordSpacing: "0px", letterSpacing: `${perGap}px` };
  }

  return { wordSpacing: "0px", letterSpacing: "0px" };
}
