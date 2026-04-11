import type { Box, Context, Node } from "../../types";
import type { ListStateChange } from "../list-state";
import type {
  ResolvedListLayoutOptions,
  VisibleWindow,
  VisibleWindowResult,
} from "./solver";
import {
  clamp,
  getNow,
  getProgress,
  interpolate,
  sameState,
} from "./base-animation";
import {
  ALPHA_EPSILON,
  type ControlledState,
  type ItemTransition,
  type TransitionLayer,
  type VirtualizedResolvedItem,
} from "./base-types";

/** Rendering services delegated to the host VirtualizedRenderer. */
export type TransitionRendererAdapter<
  C extends CanvasRenderingContext2D,
  T extends {},
> = {
  renderItem: (item: T) => Node<C>;
  measureNode: (node: Node<C>) => Box;
  drawNode: (node: Node<C>, x: number, y: number) => boolean;
  getRootContext: () => Context<C>;
  graphics: C;
  onDeleteComplete: (item: T) => void;
};

type SampledLayer<C extends CanvasRenderingContext2D> = {
  alpha: number;
  node: Node<C>;
  translateY: number;
};

type CurrentVisualState<C extends CanvasRenderingContext2D> = {
  node: Node<C>;
  alpha: number;
  height: number;
  translateY: number;
};

type ViewportTranslateAnimation = {
  fromTranslateY: number;
  toTranslateY: number;
  startTime: number;
  duration: number;
};

/** State context needed to decide whether a transition can start. */
export type TransitionContext<
  C extends CanvasRenderingContext2D,
  T extends {},
> = {
  items: readonly T[];
  position: number | undefined;
  offset: number;
  layout: ResolvedListLayoutOptions;
  readListState: () => ControlledState;
  readVisibleRange: (
    top: number,
    height: number,
  ) => { top: number; bottom: number } | undefined;
  resolveVisibleWindow: () => VisibleWindowResult<unknown>;
} & TransitionRendererAdapter<C, T>;

/**
 * Self-contained subsystem that manages mutation-driven item transitions and
 * viewport compensation for a VirtualizedRenderer.
 */
export class TransitionController<
  C extends CanvasRenderingContext2D,
  T extends {},
