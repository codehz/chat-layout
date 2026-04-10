import {
  layoutEllipsizedFirstLine,
  layoutFirstLine,
  layoutFirstLineIntrinsic,
  layoutRichEllipsizedFirstLine,
  layoutRichFirstLine,
  layoutRichFirstLineIntrinsic,
  layoutRichText,
  layoutRichTextIntrinsic,
  layoutRichTextWithOverflow,
  layoutText,
  layoutTextIntrinsic,
  layoutTextWithOverflow,
  measureRichText,
  measureRichTextIntrinsic,
  measureRichTextMinContent,
  measureText,
  measureTextMinContent,
  measureTextIntrinsic,
  type RichBlockLayout,
  type RichLineLayout,
  type RichMeasurement,
  type TextLayout,
  type TextMeasurement,
  analyzeLineForJustify,
  computeJustifySpacing,
  isJustifySupported,
  resolveJustifyMode,
  shouldJustifyLine,
} from "../text";
import { readPreparedText } from "../text/plain-core";
import { readPreparedInlineLayout, createRichSourceItems, getRichPreparedKey, walkPreparedLineRanges } from "../text/inline-engine";
import type { Box, Context, InlineSpan, MultilineTextOptions, Node, PhysicalTextAlign, TextOptions } from "../types";

type SingleLineLayout = TextLayout;
type MultiLineDrawLayout = {
  width: number;
  lines: TextLayout[];
};
type MultiLineMeasureLayout = TextMeasurement;

type TextLayoutCacheAccess<C extends CanvasRenderingContext2D> = {
  getTextLayout<T>(node: Node<C>, key: string): T | undefined;
  setTextLayout<T>(node: Node<C>, key: string, layout: T): void;
};

function resolvePhysicalTextAlign(
  options: Pick<MultilineTextOptions<any>, "align" | "physicalAlign">,
): PhysicalTextAlign {
  if (options.physicalAlign != null) {
    return options.physicalAlign;
  }
  if (options.align != null) {
    switch (options.align) {
      case "start":
        return "left";
      case "center":
        return "center";
      case "end":
        return "right";
    }
  }
  return "left";
}

function normalizeTextMaxWidth(maxWidth: number | undefined): number | undefined {
  if (maxWidth == null) {
    return undefined;
  }
  return Math.max(0, maxWidth);
}

function countSpaceChars(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0x20) count++;
  }
  return count;
}

const DEFAULT_TEXT_SPACING = {
  wordSpacing: "0px",
  letterSpacing: "0px",
} as const;

function supportsTextSpacing(g: CanvasRenderingContext2D): g is CanvasRenderingContext2D & {
  wordSpacing: string;
  letterSpacing: string;
} {
  return typeof (g as any).wordSpacing === "string" && typeof (g as any).letterSpacing === "string";
}

function withTextSpacing<C extends CanvasRenderingContext2D, T>(
  g: C,
  spacing: { wordSpacing: string; letterSpacing: string },
  cb: () => T,
): T {
  if (!supportsTextSpacing(g)) {
    return cb();
  }
  const savedWordSpacing = g.wordSpacing;
  const savedLetterSpacing = g.letterSpacing;
  try {
    g.wordSpacing = spacing.wordSpacing;
    g.letterSpacing = spacing.letterSpacing;
    return cb();
  } finally {
    g.wordSpacing = savedWordSpacing;
    g.letterSpacing = savedLetterSpacing;
  }
}

function getTextLayoutContext<C extends CanvasRenderingContext2D>(ctx: Context<C>): Context<C> & TextLayoutCacheAccess<C> {
  return ctx as Context<C> & TextLayoutCacheAccess<C>;
}

function readCachedTextLayout<C extends CanvasRenderingContext2D, T>(
  node: Node<C>,
  ctx: Context<C>,
  key: string,
  compute: () => T,
): T {
  const textCtx = getTextLayoutContext(ctx);
  const cached = textCtx.getTextLayout<T>(node, key);
  if (cached != null) {
    return cached;
  }
  const layout = compute();
  textCtx.setTextLayout(node, key, layout);
  return layout;
}

