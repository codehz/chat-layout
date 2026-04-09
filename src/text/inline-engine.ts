import type {
  Context,
  InlineSpan,
  TextEllipsisPosition,
  TextOverflowWrapMode,
  TextWhiteSpaceMode,
  TextWordBreakMode,
} from "../types";
import {
  buildPrefixWidths,
  buildSuffixWidths,
  measureEllipsisWidth,
  readLruValue,
  selectEllipsisUnitCounts,
  splitGraphemes,
  writeLruValue,
} from "./core";

const LINE_FIT_EPSILON = 0.005;
const PREPARED_INLINE_CACHE_CAPACITY = 512;

type MeasureContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

type SourceItem = {
  text: string;
  font: string;
  itemIndex: number;
  breakMode: "normal" | "never";
  extraWidth: number;
};

export type InlineAtom = {
  text: string;
  font: string;
  itemIndex: number;
  width: number;
  extraWidthAfter: number;
  kind: "text" | "space";
  preservesLineEnd: boolean;
  atomicGroupId: number | null;
};

export type PreparedInlineUnit = {
  kind: "text" | "space";
  atoms: InlineAtom[];
  width: number;
  fitEndWidth: number;
  paintEndWidth: number;
  breakAfter: boolean;
  breakable: boolean;
  atomic: boolean;
};

export type PreparedInlineChunk = {
  startUnit: number;
  endUnit: number;
};

export type PreparedInlineLayout = {
  units: PreparedInlineUnit[];
  chunks: PreparedInlineChunk[];
  whiteSpace: TextWhiteSpaceMode;
  wordBreak: TextWordBreakMode;
};

export type PreparedInlineCursor = {
  chunkIndex: number;
  unitIndex: number;
  atomIndex: number;
};

export type PreparedInlineLineRange = {
  width: number;
  start: PreparedInlineCursor;
  end: PreparedInlineCursor;
  next: PreparedInlineCursor;
};

export type PreparedInlineStats = {
  lineCount: number;
  maxLineWidth: number;
};

export type PreparedInlineAtomSlice = {
  atoms: InlineAtom[];
  width: number;
};

const kinsokuStart = new Set([
  "\uFF0C",
  "\uFF0E",
  "\uFF01",
  "\uFF1A",
  "\uFF1B",
  "\uFF1F",
  "\u3001",
  "\u3002",
  "\u30FB",
  "\uFF09",
  "\u3015",
  "\u3009",
  "\u300B",
  "\u300D",
  "\u300F",
  "\u3011",
  "\u3017",
  "\u3019",
  "\u301B",
  "\u30FC",
  "\u3005",
  "\u303B",
  "\u309D",
  "\u309E",
  "\u30FD",
  "\u30FE",
]);

const kinsokuEnd = new Set([
  "\"",
  "(",
  "[",
  "{",
  "“",
  "‘",
  "«",
  "‹",
  "\uFF08",
  "\u3014",
  "\u3008",
  "\u300A",
  "\u300C",
  "\u300E",
  "\u3010",
  "\u3016",
  "\u3018",
  "\u301A",
]);

const leftStickyPunctuation = new Set([
  ".",
  ",",
  "!",
  "?",
  ":",
  ";",
  "\u060C",
  "\u061B",
  "\u061F",
  "\u0964",
  "\u0965",
  "\u104A",
  "\u104B",
  "\u104C",
  "\u104D",
  "\u104F",
  ")",
  "]",
  "}",
  "%",
  "\"",
  "”",
  "’",
  "»",
  "›",
  "…",
]);

const keepAllGlueChars = new Set([
  "\u00A0",
  "\u202F",
  "\u2060",
  "\uFEFF",
]);

const closingQuoteChars = new Set([
  "”",
  "’",
  "»",
  "›",
  "\u300D",
  "\u300F",
  "\u3011",
]);

const cjkCodePointRanges: Array<[number, number]> = [
  [0x4E00, 0x9FFF],
  [0x3400, 0x4DBF],
  [0x20000, 0x2A6DF],
  [0x2A700, 0x2B73F],
  [0x2B740, 0x2B81F],
  [0x2B820, 0x2CEAF],
  [0x2CEB0, 0x2EBEF],
  [0x2EBF0, 0x2EE5D],
  [0x2F800, 0x2FA1F],
  [0x30000, 0x3134F],
  [0x31350, 0x323AF],
  [0x323B0, 0x33479],
  [0xF900, 0xFAFF],
  [0x3000, 0x303F],
  [0x3040, 0x309F],
  [0x30A0, 0x30FF],
  [0xAC00, 0xD7AF],
  [0xFF00, 0xFFEF],
];

let sharedMeasureContext: MeasureContext | null = null;
let sharedWordSegmenter: Intl.Segmenter | null | undefined;
const textWidthCache = new Map<string, Map<string, number>>();
const preparedInlineCache = new Map<string, PreparedInlineLayout>();

