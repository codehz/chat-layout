import type { Alignment, Box, Context, DynValue, HitTest, Node } from "./types";
import { layoutFirstLine, layoutText, type TextLayout } from "./text";
import { shallow, shallowMerge } from "./utils";
import { registerNodeParent, unregisterNodeParent } from "./registry";

export abstract class Group<C extends CanvasRenderingContext2D> implements Node<C> {
  constructor(readonly children: Node<C>[]) {
    for (const child of children) {
      registerNodeParent(child, this);
    }
  }

  abstract measure(ctx: Context<C>): Box;
  abstract draw(ctx: Context<C>, x: number, y: number): boolean;
  abstract hittest(ctx: Context<C>, test: HitTest): boolean;

  get flex(): boolean {
    return this.children.some((item) => item.flex);
  }
}

export class VStack<C extends CanvasRenderingContext2D> extends Group<C> {
  constructor(
    children: Node<C>[],
    readonly options: { gap?: number; alignment?: "left" | "center" | "right" } = {},
  ) {
    super(children);
  }

  measure(ctx: Context<C>): Box {
    let width = 0;
    let height = 0;
    if (this.options.alignment != null) {
      ctx.alignment = this.options.alignment;
    }

    for (const [index, child] of this.children.entries()) {
      if (this.options.gap != null && index !== 0) {
        height += this.options.gap;
      }
      const result = shallow(ctx).measureNode(child);
      height += result.height;
      width = Math.max(width, result.width);
    }
    ctx.remainingWidth -= width;
    return { width, height };
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    let result = false;
    const fullWidth = ctx.measureNode(this).width;
    const alignment = this.options.alignment ?? ctx.alignment;
    if (this.options.alignment != null) {
      ctx.alignment = this.options.alignment;
    }

    for (const [index, child] of this.children.entries()) {
      if (this.options.gap != null && index !== 0) {
        y += this.options.gap;
      }
      const { width, height } = shallow(ctx).measureNode(child);
      const curCtx = shallow(ctx);
      let requestRedraw: boolean;
      if (alignment === "right") {
        requestRedraw = child.draw(curCtx, x + fullWidth - width, y);
      } else if (alignment === "center") {
        requestRedraw = child.draw(curCtx, x + (fullWidth - width) / 2, y);
      } else {
        requestRedraw = child.draw(curCtx, x, y);
      }
      result ||= requestRedraw;
      y += height;
    }
    return result;
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    let y = 0;
    const fullWidth = ctx.measureNode(this).width;
    const alignment = this.options.alignment ?? ctx.alignment;
    if (this.options.alignment != null) {
      ctx.alignment = this.options.alignment;
    }

    for (const [index, child] of this.children.entries()) {
      if (this.options.gap != null && index !== 0) {
        y += this.options.gap;
      }

      const { width, height } = shallow(ctx).measureNode(child);
      const curCtx = shallow(ctx);
      if (test.y >= y && test.y < y + height) {
        let x: number;
        if (alignment === "right") {
          x = test.x - fullWidth + width;
        } else if (alignment === "center") {
          x = test.x - (fullWidth - width) / 2;
        } else {
          x = test.x;
        }
        if (x < 0 || x >= width) {
          return false;
        }
        return child.hittest(
          curCtx,
          shallowMerge(test, {
            x,
            y: test.y - y,
          }),
        );
      }
      y += height;
    }
    return false;
  }
}

export class HStack<C extends CanvasRenderingContext2D> extends Group<C> {
  constructor(
    readonly children: Node<C>[],
    readonly options: { reverse?: boolean; gap?: number } = {},
  ) {
    super(children);
  }