function getSingleLineLayoutKey(maxWidth: number | undefined): string {
  return maxWidth == null ? "single:intrinsic" : `single:${maxWidth}`;
}

function getMultiLineMeasureLayoutKey(maxWidth: number | undefined): string {
  return maxWidth == null ? "multi:measure:intrinsic" : `multi:measure:${maxWidth}`;
}

function getRichMultiLineMeasureLayoutKey(maxWidth: number | undefined): string {
  return maxWidth == null ? "rich:measure:intrinsic" : `rich:measure:${maxWidth}`;
}

function getMultiLineDrawLayoutKey(maxWidth: number | undefined): string {
  return maxWidth == null ? "multi:draw:intrinsic" : `multi:draw:${maxWidth}`;
}

function getRichMultiLineDrawLayoutKey(maxWidth: number | undefined): string {
  return maxWidth == null ? "rich:draw:intrinsic" : `rich:draw:${maxWidth}`;
}

function getMultiLineOverflowLayoutKey(maxWidth: number | undefined): string {
  return maxWidth == null ? "multi:overflow:intrinsic" : `multi:overflow:${maxWidth}`;
}

function getRichMultiLineOverflowLayoutKey(maxWidth: number | undefined): string {
  return maxWidth == null ? "rich:overflow:intrinsic" : `rich:overflow:${maxWidth}`;
}

function shouldUseMultilineOverflowLayout(options: Pick<MultilineTextOptions<any>, "maxLines">): boolean {
  return options.maxLines != null;
}

function shouldReadConstrainedOverflowLayout(
  maxWidth: number | undefined,
  options: Pick<MultilineTextOptions<any>, "maxLines">,
): maxWidth is number {
  return maxWidth != null && shouldUseMultilineOverflowLayout(options);
}

function measureBlockLayout<T extends { width: number; lines: ArrayLike<unknown> }>(layout: T): MultiLineMeasureLayout {
  return { width: layout.width, lineCount: layout.lines.length };
}

function getSingleLineMinContentLayoutKey(): string {
  return "single:min-content";
}

function getMultiLineMinContentLayoutKey(): string {
  return "multi:min-content";
}

function getRichMultiLineMinContentLayoutKey(): string {
  return "rich:min-content";
}

function getSingleLineLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  text: string,
  options: TextOptions<C>,
): SingleLineLayout {
  const maxWidth = normalizeTextMaxWidth(ctx.constraints?.maxWidth);
  return readCachedTextLayout(node, ctx, getSingleLineLayoutKey(maxWidth), () =>
    maxWidth == null
      ? layoutFirstLineIntrinsic(ctx, text, options.whiteSpace, options.wordBreak)
      : options.overflow === "ellipsis"
        ? layoutEllipsizedFirstLine(
            ctx,
            text,
            maxWidth,
            options.ellipsisPosition ?? "end",
            options.whiteSpace,
            options.wordBreak,
          )
        : layoutFirstLine(ctx, text, maxWidth, options.whiteSpace, options.wordBreak)
  );
}

function getRichSingleLineLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  options: TextOptions<C>,
): RichLineLayout {
  const maxWidth = normalizeTextMaxWidth(ctx.constraints?.maxWidth);
  return readCachedTextLayout(node, ctx, getSingleLineLayoutKey(maxWidth), () =>
    maxWidth == null
      ? layoutRichFirstLineIntrinsic(ctx, spans, options.font, options.color, options.whiteSpace, options.wordBreak)
      : options.overflow === "ellipsis"
        ? layoutRichEllipsizedFirstLine(
            ctx,
            spans,
            maxWidth,
            options.font,
            options.color,
            options.ellipsisPosition ?? "end",
            options.whiteSpace,
            options.wordBreak,
          )
        : layoutRichFirstLine(ctx, spans, maxWidth, options.font, options.color, options.whiteSpace, options.wordBreak)
  );
}

function getMultiLineOverflowLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  text: string,
  options: MultilineTextOptions<C>,
): MultiLineDrawLayout {
  const maxWidth = normalizeTextMaxWidth(ctx.constraints?.maxWidth);
  return readCachedTextLayout(node, ctx, getMultiLineOverflowLayoutKey(maxWidth), () =>
    layoutTextWithOverflow(ctx, text, maxWidth ?? 0, {
      whiteSpace: options.whiteSpace,
      wordBreak: options.wordBreak,
      overflow: options.overflow,
      maxLines: options.maxLines,
    })
  );
}

function getMultiLineMeasureLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  text: string,
  options: MultilineTextOptions<C>,
): MultiLineMeasureLayout {
  const maxWidth = normalizeTextMaxWidth(ctx.constraints?.maxWidth);
  if (shouldReadConstrainedOverflowLayout(maxWidth, options)) {
    return measureBlockLayout(getMultiLineOverflowLayout(node, ctx, text, options));
  }
  return readCachedTextLayout(node, ctx, getMultiLineMeasureLayoutKey(maxWidth), () =>
    maxWidth == null
      ? measureTextIntrinsic(ctx, text, options.whiteSpace, options.wordBreak)
      : measureText(ctx, text, maxWidth, options.whiteSpace, options.wordBreak)
  );
}

function getMultiLineDrawLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  text: string,
  options: MultilineTextOptions<C>,
): MultiLineDrawLayout {
  const maxWidth = normalizeTextMaxWidth(ctx.constraints?.maxWidth);
  if (shouldReadConstrainedOverflowLayout(maxWidth, options)) {
    return getMultiLineOverflowLayout(node, ctx, text, options);
  }
  return readCachedTextLayout(node, ctx, getMultiLineDrawLayoutKey(maxWidth), () =>
    maxWidth == null
      ? layoutTextIntrinsic(ctx, text, options.whiteSpace, options.wordBreak)
      : layoutText(ctx, text, maxWidth, options.whiteSpace, options.wordBreak)
  );
}

function getSingleLineMinContentLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  text: string,
  options: TextOptions<C>,
): SingleLineLayout {
  return readCachedTextLayout(node, ctx, getSingleLineMinContentLayoutKey(), () => {
    const measurement = measureTextMinContent(ctx, text, options.whiteSpace, options.wordBreak, options.overflowWrap);
    const { shift } = layoutFirstLineIntrinsic(ctx, text, options.whiteSpace, options.wordBreak);
    return {
      width: measurement.width,
      text,
      shift,
    };
  });
}

function getRichSingleLineMinContentWidth<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  options: TextOptions<C>,
): number {
  return readCachedTextLayout(node, ctx, getSingleLineMinContentLayoutKey(), () =>
    measureRichTextMinContent(ctx, spans, options.font, options.overflowWrap, options.whiteSpace, options.wordBreak).width
  );
}

function drawRichLine<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  line: RichLineLayout,
  fallbackColor: TextOptions<C>["color"],
  x: number,
  y: number,
  lineHeight: number,
): void {
  let cursorX = x;
  for (let fragmentIndex = 0; fragmentIndex < line.fragments.length; fragmentIndex += 1) {
    const fragment = line.fragments[fragmentIndex]!;
    cursorX += fragment.gapBefore;
    ctx.with((g) => {
      g.font = fragment.font;
      g.fillStyle = ctx.resolveDynValue((fragment.color ?? fallbackColor) as typeof fallbackColor);
      g.textAlign = "left";
      withTextSpacing(g, DEFAULT_TEXT_SPACING, () => {
        g.fillText(fragment.text, cursorX, y + (lineHeight + fragment.shift) / 2);
      });
    });
    cursorX += fragment.occupiedWidth;
  }
}

function getMultiLineMinContentLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  text: string,
  whiteSpace: MultilineTextOptions<C>["whiteSpace"],
  wordBreak: MultilineTextOptions<C>["wordBreak"],
  overflowWrap: MultilineTextOptions<C>["overflowWrap"],
): MultiLineMeasureLayout {
  return readCachedTextLayout(node, ctx, getMultiLineMinContentLayoutKey(), () =>
    measureTextMinContent(ctx, text, whiteSpace, wordBreak, overflowWrap)
  );
}

function getRichMultiLineMeasureLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  options: MultilineTextOptions<C>,
): RichMeasurement {
  const maxWidth = normalizeTextMaxWidth(ctx.constraints?.maxWidth);
  if (shouldReadConstrainedOverflowLayout(maxWidth, options)) {
    return measureBlockLayout(getRichMultiLineOverflowLayout(node, ctx, spans, options));
  }
  return readCachedTextLayout(node, ctx, getRichMultiLineMeasureLayoutKey(maxWidth), () =>
    maxWidth == null
      ? measureRichTextIntrinsic(ctx, spans, options.font, options.whiteSpace, options.wordBreak)
      : measureRichText(ctx, spans, maxWidth, options.font, options.whiteSpace, options.wordBreak)
  );
}

function getRichMultiLineOverflowLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  options: MultilineTextOptions<C>,
): RichBlockLayout {
  const maxWidth = normalizeTextMaxWidth(ctx.constraints?.maxWidth);
  return readCachedTextLayout(node, ctx, getRichMultiLineOverflowLayoutKey(maxWidth), () =>
    layoutRichTextWithOverflow(
      ctx,
      spans,
      maxWidth ?? 0,
      options.font,
      options.color,
      options.maxLines,
      options.overflow,
      options.whiteSpace,
      options.wordBreak,
    )
  );
}

function getRichMultiLineDrawLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  options: MultilineTextOptions<C>,
): RichBlockLayout {
  const maxWidth = normalizeTextMaxWidth(ctx.constraints?.maxWidth);
  if (shouldReadConstrainedOverflowLayout(maxWidth, options)) {
    return getRichMultiLineOverflowLayout(node, ctx, spans, options);
  }
  return readCachedTextLayout(node, ctx, getRichMultiLineDrawLayoutKey(maxWidth), () =>
    maxWidth == null
      ? layoutRichTextIntrinsic(ctx, spans, options.font, options.color, options.whiteSpace, options.wordBreak)
      : layoutRichText(ctx, spans, maxWidth, options.font, options.color, options.whiteSpace, options.wordBreak)
  );
}

function getRichMultiLineMinContentLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  spans: InlineSpan<C>[],
  options: MultilineTextOptions<C>,
): RichMeasurement {
  return readCachedTextLayout(node, ctx, getRichMultiLineMinContentLayoutKey(), () =>
    measureRichTextMinContent(ctx, spans, options.font, options.overflowWrap, options.whiteSpace, options.wordBreak)
  );
}

/**
 * Draws wrapped text using the configured line height and alignment.
 * Accepts either a plain string or an array of `InlineSpan` items for mixed inline styles.
 */
export class MultilineText<C extends CanvasRenderingContext2D> implements Node<C> {
  /**
   * @param text Source text to measure and draw. Pass an `InlineSpan[]` for mixed inline styles.
   * @param options Text layout and drawing options.
   */
  constructor(
    readonly text: string | InlineSpan<C>[],
    readonly options: MultilineTextOptions<C>,
  ) {}

  measure(ctx: Context<C>): Box {
    if (typeof this.text !== "string") {
      const spans = this.text;
      const { width, lineCount } = getRichMultiLineMeasureLayout(this, ctx, spans, this.options);
      return { width, height: lineCount * this.options.lineHeight };
    }
    return ctx.with((g) => {
      g.font = this.options.font;
      const { width, lineCount } = getMultiLineMeasureLayout(this, ctx, this.text as string, this.options);
      return { width, height: lineCount * this.options.lineHeight };
    });
  }

