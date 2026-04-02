import { findChildAtPoint } from "../layout";
import type { Context, FlexLayoutResult, HitTest, LayoutConstraints, Node } from "../types";
import { shallow, shallowMerge } from "../utils";

type LayoutCacheAccess<C extends CanvasRenderingContext2D> = {
  getLayoutResult(node: Node<C>, constraints?: LayoutConstraints): FlexLayoutResult<C> | undefined;
  setLayoutResult(node: Node<C>, result: FlexLayoutResult<C>, constraints?: LayoutConstraints): void;
};

type LayoutContext<C extends CanvasRenderingContext2D> = Context<C> & LayoutCacheAccess<C>;

export function withConstraints<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  constraints: LayoutConstraints | undefined,
): Context<C> {
  const next = shallow(ctx);
  next.constraints = constraints;
  return next;
}

function getLayoutContext<C extends CanvasRenderingContext2D>(ctx: Context<C>): LayoutContext<C> {
  return ctx as LayoutContext<C>;
}

export function readLayoutResult<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
): FlexLayoutResult<C> | undefined {
  return getLayoutContext(ctx).getLayoutResult(node, ctx.constraints);
}

export function writeLayoutResult<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  result: FlexLayoutResult<C>,
): void {
  getLayoutContext(ctx).setLayoutResult(node, result, ctx.constraints);
}

function ensureLayoutResult<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
): FlexLayoutResult<C> | undefined {
  return readLayoutResult(node, ctx);
}

export function drawLayoutChildren<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  x: number,
  y: number,
): boolean {
  const layoutResult = ensureLayoutResult(node, ctx);
  if (!layoutResult) {
    return false;
  }

  let result = false;
  for (const childResult of layoutResult.children) {
    result ||= childResult.node.draw(
      withConstraints(ctx, childResult.constraints),
      x + childResult.contentBox.x,
      y + childResult.contentBox.y,
    );
  }
  return result;
}

export function hittestLayoutChildren<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  test: HitTest,
  box: "rect" | "contentBox" = "contentBox",
): boolean {
  const layoutResult = ensureLayoutResult(node, ctx);
  if (!layoutResult) {
    return false;
  }

  const hit = findChildAtPoint(layoutResult.children, test.x, test.y, box);
  if (!hit) {
    return false;
  }

  return hit.child.node.hittest(
    withConstraints(ctx, hit.child.constraints),
    shallowMerge(test, {
      x: hit.localX,
      y: hit.localY,
    }),
  );
}
