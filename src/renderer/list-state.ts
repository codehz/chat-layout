/**
 * Mutable list state shared with virtualized renderers.
 */
export interface ReplaceListItemAnimationOptions {
  /** Animation duration in milliseconds. */
  duration?: number;
}

type ListReplaceChange<T extends {}> = {
  type: "replace";
  index: number;
  prevItem: T;
  nextItem: T;
  animation: ReplaceListItemAnimationOptions | undefined;
};

type ListUnshiftChange = {
  type: "unshift";
  count: number;
};

type ListPushChange = {
  type: "push";
  count: number;
};

type ListResetChange = {
  type: "reset";
};

type ListSetChange = {
  type: "set";
};

export type ListStateChange<T extends {}> =
  | ListReplaceChange<T>
  | ListUnshiftChange
  | ListPushChange
  | ListResetChange
  | ListSetChange;

export type ListStateChangeListener<T extends {}> = (change: ListStateChange<T>) => void;

const listStateListeners = new WeakMap<ListState<{}>, Set<ListStateChangeListener<{}>>>();

function emitListStateChange<T extends {}>(list: ListState<T>, change: ListStateChange<T>): void {
  const listeners = listStateListeners.get(list as unknown as ListState<{}>);
  if (listeners == null || listeners.size === 0) {
    return;
  }
  for (const listener of [...listeners]) {
    (listener as ListStateChangeListener<T>)(change);
  }
}

export function subscribeListState<T extends {}>(list: ListState<T>, listener: ListStateChangeListener<T>): () => void {
  const key = list as unknown as ListState<{}>;
  let listeners = listStateListeners.get(key);
  if (listeners == null) {
    listeners = new Set();
    listStateListeners.set(key, listeners);
  }
  listeners.add(listener as ListStateChangeListener<{}>);
  return () => {
    const current = listStateListeners.get(key);
    if (current == null) {
      return;
    }
    current.delete(listener as ListStateChangeListener<{}>);
    if (current.size === 0) {
      listStateListeners.delete(key);
    }
  };
}

export class ListState<T extends {}> {
  #items: T[];

  /** Pixel offset from the anchored item edge. */
  offset = 0;
  /** Anchor item index, or `undefined` to use the renderer default. */
  position: number | undefined;

  /** Items currently managed by the renderer. */
  get items(): T[] {
    return this.#items;
  }

  /** Replaces the full item collection while preserving scroll state. */
  set items(value: T[]) {
    this.#items = [...value];
    emitListStateChange(this, { type: "set" });
  }

  /**
   * @param items Initial list items.
   */
  constructor(items: T[] = []) {
    this.#items = [...items];
  }

  /** Prepends one or more items. */
  unshift(...items: T[]): void {
    this.unshiftAll(items);
  }

  /** Prepends an array of items. */
  unshiftAll(items: T[]): void {
    if (items.length === 0) {
      return;
    }
    if (this.position != null) {
      this.position += items.length;
    }
    this.#items = items.concat(this.#items);
    emitListStateChange(this, {
      type: "unshift",
      count: items.length,
    });
  }

  /** Appends one or more items. */
  push(...items: T[]): void {
    this.pushAll(items);
  }

  /** Appends an array of items. */
  pushAll(items: T[]): void {
    if (items.length === 0) {
      return;
    }
    this.#items.push(...items);
    emitListStateChange(this, {
      type: "push",
      count: items.length,
    });
  }

  /**
   * Replaces an existing item by index.
   */
  replace(index: number, item: T, animation?: ReplaceListItemAnimationOptions): void {
    const normalizedIndex = Number.isFinite(index) ? Math.trunc(index) : Number.NaN;
    if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0 || normalizedIndex >= this.#items.length) {
      throw new RangeError(`replace() index ${index} is out of range for list length ${this.#items.length}.`);
    }

    const prevItem = this.#items[normalizedIndex]!;
    this.#items[normalizedIndex] = item;
    emitListStateChange(this, {
      type: "replace",
      index: normalizedIndex,
      prevItem,
      nextItem: item,
      animation:
        animation != null && Number.isFinite(animation.duration)
          ? { duration: animation.duration }
          : animation == null
            ? undefined
            : {},
    });
  }

  /**
   * Sets the current anchor item and pixel offset.
   */
  setAnchor(position: number, offset = 0): void {
    this.position = Number.isFinite(position) ? Math.trunc(position) : undefined;
    this.offset = Number.isFinite(offset) ? offset : 0;
  }

  /**
   * Replaces all items and clears scroll state.
   */
  reset(items: T[] = []): void {
    this.#items = [...items];
    this.offset = 0;
    this.position = undefined;
    emitListStateChange(this, { type: "reset" });
  }

  /** Clears the current scroll anchor while keeping the items. */
  resetScroll(): void {
    this.offset = 0;
    this.position = undefined;
  }

  /** Applies a relative pixel scroll delta. */
  applyScroll(delta: number): void {
    this.offset += delta;
  }
}
