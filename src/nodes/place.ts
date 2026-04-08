import { createRect, findChildAtPoint, getSingleChildLayout } from "../layout";
import type { Box, Context, HitTest, Node, TextAlign } from "../types";
import { measureNodeMinContent, Wrapper } from "./base";
import { readLayoutResult, withConstraints, writeLayoutResult } from "./shared";

function resolveHorizontalOffset(align: TextAlign, availableWidth: number, childWidth: number): number {
  switch (align) {
    case "center":
      return (availableWidth - childWidth) / 2;
    case "end":
      return availableWidth - childWidth;
    case "start":
      return 0;
  }
}

/**
 * Aligns a single child horizontally within the available width.
 */
export class Place<C extends CanvasRenderingContext2D> extends Wrapper<C> {
  /**
   * @param inner Wrapped child node.
   * @param options Alignment behavior for the child.
   */
  constructor(
    inner: Node<C>,
    readonly options: {
      align?: TextAlign;
      expand?: boolean;
    } = {},
  ) {
    super(inner);
  }

  measure(ctx: Context<C>): Box {
    const availableWidth = ctx.constraints?.maxWidth;
    const expand = this.options.expand ?? true;
    const childConstraints = ctx.constraints
      ? {
          ...ctx.constraints,
        }
      : undefined;
    const childBox = ctx.measureNode(this.inner, childConstraints);
    let width = expand && availableWidth != null ? availableWidth : childBox.width;
    if (ctx.constraints?.minWidth != null) {
      width = Math.max(width, ctx.constraints.minWidth);
    }
    if (ctx.constraints?.maxWidth != null) {
      width = Math.min(width, ctx.constraints.maxWidth);
    }

    const align = this.options.align ?? "start";
    const childRect = createRect(resolveHorizontalOffset(align, width, childBox.width), 0, childBox.width, childBox.height);

    writeLayoutResult(this, ctx, {
      containerBox: createRect(0, 0, width, childBox.height),
      contentBox: childRect,
      children: [
        {
          node: this.inner,
          rect: childRect,
          contentBox: createRect(0, 0, childBox.width, childBox.height),
          constraints: childConstraints,
        },
      ],
      constraints: ctx.constraints,
    });

    return {
      width,
      height: childBox.height,
    };
  }

  measureMinContent(ctx: Context<C>): Box {
    return measureNodeMinContent(ctx, this.inner);
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    const layoutResult = readLayoutResult(this, ctx);
    if (!layoutResult) {
      return this.inner.draw(ctx, x, y);
    }

    const childResult = getSingleChildLayout(layoutResult);
    if (!childResult) {
      return false;
    }
    const childCtx = withConstraints(ctx, childResult.constraints);
    return childResult.node.draw(childCtx, x + childResult.rect.x, y + childResult.rect.y);
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
