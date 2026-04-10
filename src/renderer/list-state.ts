import {
  emitWeakListeners,
  pruneWeakListenerMap,
  type WeakListenerRecord,
} from "./weak-listeners";

/**
 * Mutable list state shared with virtualized renderers.
 */
export interface UpdateListItemAnimationOptions {
  /** Animation duration in milliseconds. */
  duration?: number;
}

type ListUpdateChange<T extends {}> = {
  type: "update";
  prevItem: T;
  nextItem: T;
  animation: UpdateListItemAnimationOptions | undefined;
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
  | ListUpdateChange<T>
  | ListUnshiftChange
  | ListPushChange
  | ListResetChange
  | ListSetChange;

export type ListStateChangeListener<T extends {}> = (
  change: ListStateChange<T>,
) => void;

type WeakListStateListenerRecord = WeakListenerRecord<
  object,
  ListStateChange<{}>
>;

const listStateListeners = new WeakMap<
  ListState<{}>,
  Map<symbol, WeakListStateListenerRecord>
>();
const listStateListenerRegistry =
  typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry<{
        listRef: WeakRef<ListState<{}>>;
        token: symbol;
      }>(({ listRef, token }) => {
        const list = listRef.deref();
        if (list == null) {
          return;
        }
        deleteListStateListener(list, token);
      })
    : null;

function deleteListStateListener(list: ListState<{}>, token: symbol): void {
  const listeners = listStateListeners.get(list);
  if (listeners == null) {
    return;
  }
  listeners.delete(token);
  if (listeners.size === 0) {
    listStateListeners.delete(list);
  }
}

function emitListStateChange<T extends {}>(
  list: ListState<T>,
  change: ListStateChange<T>,
): void {
  const listeners = listStateListeners.get(list as unknown as ListState<{}>);
  if (listeners == null) {
    return;
  }
  emitWeakListeners(listeners, change as ListStateChange<{}>);
  if (listeners.size === 0) {
    listStateListeners.delete(list as unknown as ListState<{}>);
  }
}

export function subscribeListState<T extends {}, O extends object>(
  list: ListState<T>,
  owner: O,
  listener: (owner: O, change: ListStateChange<T>) => void,
): void {
  const key = list as unknown as ListState<{}>;
  let listeners = listStateListeners.get(key);
  if (listeners == null) {
    listeners = new Map();
    listStateListeners.set(key, listeners);
  } else {
    pruneWeakListenerMap(listeners);
  }
  const token = Symbol();
  listeners.set(token, {
    ownerRef: new WeakRef(owner),
    notify: listener as (owner: object, change: ListStateChange<{}>) => void,
  });
  listStateListenerRegistry?.register(owner, {
    listRef: new WeakRef(key),
    token,
  });
}

function isObjectIdentityCandidate(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

function assertUniqueItemReferences<T extends {}>(
  items: readonly T[],
  existingItems?: readonly T[],
): void {
  const seen = new Set<T>();
  if (existingItems != null) {
    for (const item of existingItems) {
      if (isObjectIdentityCandidate(item)) {
        seen.add(item);
      }
    }
  }
  for (const item of items) {
    if (!isObjectIdentityCandidate(item)) {
      continue;
    }
    if (seen.has(item)) {
      throw new Error("ListState items must use unique object references.");
    }
    seen.add(item);
  }
}

function normalizeUpdateAnimation(
  animation: UpdateListItemAnimationOptions | undefined,
): UpdateListItemAnimationOptions | undefined {
  if (animation == null) {
    return undefined;
  }
  return Number.isFinite(animation.duration)
    ? { duration: animation.duration }
    : {};
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
    const nextItems = [...value];
    assertUniqueItemReferences(nextItems);
    this.#items = nextItems;
    emitListStateChange(this, { type: "set" });
  }

  /**
   * @param items Initial list items.
   */
  constructor(items: T[] = []) {
    const nextItems = [...items];
    assertUniqueItemReferences(nextItems);
    this.#items = nextItems;
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
    assertUniqueItemReferences(items, this.#items);
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
    assertUniqueItemReferences(items, this.#items);
    this.#items.push(...items);
    emitListStateChange(this, {
      type: "push",
      count: items.length,
    });
  }

  /**
   * Updates an existing item by object identity.
   */
  update(
    targetItem: T,
    nextItem: T,
    animation?: UpdateListItemAnimationOptions,
  ): void {
    if (
      !isObjectIdentityCandidate(targetItem) ||
      !isObjectIdentityCandidate(nextItem)
    ) {
      throw new TypeError("update() only supports object items.");
    }
    if (targetItem === nextItem) {
      throw new Error(
        "update() requires nextItem to be a new object reference.",
      );
    }
    const index = this.#items.indexOf(targetItem);
    if (index < 0) {
      throw new Error("update() targetItem is not present in the list.");
    }
    if (this.#items.includes(nextItem)) {
      throw new Error("update() nextItem is already present in the list.");
    }
    const prevItem = this.#items[index]!;
    this.#items[index] = nextItem;
    emitListStateChange(this, {
      type: "update",
      prevItem,
      nextItem,
      animation: normalizeUpdateAnimation(animation),
    });
  }

  /**
   * Sets the current anchor item and pixel offset.
   */
  setAnchor(position: number, offset = 0): void {
    this.position = Number.isFinite(position)
      ? Math.trunc(position)
      : undefined;
    this.offset = Number.isFinite(offset) ? offset : 0;
  }

  /**
   * Replaces all items and clears scroll state.
   */
  reset(items: T[] = []): void {
    const nextItems = [...items];
    assertUniqueItemReferences(nextItems);
    this.#items = nextItems;
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