> {
  #itemTransitions = new WeakMap<T, ItemTransition<C>>();
  #activeTransitionItems = new Set<T>();
  #viewportTranslateAnimation: ViewportTranslateAnimation | undefined;

  // Visibility snapshot used for transition gating and offscreen pruning.
  #drawnItems = new Set<T>();
  #visibleItems = new Set<T>();
  #hasVisibilitySnapshot = false;
  #visibilitySnapshotState: ControlledState | undefined;
  #visibilitySnapshotCoversShortList = false;
  #visibilitySnapshotTopGap = 0;
  #visibilitySnapshotBottomGap = 0;

  captureVisibilitySnapshot(
    window: VisibleWindow<unknown>,
    items: readonly T[],
    viewportHeight: number,
    snapshotState: ControlledState,
    layout: ResolvedListLayoutOptions,
    extraShift: number,
    readVisibleRange: (
      top: number,
      height: number,
    ) => { top: number; bottom: number } | undefined,
  ): void {
    const nextDrawnItems = new Set<T>();
    const nextVisibleItems = new Set<T>();
    let minVisibleIndex = Number.POSITIVE_INFINITY;
    let maxVisibleIndex = Number.NEGATIVE_INFINITY;
    let topMostY = Number.POSITIVE_INFINITY;
    let bottomMostY = Number.NEGATIVE_INFINITY;
    const effectiveShift = window.shift + extraShift;
    for (const { idx, offset, height } of window.drawList) {
      minVisibleIndex = Math.min(minVisibleIndex, idx);
      maxVisibleIndex = Math.max(maxVisibleIndex, idx);
      const y = offset + effectiveShift;
      topMostY = Math.min(topMostY, y);
      bottomMostY = Math.max(bottomMostY, y + height);
      const item = items[idx];
      if (item != null) {
        nextDrawnItems.add(item);
      }
      if (readVisibleRange(offset + effectiveShift, height) == null) {
        continue;
      }
      if (item == null) {
        continue;
      }
      nextVisibleItems.add(item);
    }
    this.#drawnItems = nextDrawnItems;
    this.#visibleItems = nextVisibleItems;
    this.#hasVisibilitySnapshot = true;
    this.#visibilitySnapshotState = snapshotState;
    const contentHeight = bottomMostY - topMostY;
    this.#visibilitySnapshotCoversShortList =
      window.drawList.length > 0 &&
      items.length > 0 &&
      window.drawList.length === items.length &&
      minVisibleIndex === 0 &&
      maxVisibleIndex === items.length - 1 &&
      topMostY >= -Number.EPSILON &&
      bottomMostY <= viewportHeight + Number.EPSILON &&
      contentHeight < viewportHeight - Number.EPSILON;
    this.#visibilitySnapshotTopGap = this.#visibilitySnapshotCoversShortList
      ? Math.max(0, topMostY)
      : 0;
    this.#visibilitySnapshotBottomGap = this.#visibilitySnapshotCoversShortList
      ? Math.max(0, viewportHeight - bottomMostY)
      : 0;
  }

  /**
   * Removes transitions for items that are no longer visible.
   * Returns true if any transition was canceled or finalized.
   */
  pruneInvisible(
    adapter: Pick<TransitionRendererAdapter<C, T>, "onDeleteComplete">,
  ): boolean {
    let changed = false;
    for (const item of [...this.#activeTransitionItems]) {
      const transition = this.#itemTransitions.get(item);
      const isTracked =
        transition?.kind === "insert"
          ? this.#drawnItems.has(item)
          : this.#visibleItems.has(item);
      if (isTracked) {
        continue;
      }
      this.#itemTransitions.delete(item);
      this.#activeTransitionItems.delete(item);
      if (transition?.kind === "delete") {
        adapter.onDeleteComplete(item);
      }
      changed = true;
    }
    return changed;
  }

  /** Advance all active transitions and return true if any are still running. */
  prepare(
    now: number,
    adapter: Pick<TransitionRendererAdapter<C, T>, "onDeleteComplete">,
  ): boolean {
    let keepAnimating = false;
    this.#cleanupViewportTranslateAnimation(now);
    if (this.#viewportTranslateAnimation != null) {
      keepAnimating = true;
    }
    for (const item of [...this.#activeTransitionItems]) {
      if (this.readTransition(item, now, adapter) != null) {
        keepAnimating = true;
      }
    }
    return keepAnimating;
  }

  getViewportTranslateY(now: number): number {
    this.#cleanupViewportTranslateAnimation(now);
    const transition = this.#viewportTranslateAnimation;
    if (transition == null) {
      return 0;
    }
    return interpolate(
      transition.fromTranslateY,
      transition.toTranslateY,
      transition.startTime,
      transition.duration,
      now,
    );
  }

  /**
   * Returns the active transition for an item, or undefined if none / already
   * completed (and cleans up completed transitions as a side effect).
   */
  readTransition(
    item: T,
    now: number,
    adapter?: Pick<TransitionRendererAdapter<C, T>, "onDeleteComplete">,
  ): ItemTransition<C> | undefined {
    const transition = this.#itemTransitions.get(item);
    if (transition == null) {
      return undefined;
    }
    if (getProgress(transition.startTime, transition.duration, now) >= 1) {
      this.#itemTransitions.delete(item);
      this.#activeTransitionItems.delete(item);
      if (transition.kind === "delete") {
        adapter?.onDeleteComplete(item);
      }
      return undefined;
    }
    return transition;
  }

  /** Returns the effective rendered height for an item, accounting for transitions. */
  getItemHeight(
    item: T,
    now: number,
    adapter: Pick<
      TransitionRendererAdapter<C, T>,
      "renderItem" | "measureNode"
    >,
  ): number {
    const transition = this.readTransition(item, now);
    if (transition != null) {
      return this.#sampleTransitionHeight(transition, now);
    }
    const node = adapter.renderItem(item);
    return adapter.measureNode(node).height;
  }

  /** Resolves an item to its draw/hittest callbacks for the current frame. */
  resolveItem(
    item: T,
    now: number,
    adapter: TransitionRendererAdapter<C, T>,
  ): { value: VirtualizedResolvedItem; height: number } {
    const transition = this.readTransition(item, now, adapter);
    if (transition == null) {
      const node = adapter.renderItem(item);
      return {
        value: {
          draw: (y) => adapter.drawNode(node, 0, y),
          hittest: (test, y) =>
            node.hittest(adapter.getRootContext(), { ...test, y: test.y - y }),
        },
        height: adapter.measureNode(node).height,
      };
    }

    const slotHeight = this.#sampleTransitionHeight(transition, now);
    const layers = this.#readTransitionLayers(transition, now);

    return {
      value: {
        draw: (y) => this.#drawTransitionLayers(layers, slotHeight, y, adapter),
        hittest: () => false,
      },
      height: slotHeight,
    };
  }

  handleListStateChange(
    change: ListStateChange<T>,
    ctx: TransitionContext<C, T>,
  ): void {
    switch (change.type) {
      case "update":
        this.handleUpdate(
          change.prevItem,
          change.nextItem,
          change.animation?.duration,
          ctx,
        );
        break;
      case "delete":
        this.handleDelete(change.item, change.animation?.duration, ctx);
        break;
      case "delete-finalize":
        this.#itemTransitions.delete(change.item);
        this.#activeTransitionItems.delete(change.item);
        break;
      case "unshift":
        this.handleUnshift(
          change.count,
          change.animation?.duration,
          change.animation?.distance,
          ctx,
        );
        break;
      case "push":
        this.handlePush(
          change.count,
          change.animation?.duration,
          change.animation?.distance,
          ctx,
        );
        break;
      case "reset":
      case "set":
        this.reset();
        break;
    }
  }

  handleUpdate(
    prevItem: T,
    nextItem: T,
    duration: number | undefined,
    ctx: TransitionContext<C, T>,
  ): void {
    const normalizedDuration = Math.max(
      0,
      typeof duration === "number" && Number.isFinite(duration) ? duration : 0,
    );
    const nextIndex = ctx.items.indexOf(nextItem);
    if (
      normalizedDuration <= 0 ||
      nextIndex < 0 ||
      !this.#canAnimateUpdate(nextIndex, prevItem, ctx)
    ) {
      this.#itemTransitions.delete(prevItem);
      this.#activeTransitionItems.delete(prevItem);
      return;
    }

    const now = getNow();
    const nextNode = ctx.renderItem(nextItem);
    const nextHeight = ctx.measureNode(nextNode).height;
    const transition = this.readTransition(prevItem, now, ctx);
    const currentVisualState = this.#readCurrentVisualState(
      prevItem,
      transition,
      now,
      ctx,
    );

    const fromLayer =
      currentVisualState.alpha > ALPHA_EPSILON
        ? this.#createLayer(
            currentVisualState.node,
            currentVisualState.alpha,
            0,
            now,
            normalizedDuration,
            currentVisualState.translateY,
            0,
          )
        : undefined;
    const toLayer = this.#createLayer(
      nextNode,
      0,
      1,
      now,
      normalizedDuration,
      currentVisualState.translateY,
      0,
    );

    this.#itemTransitions.delete(prevItem);
    this.#itemTransitions.set(nextItem, {
      kind: "update",
      fromLayer,
      toLayer,
      fromHeight: currentVisualState.height,
      toHeight: nextHeight,
      startTime: now,
      duration: normalizedDuration,
    });
    this.#activeTransitionItems.delete(prevItem);
    this.#activeTransitionItems.add(nextItem);
  }

  handleDelete(
    item: T,
    duration: number | undefined,
    ctx: TransitionContext<C, T>,
  ): void {
    const normalizedDuration = Math.max(
      0,
      typeof duration === "number" && Number.isFinite(duration) ? duration : 0,
    );
    const index = ctx.items.indexOf(item);
    if (
      normalizedDuration <= 0 ||
      index < 0 ||
      !this.#canAnimateUpdate(index, item, ctx)
    ) {
      this.#itemTransitions.delete(item);
      this.#activeTransitionItems.delete(item);
      ctx.onDeleteComplete(item);
      return;
    }

    const now = getNow();
    const transition = this.readTransition(item, now, ctx);
    const currentVisualState = this.#readCurrentVisualState(
      item,
      transition,
      now,
      ctx,
    );

    const fromLayer =
      currentVisualState.alpha > ALPHA_EPSILON
        ? this.#createLayer(
            currentVisualState.node,
            currentVisualState.alpha,
            0,
            now,
            normalizedDuration,
            currentVisualState.translateY,
            0,
          )
        : undefined;

    this.#itemTransitions.set(item, {
      kind: "delete",
      fromLayer,
      toLayer: undefined,
      fromHeight: currentVisualState.height,
      toHeight: 0,
      startTime: now,
      duration: normalizedDuration,
    });
    this.#activeTransitionItems.add(item);
  }

  handlePush(
    count: number,
    duration: number | undefined,
    distance: number | undefined,
    ctx: TransitionContext<C, T>,
  ): void {
    if (
      count <= 0 ||
      !(typeof duration === "number" && duration > 0) ||
      !this.#canAnimateInsert("push", count, ctx)
    ) {
      return;
    }

    const start = ctx.items.length - count;
    if (start < 0) {
      return;
    }

    const now = getNow();
    if (ctx.layout.underflowAlign === "bottom") {
      let insertedHeight = 0;
      for (let index = start; index < ctx.items.length; index += 1) {
        const item = ctx.items[index];
        if (item == null) {
          continue;
        }
        const node = ctx.renderItem(item);
        insertedHeight += ctx.measureNode(node).height;
      }
      if (!(insertedHeight > 0) || !Number.isFinite(insertedHeight)) {
        return;
      }
      const travel = Math.min(insertedHeight, this.#visibilitySnapshotTopGap);
      if (!(travel > 0) || !Number.isFinite(travel)) {
        return;
      }
      this.#viewportTranslateAnimation = {
        fromTranslateY: this.getViewportTranslateY(now) + travel,
        toTranslateY: 0,
        startTime: now,
        duration,
      };
      return;
    }

    for (let index = start; index < ctx.items.length; index += 1) {
      const item = ctx.items[index];
      if (item == null) {
        continue;
      }
      const node = ctx.renderItem(item);
      const itemHeight = ctx.measureNode(node).height;
      const resolvedDistance =
        typeof distance === "number" && Number.isFinite(distance)
          ? Math.max(0, distance)
          : Math.min(24, itemHeight);
      this.#itemTransitions.set(item, {
        kind: "insert",
        fromLayer: undefined,
        toLayer: this.#createLayer(
          node,
          0,
          1,
          now,
          duration,
          resolvedDistance,
          0,
        ),
        fromHeight: itemHeight,
        toHeight: itemHeight,
        startTime: now,
        duration,
      });
      this.#activeTransitionItems.add(item);
    }
  }

  handleUnshift(
    count: number,
    duration: number | undefined,
    distance: number | undefined,
    ctx: TransitionContext<C, T>,
  ): void {
    if (
      count <= 0 ||
      !(typeof duration === "number" && duration > 0) ||
      !this.#canAnimateInsert("unshift", count, ctx)
    ) {
      return;
    }

    if (ctx.layout.underflowAlign === "bottom") {
      const now = getNow();
      for (
        let index = 0;
        index < Math.min(count, ctx.items.length);
        index += 1
      ) {
        const item = ctx.items[index];
        if (item == null) {
          continue;
        }
        const node = ctx.renderItem(item);
        const itemHeight = ctx.measureNode(node).height;
        const resolvedDistance =
          typeof distance === "number" && Number.isFinite(distance)
            ? Math.max(0, distance)
            : Math.min(24, itemHeight);
        this.#itemTransitions.set(item, {
          kind: "insert",
          fromLayer: undefined,
          toLayer: this.#createLayer(
            node,
            0,
            1,
            now,
            duration,
            -resolvedDistance,
            0,
          ),
          fromHeight: itemHeight,
          toHeight: itemHeight,
          startTime: now,
          duration,
        });
        this.#activeTransitionItems.add(item);
      }
      return;
    }

    const now = getNow();
    let insertedHeight = 0;
    for (let index = 0; index < Math.min(count, ctx.items.length); index += 1) {
      const item = ctx.items[index];
      if (item == null) {
        continue;
      }
      const node = ctx.renderItem(item);
      insertedHeight += ctx.measureNode(node).height;
    }
    if (!(insertedHeight > 0) || !Number.isFinite(insertedHeight)) {
      return;
    }
    const travel = Math.min(insertedHeight, this.#visibilitySnapshotBottomGap);
    if (!(travel > 0) || !Number.isFinite(travel)) {
      return;
    }
    this.#viewportTranslateAnimation = {
      fromTranslateY: this.getViewportTranslateY(now) - travel,
      toTranslateY: 0,
      startTime: now,
      duration,
    };
  }

  /** Clears all transition state (e.g., on list reset). */
  reset(): void {
    this.#itemTransitions = new WeakMap<T, ItemTransition<C>>();
    this.#activeTransitionItems.clear();
    this.#viewportTranslateAnimation = undefined;
    this.#drawnItems.clear();
    this.#visibleItems.clear();
    this.#hasVisibilitySnapshot = false;
    this.#visibilitySnapshotState = undefined;
    this.#visibilitySnapshotCoversShortList = false;
    this.#visibilitySnapshotTopGap = 0;
    this.#visibilitySnapshotBottomGap = 0;
  }

  #createLayer(
    node: Node<C>,
    fromAlpha: number,
    toAlpha: number,
    startTime: number,
    duration: number,
    fromTranslateY: number,
    toTranslateY: number,
  ): TransitionLayer<C> {
    return {
      node,
      fromAlpha,
      toAlpha,
      fromTranslateY,
      toTranslateY,
      startTime,
      duration,
    };
  }

  #sampleLayerAlpha(layer: TransitionLayer<C>, now: number): number {
    return interpolate(
      layer.fromAlpha,
      layer.toAlpha,
      layer.startTime,
      layer.duration,
      now,
    );
  }

  #sampleLayerTranslateY(layer: TransitionLayer<C>, now: number): number {
    return interpolate(
      layer.fromTranslateY,
      layer.toTranslateY,
      layer.startTime,
      layer.duration,
      now,
    );
  }

  #sampleTransitionHeight(transition: ItemTransition<C>, now: number): number {
    return interpolate(
      transition.fromHeight,
      transition.toHeight,
      transition.startTime,
      transition.duration,
      now,
    );
  }

  #readTransitionLayers(
    transition: ItemTransition<C>,
    now: number,
  ): SampledLayer<C>[] {
    return [transition.fromLayer, transition.toLayer]
      .filter((layer): layer is TransitionLayer<C> => layer != null)
      .map((layer) => ({
        alpha: this.#sampleLayerAlpha(layer, now),
        node: layer.node,
        translateY: this.#sampleLayerTranslateY(layer, now),
      }))
      .filter((layer) => layer.alpha > ALPHA_EPSILON);
  }

  #drawTransitionLayers(
    layers: SampledLayer<C>[],
    slotHeight: number,
    y: number,
    adapter: TransitionRendererAdapter<C, T>,
  ): boolean {
    if (slotHeight <= 0) {
      return false;
    }

    let result = false;
    for (const layer of layers) {
      const alpha = clamp(layer.alpha, 0, 1);
      if (alpha <= ALPHA_EPSILON) {
        continue;
      }

      adapter.graphics.save();
      try {
        if (typeof adapter.graphics.globalAlpha === "number") {
          adapter.graphics.globalAlpha *= alpha;
        }
        const layerY = y + layer.translateY;
        if (adapter.drawNode(layer.node, 0, layerY)) {
          result = true;
        }
      } finally {
        adapter.graphics.restore();
      }
    }
    return result;
  }

  #isIndexVisible(
    index: number,
    resolveVisibleWindow: () => VisibleWindowResult<unknown>,
    readVisibleRange: (
      top: number,
      height: number,
    ) => { top: number; bottom: number } | undefined,
  ): boolean {
    if (index < 0) {
      return false;
    }
    const solution = resolveVisibleWindow();
    for (const entry of solution.window.drawList) {
      if (entry.idx !== index) {
        continue;
      }
      if (
        readVisibleRange(entry.offset + solution.window.shift, entry.height) !=
        null
      ) {
        return true;
      }
    }
    return false;
  }

  #canAnimateUpdate(
    nextIndex: number,
    prevItem: T,
    ctx: TransitionContext<C, T>,
  ): boolean {
    if (nextIndex < 0) {
      return false;
    }
    if (
      this.#hasVisibilitySnapshot &&
      this.#visibilitySnapshotState != null &&
      sameState(this.#visibilitySnapshotState, ctx.position, ctx.offset)
    ) {
      return (
        this.#visibleItems.has(prevItem) ||
        this.#activeTransitionItems.has(prevItem)
      );
    }
    return this.#isIndexVisible(
      nextIndex,
      ctx.resolveVisibleWindow,
      ctx.readVisibleRange,
    );
  }

  #canAnimateInsert(
    direction: "push" | "unshift",
    count: number,
    ctx: TransitionContext<C, T>,
  ): boolean {
    if (
      !this.#hasVisibilitySnapshot ||
      this.#visibilitySnapshotState == null ||
      !this.#visibilitySnapshotCoversShortList
    ) {
      return false;
    }

    const expectedPosition =
      direction === "unshift" && this.#visibilitySnapshotState.position != null
        ? this.#visibilitySnapshotState.position + count
        : this.#visibilitySnapshotState.position;
    return sameState(
      {
        position: expectedPosition,
        offset: this.#visibilitySnapshotState.offset,
      },
      ctx.position,
      ctx.offset,
    );
  }

  #readCurrentVisualState(
    item: T,
    transition: ItemTransition<C> | undefined,
    now: number,
    ctx: TransitionContext<C, T>,
  ): CurrentVisualState<C> {
    if (transition?.toLayer != null) {
      return {
        node: transition.toLayer.node,
        alpha: this.#sampleLayerAlpha(transition.toLayer, now),
        height: this.#sampleTransitionHeight(transition, now),
        translateY: this.#sampleLayerTranslateY(transition.toLayer, now),
      };
    }
    if (transition?.fromLayer != null) {
      return {
        node: transition.fromLayer.node,
        alpha: this.#sampleLayerAlpha(transition.fromLayer, now),
        height: this.#sampleTransitionHeight(transition, now),
        translateY: this.#sampleLayerTranslateY(transition.fromLayer, now),
      };
    }

    const node = ctx.renderItem(item);
    return {
      node,
      alpha: 1,
      height: ctx.measureNode(node).height,
      translateY: 0,
    };
  }

  #cleanupViewportTranslateAnimation(now: number): void {
    const transition = this.#viewportTranslateAnimation;
    if (
      transition != null &&
      getProgress(transition.startTime, transition.duration, now) >= 1
    ) {
      this.#viewportTranslateAnimation = undefined;
    }
  }
}
