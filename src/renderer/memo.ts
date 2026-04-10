import type { Node } from "../types";

const DEFAULT_MEMO_RENDER_ITEM_BY_MAX_ENTRIES = 512;

function isWeakMapKey(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

function normalizeMaxEntries(maxEntries: number | undefined): number {
  if (maxEntries === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  if (maxEntries == null || !Number.isFinite(maxEntries)) {
    return DEFAULT_MEMO_RENDER_ITEM_BY_MAX_ENTRIES;
  }
  return Math.max(0, Math.trunc(maxEntries));
}

function readLruValue<K, V>(cache: Map<K, V>, key: K): V | undefined {
  const cached = cache.get(key);
  if (cached == null) {
    return undefined;
  }
  cache.delete(key);
  cache.set(key, cached);
  return cached;
}

function writeLruValue<K, V>(
  cache: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number,
): V {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (Number.isFinite(maxEntries) && cache.size >= maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey != null) {
      cache.delete(oldestKey);
    }
  }
  if (maxEntries > 0) {
    cache.set(key, value);
  }
  return value;
}

/**
 * Memoizes `renderItem` by object identity.
 */
export function memoRenderItem<
  C extends CanvasRenderingContext2D,
  T extends object,
>(
  renderItem: (item: T) => Node<C>,
): ((item: T) => Node<C>) & { reset: (key: T) => boolean } {
  const cache = new WeakMap<object, Node<C>>();

  function fn(item: T): Node<C> {
    if (!isWeakMapKey(item)) {
      throw new TypeError(
        "memoRenderItem() only supports object items. Use memoRenderItemBy() for primitive keys.",
      );
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

/**
 * Memoizes `renderItem` by a caller-provided cache key.
 */
export function memoRenderItemBy<C extends CanvasRenderingContext2D, T, K>(
  keyOf: (item: T) => K,
  renderItem: (item: T) => Node<C>,
  options: {
    maxEntries?: number;
  } = {},
): ((item: T) => Node<C>) & {
  reset: (item: T) => boolean;
  resetKey: (key: K) => boolean;
} {
  const cache = new Map<K, Node<C>>();
  const maxEntries = normalizeMaxEntries(options.maxEntries);

  function fn(item: T): Node<C> {
    const key = keyOf(item);
    const cached = readLruValue(cache, key);
    if (cached != null) {
      return cached;
    }
    const result = renderItem(item);
    return writeLruValue(cache, key, result, maxEntries);
  }

  return Object.assign(fn, {
    reset: (item: T) => cache.delete(keyOf(item)),
    resetKey: (key: K) => cache.delete(key),
  });
}