  measureMinContent(ctx: Context<C>): Box {
    if (typeof this.text !== "string") {
      const spans = this.text;
      const { width, lineCount } = getRichMultiLineMinContentLayout(this, ctx, spans, this.options);
      return { width, height: lineCount * this.options.lineHeight };
    }
    return ctx.with((g) => {
      g.font = this.options.font;
      const { width, lineCount } = getMultiLineMinContentLayout(
        this,
        ctx,
        this.text as string,
        this.options.whiteSpace,
        this.options.wordBreak,
        this.options.overflowWrap,
      );
      return { width, height: lineCount * this.options.lineHeight };
    });
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    if (typeof this.text !== "string") {
      const spans = this.text;
      const { width, lines } = getRichMultiLineDrawLayout(this, ctx, spans, this.options);
      const align = resolvePhysicalTextAlign(this.options);
      const maxWidth = normalizeTextMaxWidth(ctx.constraints?.maxWidth);
      const mode = resolveJustifyMode(this.options.justify);
      const canJustify = mode != null && maxWidth != null && maxWidth > 0 && isJustifySupported(ctx.graphics);
      const threshold = this.options.justifyGapThreshold ?? 2.0;

      if (canJustify) {
        const prepared = readPreparedInlineLayout(
          getRichPreparedKey(spans, this.options.font, this.options.whiteSpace ?? "normal", this.options.wordBreak ?? "normal"),
          createRichSourceItems(spans, this.options.font),
          this.options.whiteSpace ?? "normal",
          this.options.wordBreak ?? "normal",
        );
        let lineIndex = 0;
        const totalLines = lines.length;
        walkPreparedLineRanges(prepared, maxWidth, (lineRange) => {
          if (lineIndex >= totalLines) return false;
          const line = lines[lineIndex]!;
          const isLastLine = lineIndex === totalLines - 1;
          const isOverflowTruncated = isLastLine && shouldUseMultilineOverflowLayout(this.options)
            && this.options.overflow === "ellipsis";
          const wantJustify = !isOverflowTruncated
            && (!isLastLine || this.options.justifyLastLine === true);

          if (wantJustify) {
            const info = analyzeLineForJustify(prepared, lineRange);
            if (shouldJustifyLine(lineRange.width, maxWidth, info, mode, threshold)) {
              const spacing = computeJustifySpacing(lineRange.width, maxWidth, info, mode);
              const extraSpace = maxWidth - lineRange.width;
              const perGapSpacing = mode === "inter-word"
                ? (info.wordGapCount > 0 ? extraSpace / info.wordGapCount : 0)
                : (info.charCount > 0 ? extraSpace / info.charCount : 0);

              let cursorX = x;
              for (let fi = 0; fi < line.fragments.length; fi++) {
                const frag = line.fragments[fi]!;
                if (mode === "inter-word") {
                  // gapBefore is from space atoms; each non-zero gapBefore typically has 1 space
                  // but count actual space chars for correctness
                  const gapSpaces = frag.gapBefore > 0 ? 1 : 0;
                  cursorX += frag.gapBefore + gapSpaces * perGapSpacing;
                } else {
                  // inter-character: gapBefore also gets letterSpacing per char
                  cursorX += frag.gapBefore + (frag.gapBefore > 0 ? perGapSpacing : 0);
                }
                ctx.with((g) => {
                  g.font = frag.font;
                  g.fillStyle = ctx.resolveDynValue((frag.color ?? this.options.color) as typeof this.options.color);
                  g.textAlign = "left";
                  withTextSpacing(g, spacing, () => {
                    g.fillText(frag.text, cursorX, y + (this.options.lineHeight + frag.shift) / 2);
                  });
                });
                // Advance cursor: original width + extra spacing for spaces/chars in fragment text
                if (mode === "inter-word") {
                  cursorX += frag.occupiedWidth + countSpaceChars(frag.text) * perGapSpacing;
                } else {
                  // letterSpacing applies after every char including last
                  cursorX += frag.occupiedWidth + frag.text.length * perGapSpacing;
                }
              }
              y += this.options.lineHeight;
              lineIndex++;
              return;
            }
          }

          // Fallback: normal alignment
          const startX = align === "right" ? x + width : align === "center" ? x + width / 2 : x;
          let cursorX = startX;
          for (let fi = 0; fi < line.fragments.length; fi++) {
            const frag = line.fragments[fi]!;
            cursorX += frag.gapBefore;
            ctx.with((g) => {
              g.font = frag.font;
              g.fillStyle = ctx.resolveDynValue((frag.color ?? this.options.color) as typeof this.options.color);
              if (align === "right") {
                g.textAlign = "right";
              } else if (align === "center") {
                g.textAlign = "center";
              } else {
                g.textAlign = "left";
              }
              withTextSpacing(g, DEFAULT_TEXT_SPACING, () => {
                g.fillText(frag.text, cursorX, y + (this.options.lineHeight + frag.shift) / 2);
              });
            });
            cursorX += frag.occupiedWidth;
          }
          y += this.options.lineHeight;
          lineIndex++;
        });
      } else {
        const startX = align === "right" ? x + width : align === "center" ? x + width / 2 : x;
        for (const line of lines) {
          let cursorX = startX;
          for (let fi = 0; fi < line.fragments.length; fi++) {
            const frag = line.fragments[fi]!;
            cursorX += frag.gapBefore;
            ctx.with((g) => {
              g.font = frag.font;
              g.fillStyle = ctx.resolveDynValue((frag.color ?? this.options.color) as typeof this.options.color);
              if (align === "right") {
                g.textAlign = "right";
              } else if (align === "center") {
                g.textAlign = "center";
              } else {
                g.textAlign = "left";
              }
              withTextSpacing(g, DEFAULT_TEXT_SPACING, () => {
                g.fillText(frag.text, cursorX, y + (this.options.lineHeight + frag.shift) / 2);
              });
            });
            cursorX += frag.occupiedWidth;
          }
          y += this.options.lineHeight;
        }
      }
      return false;
    }
    return ctx.with((g) => {
      g.font = this.options.font;
      g.fillStyle = ctx.resolveDynValue(this.options.color);
      const { width, lines } = getMultiLineDrawLayout(this, ctx, this.text as string, this.options);
      const maxWidth = normalizeTextMaxWidth(ctx.constraints?.maxWidth);
      const mode = resolveJustifyMode(this.options.justify);
      const canJustify = mode != null && maxWidth != null && maxWidth > 0 && isJustifySupported(g);
      const threshold = this.options.justifyGapThreshold ?? 2.0;

      if (canJustify) {
        const prepared = readPreparedText(
          this.text as string,
          this.options.font,
          this.options.whiteSpace ?? "normal",
          this.options.wordBreak ?? "normal",
        );
        let lineIndex = 0;
        const totalLines = lines.length;
        walkPreparedLineRanges(prepared, maxWidth, (lineRange) => {
          if (lineIndex >= totalLines) return false;
          const layout = lines[lineIndex]!;
          const isLastLine = lineIndex === totalLines - 1;
          const isOverflowTruncated = isLastLine && shouldUseMultilineOverflowLayout(this.options)
            && this.options.overflow === "ellipsis";
          const wantJustify = !isOverflowTruncated
            && (!isLastLine || this.options.justifyLastLine === true);

          if (wantJustify) {
            const info = analyzeLineForJustify(prepared, lineRange);
            if (shouldJustifyLine(lineRange.width, maxWidth, info, mode, threshold)) {
              const spacing = computeJustifySpacing(lineRange.width, maxWidth, info, mode);
              withTextSpacing(g, spacing, () => {
                g.textAlign = "left";
                g.fillText(layout.text, x, y + (this.options.lineHeight + layout.shift) / 2);
              });
              y += this.options.lineHeight;
              lineIndex++;
              return;
            }
          }

          // Fallback to normal alignment for this line
          withTextSpacing(g, DEFAULT_TEXT_SPACING, () => {
            switch (resolvePhysicalTextAlign(this.options)) {
              case "left":
                g.textAlign = "left";
                g.fillText(layout.text, x, y + (this.options.lineHeight + layout.shift) / 2);
                break;
              case "right":
                g.textAlign = "right";
                g.fillText(layout.text, x + width, y + (this.options.lineHeight + layout.shift) / 2);
                break;
              case "center":
                g.textAlign = "center";
                g.fillText(layout.text, x + width / 2, y + (this.options.lineHeight + layout.shift) / 2);
                break;
            }
          });
          y += this.options.lineHeight;
          lineIndex++;
        });
      } else {
        withTextSpacing(g, DEFAULT_TEXT_SPACING, () => {
          switch (resolvePhysicalTextAlign(this.options)) {
            case "left":
              for (const { text, shift } of lines) {
                g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
                y += this.options.lineHeight;
              }
              break;
            case "right": {
              x += width;
              g.textAlign = "right";
              for (const { text, shift } of lines) {
                g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
                y += this.options.lineHeight;
              }
              break;
            }
            case "center": {
              x += width / 2;
              g.textAlign = "center";
              for (const { text, shift } of lines) {
                g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
                y += this.options.lineHeight;
              }
              break;
            }
          }
        });
      }
      return false;
    });
  }