function getMeasureContext(): MeasureContext {
  if (sharedMeasureContext != null) {
    return sharedMeasureContext;
  }
  if (typeof OffscreenCanvas !== "undefined") {
    const ctx = new OffscreenCanvas(1, 1).getContext("2d");
    if (ctx != null) {
      sharedMeasureContext = ctx;
      return ctx;
    }
  }
  if (typeof document !== "undefined") {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx != null) {
      sharedMeasureContext = ctx;
      return ctx;
    }
  }
  throw new Error("Text measurement requires OffscreenCanvas or a DOM canvas context.");
}

function getTextWidthCache(font: string): Map<string, number> {
  let cache = textWidthCache.get(font);
  if (cache == null) {
    cache = new Map<string, number>();
    textWidthCache.set(font, cache);
  }
  return cache;
}

function measureTextWidth(font: string, text: string): number {
  const cache = getTextWidthCache(font);
  const cached = cache.get(text);
  if (cached != null) {
    return cached;
  }
  const ctx = getMeasureContext();
  ctx.font = font;
  const width = ctx.measureText(text).width;
  cache.set(text, width);
  return width;
}

function isCollapsibleWhitespace(text: string): boolean {
  return /^[ \t\n\f\r]+$/u.test(text);
}

function isPreservedWhitespaceGrapheme(text: string): boolean {
  return text === " " || text === "\t";
}

function normalizePreWrapText(text: string): string {
  if (!/[\r\f]/.test(text)) {
    return text.replace(/\r\n/g, "\n");
  }
  return text.replace(/\r\n/g, "\n").replace(/[\r\f]/g, "\n");
}

function getLastCodePoint(text: string): string | null {
  if (text.length === 0) {
    return null;
  }
  const codePoints = Array.from(text);
  return codePoints[codePoints.length - 1] ?? null;
}

function isCJKCodePoint(codePoint: number): boolean {
  for (const [start, end] of cjkCodePointRanges) {
    if (codePoint >= start && codePoint <= end) {
      return true;
    }
  }
  return false;
}

export function isCJK(text: string): boolean {
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint != null && isCJKCodePoint(codePoint)) {
      return true;
    }
  }
  return false;
}

function endsWithClosingQuote(text: string): boolean {
  const last = getLastCodePoint(text);
  return last != null && closingQuoteChars.has(last);
}

function endsWithKeepAllGlueText(text: string): boolean {
  const last = getLastCodePoint(text);
  return last != null && keepAllGlueChars.has(last);
}

function endsWithLineStartProhibitedText(text: string): boolean {
  const last = getLastCodePoint(text);
  return last != null && (kinsokuStart.has(last) || leftStickyPunctuation.has(last));
}

function canContinueKeepAllTextRun(text: string): boolean {
  return !endsWithLineStartProhibitedText(text) && !endsWithKeepAllGlueText(text);
}

function getSharedWordSegmenter(): Intl.Segmenter | null {
  if (sharedWordSegmenter !== undefined) {
    return sharedWordSegmenter;
  }
  sharedWordSegmenter = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;
  return sharedWordSegmenter;
}

function sumAtomWidths(atoms: readonly InlineAtom[], start = 0, end = atoms.length): number {
  let width = 0;
  for (let index = start; index < end; index += 1) {
    const atom = atoms[index];
    if (atom != null) {
      width += atom.width + atom.extraWidthAfter;
    }
  }
  return width;
}

function measureAtomSequenceWidth(atoms: readonly InlineAtom[]): number {
  if (atoms.length === 0) {
    return 0;
  }
  let width = 0;
  let currentFont = atoms[0]!.font;
  let currentText = "";
  for (const atom of atoms) {
    if (atom.font !== currentFont && currentText.length > 0) {
      width += measureTextWidth(currentFont, currentText);
      currentFont = atom.font;
      currentText = "";
    }
    currentText += atom.text;
    width += atom.extraWidthAfter;
  }
  if (currentText.length > 0) {
    width += measureTextWidth(currentFont, currentText);
  }
  return width;
}

function pushTextPartAtoms(
  target: InlineAtom[],
  text: string,
  font: string,
  itemIndex: number,
  atomicGroupId: number | null,
  extraWidth: number,
): void {
  const graphemes = splitGraphemes(text);
  for (let index = 0; index < graphemes.length; index += 1) {
    const grapheme = graphemes[index] ?? "";
    target.push({
      text: grapheme,
      font,
      itemIndex,
      width: measureTextWidth(font, grapheme),
      extraWidthAfter: index === graphemes.length - 1 ? extraWidth : 0,
      kind: "text",
      preservesLineEnd: false,
      atomicGroupId,
    });
  }
}