  measure(ctx: Context<C>): Box {
    let width = 0;
    let height = 0;
    let firstFlex: Node<C> | undefined;

    for (const [index, child] of this.children.entries()) {
      if (this.options.gap != null && index !== 0) {
        width += this.options.gap;
      }
      if (firstFlex == null && child.flex) {
        firstFlex = child;
        continue;
      }
      const curCtx = shallow(ctx);
      curCtx.remainingWidth = ctx.remainingWidth - width;
      const result = curCtx.measureNode(child);
      width += result.width;
      height = Math.max(height, result.height);
    }

    if (firstFlex != null) {
      const curCtx = shallow(ctx);
      curCtx.remainingWidth = ctx.remainingWidth - width;
      const result = curCtx.measureNode(firstFlex);
      width += result.width;
      height = Math.max(height, result.height);
    }

    return { width, height };
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    let result = false;
    const reverse = this.options.reverse ?? ctx.reverse;
    if (this.options.reverse) {
      ctx.reverse = this.options.reverse;
    }

    if (reverse) {
      x += ctx.measureNode(this).width;
      for (const [index, child] of this.children.entries()) {
        const gap = this.options.gap != null && index !== 0 ? this.options.gap : undefined;
        if (gap) {
          x -= gap;
          ctx.remainingWidth -= gap;
        }
        const { width } = shallow(ctx).measureNode(child);
        x -= width;
        const requestRedraw = child.draw(shallow(ctx), x, y);
        result ||= requestRedraw;
        ctx.remainingWidth -= width;
      }
    } else {
      for (const [index, child] of this.children.entries()) {
        const gap = this.options.gap != null && index !== 0 ? this.options.gap : undefined;
        if (gap) {
          x += gap;
          ctx.remainingWidth -= gap;
        }
        const requestRedraw = child.draw(shallow(ctx), x, y);
        result ||= requestRedraw;
        const { width } = shallow(ctx).measureNode(child);
        ctx.remainingWidth -= width;
        x += width;
      }
    }

    return result;
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    const reverse = this.options.reverse ?? ctx.reverse;
    if (this.options.reverse) {
      ctx.reverse = this.options.reverse;
    }

    if (reverse) {
      let x = ctx.measureNode(this).width;
      for (const [index, child] of this.children.entries()) {
        const gap = this.options.gap != null && index !== 0 ? this.options.gap : undefined;
        if (gap) {
          x -= gap;
          ctx.remainingWidth -= gap;
        }
        const { width, height } = shallow(ctx).measureNode(child);
        x -= width;
        if (x <= test.x && test.x < x + width) {
          if (test.y >= height) {
            return false;
          }
          return child.hittest(
            shallow(ctx),
            shallowMerge(test, {
              x: test.x - x,
            }),
          );
        }
        ctx.remainingWidth -= width;
      }
    } else {
      let x = 0;
      for (const [index, child] of this.children.entries()) {
        const gap = this.options.gap != null && index !== 0 ? this.options.gap : undefined;
        if (gap) {
          x += gap;
          ctx.remainingWidth -= gap;
        }
        const { width, height } = shallow(ctx).measureNode(child);
        if (x <= test.x && test.x < x + width) {
          if (test.y >= height) {
            return false;
          }
          return child.hittest(
            shallow(ctx),
            shallowMerge(test, {
              x: test.x - x,
            }),
          );
        }
        x += width;
        ctx.remainingWidth -= width;
      }
    }

    return false;
  }
}

export class Wrapper<C extends CanvasRenderingContext2D> implements Node<C> {
  #inner: Node<C>;

  constructor(inner: Node<C>) {
    this.#inner = inner;
    registerNodeParent(this.#inner, this);
  }

  get inner(): Node<C> {
    return this.#inner;
  }

  set inner(newNode: Node<C>) {
    if (newNode === this.#inner) {
      return;
    }
    unregisterNodeParent(this.#inner);
    this.#inner = newNode;
    registerNodeParent(newNode, this);
  }

  get flex(): boolean {
    return this.inner.flex;
  }

  measure(ctx: Context<C>): Box {
    return this.inner.measure(ctx);
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return this.inner.draw(ctx, x, y);
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    return this.inner.hittest(ctx, test);
  }
}

export class PaddingBox<C extends CanvasRenderingContext2D> extends Wrapper<C> {
  constructor(
    inner: Node<C>,
    readonly padding: {
      top?: number;
      bottom?: number;
      left?: number;
      right?: number;
    } = {},
  ) {
    super(inner);
  }

  get #top(): number {
    return this.padding.top ?? 0;
  }

  get #bottom(): number {
    return this.padding.bottom ?? 0;
  }

  get #left(): number {
    return this.padding.left ?? 0;
  }

  get #right(): number {
    return this.padding.right ?? 0;
  }

  measure(ctx: Context<C>): Box {
    ctx.remainingWidth -= this.#left + this.#right;
    const { width, height } = ctx.measureNode(this.inner);
    return {
      width: width + this.#left + this.#right,
      height: height + this.#top + this.#bottom,
    };
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    ctx.remainingWidth -= this.#left + this.#right;
    return this.inner.draw(ctx, x + this.#left, y + this.#top);
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    ctx.remainingWidth -= this.#left + this.#right;
    const { width, height } = shallow(ctx).measureNode(this.inner);
    if (0 <= test.x - this.#left && test.x - this.#left < width && 0 <= test.y - this.#top && test.y - this.#top < height) {
      return this.inner.hittest(
        shallow(ctx),
        shallowMerge(test, {
          x: test.x - this.#left,
          y: test.y - this.#top,
        }),
      );
    }
    return false;
  }
}

