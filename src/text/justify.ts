import type { TextJustifyMode } from "../types";
import {
  forEachAtomInRange,
  isCJK,
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

const HYBRID_WORD_SHARE_CANDIDATES = [
  0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8,
  0.85, 1.0, 0.0,
] as const;

const PUNCTUATION_OR_SYMBOL_PATTERN = /^[\p{P}\p{S}]$/u;
const JUSTIFY_SCORE_EPSILON = 1e-9;

export interface JustifyLineInfo {
  /** Number of word gaps (space units) in the line. */
  wordGapCount: number;
  /** Number of visible non-space runs in the line. */
  wordCount: number;
  /** Total number of visible atoms that receive letter spacing. */
  renderAtomCount: number;
  /** Total number of inter-atom gaps that receive letter spacing. */
  letterGapCount: number;
  /** Total number of visible space atoms. */
  spaceCount: number;
  /** Total number of visible non-space atoms. */
  nonSpaceCount: number;
  /** Number of visible CJK atoms. */
  cjkCount: number;
  /** Number of visible non-space Latin-like atoms. */
  latinLikeCount: number;
  /** Number of visible non-space punctuation/symbol atoms. */
  punctuationCount: number;
  /** Visible line width before justification. */
  lineWidth: number;
  /** Visible width excluding space atoms. */
  nonSpaceWidth: number;
}

export function analyzeLineForJustify(
  prepared: PreparedInlineLayout,
  line: PreparedInlineLineRange,
): JustifyLineInfo {
  let wordGapCount = 0;
  let wordCount = 0;
  let renderAtomCount = 0;
  let spaceCount = 0;
  let nonSpaceCount = 0;
  let cjkCount = 0;
  let latinLikeCount = 0;
  let punctuationCount = 0;
  let nonSpaceWidth = 0;
  let insideWord = false;

  forEachAtomInRange(prepared, line.start, line.end, (atom) => {
    if (
      atom.kind === "space" &&
      !atom.preservesLineEnd &&
      atom.atomicGroupId == null
    ) {
      wordGapCount++;
    }
    renderAtomCount++;
    if (atom.kind === "space") {
      spaceCount++;
      insideWord = false;
      return;
    }

    nonSpaceCount++;
    nonSpaceWidth += atom.width + atom.extraWidthAfter;

    if (!insideWord) {
      wordCount++;
      insideWord = true;
    }

    if (isCJK(atom.text)) {
      cjkCount++;
      return;
    }
    if (PUNCTUATION_OR_SYMBOL_PATTERN.test(atom.text)) {
      punctuationCount++;
      return;
    }
    latinLikeCount++;
  });

  return {
    wordGapCount,
    wordCount,
    renderAtomCount,
    letterGapCount: Math.max(renderAtomCount - 1, 0),
    spaceCount,
    nonSpaceCount,
    cjkCount,
    latinLikeCount,
    punctuationCount,
    lineWidth: line.width,
    nonSpaceWidth,
  };
}

function getAverageWordWidth(info: JustifyLineInfo): number {
  return info.wordCount > 0
    ? info.nonSpaceWidth / info.wordCount
    : info.lineWidth;
}

function getAverageCharWidth(info: JustifyLineInfo): number {
  return info.renderAtomCount > 0
    ? info.lineWidth / info.renderAtomCount
    : info.lineWidth;
}

function resolvePerGapSpacing(
  totalSpace: number,
  gapCount: number,
): number | null {
  if (totalSpace === 0) {
    return 0;
  }
  if (gapCount <= 0) {
    return null;
  }
  return totalSpace / gapCount;
}

function exceedsThreshold(
  perGap: number,
  averageWidth: number,
  threshold: number,
): boolean {
  if (!Number.isFinite(threshold)) {
    return false;
  }
  return perGap > threshold * averageWidth;
}

function createJustifySpacing(
  wordSpacingPx: number,
  letterSpacingPx: number,
): JustifySpacing {
  return {
    wordSpacing: `${wordSpacingPx}px`,
    letterSpacing: `${letterSpacingPx}px`,
    wordSpacingPx,
    letterSpacingPx,
  };
}

// -------- Threshold check --------

export function shouldJustifyLine(
  lineWidth: number,
  maxWidth: number,
  info: JustifyLineInfo,
  mode: ResolvedJustifyMode,
  threshold: number,
): boolean {
  return (
    computeJustifySpacing(lineWidth, maxWidth, info, mode, threshold) != null
  );
}

// -------- Spacing computation --------

export interface JustifySpacing {
  wordSpacing: string;
  letterSpacing: string;
  wordSpacingPx: number;
  letterSpacingPx: number;
}

export function computeJustifySpacing(
  lineWidth: number,
  maxWidth: number,
  info: JustifyLineInfo,
  mode: ResolvedJustifyMode,
  threshold = Number.POSITIVE_INFINITY,
): JustifySpacing | null {
  const extraSpace = maxWidth - lineWidth;
  if (extraSpace <= 0 || mode == null) {
    return null;
  }

  if (mode === "inter-word" && info.wordGapCount > 0) {
    const perGap = extraSpace / info.wordGapCount;
    const avgWordWidth = Math.max(getAverageWordWidth(info), Number.EPSILON);
    if (exceedsThreshold(perGap, avgWordWidth, threshold)) {
      return null;
    }
    return createJustifySpacing(perGap, 0);
  }

  if (mode !== "inter-character" || info.renderAtomCount === 0) {
    return null;
  }

  const avgCharWidth = Math.max(getAverageCharWidth(info), Number.EPSILON);
  if (info.wordGapCount === 0) {
    const perGap = resolvePerGapSpacing(extraSpace, info.letterGapCount);
    if (perGap == null) {
      return null;
    }
    if (exceedsThreshold(perGap, avgCharWidth, threshold)) {
      return null;
    }
    return createJustifySpacing(0, perGap);
  }

  const avgWordWidth = Math.max(getAverageWordWidth(info), Number.EPSILON);
  const nonSpaceCount = Math.max(info.nonSpaceCount, 1);
  const cjkRatio = info.cjkCount / nonSpaceCount;
  const latinLikeRatio = info.latinLikeCount / nonSpaceCount;
  const punctuationRatio = info.punctuationCount / nonSpaceCount;
  const wordPenalty = 1 + cjkRatio;
  const letterPenalty = 1 + latinLikeRatio + 0.5 * punctuationRatio;

  let bestCandidate: {
    spacing: JustifySpacing;
    score: number;
    wordShare: number;
  } | null = null;

  for (const wordShare of HYBRID_WORD_SHARE_CANDIDATES) {
    const wordExtraSpace = extraSpace * wordShare;
    const letterExtraSpace = extraSpace - wordExtraSpace;
    const wordSpacingPx = resolvePerGapSpacing(
      wordExtraSpace,
      info.wordGapCount,
    );
    const letterSpacingPx = resolvePerGapSpacing(
      letterExtraSpace,
      info.letterGapCount,
    );
    if (wordSpacingPx == null || letterSpacingPx == null) {
      continue;
    }
    if (
      exceedsThreshold(wordSpacingPx, avgWordWidth, threshold) ||
      exceedsThreshold(letterSpacingPx, avgCharWidth, threshold)
    ) {
      continue;
    }

    const wordRatio = wordSpacingPx / avgWordWidth;
    const letterRatio = letterSpacingPx / avgCharWidth;
    const score =
      wordPenalty * wordRatio ** 2 + letterPenalty * letterRatio ** 2;
    if (
      bestCandidate == null ||
      score < bestCandidate.score - JUSTIFY_SCORE_EPSILON ||
      (Math.abs(score - bestCandidate.score) <= JUSTIFY_SCORE_EPSILON &&
        wordShare > bestCandidate.wordShare)
    ) {
      bestCandidate = {
        spacing: createJustifySpacing(wordSpacingPx, letterSpacingPx),
        score,
        wordShare,
      };
    }
  }

  return bestCandidate?.spacing ?? null;
}