function buildCollapsedWhitespaceAtoms(items: readonly SourceItem[]): InlineAtom[][] {
  const chunks: InlineAtom[][] = [[]];
  const atoms = chunks[0]!;
  let pendingSpace:
    | {
        font: string;
        itemIndex: number;
        atomicGroupId: number | null;
      }
    | null = null;
  let lastVisible:
    | {
        font: string;
        itemIndex: number;
        atomicGroupId: number | null;
      }
    | null = null;

  for (const item of items) {
    const atomicGroupId = item.breakMode === "never" ? item.itemIndex + 1 : null;
    const parts = item.text.match(/[ \t\n\f\r]+|[^ \t\n\f\r]+/gu) ?? [];
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const part = parts[partIndex] ?? "";
      if (isCollapsibleWhitespace(part)) {
        if (lastVisible != null) {
          pendingSpace = {
            font: lastVisible.font,
            itemIndex: lastVisible.itemIndex,
            atomicGroupId,
          };
        }
        continue;
      }

      if (pendingSpace != null) {
        atoms.push({
          text: " ",
          font: pendingSpace.font,
          itemIndex: pendingSpace.itemIndex,
          width: measureTextWidth(pendingSpace.font, " "),
          extraWidthAfter: 0,
          kind: "space",
          preservesLineEnd: false,
          atomicGroupId: pendingSpace.atomicGroupId,
        });
        pendingSpace = null;
      }

      pushTextPartAtoms(
        atoms,
        part,
        item.font,
        item.itemIndex,
        atomicGroupId,
        partIndex === parts.length - 1 ? item.extraWidth : 0,
      );
      lastVisible = {
        font: item.font,
        itemIndex: item.itemIndex,
        atomicGroupId,
      };
    }
  }

  return chunks;
}

function buildPreWrapAtoms(items: readonly SourceItem[]): InlineAtom[][] {
  const chunks: InlineAtom[][] = [[]];
  let currentChunk = chunks[0]!;

  for (const item of items) {
    const atomicGroupId = item.breakMode === "never" ? item.itemIndex + 1 : null;
    const normalizedText = normalizePreWrapText(item.text);
    const graphemes = splitGraphemes(normalizedText);
    for (let index = 0; index < graphemes.length; index += 1) {
      const grapheme = graphemes[index] ?? "";
      if (grapheme === "\n") {
        currentChunk = [];
        chunks.push(currentChunk);
        continue;
      }
      const isSpace = isPreservedWhitespaceGrapheme(grapheme);
      currentChunk.push({
        text: grapheme,
        font: item.font,
        itemIndex: item.itemIndex,
        width: measureTextWidth(item.font, grapheme),
        extraWidthAfter: index === graphemes.length - 1 ? item.extraWidth : 0,
        kind: isSpace ? "space" : "text",
        preservesLineEnd: isSpace,
        atomicGroupId,
      });
    }
  }

  return chunks;
}

function buildBaseCjkUnits(atoms: readonly InlineAtom[]): InlineAtom[][] {
  const units: InlineAtom[][] = [];
  let current: InlineAtom[] = [];
  let currentContainsCJK = false;
  let currentEndsWithClosingQuote = false;
  let currentIsSingleKinsokuEnd = false;

  const flushCurrent = () => {
    if (current.length === 0) {
      return;
    }
    units.push(current);
    current = [];
    currentContainsCJK = false;
    currentEndsWithClosingQuote = false;
    currentIsSingleKinsokuEnd = false;
  };

  for (const atom of atoms) {
    const atomContainsCJK = isCJK(atom.text);
    if (current.length === 0) {
      current = [atom];
      currentContainsCJK = atomContainsCJK;
      currentEndsWithClosingQuote = endsWithClosingQuote(atom.text);
      currentIsSingleKinsokuEnd = kinsokuEnd.has(atom.text);
      continue;
    }

    if (
      currentIsSingleKinsokuEnd ||
      kinsokuStart.has(atom.text) ||
      leftStickyPunctuation.has(atom.text) ||
      (atomContainsCJK && currentEndsWithClosingQuote)
    ) {
      current.push(atom);
      currentContainsCJK = currentContainsCJK || atomContainsCJK;
      currentEndsWithClosingQuote = leftStickyPunctuation.has(atom.text)
        ? currentEndsWithClosingQuote || endsWithClosingQuote(atom.text)
        : endsWithClosingQuote(atom.text);
      currentIsSingleKinsokuEnd = false;
      continue;
    }

    if (!currentContainsCJK && !atomContainsCJK) {
      current.push(atom);
      currentEndsWithClosingQuote = endsWithClosingQuote(atom.text);
      currentIsSingleKinsokuEnd = false;
      continue;
    }

    flushCurrent();
    current = [atom];
    currentContainsCJK = atomContainsCJK;
    currentEndsWithClosingQuote = endsWithClosingQuote(atom.text);
    currentIsSingleKinsokuEnd = kinsokuEnd.has(atom.text);
  }

  flushCurrent();
  return units;
}

