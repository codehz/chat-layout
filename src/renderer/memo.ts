import type { Node } from "../types";

function isWeakMapKey(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

export function memoRenderItem<C extends CanvasRenderingContext2D, T extends object>(
  renderItem: (item: T) => Node<C>,
): ((item: T) => Node<C>) & { reset: (key: T) => boolean } {
  const cache = new WeakMap<object, Node<C>>();

  function fn(item: T): Node<C> {
    if (!isWeakMapKey(item)) {
      throw new TypeError("memoRenderItem() only supports object items. Use memoRenderItemBy() for primitive keys.");
    }
    const key = item as unknown as object;
    const cached = cache.get(key);
    if (cached != null) {
      return cached;
    }
    const result = renderItem(item);
    cache.set(key, result);
    return result;
  }

  return Object.assign(fn, {
    reset: (key: T) => cache.delete(key as unknown as object),
  });
}

export function memoRenderItemBy<C extends CanvasRenderingContext2D, T, K>(
  keyOf: (item: T) => K,
  renderItem: (item: T) => Node<C>,
): ((item: T) => Node<C>) & { reset: (item: T) => boolean; resetKey: (key: K) => boolean } {
  const cache = new Map<K, Node<C>>();

  function fn(item: T): Node<C> {
    const key = keyOf(item);
    const cached = cache.get(key);
    if (cached != null) {
      return cached;
    }
    const result = renderItem(item);
    cache.set(key, result);
    return result;
  }

  return Object.assign(fn, {
    reset: (item: T) => cache.delete(keyOf(item)),
    resetKey: (key: K) => cache.delete(key),
  });
}
