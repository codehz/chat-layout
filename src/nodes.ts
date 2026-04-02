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
      // 传递约束给子节点
      const childConstraints = ctx.constraints
        ? {
            ...ctx.constraints,
          }
        : undefined;
      const result = shallow(ctx).measureNode(child, childConstraints);
      height += result.height;
      width = Math.max(width, result.width);
    }
    // 不再修改 remainingWidth，改为设置约束
    if (ctx.constraints == null) {
      ctx.constraints = { maxWidth: width };
      ctx.remainingWidth = width;
    }
    return { width, height };
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    let result = false;
    const { width: fullWidth } = ctx.measureNode(this, ctx.constraints);
    const alignment = this.options.alignment ?? ctx.alignment;
    if (this.options.alignment != null) {
      ctx.alignment = this.options.alignment;
    }

    for (const [index, child] of this.children.entries()) {
      if (this.options.gap != null && index !== 0) {
        y += this.options.gap;
      }
      const childConstraints = ctx.constraints
        ? {
            ...ctx.constraints,
          }
        : undefined;
      const { width, height } = shallow(ctx).measureNode(child, childConstraints);
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
    const { width: fullWidth } = ctx.measureNode(this, ctx.constraints);
    const alignment = this.options.alignment ?? ctx.alignment;
    if (this.options.alignment != null) {
      ctx.alignment = this.options.alignment;
    }

    for (const [index, child] of this.children.entries()) {
      if (this.options.gap != null && index !== 0) {
        y += this.options.gap;
      }

      const childConstraints = ctx.constraints
        ? {
            ...ctx.constraints,
          }
        : undefined;
      const { width, height } = shallow(ctx).measureNode(child, childConstraints);
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
      // 传递约束给子节点
      const childConstraints = ctx.constraints
        ? {
            ...ctx.constraints,
            minWidth: ctx.constraints.minWidth != null ? ctx.constraints.minWidth - width : undefined,
            maxWidth: ctx.constraints.maxWidth != null ? ctx.constraints.maxWidth - width : undefined,
          }
        : undefined;
      const curCtx = shallow(ctx);
      if (childConstraints != null) {
        curCtx.constraints = childConstraints;
        if (childConstraints.maxWidth != null) {
          curCtx.remainingWidth = childConstraints.maxWidth;
        }
      }
      const result = curCtx.measureNode(child, childConstraints);
      width += result.width;
      height = Math.max(height, result.height);
    }

    if (firstFlex != null) {
      const childConstraints = ctx.constraints
        ? {
            ...ctx.constraints,
            minWidth: ctx.constraints.minWidth != null ? ctx.constraints.minWidth - width : undefined,
            maxWidth: ctx.constraints.maxWidth != null ? ctx.constraints.maxWidth - width : undefined,
          }
        : undefined;
      const curCtx = shallow(ctx);
      if (childConstraints != null) {
        curCtx.constraints = childConstraints;
        if (childConstraints.maxWidth != null) {
          curCtx.remainingWidth = childConstraints.maxWidth;
        }
      }
      const result = curCtx.measureNode(firstFlex, childConstraints);
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
      x += ctx.measureNode(this, ctx.constraints).width;
      for (const [index, child] of this.children.entries()) {
        const gap = this.options.gap != null && index !== 0 ? this.options.gap : undefined;
        if (gap) {
          x -= gap;
        }
        // 传递约束给子节点
        const childConstraints = ctx.constraints
          ? {
              ...ctx.constraints,
              minWidth: ctx.constraints.minWidth != null ? ctx.constraints.minWidth - (ctx.measureNode(this, ctx.constraints).width - x) : undefined,
              maxWidth: ctx.constraints.maxWidth != null ? ctx.constraints.maxWidth - (ctx.measureNode(this, ctx.constraints).width - x) : undefined,
            }
          : undefined;
        const curCtx = shallow(ctx);
        if (childConstraints != null) {
          curCtx.constraints = childConstraints;
          if (childConstraints.maxWidth != null) {
            curCtx.remainingWidth = childConstraints.maxWidth;
          }
        }
        const { width } = curCtx.measureNode(child, childConstraints);
        x -= width;
        const requestRedraw = child.draw(curCtx, x, y);
        result ||= requestRedraw;
      }
    } else {
      for (const [index, child] of this.children.entries()) {
        const gap = this.options.gap != null && index !== 0 ? this.options.gap : undefined;
        if (gap) {
          x += gap;
        }
        // 传递约束给子节点
        const childConstraints = ctx.constraints
          ? {
              ...ctx.constraints,
              minWidth: ctx.constraints.minWidth != null ? ctx.constraints.minWidth - x : undefined,
              maxWidth: ctx.constraints.maxWidth != null ? ctx.constraints.maxWidth - x : undefined,
            }
          : undefined;
        const curCtx = shallow(ctx);
        if (childConstraints != null) {
          curCtx.constraints = childConstraints;
          if (childConstraints.maxWidth != null) {
            curCtx.remainingWidth = childConstraints.maxWidth;
          }
        }
        const requestRedraw = child.draw(curCtx, x, y);
        result ||= requestRedraw;
        const { width } = curCtx.measureNode(child, childConstraints);
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
      let x = ctx.measureNode(this, ctx.constraints).width;
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
    const paddingLeft = this.#left;
    const paddingRight = this.#right;
    // 创建子节点的约束
    const childConstraints = ctx.constraints
      ? {
          ...ctx.constraints,
          minWidth: ctx.constraints.minWidth != null ? ctx.constraints.minWidth - paddingLeft - paddingRight : undefined,
          maxWidth: ctx.constraints.maxWidth != null ? ctx.constraints.maxWidth - paddingLeft - paddingRight : undefined,
        }
      : undefined;
    const { width, height } = ctx.measureNode(this.inner, childConstraints);
    return {
      width: width + paddingLeft + paddingRight,
      height: height + this.#top + this.#bottom,
    };
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    const paddingLeft = this.#left;
    const paddingRight = this.#right;
    // 创建子节点的约束
    const childConstraints = ctx.constraints
      ? {
          ...ctx.constraints,
          minWidth: ctx.constraints.minWidth != null ? ctx.constraints.minWidth - paddingLeft - paddingRight : undefined,
          maxWidth: ctx.constraints.maxWidth != null ? ctx.constraints.maxWidth - paddingLeft - paddingRight : undefined,
        }
      : undefined;
    // 在绘制时设置约束
    if (childConstraints != null) {
      ctx.constraints = childConstraints;
      if (childConstraints.maxWidth != null) {
        ctx.remainingWidth = childConstraints.maxWidth;
      }
    }
    return this.inner.draw(ctx, x + paddingLeft, y + this.#top);
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    const paddingLeft = this.#left;
    const paddingRight = this.#right;
    // 创建子节点的约束
    const childConstraints = ctx.constraints
      ? {
          ...ctx.constraints,
          minWidth: ctx.constraints.minWidth != null ? ctx.constraints.minWidth - paddingLeft - paddingRight : undefined,
          maxWidth: ctx.constraints.maxWidth != null ? ctx.constraints.maxWidth - paddingLeft - paddingRight : undefined,
        }
      : undefined;
    if (childConstraints != null) {
      ctx.constraints = childConstraints;
      if (childConstraints.maxWidth != null) {
        ctx.remainingWidth = childConstraints.maxWidth;
      }
    }
    const { width, height } = shallow(ctx).measureNode(this.inner, childConstraints);
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
    const { width, height } = ctx.measureNode(this.inner, ctx.constraints);
    return {
      width: ctx.constraints?.maxWidth ?? ctx.remainingWidth,
      height,
    };
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    ctx.alignment = this.options.alignment;
    const { width } = ctx.measureNode(this.inner, ctx.constraints);
    let shift = 0;
    const availableWidth = ctx.constraints?.maxWidth ?? ctx.remainingWidth;
    switch (this.options.alignment) {
      case "center":
        shift = (availableWidth - width) / 2;
        break;
      case "right":
        shift = availableWidth - width;
        break;
    }
    return this.inner.draw(ctx, x + shift, y);
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    ctx.alignment = this.options.alignment;
    const { width } = shallow(ctx).measureNode(this.inner, ctx.constraints);
    const availableWidth = ctx.constraints?.maxWidth ?? ctx.remainingWidth;
    let shift = 0;
    switch (this.options.alignment) {
      case "center":
        shift = (availableWidth - width) / 2;
        break;
      case "right":
        shift = availableWidth - width;
        break;
    }
    if (0 <= test.x - shift && test.x - shift < width) {
      return this.inner.hittest(
        shallow(ctx),
        shallowMerge(test, {
          x: test.x - shift,
        }),
      );
    }
    return false;
  }
}

export class MultilineText<C extends CanvasRenderingContext2D> implements Node<C> {
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
      // 优先使用约束中的 maxWidth，否则回退到 remainingWidth
      const maxWidth = ctx.constraints?.maxWidth ?? ctx.remainingWidth;
      const { width, lines } = layoutText(ctx, this.text, maxWidth);
      return { width, height: lines.length * this.options.lineHeight };
    });
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return ctx.with((g) => {
      g.font = this.options.font;
      g.fillStyle = ctx.resolveDynValue(this.options.style);
      const maxWidth = ctx.constraints?.maxWidth ?? ctx.remainingWidth;
      const { lines } = layoutText(ctx, this.text, maxWidth);
      switch (this.options.alignment) {
        case "left":
          for (const { text, shift } of lines) {
            g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
            y += this.options.lineHeight;
          }
          break;
        case "right":
          const rightWidth = Math.max(...lines.map(l => l.width));
          x += rightWidth;
          g.textAlign = "right";
          for (const { text, shift } of lines) {
            g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
            y += this.options.lineHeight;
          }
          break;
        case "center":
          const centerWidth = Math.max(...lines.map(l => l.width));
          x += centerWidth / 2;
          g.textAlign = "center";
          for (const { text, shift } of lines) {
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
      // 优先使用约束中的 maxWidth，否则回退到 remainingWidth
      const maxWidth = ctx.constraints?.maxWidth ?? ctx.remainingWidth;
      const { width, text, shift } = layoutFirstLine(ctx, this.text, maxWidth);
      return { width, height: this.options.lineHeight };
    });
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return ctx.with((g) => {
      g.font = this.options.font;
      g.fillStyle = ctx.resolveDynValue(this.options.style);
      const maxWidth = ctx.constraints?.maxWidth ?? ctx.remainingWidth;
      const { text, shift } = layoutFirstLine(ctx, this.text, maxWidth);
      g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
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