function mergeKeepAllUnits(units: readonly InlineAtom[][]): InlineAtom[][] {
  if (units.length <= 1) {
    return units.slice();
  }

  const merged: InlineAtom[][] = [];
  let current = units[0]!.slice();
  let currentText = current.map((atom) => atom.text).join("");
  let currentContainsCJK = isCJK(currentText);
  let currentCanContinue = canContinueKeepAllTextRun(currentText);

  const flush = () => {
    merged.push(current);
  };

  for (let index = 1; index < units.length; index += 1) {
    const next = units[index]!;
    const nextText = next.map((atom) => atom.text).join("");
    const nextContainsCJK = isCJK(nextText);
    const nextCanContinue = canContinueKeepAllTextRun(nextText);

    if (currentContainsCJK && currentCanContinue) {
      current = [...current, ...next];
      currentText += nextText;
      currentContainsCJK = currentContainsCJK || nextContainsCJK;
      currentCanContinue = nextCanContinue;
      continue;
    }

    flush();
    current = next.slice();
    currentText = nextText;
    currentContainsCJK = nextContainsCJK;
    currentCanContinue = nextCanContinue;
  }

  flush();
  return merged;
}

function splitAtomsByWordSegments(atoms: readonly InlineAtom[]): InlineAtom[][] {
  if (atoms.length <= 1) {
    return atoms.length === 0 ? [] : [atoms.slice()];
  }
  const segmenter = getSharedWordSegmenter();
  if (segmenter == null) {
    return [atoms.slice()];
  }

  const text = atoms.map((atom) => atom.text).join("");
  const offsets = [0];
  for (let index = 0; index < atoms.length; index += 1) {
    offsets.push((offsets[index] ?? 0) + (atoms[index]?.text.length ?? 0));
  }

  const units: InlineAtom[][] = [];
  let atomStart = 0;
  let atomEnd = 0;
  for (const segment of segmenter.segment(text)) {
    const start = segment.index;
    const end = start + segment.segment.length;
    while ((offsets[atomStart] ?? 0) < start) {
      atomStart += 1;
    }
    atomEnd = atomStart;
    while ((offsets[atomEnd] ?? 0) < end) {
      atomEnd += 1;
    }
    if (atomStart < atomEnd) {
      units.push(atoms.slice(atomStart, atomEnd));
    }
    atomStart = atomEnd;
  }

  return units.length > 0 ? units : [atoms.slice()];
}

function makeTextUnit(atoms: InlineAtom[], atomic = false): PreparedInlineUnit {
  const width = measureAtomSequenceWidth(atoms);
  return {
    kind: "text",
    atoms,
    width,
    fitEndWidth: width,
    paintEndWidth: width,
    breakAfter: true,
    breakable: !atomic && atoms.length > 1,
    atomic,
  };
}

function makeSpaceUnit(atoms: InlineAtom[]): PreparedInlineUnit {
  const width = measureAtomSequenceWidth(atoms);
  const preservesLineEnd = atoms.every((atom) => atom.preservesLineEnd);
  return {
    kind: "space",
    atoms,
    width,
    fitEndWidth: 0,
    paintEndWidth: preservesLineEnd ? width : 0,
    breakAfter: true,
    breakable: atoms.length > 1,
    atomic: false,
  };
}

function tokenizeChunkAtoms(
  chunkAtoms: readonly InlineAtom[],
  wordBreak: TextWordBreakMode,
): PreparedInlineUnit[] {
  const units: PreparedInlineUnit[] = [];
  let index = 0;

  while (index < chunkAtoms.length) {
    const atom = chunkAtoms[index]!;
    if (atom.atomicGroupId != null) {
      const start = index;
      const atomicGroupId = atom.atomicGroupId;
      while (index < chunkAtoms.length && chunkAtoms[index]?.atomicGroupId === atomicGroupId) {
        index += 1;
      }
      units.push(makeTextUnit(chunkAtoms.slice(start, index), true));
      continue;
    }

    if (atom.kind === "space") {
      const start = index;
      while (index < chunkAtoms.length && chunkAtoms[index]?.kind === "space" && chunkAtoms[index]?.atomicGroupId == null) {
        index += 1;
      }
      units.push(makeSpaceUnit(chunkAtoms.slice(start, index)));
      continue;
    }

    const start = index;
    while (index < chunkAtoms.length && chunkAtoms[index]?.kind === "text" && chunkAtoms[index]?.atomicGroupId == null) {
      index += 1;
    }
    const textRunAtoms = chunkAtoms.slice(start, index);
    const runText = textRunAtoms.map((part) => part.text).join("");
    const rawUnits = isCJK(runText)
      ? buildBaseCjkUnits(textRunAtoms)
      : splitAtomsByWordSegments(textRunAtoms);
    const normalizedUnits = wordBreak === "keep-all" && isCJK(runText)
      ? mergeKeepAllUnits(rawUnits)
      : rawUnits;
    for (const unitAtoms of normalizedUnits) {
      units.push(makeTextUnit(unitAtoms.slice(), false));
    }
  }

  return units;
}

