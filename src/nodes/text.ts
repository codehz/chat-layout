import {
  layoutFirstLine,
  layoutFirstLineIntrinsic,
  layoutText,
  layoutTextIntrinsic,
  measureText,
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

function getSingleLineLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  text: string,
  whitespace: TextOptions<C>["whitespace"],
): SingleLineLayout {
  const maxWidth = normalizeTextMaxWidth(ctx.constraints?.maxWidth);
  return readCachedTextLayout(node, ctx, getSingleLineLayoutKey(maxWidth), () =>
    maxWidth == null ? layoutFirstLineIntrinsic(ctx, text, whitespace) : layoutFirstLine(ctx, text, maxWidth, whitespace)
  );
}

function getMultiLineMeasureLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  text: string,
  whitespace: MultilineTextOptions<C>["whitespace"],
): MultiLineMeasureLayout {
  const maxWidth = normalizeTextMaxWidth(ctx.constraints?.maxWidth);
  return readCachedTextLayout(node, ctx, getMultiLineMeasureLayoutKey(maxWidth), () =>
    maxWidth == null ? measureTextIntrinsic(ctx, text, whitespace) : measureText(ctx, text, maxWidth, whitespace)
  );
}

function getMultiLineDrawLayout<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  text: string,
  whitespace: MultilineTextOptions<C>["whitespace"],
): MultiLineDrawLayout {
  const maxWidth = normalizeTextMaxWidth(ctx.constraints?.maxWidth);
  return readCachedTextLayout(node, ctx, getMultiLineDrawLayoutKey(maxWidth), () =>
    maxWidth == null ? layoutTextIntrinsic(ctx, text, whitespace) : layoutText(ctx, text, maxWidth, whitespace)
  );
}

export class MultilineText<C extends CanvasRenderingContext2D> implements Node<C> {
  constructor(
    readonly text: string,
    readonly options: MultilineTextOptions<C>,
  ) {}

  measure(ctx: Context<C>): Box {
    return ctx.with((g) => {
      g.font = this.options.font;
      const { width, lineCount } = getMultiLineMeasureLayout(this, ctx, this.text, this.options.whitespace);
      return { width, height: lineCount * this.options.lineHeight };
    });
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return ctx.with((g) => {
      g.font = this.options.font;
      g.fillStyle = ctx.resolveDynValue(this.options.style);
      const { width, lines } = getMultiLineDrawLayout(this, ctx, this.text, this.options.whitespace);
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

export class Text<C extends CanvasRenderingContext2D> implements Node<C> {
  constructor(
    readonly text: string,
    readonly options: TextOptions<C>,
  ) {}

  measure(ctx: Context<C>): Box {
    return ctx.with((g) => {
      g.font = this.options.font;
      const { width } = getSingleLineLayout(this, ctx, this.text, this.options.whitespace);
      return { width, height: this.options.lineHeight };
    });
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return ctx.with((g) => {
      g.font = this.options.font;
      g.fillStyle = ctx.resolveDynValue(this.options.style);
      const { text, shift } = getSingleLineLayout(this, ctx, this.text, this.options.whitespace);
      g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
      return false;
    });
  }

  hittest(_ctx: Context<C>, _test: { x: number; y: number; type: "click" | "auxclick" | "hover" }): boolean {
    return false;
  }
}