export class AlignBox<C extends CanvasRenderingContext2D> extends Wrapper<C> {
  #shift = 0;

  constructor(
    inner: Node<C>,
    readonly options: {
      alignment: Alignment;
    },
  ) {
    super(inner);
  }

  measure(ctx: Context<C>): Box {
    ctx.alignment = this.options.alignment;
    const { width, height } = ctx.measureNode(this.inner);
    switch (this.options.alignment) {
      case "center":
        this.#shift = (ctx.remainingWidth - width) / 2;
        break;
      case "right":
        this.#shift = ctx.remainingWidth - width;
        break;
      default:
        this.#shift = 0;
    }
    return {
      width: ctx.remainingWidth,
      height,
    };
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    ctx.alignment = this.options.alignment;
    return this.inner.draw(ctx, x + this.#shift, y);
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    ctx.alignment = this.options.alignment;
    const { width } = shallow(ctx).measureNode(this.inner);
    if (0 <= test.x - this.#shift && test.x - this.#shift < width) {
      return this.inner.hittest(
        shallow(ctx),
        shallowMerge(test, {
          x: test.x - this.#shift,
        }),
      );
    }
    return false;
  }
}

export class MultilineText<C extends CanvasRenderingContext2D> implements Node<C> {
  #width = 0;
  #lines: TextLayout[] = [];

  constructor(
    readonly text: string,
    readonly options: {
      lineHeight: number;
      font: string;
      alignment: "left" | "center" | "right";
      style: DynValue<C, string>;
    },
  ) {}

  get flex(): boolean {
    return true;
  }

  measure(ctx: Context<C>): Box {
    return ctx.with((g) => {
      g.font = this.options.font;
      const { width, lines } = layoutText(ctx, this.text, ctx.remainingWidth);
      this.#width = width;
      this.#lines = lines;
      return { width: this.#width, height: this.#lines.length * this.options.lineHeight };
    });
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return ctx.with((g) => {
      g.font = this.options.font;
      g.fillStyle = ctx.resolveDynValue(this.options.style);
      switch (this.options.alignment) {
        case "left":
          for (const { text, shift } of this.#lines) {
            g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
            y += this.options.lineHeight;
          }
          break;
        case "right":
          x += this.#width;
          g.textAlign = "right";
          for (const { text, shift } of this.#lines) {
            g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
            y += this.options.lineHeight;
          }
          break;
        case "center":
          x += this.#width / 2;
          g.textAlign = "center";
          for (const { text, shift } of this.#lines) {
            g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
            y += this.options.lineHeight;
          }
          break;
      }
      return false;
    });
  }

  hittest(_ctx: Context<C>, _test: HitTest): boolean {
    return false;
  }
}

export class Text<C extends CanvasRenderingContext2D> implements Node<C> {
  #width = 0;
  #text = "";
  #shift = 0;

  constructor(
    readonly text: string,
    readonly options: {
      lineHeight: number;
      font: string;
      style: DynValue<C, string>;
    },
  ) {}

  get flex(): boolean {
    return false;
  }

  measure(ctx: Context<C>): Box {
    return ctx.with((g) => {
      g.font = this.options.font;
      const { width, text, shift } = layoutFirstLine(ctx, this.text, ctx.remainingWidth);
      this.#width = width;
      this.#text = text;
      this.#shift = shift;
      return { width: this.#width, height: this.options.lineHeight };
    });
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return ctx.with((g) => {
      g.font = this.options.font;
      g.fillStyle = ctx.resolveDynValue(this.options.style);
      g.fillText(this.#text, x, y + (this.options.lineHeight + this.#shift) / 2);
      return false;
    });
  }

  hittest(_ctx: Context<C>, _test: HitTest): boolean {
    return false;
  }
}

export class Fixed<C extends CanvasRenderingContext2D> implements Node<C> {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  get flex(): boolean {
    return false;
  }

  measure(_ctx: Context<C>): Box {
    return { width: this.width, height: this.height };
  }

  draw(_ctx: Context<C>, _x: number, _y: number): boolean {
    return false;
  }

  hittest(_ctx: Context<C>, _test: HitTest): boolean {
    return false;
  }
}