function buildPreparedInlineLayout(
  items: readonly SourceItem[],
  whiteSpace: TextWhiteSpaceMode,
  wordBreak: TextWordBreakMode,
): PreparedInlineLayout {
  const atomChunks = whiteSpace === "pre-wrap"
    ? buildPreWrapAtoms(items)
    : buildCollapsedWhitespaceAtoms(items);
  const chunks: PreparedInlineChunk[] = [];
  const units: PreparedInlineUnit[] = [];

  for (const atomChunk of atomChunks) {
    const startUnit = units.length;
    const chunkUnits = tokenizeChunkAtoms(atomChunk, wordBreak);
    units.push(...chunkUnits);
    chunks.push({
      startUnit,
      endUnit: units.length,
    });
  }

  return { units, chunks, whiteSpace, wordBreak };
}

function cloneCursor(cursor: PreparedInlineCursor): PreparedInlineCursor {
  return {
    chunkIndex: cursor.chunkIndex,
    unitIndex: cursor.unitIndex,
    atomIndex: cursor.atomIndex,
  };
}

function cursorEquals(a: PreparedInlineCursor, b: PreparedInlineCursor): boolean {
  return a.chunkIndex === b.chunkIndex && a.unitIndex === b.unitIndex && a.atomIndex === b.atomIndex;
}

function fits(width: number, maxWidth: number): boolean {
  return width <= maxWidth + LINE_FIT_EPSILON;
}

function getVisibleEndAfterBreak(
  chunkIndex: number,
  unitIndex: number,
  unit: PreparedInlineUnit,
): PreparedInlineCursor {
  if (unit.kind === "space" && unit.paintEndWidth === 0) {
    return { chunkIndex, unitIndex, atomIndex: 0 };
  }
  return { chunkIndex, unitIndex: unitIndex + 1, atomIndex: 0 };
}

function fitPartialUnit(
  unit: PreparedInlineUnit,
  startAtomIndex: number,
  lineWidth: number,
  maxWidth: number,
): { count: number; width: number } {
  let width = 0;
  let count = 0;
  for (let index = startAtomIndex; index < unit.atoms.length; index += 1) {
    const atom = unit.atoms[index]!;
    const atomWidth = atom.width + atom.extraWidthAfter;
    if (count > 0 && !fits(lineWidth + width + atomWidth, maxWidth)) {
      break;
    }
    if (count === 0 || fits(lineWidth + width + atomWidth, maxWidth)) {
      width += atomWidth;
      count += 1;
      continue;
    }
    break;
  }
  return { count, width };
}

