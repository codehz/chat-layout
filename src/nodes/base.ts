import {
  attachNodeToParent,
  replaceNodeParent,
  replaceNodesParent,
} from "../internal/node-registry";
import type { Box, Context, HitTest, LayoutConstraints, Node } from "../types";
import { shallow } from "../utils";

export function withNodeConstraints<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  constraints: LayoutConstraints | undefined,
): Context<C> {
  if (constraints === ctx.constraints) {
    return ctx;
  }
  const next = shallow(ctx);
  next.constraints = constraints;
  return next;
}

export function measureNodeMinContent<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  node: Node<C>,
  constraints: LayoutConstraints | undefined = ctx.constraints,
): Box {
  const nextCtx = withNodeConstraints(ctx, constraints);
  if (node.measureMinContent != null) {
    return node.measureMinContent(nextCtx);
  }
  return node.measure(nextCtx);
}

/**
 * A node that owns an ordered list of child nodes.
 */
export abstract class Group<
  C extends CanvasRenderingContext2D,
> implements Node<C> {
  #children: Node<C>[];

  /**
   * @param children Initial child nodes, in layout order.
   */
  constructor(children: Node<C>[]) {
    this.#children = [...children];
    replaceNodesParent([], this.#children, this);
  }

  /** Child nodes managed by this group. */
  get children(): readonly Node<C>[] {
    return this.#children;
  }

  /**
   * Replaces the full child list while updating parent links.
   */
  replaceChildren(nextChildren: Node<C>[]): void {
    const nextSnapshot = [...nextChildren];
    replaceNodesParent(this.#children, nextSnapshot, this);
    this.#children = nextSnapshot;
  }

  abstract measure(ctx: Context<C>): Box;
  abstract draw(ctx: Context<C>, x: number, y: number): boolean;
  abstract hittest(ctx: Context<C>, test: HitTest): boolean;
}

/**
 * A node that forwards layout and drawing to a single inner node.
 */
export class Wrapper<C extends CanvasRenderingContext2D> implements Node<C> {
  #inner: Node<C>;

  /**
   * @param inner Wrapped child node.
   */
  constructor(inner: Node<C>) {
    this.#inner = inner;
    attachNodeToParent(this.#inner, this);
  }

  /** The wrapped child node. */
  get inner(): Node<C> {
    return this.#inner;
  }

  /** Replaces the wrapped child node. */
  set inner(newNode: Node<C>) {
    if (newNode === this.#inner) {
      return;
    }
    replaceNodeParent(this.#inner, newNode, this);
    this.#inner = newNode;
  }

  measure(ctx: Context<C>): Box {
    return this.inner.measure(ctx);
  }

  measureMinContent(ctx: Context<C>): Box {
    return measureNodeMinContent(ctx, this.inner);
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return this.inner.draw(ctx, x, y);
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    return this.inner.hittest(ctx, test);
  }
}
