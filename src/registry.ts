import type { Node } from "./types";

const registry = new WeakMap<Node<any>, Node<any>>();
const revisions = new WeakMap<Node<any>, number>();

function getOwnershipError(): Error {
  return new Error("A node can only be attached to one parent. Shared nodes are not supported.");
}

function getDetachOwnershipError(): Error {
  return new Error("Cannot detach or replace a node from a parent that does not own it.");
}

function bumpRevision(node: Node<any>): void {
  revisions.set(node, (revisions.get(node) ?? 0) + 1);
}

export function getNodeRevision<C extends CanvasRenderingContext2D>(node: Node<C>): number {
  return revisions.get(node) ?? 0;
}

export function attachNodeToParent<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  parent: Node<C>,
): void {
  if (registry.has(node)) {
    throw getOwnershipError();
  }
  registry.set(node, parent);
  bumpRevision(parent);
}

export function attachNodesToParent<C extends CanvasRenderingContext2D>(
  nodes: Iterable<Node<C>>,
  parent: Node<C>,
): void {
  for (const node of nodes) {
    attachNodeToParent(node, parent);
  }
}

export function detachNodeFromParent<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  parent?: Node<C>,
): void {
  const currentParent = registry.get(node);
  if (currentParent == null) {
    return;
  }
  if (parent != null && currentParent !== parent) {
    throw getDetachOwnershipError();
  }
  registry.delete(node);
  bumpRevision(currentParent);
}

export function replaceNodeParent<C extends CanvasRenderingContext2D>(
  previousNode: Node<C>,
  nextNode: Node<C>,
  parent: Node<C>,
): void {
  if (previousNode === nextNode) {
    return;
  }
  const currentParent = registry.get(previousNode);
  if (currentParent !== parent) {
    throw getDetachOwnershipError();
  }
  if (registry.has(nextNode)) {
    throw getOwnershipError();
  }
  registry.delete(previousNode);
  registry.set(nextNode, parent);
  bumpRevision(parent);
}

export function replaceNodesParent<C extends CanvasRenderingContext2D>(
  previousNodes: Iterable<Node<C>>,
  nextNodes: Iterable<Node<C>>,
  parent: Node<C>,
): void {
  const previousSnapshot = Array.from(previousNodes);
  const nextSnapshot = Array.from(nextNodes);
  if (
    previousSnapshot.length === nextSnapshot.length &&
    previousSnapshot.every((node, index) => node === nextSnapshot[index])
  ) {
    return;
  }

  const previousSet = new Set(previousSnapshot);
  const nextSet = new Set<Node<C>>();
  for (const node of nextSnapshot) {
    if (nextSet.has(node)) {
      throw getOwnershipError();
    }
    nextSet.add(node);
    const currentParent = registry.get(node);
    if (currentParent != null && currentParent !== parent) {
      throw getOwnershipError();
    }
  }

  for (const node of previousSnapshot) {
    if (!nextSet.has(node)) {
      const currentParent = registry.get(node);
      if (currentParent !== parent) {
        throw getDetachOwnershipError();
      }
      registry.delete(node);
    }
  }

  for (const node of nextSnapshot) {
    if (!previousSet.has(node)) {
      registry.set(node, parent);
    }
  }

  bumpRevision(parent);
}

export function forEachNodeAncestor<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  visitor: (ancestor: Node<C>) => void,
): void {
  let current: Node<C> | undefined = node;
  while ((current = registry.get(current))) {
    visitor(current);
  }
}

export function registerNodeParent<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  parent: Node<C>,
): void {
  attachNodeToParent(node, parent);
}

export function unregisterNodeParent<C extends CanvasRenderingContext2D>(node: Node<C>, parent?: Node<C>): void {
  detachNodeFromParent(node, parent);
}

export function getNodeParent<C extends CanvasRenderingContext2D>(node: Node<C>): Node<C> | undefined {
  return registry.get(node);
}
