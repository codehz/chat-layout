import type { Node } from "./types";

const registry = new WeakMap<Node<any>, Node<any>>();

export function registerNodeParent<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  parent: Node<C>,
): void {
  if (registry.has(node)) {
    throw new Error("A node can only be attached to one parent. Shared nodes are not supported.");
  }
  registry.set(node, parent);
}

export function unregisterNodeParent<C extends CanvasRenderingContext2D>(node: Node<C>): void {
  registry.delete(node);
}

export function getNodeParent<C extends CanvasRenderingContext2D>(node: Node<C>): Node<C> | undefined {
  return registry.get(node);
}
