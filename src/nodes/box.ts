import { createRect, findChildAtPoint, getSingleChildLayout } from "../layout";
import type { Box, Context, HitTest, Node } from "../types";
import { measureNodeMinContent } from "./base";
import { Wrapper } from "./base";
import { readLayoutResult, withConstraints, writeLayoutResult } from "./shared";

function clampToConstraints(value: number, min?: number, max?: number): number {
  let result = value;
  if (min != null) {
    result = Math.max(result, min);
  }
  if (max != null) {
    result = Math.min(result, max);
  }
  return result;
}

function shrinkConstraint(value: number | undefined, padding: number): number | undefined {
  if (value == null) {
    return undefined;
  }
  return Math.max(0, value - padding);
}

/**
 * Adds padding around a single child node.
 */
export class PaddingBox<C extends CanvasRenderingContext2D> extends Wrapper<C> {
  /**
   * @param inner Wrapped child node.
   * @param padding Padding in CSS pixels on each side.
   */
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
    const paddingTop = this.#top;
    const paddingBottom = this.#bottom;
    const horizontalPadding = paddingLeft + paddingRight;
    const verticalPadding = paddingTop + paddingBottom;
    const childConstraints = ctx.constraints
      ? {
          ...ctx.constraints,
          minWidth: shrinkConstraint(ctx.constraints.minWidth, horizontalPadding),
          maxWidth: shrinkConstraint(ctx.constraints.maxWidth, horizontalPadding),
          minHeight: shrinkConstraint(ctx.constraints.minHeight, verticalPadding),
          maxHeight: shrinkConstraint(ctx.constraints.maxHeight, verticalPadding),
        }
      : undefined;
    const { width, height } = ctx.measureNode(this.inner, childConstraints);
    const containerBox = createRect(
      0,
      0,
      clampToConstraints(width + horizontalPadding, ctx.constraints?.minWidth, ctx.constraints?.maxWidth),
      clampToConstraints(height + verticalPadding, ctx.constraints?.minHeight, ctx.constraints?.maxHeight),
    );
    const childRect = createRect(paddingLeft, paddingTop, width, height);
    writeLayoutResult(this, ctx, {
      containerBox,
      contentBox: childRect,
      children: [
        {
          node: this.inner,
          rect: childRect,
          contentBox: childRect,
          constraints: childConstraints,
        },
      ],
      constraints: ctx.constraints,
    });
    return {
      width: containerBox.width,
      height: containerBox.height,
    };
  }

  measureMinContent(ctx: Context<C>): Box {
    const paddingLeft = this.#left;
    const paddingRight = this.#right;
    const paddingTop = this.#top;
    const paddingBottom = this.#bottom;
    const horizontalPadding = paddingLeft + paddingRight;
    const verticalPadding = paddingTop + paddingBottom;
    const childConstraints = ctx.constraints
      ? {
          ...ctx.constraints,
          minWidth: shrinkConstraint(ctx.constraints.minWidth, horizontalPadding),
          maxWidth: shrinkConstraint(ctx.constraints.maxWidth, horizontalPadding),
          minHeight: shrinkConstraint(ctx.constraints.minHeight, verticalPadding),
          maxHeight: shrinkConstraint(ctx.constraints.maxHeight, verticalPadding),
        }
      : undefined;
    const { width, height } = measureNodeMinContent(ctx, this.inner, childConstraints);
    return {
      width: width + horizontalPadding,
      height: height + verticalPadding,
    };
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    const layoutResult = readLayoutResult(this, ctx);
    if (!layoutResult) {
      return this.inner.draw(ctx, x + this.#left, y + this.#top);
    }

    const childResult = getSingleChildLayout(layoutResult);
    if (!childResult) {
      return false;
    }

    return childResult.node.draw(
      withConstraints(ctx, childResult.constraints),
      x + childResult.rect.x,
      y + childResult.rect.y,
    );
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    const layoutResult = readLayoutResult(this, ctx);
    if (!layoutResult) {
      return false;
    }

    const hit = findChildAtPoint(layoutResult.children, test.x, test.y, "rect");
    if (!hit) {
      return false;
    }

    return hit.child.node.hittest(
      withConstraints(ctx, hit.child.constraints),
      {
        ...test,
        x: hit.localX,
        y: hit.localY,
      },
    );
  }
}

/**
 * A leaf node with a fixed size and no drawing behavior.
 */
export class Fixed<C extends CanvasRenderingContext2D> implements Node<C> {
  /**
   * @param width Fixed width in CSS pixels.
   * @param height Fixed height in CSS pixels.
   */
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  measure(_ctx: Context<C>): Box {
    return { width: this.width, height: this.height };
  }

  measureMinContent(_ctx: Context<C>): Box {
    return { width: this.width, height: this.height };
  }

  draw(_ctx: Context<C>, _x: number, _y: number): boolean {
    return false;
  }

  hittest(_ctx: Context<C>, _test: HitTest): boolean {
    return false;
  }
}