function stepChunkLine(
  prepared: PreparedInlineLayout,
  chunkIndex: number,
  startUnitIndex: number,
  startAtomIndex: number,
  maxWidth: number,
): PreparedInlineLineRange | null {
  const chunk = prepared.chunks[chunkIndex];
  if (chunk == null || startUnitIndex >= chunk.endUnit) {
    return null;
  }

  const start: PreparedInlineCursor = {
    chunkIndex,
    unitIndex: startUnitIndex,
    atomIndex: startAtomIndex,
  };
  let unitIndex = startUnitIndex;
  let atomIndex = startAtomIndex;
  let lineWidth = 0;
  let hasContent = false;
  let pendingBreak:
    | {
        end: PreparedInlineCursor;
        next: PreparedInlineCursor;
        width: number;
      }
    | null = null;

  while (unitIndex < chunk.endUnit) {
    const unit = prepared.units[unitIndex]!;
    if (atomIndex > 0) {
      const fitted = fitPartialUnit(unit, atomIndex, lineWidth, maxWidth);
      if (fitted.count === 0) {
        if (hasContent) {
          return {
            width: lineWidth,
            start,
            end: { chunkIndex, unitIndex, atomIndex },
            next: { chunkIndex, unitIndex, atomIndex },
          };
        }
        const atom = unit.atoms[atomIndex]!;
        const width = atom.width + atom.extraWidthAfter;
        return {
          width,
          start,
          end: { chunkIndex, unitIndex, atomIndex: atomIndex + 1 },
          next: { chunkIndex, unitIndex, atomIndex: atomIndex + 1 },
        };
      }

      if (atomIndex + fitted.count >= unit.atoms.length) {
        lineWidth += fitted.width;
        hasContent = true;
        atomIndex = 0;
        unitIndex += 1;
        pendingBreak = {
          end: { chunkIndex, unitIndex, atomIndex: 0 },
          next: { chunkIndex, unitIndex, atomIndex: 0 },
          width: lineWidth,
        };
        continue;
      }

      return {
        width: lineWidth + fitted.width,
        start,
        end: { chunkIndex, unitIndex, atomIndex: atomIndex + fitted.count },
        next: { chunkIndex, unitIndex, atomIndex: atomIndex + fitted.count },
      };
    }

    if (!hasContent) {
      if (fits(unit.width, maxWidth) || unit.atomic || !unit.breakable) {
        lineWidth = unit.width;
        hasContent = true;
        const next = { chunkIndex, unitIndex: unitIndex + 1, atomIndex: 0 };
        pendingBreak = {
          end: getVisibleEndAfterBreak(chunkIndex, unitIndex, unit),
          next,
          width: unit.paintEndWidth,
        };
        unitIndex += 1;
        continue;
      }

      const fitted = fitPartialUnit(unit, 0, 0, maxWidth);
      if (fitted.count >= unit.atoms.length) {
        lineWidth = fitted.width;
        hasContent = true;
        const next = { chunkIndex, unitIndex: unitIndex + 1, atomIndex: 0 };
        pendingBreak = {
          end: next,
          next,
          width: lineWidth,
        };
        unitIndex += 1;
        continue;
      }
      return {
        width: fitted.width,
        start,
        end: { chunkIndex, unitIndex, atomIndex: fitted.count },
        next: { chunkIndex, unitIndex, atomIndex: fitted.count },
      };
    }

    if (fits(lineWidth + unit.width, maxWidth)) {
      const nextWidth = lineWidth + unit.width;
      lineWidth = nextWidth;
      const next = { chunkIndex, unitIndex: unitIndex + 1, atomIndex: 0 };
      pendingBreak = {
        end: getVisibleEndAfterBreak(chunkIndex, unitIndex, unit),
        next,
        width: nextWidth - unit.width + unit.paintEndWidth,
      };
      unitIndex += 1;
      continue;
    }

    if (fits(lineWidth + unit.fitEndWidth, maxWidth)) {
      const next = { chunkIndex, unitIndex: unitIndex + 1, atomIndex: 0 };
      return {
        width: lineWidth + unit.paintEndWidth,
        start,
        end: getVisibleEndAfterBreak(chunkIndex, unitIndex, unit),
        next,
      };
    }

    if (pendingBreak != null) {
      return {
        width: pendingBreak.width,
        start,
        end: pendingBreak.end,
        next: pendingBreak.next,
      };
    }

    return {
      width: lineWidth,
      start,
      end: { chunkIndex, unitIndex, atomIndex: 0 },
      next: { chunkIndex, unitIndex, atomIndex: 0 },
    };
  }

  if (!hasContent) {
    return null;
  }

  if (pendingBreak != null && pendingBreak.next.unitIndex === chunk.endUnit && pendingBreak.next.atomIndex === 0) {
    return {
      width: pendingBreak.width,
      start,
      end: pendingBreak.end,
      next: pendingBreak.next,
    };
  }

  return {
    width: lineWidth,
    start,
    end: { chunkIndex, unitIndex, atomIndex: 0 },
    next: { chunkIndex, unitIndex, atomIndex: 0 },
  };
}

export function getPreparedLineStart(prepared: PreparedInlineLayout): PreparedInlineCursor | undefined {
  for (let chunkIndex = 0; chunkIndex < prepared.chunks.length; chunkIndex += 1) {
    const chunk = prepared.chunks[chunkIndex]!;
    if (chunk.startUnit === chunk.endUnit) {
      return { chunkIndex, unitIndex: chunk.startUnit, atomIndex: 0 };
    }
    return { chunkIndex, unitIndex: chunk.startUnit, atomIndex: 0 };
  }
  return undefined;
}

export function getPreparedEndCursor(prepared: PreparedInlineLayout): PreparedInlineCursor {
  if (prepared.chunks.length === 0) {
    return { chunkIndex: 0, unitIndex: 0, atomIndex: 0 };
  }
  const lastChunkIndex = prepared.chunks.length - 1;
  const lastChunk = prepared.chunks[lastChunkIndex]!;
  return {
    chunkIndex: lastChunkIndex,
    unitIndex: lastChunk.endUnit,
    atomIndex: 0,
  };
}

export function layoutNextPreparedLine(
  prepared: PreparedInlineLayout,
  start: PreparedInlineCursor,
  maxWidth: number,
): PreparedInlineLineRange | null {
  const chunk = prepared.chunks[start.chunkIndex];
  if (chunk == null) {
    return null;
  }
  if (chunk.startUnit === chunk.endUnit) {
    return cursorEquals(start, { chunkIndex: start.chunkIndex, unitIndex: chunk.endUnit, atomIndex: 0 })
      ? null
      : {
          width: 0,
          start: cloneCursor(start),
          end: { chunkIndex: start.chunkIndex, unitIndex: chunk.endUnit, atomIndex: 0 },
          next: { chunkIndex: start.chunkIndex, unitIndex: chunk.endUnit, atomIndex: 0 },
        };
  }
  return stepChunkLine(
    prepared,
    start.chunkIndex,
    start.unitIndex,
    start.atomIndex,
    maxWidth,
  );
}

