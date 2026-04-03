import {
  layoutEllipsizedFirstLine,
  layoutFirstLine,
  layoutFirstLineIntrinsic,
  layoutText,
  layoutTextIntrinsic,
  layoutTextWithOverflow,
  measureText,
  measureTextMinContent,
  measureTextIntrinsic,
  type TextLayout,
  type TextMeasurement,
} from "../text";
import type { Box, Context, MultilineTextOptions, Node, PhysicalTextAlign, TextOptions } from "../types";

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

function getMultiLineDrawLayoutKey(maxWidth: number | undefined): string {
  return maxWidth == null ? "multi:draw:intrinsic" : `multi:draw:${maxWidth}`;
}

function getMultiLineOverflowLayoutKey(maxWidth: number | undefined): string {
  return maxWidth == null ? "multi:overflow:intrinsic" : `multi:overflow:${maxWidth}`;
}

function shouldUseMultilineOverflowLayout(options: Pick<MultilineTextOptions<any>, "maxLines">): boolean {
  return options.maxLines != null;
}

function getSingleLineMinContentLayoutKey(): string {
  return "single:min-content";
}

function getMultiLineMinContentLayoutKey(): string {
  return "multi:min-content";
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
      ? layoutFirstLineIntrinsic(ctx, text, options.whitespace)
      : options.overflow === "ellipsis"
        ? layoutEllipsizedFirstLine(ctx, text, maxWidth, options.ellipsisPosition ?? "end", options.whitespace)
        : layoutFirstLine(ctx, text, maxWidth, options.whitespace)
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
      whitespace: options.whitespace,
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
  if (maxWidth != null && shouldUseMultilineOverflowLayout(options)) {
    const layout = getMultiLineOverflowLayout(node, ctx, text, options);
    return { width: layout.width, lineCount: layout.lines.length };
  }
  return readCachedTextLayout(node, ctx, getMultiLineMeasureLayoutKey(maxWidth), () =>
    maxWidth == null ? measureTextIntrinsic(ctx, text, options.whitespace) : measureText(ctx, text, maxWidth, options.whitespace)
  );
}

function getMultiLineDrawLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  text: string,
  options: MultilineTextOptions<C>,
): MultiLineDrawLayout {
  const maxWidth = normalizeTextMaxWidth(ctx.constraints?.maxWidth);
  if (maxWidth != null && shouldUseMultilineOverflowLayout(options)) {
    return getMultiLineOverflowLayout(node, ctx, text, options);
  }
  return readCachedTextLayout(node, ctx, getMultiLineDrawLayoutKey(maxWidth), () =>
    maxWidth == null ? layoutTextIntrinsic(ctx, text, options.whitespace) : layoutText(ctx, text, maxWidth, options.whitespace)
  );
}

function getSingleLineMinContentLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  text: string,
  options: TextOptions<C>,
): SingleLineLayout {
  return readCachedTextLayout(node, ctx, getSingleLineMinContentLayoutKey(), () =>
    layoutFirstLineIntrinsic(ctx, text, options.whitespace)
  );
}

function getMultiLineMinContentLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  text: string,
  whitespace: MultilineTextOptions<C>["whitespace"],
): MultiLineMeasureLayout {
  return readCachedTextLayout(node, ctx, getMultiLineMinContentLayoutKey(), () =>
    measureTextMinContent(ctx, text, whitespace)
  );
}

/**
 * Draws wrapped text using the configured line height and alignment.
 */
export class MultilineText<C extends CanvasRenderingContext2D> implements Node<C> {
  /**
   * @param text Source text to measure and draw.
   * @param options Text layout and drawing options.
   */
  constructor(
    readonly text: string,
    readonly options: MultilineTextOptions<C>,
  ) {}

  measure(ctx: Context<C>): Box {
    return ctx.with((g) => {
      g.font = this.options.font;
      const { width, lineCount } = getMultiLineMeasureLayout(this, ctx, this.text, this.options);
      return { width, height: lineCount * this.options.lineHeight };
    });
  }

  measureMinContent(ctx: Context<C>): Box {
    return ctx.with((g) => {
      g.font = this.options.font;
      const { width, lineCount } = getMultiLineMinContentLayout(this, ctx, this.text, this.options.whitespace);
      return { width, height: lineCount * this.options.lineHeight };
    });
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return ctx.with((g) => {
      g.font = this.options.font;
      g.fillStyle = ctx.resolveDynValue(this.options.style);
      const { width, lines } = getMultiLineDrawLayout(this, ctx, this.text, this.options);
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
   * @param text Source text to measure and draw.
   * @param options Text layout and drawing options.
   */
  constructor(
    readonly text: string,
    readonly options: TextOptions<C>,
  ) {}

  measure(ctx: Context<C>): Box {
    return ctx.with((g) => {
      g.font = this.options.font;
      const { width } = getSingleLineLayout(this, ctx, this.text, this.options);
      return { width, height: this.options.lineHeight };
    });
  }

  measureMinContent(ctx: Context<C>): Box {
    return ctx.with((g) => {
      g.font = this.options.font;
      const { width } = getSingleLineMinContentLayout(this, ctx, this.text, this.options);
      return { width, height: this.options.lineHeight };
    });
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return ctx.with((g) => {
      g.font = this.options.font;
      g.fillStyle = ctx.resolveDynValue(this.options.style);
      const { text, shift } = getSingleLineLayout(this, ctx, this.text, this.options);
      g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
      return false;
    });
  }

  hittest(_ctx: Context<C>, _test: { x: number; y: number; type: "click" | "auxclick" | "hover" }): boolean {
    return false;
  }
}
