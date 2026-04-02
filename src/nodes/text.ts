import { layoutFirstLine, layoutFirstLineIntrinsic, layoutText, layoutTextIntrinsic } from "../text";
import type { Box, Context, MultilineTextOptions, Node, PhysicalTextAlign, TextOptions } from "../types";

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

export class MultilineText<C extends CanvasRenderingContext2D> implements Node<C> {
  constructor(
    readonly text: string,
    readonly options: MultilineTextOptions<C>,
  ) {}

  measure(ctx: Context<C>): Box {
    return ctx.with((g) => {
      g.font = this.options.font;
      const maxWidth = ctx.constraints?.maxWidth;
      const { width, lines } = maxWidth == null
        ? layoutTextIntrinsic(ctx, this.text, this.options.whitespace)
        : layoutText(ctx, this.text, maxWidth, this.options.whitespace);
      return { width, height: lines.length * this.options.lineHeight };
    });
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return ctx.with((g) => {
      g.font = this.options.font;
      g.fillStyle = ctx.resolveDynValue(this.options.style);
      const maxWidth = ctx.constraints?.maxWidth;
      const { lines } = maxWidth == null
        ? layoutTextIntrinsic(ctx, this.text, this.options.whitespace)
        : layoutText(ctx, this.text, maxWidth, this.options.whitespace);
      switch (resolvePhysicalTextAlign(this.options)) {
        case "left":
          for (const { text, shift } of lines) {
            g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
            y += this.options.lineHeight;
          }
          break;
        case "right": {
          const rightWidth = Math.max(...lines.map((line) => line.width));
          x += rightWidth;
          g.textAlign = "right";
          for (const { text, shift } of lines) {
            g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
            y += this.options.lineHeight;
          }
          break;
        }
        case "center": {
          const centerWidth = Math.max(...lines.map((line) => line.width));
          x += centerWidth / 2;
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
      const maxWidth = ctx.constraints?.maxWidth;
      const { width } = maxWidth == null
        ? layoutFirstLineIntrinsic(ctx, this.text, this.options.whitespace)
        : layoutFirstLine(ctx, this.text, maxWidth, this.options.whitespace);
      return { width, height: this.options.lineHeight };
    });
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return ctx.with((g) => {
      g.font = this.options.font;
      g.fillStyle = ctx.resolveDynValue(this.options.style);
      const maxWidth = ctx.constraints?.maxWidth;
      const { text, shift } = maxWidth == null
        ? layoutFirstLineIntrinsic(ctx, this.text, this.options.whitespace)
        : layoutFirstLine(ctx, this.text, maxWidth, this.options.whitespace);
      g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
      return false;
    });
  }

  hittest(_ctx: Context<C>, _test: { x: number; y: number; type: "click" | "auxclick" | "hover" }): boolean {
    return false;
  }
}
