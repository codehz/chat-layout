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

export interface InsertListItemsAnimationOptions {
  /** Animation duration in milliseconds. */
  duration?: number;
  /** Auto-follow the insertion edge when the viewport was already pinned there. */
  autoFollow?: boolean;
}

export type PushListItemsAnimationOptions = InsertListItemsAnimationOptions;

export type UnshiftListItemsAnimationOptions = InsertListItemsAnimationOptions;

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

export type ListScrollMutationSource = "external" | "internal";

export type ListScrollMutation = {
  version: number;
  source: ListScrollMutationSource;
};

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

type MutableListScrollMutation = {
  version: number;
  source: ListScrollMutationSource;
};

const listScrollMutations = new WeakMap<
  ListState<{}>,
  MutableListScrollMutation
>();

type ListScrollStatePatch = {
  position?: number | undefined;
  offset?: number;
};

const WRITE_LIST_SCROLL_STATE = Symbol("writeListScrollState");
const FINALIZE_LIST_DELETE = Symbol("finalizeListDelete");

type InternalListStateWriter = {
  [WRITE_LIST_SCROLL_STATE]: (
    patch: ListScrollStatePatch,
    source: ListScrollMutationSource,
  ) => void;
};

type InternalListStateDeleteFinalizer<T extends {}> = {
  [FINALIZE_LIST_DELETE]: (item: T) => void;
};

function normalizePosition(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : undefined;
}

function normalizeOffset(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function getListScrollMutationRecord(
  list: ListState<{}>,
): MutableListScrollMutation {
  let record = listScrollMutations.get(list);
  if (record == null) {
    record = {
      version: 0,
      source: "internal",
    };
    listScrollMutations.set(list, record);
  }
  return record;
}

function markListScrollMutation(
  list: ListState<{}>,
  source: ListScrollMutationSource,
): void {
  const record = getListScrollMutationRecord(list);
  record.version += 1;
  record.source = source;
}

export function readListScrollMutation<T extends {}>(
  list: ListState<T>,
): ListScrollMutation {
  const record = getListScrollMutationRecord(list as unknown as ListState<{}>);
  return {
    version: record.version,
    source: record.source,
  };
}

export function writeInternalListScrollState<T extends {}>(
  list: ListState<T>,
  state: {
    position: number | undefined;
    offset: number;
  },
): void {
  (list as unknown as InternalListStateWriter)[WRITE_LIST_SCROLL_STATE](
    state,
    "internal",
  );
}

export function finalizeInternalListDelete<T extends {}>(
  list: ListState<T>,
  item: T,
): void {
  (list as unknown as InternalListStateDeleteFinalizer<T>)[
    FINALIZE_LIST_DELETE
  ](item);
}

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

function normalizeInsertAnimation(
  animation: InsertListItemsAnimationOptions | undefined,
): InsertListItemsAnimationOptions | undefined {
  const duration = normalizeInsertAnimationDuration(
    animation?.duration,
    animation != null,
  );
  if (duration == null) {
    return undefined;
  }

  const normalizedAnimation: InsertListItemsAnimationOptions = { duration };
  if (animation?.autoFollow === true) {
    normalizedAnimation.autoFollow = true;
  }
  return normalizedAnimation;
}

export class ListState<T extends {}> {
  #items: T[];
  #pendingDeletes = new Set<T>();
  #offset = 0;
  #position: number | undefined;

  /** Pixel offset from the anchored item edge. */
  get offset(): number {
    return this.#offset;
  }

  /** Anchor item index, or `undefined` to use the renderer default. */
  get position(): number | undefined {
    return this.#position;
  }

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
    const normalizedAnimation = normalizeInsertAnimation(animation);
    if (this.position != null) {
      this.#writeScrollState(
        {
          position: this.position + items.length,
        },
        "internal",
      );
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
    const normalizedAnimation = normalizeInsertAnimation(animation);
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
      this[FINALIZE_LIST_DELETE](item);
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
  [FINALIZE_LIST_DELETE](item: T): void {
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
      this.#writeScrollState(
        {
          position: undefined,
          offset: 0,
        },
        "internal",
      );
    } else if (this.position != null) {
      if (this.position > index) {
        this.#writeScrollState(
          {
            position: this.position - 1,
          },
          "internal",
        );
      } else if (this.position === index) {
        this.#writeScrollState(
          {
            position: Math.min(index, this.#items.length - 1),
          },
          "internal",
        );
      }
    }
    emitListStateChange(this, {
      type: "delete-finalize",
      item,
    });
  }

  /**
   * Replaces all items and clears scroll state.
   */
  reset(items: T[] = []): void {
    const nextItems = [...items];
    assertUniqueItemReferences(nextItems);
    this.#items = nextItems;
    this.#pendingDeletes.clear();
    this.#writeScrollState(
      {
        position: undefined,
        offset: 0,
      },
      "internal",
    );
    emitListStateChange(this, { type: "reset" });
  }

  /** Applies a relative pixel scroll delta. */
  applyScroll(delta: number): void {
    this.#writeScrollState(
      {
        offset: this.#offset + delta,
      },
      "external",
    );
  }

  [WRITE_LIST_SCROLL_STATE](
    patch: ListScrollStatePatch,
    source: ListScrollMutationSource,
  ): void {
    this.#writeScrollState(patch, source);
  }

  #writeScrollState(
    patch: ListScrollStatePatch,
    source: ListScrollMutationSource,
  ): void {
    let changed = false;

    if ("position" in patch) {
      const nextPosition = normalizePosition(patch.position);
      if (!Object.is(this.#position, nextPosition)) {
        this.#position = nextPosition;
        changed = true;
      }
    }

    if ("offset" in patch) {
      const nextOffset = normalizeOffset(patch.offset ?? 0);
      if (!Object.is(this.#offset, nextOffset)) {
        this.#offset = nextOffset;
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    markListScrollMutation(this as unknown as ListState<{}>, source);
  }
}