export function walkPreparedLineRanges(
  prepared: PreparedInlineLayout,
  maxWidth: number,
  onLine: (line: PreparedInlineLineRange) => void,
): number {
  let lineCount = 0;
  for (let chunkIndex = 0; chunkIndex < prepared.chunks.length; chunkIndex += 1) {
    const chunk = prepared.chunks[chunkIndex]!;
    if (chunk.startUnit === chunk.endUnit) {
      const cursor = { chunkIndex, unitIndex: chunk.startUnit, atomIndex: 0 };
      onLine({ width: 0, start: cursor, end: cursor, next: cursor });
      lineCount += 1;
      continue;
    }
    let cursor: PreparedInlineCursor = {
      chunkIndex,
      unitIndex: chunk.startUnit,
      atomIndex: 0,
    };
    while (true) {
      const line = layoutNextPreparedLine(prepared, cursor, maxWidth);
      if (line == null) {
        break;
      }
      onLine(line);
      lineCount += 1;
      if (cursorEquals(line.next, cursor)) {
        break;
      }
      cursor = line.next;
      if (cursor.unitIndex >= chunk.endUnit && cursor.atomIndex === 0) {
        break;
      }
    }
  }
  return lineCount;
}

export function measurePreparedLineStats(prepared: PreparedInlineLayout, maxWidth: number): PreparedInlineStats {
  let lineCount = 0;
  let maxLineWidth = 0;
  walkPreparedLineRanges(prepared, maxWidth, (line) => {
    lineCount += 1;
    if (line.width > maxLineWidth) {
      maxLineWidth = line.width;
    }
  });
  return { lineCount, maxLineWidth };
}

export function measurePreparedNaturalWidth(prepared: PreparedInlineLayout): number {
  return measurePreparedLineStats(prepared, Number.POSITIVE_INFINITY).maxLineWidth;
}

function forEachAtomInRange(
  prepared: PreparedInlineLayout,
  start: PreparedInlineCursor,
  end: PreparedInlineCursor,
  cb: (atom: InlineAtom) => void,
): void {
  if (start.chunkIndex !== end.chunkIndex) {
    throw new Error("Atom range iteration only supports a single chunk.");
  }
  for (let unitIndex = start.unitIndex; unitIndex < end.unitIndex; unitIndex += 1) {
    const unit = prepared.units[unitIndex]!;
    const atomStart = unitIndex === start.unitIndex ? start.atomIndex : 0;
    const atomEnd = unitIndex === end.unitIndex ? end.atomIndex : unit.atoms.length;
    for (let atomIndex = atomStart; atomIndex < atomEnd; atomIndex += 1) {
      const atom = unit.atoms[atomIndex];
      if (atom != null) {
        cb(atom);
      }
    }
  }
  if (end.unitIndex < prepared.units.length) {
    const unit = prepared.units[end.unitIndex];
    if (unit != null && start.unitIndex === end.unitIndex) {
      for (let atomIndex = start.atomIndex; atomIndex < end.atomIndex; atomIndex += 1) {
        const atom = unit.atoms[atomIndex];
        if (atom != null) {
          cb(atom);
        }
      }
    }
  }
}

export function collectAtomsInRange(
  prepared: PreparedInlineLayout,
  start: PreparedInlineCursor,
  end: PreparedInlineCursor,
): InlineAtom[] {
  const atoms: InlineAtom[] = [];
  if (start.unitIndex === end.unitIndex) {
    const unit = prepared.units[start.unitIndex];
    if (unit == null) {
      return atoms;
    }
    for (let atomIndex = start.atomIndex; atomIndex < end.atomIndex; atomIndex += 1) {
      const atom = unit.atoms[atomIndex];
      if (atom != null) {
        atoms.push(atom);
      }
    }
    return atoms;
  }

  const startChunk = prepared.chunks[start.chunkIndex];
  if (startChunk == null) {
    return atoms;
  }
  for (let unitIndex = start.unitIndex; unitIndex < end.unitIndex; unitIndex += 1) {
    const unit = prepared.units[unitIndex]!;
    const atomStart = unitIndex === start.unitIndex ? start.atomIndex : 0;
    for (let atomIndex = atomStart; atomIndex < unit.atoms.length; atomIndex += 1) {
      const atom = unit.atoms[atomIndex];
      if (atom != null) {
        atoms.push(atom);
      }
    }
  }
  const endUnit = prepared.units[end.unitIndex];
  if (endUnit != null) {
    for (let atomIndex = 0; atomIndex < end.atomIndex; atomIndex += 1) {
      const atom = endUnit.atoms[atomIndex];
      if (atom != null) {
        atoms.push(atom);
      }
    }
  }
  return atoms;
}

export function collectLineAtoms(prepared: PreparedInlineLayout, line: PreparedInlineLineRange): PreparedInlineAtomSlice {
  const atoms = collectAtomsInRange(prepared, line.start, line.end);
  return {
    atoms,
    width: line.width,
  };
}

