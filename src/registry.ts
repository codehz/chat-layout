import type { Node } from "./types";

const registry = new WeakMap<Node<any>, Node<any>>();

export function registerNodeParent<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  parent: Node<C>,
): void {
  registry.set(node, parent);
}

export function unregisterNodeParent<C extends CanvasRenderingContext2D>(node: Node<C>): void {
  registry.delete(node);
}

export function getNodeParent<C extends CanvasRenderingContext2D>(node: Node<C>): Node<C> | undefined {
  return registry.get(node);
}
