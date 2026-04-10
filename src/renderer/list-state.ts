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

export interface DeleteListItemAnimationOptions {
  /** Animation duration in milliseconds. */
  duration?: number;
}

export interface PushListItemsAnimationOptions {
  /** Animation duration in milliseconds. */
  duration?: number;
  /** Enter offset in pixels measured from the final resting position. */
  distance?: number;
  /** Whether the inserted items should fade in. Defaults to `true`. */
  fade?: boolean;
}

export interface UnshiftListItemsAnimationOptions {
  /** Animation duration in milliseconds. */
  duration?: number;
}

type ListUpdateChange<T extends {}> = {
  type: "update";
  prevItem: T;
  nextItem: T;
  animation: UpdateListItemAnimationOptions | undefined;
};

type ListDeleteChange<T extends {}> = {
  type: "delete";
  item: T;
  animation: DeleteListItemAnimationOptions | undefined;
};

type ListDeleteFinalizeChange<T extends {}> = {
  type: "delete-finalize";
  item: T;
};

type ListUnshiftChange = {
  type: "unshift";
  count: number;
  animation: UnshiftListItemsAnimationOptions | undefined;
};

type ListPushChange = {
  type: "push";
  count: number;
  animation: PushListItemsAnimationOptions | undefined;
};

type ListResetChange = {
  type: "reset";
};

type ListSetChange = {
  type: "set";
};

export type ListStateChange<T extends {}> =
  | ListUpdateChange<T>
  | ListDeleteChange<T>
  | ListDeleteFinalizeChange<T>
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

function normalizeAnimationDuration(
  duration: number | undefined,
): { duration?: number } | undefined {
  if (duration == null) {
    return undefined;
  }
  return Number.isFinite(duration) ? { duration } : {};
}

function normalizeUpdateAnimation(
  animation: UpdateListItemAnimationOptions | undefined,
): UpdateListItemAnimationOptions | undefined {
  return normalizeAnimationDuration(animation?.duration);
}

function normalizeDeleteAnimation(
  animation: DeleteListItemAnimationOptions | undefined,
): DeleteListItemAnimationOptions | undefined {
  return normalizeAnimationDuration(animation?.duration);
}

const DEFAULT_INSERT_ALL_ANIMATION_DURATION = 220;

function normalizeInsertAnimationDuration(
  duration: number | undefined,
  hasAnimationOptions: boolean,
): number | undefined {
  if (!hasAnimationOptions) {
    return undefined;
  }
  const resolvedDuration =
    duration == null ? DEFAULT_INSERT_ALL_ANIMATION_DURATION : duration;
  if (!Number.isFinite(resolvedDuration) || resolvedDuration <= 0) {
    return undefined;
  }
  return resolvedDuration;
}

function normalizePushAnimation(
  animation: PushListItemsAnimationOptions | undefined,
): PushListItemsAnimationOptions | undefined {
  const duration = normalizeInsertAnimationDuration(
    animation?.duration,
    animation != null,
  );
  if (duration == null) {
    return undefined;
  }

  const normalizedAnimation: PushListItemsAnimationOptions = {
    duration,
    fade: animation?.fade ?? true,
  };
  if (
    typeof animation?.distance === "number" &&
    Number.isFinite(animation.distance)
  ) {
    normalizedAnimation.distance = Math.max(0, animation.distance);
  }
  return normalizedAnimation;
}

function normalizeUnshiftAnimation(
  animation: UnshiftListItemsAnimationOptions | undefined,
): UnshiftListItemsAnimationOptions | undefined {
  const duration = normalizeInsertAnimationDuration(
    animation?.duration,
    animation != null,
  );
  if (duration == null) {
    return undefined;
  }
  return { duration };
}

export class ListState<T extends {}> {
  #items: T[];
  #pendingDeletes = new Set<T>();

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
    this.#pendingDeletes.clear();
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
  unshiftAll(items: T[], animation?: UnshiftListItemsAnimationOptions): void {
    if (items.length === 0) {
      return;
    }
    assertUniqueItemReferences(items, this.#items);
    const normalizedAnimation = normalizeUnshiftAnimation(animation);
    if (this.position != null) {
      this.position += items.length;
    }
    this.#items = items.concat(this.#items);
    emitListStateChange(this, {
      type: "unshift",
      count: items.length,
      animation: normalizedAnimation,
    });
  }

  /** Appends one or more items. */
  push(...items: T[]): void {
    this.pushAll(items);
  }

  /** Appends an array of items. */
  pushAll(items: T[], animation?: PushListItemsAnimationOptions): void {
    if (items.length === 0) {
      return;
    }
    assertUniqueItemReferences(items, this.#items);
    const normalizedAnimation = normalizePushAnimation(animation);
    this.#items.push(...items);
    emitListStateChange(this, {
      type: "push",
      count: items.length,
      animation: normalizedAnimation,
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
    if (this.#pendingDeletes.has(targetItem)) {
      throw new Error("update() targetItem is pending deletion.");
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
   * Starts deleting an existing item by object identity.
   */
  delete(item: T, animation?: DeleteListItemAnimationOptions): void {
    if (!isObjectIdentityCandidate(item)) {
      throw new TypeError("delete() only supports object items.");
    }
    const index = this.#items.indexOf(item);
    if (index < 0) {
      throw new Error("delete() item is not present in the list.");
    }
    if (this.#pendingDeletes.has(item)) {
      return;
    }
    const normalizedAnimation = normalizeDeleteAnimation(animation);
    const duration = normalizedAnimation?.duration ?? 0;
    if (!(duration > 0)) {
      this.#pendingDeletes.add(item);
      this.finalizeDelete(item);
      return;
    }
    this.#pendingDeletes.add(item);
    emitListStateChange(this, {
      type: "delete",
      item,
      animation: normalizedAnimation,
    });
  }

  /**
   * Finalizes a pending delete by removing the item from the list.
   */
  finalizeDelete(item: T): void {
    if (!this.#pendingDeletes.has(item)) {
      return;
    }
    const index = this.#items.indexOf(item);
    this.#pendingDeletes.delete(item);
    if (index < 0) {
      return;
    }
    this.#items.splice(index, 1);
    if (this.#items.length === 0) {
      this.position = undefined;
      this.offset = 0;
    } else if (this.position != null) {
      if (this.position > index) {
        this.position -= 1;
      } else if (this.position === index) {
        this.position = Math.min(index, this.#items.length - 1);
      }
    }
    emitListStateChange(this, {
      type: "delete-finalize",
      item,
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
    this.#pendingDeletes.clear();
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