  hittest(_ctx: Context<C>, _test: { x: number; y: number; type: "click" | "auxclick" | "hover" }): boolean {
    return false;
  }
}

/**
 * Draws a single line of text, clipped logically by measurement width.
 */
export class Text<C extends CanvasRenderingContext2D> implements Node<C> {
  /**
   * @param text Source text to measure and draw. Pass an `InlineSpan[]` for mixed inline styles.
   * @param options Text layout and drawing options.
   */
  constructor(
    readonly text: string | InlineSpan<C>[],
    readonly options: TextOptions<C>,
  ) {}

  measure(ctx: Context<C>): Box {
    if (typeof this.text !== "string") {
      const { width } = getRichSingleLineLayout(this, ctx, this.text, this.options);
      return { width, height: this.options.lineHeight };
    }
    const text = this.text;
    return ctx.with((g) => {
      g.font = this.options.font;
      const { width } = getSingleLineLayout(this, ctx, text, this.options);
      return { width, height: this.options.lineHeight };
    });
  }

  measureMinContent(ctx: Context<C>): Box {
    if (typeof this.text !== "string") {
      const width = getRichSingleLineMinContentWidth(this, ctx, this.text, this.options);
      return { width, height: this.options.lineHeight };
    }
    const text = this.text;
    return ctx.with((g) => {
      g.font = this.options.font;
      const { width } = getSingleLineMinContentLayout(this, ctx, text, this.options);
      return { width, height: this.options.lineHeight };
    });
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    if (typeof this.text !== "string") {
      const line = getRichSingleLineLayout(this, ctx, this.text, this.options);
      drawRichLine(ctx, line, this.options.color, x, y, this.options.lineHeight);
      return false;
    }
    const text = this.text;
    return ctx.with((g) => {
      g.font = this.options.font;
      g.fillStyle = ctx.resolveDynValue(this.options.color);
      const layout = getSingleLineLayout(this, ctx, text, this.options);
      withTextSpacing(g, DEFAULT_TEXT_SPACING, () => {
        g.fillText(layout.text, x, y + (this.options.lineHeight + layout.shift) / 2);
      });
      return false;
    });
  }

  hittest(_ctx: Context<C>, _test: { x: number; y: number; type: "click" | "auxclick" | "hover" }): boolean {
    return false;
  }
}
