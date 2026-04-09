import { createRect, findChildAtPoint, getSingleChildLayout } from "../layout";
import type { Box, Context, HitTest, LayoutConstraints, Node } from "../types";
import { measureNodeMinContent, Wrapper } from "./base";
import { readLayoutResult, withConstraints, writeLayoutResult } from "./shared";

export interface ShrinkWrapOptions {
  tolerance?: number;
  preferredMinWidth?: number;
}

const DEFAULT_TOLERANCE = 0.5;
const HEIGHT_EPSILON = 1e-6;

type ShrinkwrapProbeResult = {
  maxWidth: number;
  box: Box;
};

function withMaxWidth(
  constraints: LayoutConstraints | undefined,
  maxWidth: number,
): LayoutConstraints {
  return {
    ...constraints,
    maxWidth,
  };
}

function computeShrinkwrapWidth(
  measure: (maxWidth: number) => Box,
  lowerBound: number,
  upperBound: number,
  referenceHeight: number,
  tolerance = DEFAULT_TOLERANCE,
): ShrinkwrapProbeResult {
  const minWidth = Math.min(lowerBound, upperBound);
  const maxWidth = Math.max(lowerBound, upperBound);
  const effectiveTolerance = Math.max(tolerance, HEIGHT_EPSILON);
  const lowerBoundBox = measure(minWidth);
  if (lowerBoundBox.height <= referenceHeight + HEIGHT_EPSILON) {
    return {
      maxWidth: minWidth,
      box: lowerBoundBox,
    };
  }

  let lo = minWidth;
  let hi = maxWidth;
  let hiBox = measure(maxWidth);

  while (hi - lo > effectiveTolerance) {
    const probeWidth = (lo + hi) / 2;
    const probeBox = measure(probeWidth);
    if (probeBox.height <= referenceHeight + HEIGHT_EPSILON) {
      hi = probeWidth;
      hiBox = probeBox;
      continue;
    }
    lo = probeWidth;
  }

  return {
    maxWidth: hi,
    box: hiBox,
  };
}

/**
 * Shrinks a single child to the narrowest width that does not increase its reference height.
 */
export class ShrinkWrap<C extends CanvasRenderingContext2D> extends Wrapper<C> {
  constructor(
    inner: Node<C>,
    readonly options: ShrinkWrapOptions = {},
  ) {
    super(inner);
  }

  measure(ctx: Context<C>): Box {
    const constraints = ctx.constraints;
    const availableWidth = constraints?.maxWidth;
    if (availableWidth == null) {
      const childConstraints = constraints == null ? undefined : { ...constraints };
      const childBox = ctx.measureNode(this.inner, childConstraints);
      this.#writeLayout(ctx, childBox, childConstraints);
      return childBox;
    }

    const boundedConstraints = constraints == null ? { maxWidth: availableWidth } : constraints;
    const referenceConstraints = { ...boundedConstraints };
    const referenceBox = ctx.measureNode(this.inner, referenceConstraints);
    let lowerBound = measureNodeMinContent(ctx, this.inner, boundedConstraints).width;
    const preferredMinWidth = this.options.preferredMinWidth == null
      ? undefined
      : Math.max(0, this.options.preferredMinWidth);
    if (preferredMinWidth != null && preferredMinWidth <= availableWidth) {
      lowerBound = Math.max(lowerBound, preferredMinWidth);
    }
    if (boundedConstraints.minWidth != null) {
      lowerBound = Math.max(lowerBound, boundedConstraints.minWidth);
    }
    if (lowerBound >= availableWidth) {
      this.#writeLayout(ctx, referenceBox, referenceConstraints);
      return referenceBox;
    }

    const finalProbe = computeShrinkwrapWidth(
      (maxWidth) => ctx.measureNode(this.inner, withMaxWidth(boundedConstraints, maxWidth)),
      lowerBound,
      availableWidth,
      referenceBox.height,
      this.options.tolerance ?? DEFAULT_TOLERANCE,
    );
    const finalConstraints = withMaxWidth(boundedConstraints, finalProbe.maxWidth);
    const finalBox = ctx.measureNode(this.inner, finalConstraints);
    this.#writeLayout(ctx, finalBox, finalConstraints);
    return finalBox;
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

  #writeLayout(ctx: Context<C>, childBox: Box, childConstraints: LayoutConstraints | undefined): void {
    const childRect = createRect(0, 0, childBox.width, childBox.height);
    writeLayoutResult(this, ctx, {
      containerBox: childRect,
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
  }
}