export function collectAtomsFromCursorToEnd(
  prepared: PreparedInlineLayout,
  start: PreparedInlineCursor,
): InlineAtom[] {
  const atoms: InlineAtom[] = [];
  for (let chunkIndex = start.chunkIndex; chunkIndex < prepared.chunks.length; chunkIndex += 1) {
    const chunk = prepared.chunks[chunkIndex]!;
    const chunkStart = chunkIndex === start.chunkIndex
      ? start
      : { chunkIndex, unitIndex: chunk.startUnit, atomIndex: 0 };
    const chunkEnd = { chunkIndex, unitIndex: chunk.endUnit, atomIndex: 0 };
    atoms.push(...collectAtomsInRange(prepared, chunkStart, chunkEnd));
  }
  return atoms;
}

export function materializePreparedLineText(prepared: PreparedInlineLayout, line: PreparedInlineLineRange): string {
  return collectLineAtoms(prepared, line).atoms.map((atom) => atom.text).join("");
}

export function flattenPreparedLineAtoms(prepared: PreparedInlineLayout, line: PreparedInlineLineRange): InlineAtom[] {
  return collectLineAtoms(prepared, line).atoms;
}

export function measurePreparedMinContentWidth(
  prepared: PreparedInlineLayout,
  overflowWrap: TextOverflowWrapMode = "break-word",
): number {
  let maxWidth = 0;
  let maxAnyWidth = 0;
  for (const unit of prepared.units) {
    if (unit.width > maxAnyWidth) {
      maxAnyWidth = unit.width;
    }
    if (unit.kind !== "text") {
      continue;
    }
    const candidateWidth = overflowWrap === "anywhere" && unit.breakable
      ? unit.atoms.reduce((widest, atom) => Math.max(widest, atom.width + atom.extraWidthAfter), 0)
      : unit.width;
    if (candidateWidth > maxWidth) {
      maxWidth = candidateWidth;
    }
  }
  return maxWidth > 0 ? maxWidth : maxAnyWidth;
}

export function getPreparedUnits(prepared: PreparedInlineLayout): Array<{ text: string; width: number }> {
  return prepared.units.flatMap((unit) => {
    if (unit.kind === "text" && unit.breakable) {
      return unit.atoms.map((atom) => ({
        text: atom.text,
        width: atom.width + atom.extraWidthAfter,
      }));
    }
    const text = unit.atoms.map((atom) => atom.text).join("");
    return text.length === 0 && unit.width === 0 ? [] : [{ text, width: unit.width }];
  });
}

export function joinPreparedUnitText(
  units: ReadonlyArray<{ text: string; width: number }>,
  start: number,
  end: number,
): string {
  if (start >= end) {
    return "";
  }
  return units.slice(start, end).map((unit) => unit.text).join("");
}

export function measureAtomsWidth(atoms: readonly InlineAtom[]): number {
  return atoms.reduce((total, atom) => total + atom.width + atom.extraWidthAfter, 0);
}

export function readPreparedInlineLayout(
  key: string,
  items: readonly SourceItem[],
  whiteSpace: TextWhiteSpaceMode,
  wordBreak: TextWordBreakMode,
): PreparedInlineLayout {
  const cached = readLruValue(preparedInlineCache, key);
  if (cached != null) {
    return cached;
  }
  return writeLruValue(
    preparedInlineCache,
    key,
    buildPreparedInlineLayout(items, whiteSpace, wordBreak),
    PREPARED_INLINE_CACHE_CAPACITY,
  );
}

export function getPlainPreparedKey(
  text: string,
  font: string,
  whiteSpace: TextWhiteSpaceMode,
  wordBreak: TextWordBreakMode,
): string {
  return `plain\u0000${font}\u0000${whiteSpace}\u0000${wordBreak}\u0000${text}`;
}

export function getRichPreparedKey<C extends CanvasRenderingContext2D>(
  spans: readonly InlineSpan<C>[],
  defaultFont: string,
  whiteSpace: TextWhiteSpaceMode,
  wordBreak: TextWordBreakMode,
): string {
  return spans
    .map((span) =>
      `${span.font ?? defaultFont}\u0000${span.text}\u0000${span.break ?? ""}\u0000${span.extraWidth ?? 0}`
    )
    .join("\u0001") + `\u0002${whiteSpace}\u0002${wordBreak}`;
}

export function createPlainSourceItems(text: string, font: string): SourceItem[] {
  return [{
    text,
    font,
    itemIndex: 0,
    breakMode: "normal",
    extraWidth: 0,
  }];
}

export function createRichSourceItems<C extends CanvasRenderingContext2D>(
  spans: readonly InlineSpan<C>[],
  defaultFont: string,
): SourceItem[] {
  return spans.map((span, index) => ({
    text: span.text,
    font: span.font ?? defaultFont,
    itemIndex: index,
    breakMode: span.break ?? "normal",
    extraWidth: span.extraWidth ?? 0,
  }));
}
