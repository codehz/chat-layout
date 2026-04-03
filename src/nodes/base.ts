import { attachNodeToParent, replaceNodeParent, replaceNodesParent } from "../internal/node-registry";
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

export abstract class Group<C extends CanvasRenderingContext2D> implements Node<C> {
  #children: Node<C>[];

  constructor(children: Node<C>[]) {
    this.#children = [...children];
    replaceNodesParent([], this.#children, this);
  }

  get children(): readonly Node<C>[] {
    return this.#children;
  }

  replaceChildren(nextChildren: Node<C>[]): void {
    const nextSnapshot = [...nextChildren];
    replaceNodesParent(this.#children, nextSnapshot, this);
    this.#children = nextSnapshot;
  }

  abstract measure(ctx: Context<C>): Box;
  abstract draw(ctx: Context<C>, x: number, y: number): boolean;
  abstract hittest(ctx: Context<C>, test: HitTest): boolean;
}

export class Wrapper<C extends CanvasRenderingContext2D> implements Node<C> {
  #inner: Node<C>;

  constructor(inner: Node<C>) {
    this.#inner = inner;
    attachNodeToParent(this.#inner, this);
  }

  get inner(): Node<C> {
    return this.#inner;
  }

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
