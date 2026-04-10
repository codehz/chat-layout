import type { Box, Context, Node } from "../../types";
import type { ListStateChange } from "../list-state";
import type { VisibleWindow, VisibleWindowResult } from "./solver";
import {
  clamp,
  getNow,
  getProgress,
  interpolate,
  sameState,
} from "./base-animation";
import {
  ALPHA_EPSILON,
  type AnimatedLayerPlacement,
  type ControlledState,
  type ReplacementAnimation,
  type ReplacementLayer,
  type VirtualizedResolvedItem,
} from "./base-types";

/** Rendering services delegated to the host VirtualizedRenderer. */
export type ReplacementRendererAdapter<
  C extends CanvasRenderingContext2D,
  T extends {},
> = {
  renderItem: (item: T) => Node<C>;
  measureNode: (node: Node<C>) => Box;
  drawNode: (node: Node<C>, x: number, y: number) => boolean;
  getRootContext: () => Context<C>;
  graphics: C;
  defaultAnimatedPlacement: AnimatedLayerPlacement;
  onDeleteComplete: (item: T) => void;
};

type SampledLayer<C extends CanvasRenderingContext2D> = {
  alpha: number;
  node: Node<C>;
  nodeHeight: number;
  placement: AnimatedLayerPlacement;
  translateY: number;
};

type CurrentVisualState<C extends CanvasRenderingContext2D> = {
  node: Node<C>;
  alpha: number;
  height: number;
  placement: AnimatedLayerPlacement;
  translateY: number;
};

type WindowTranslateAnimation = {
  fromTranslateY: number;
  toTranslateY: number;
  startTime: number;
  duration: number;
};

/** State context needed to check whether an update can be animated. */
export type ReplacementUpdateContext<
  C extends CanvasRenderingContext2D,
  T extends {},
> = {
  items: readonly T[];
  position: number | undefined;
  offset: number;
  readListState: () => ControlledState;
  readVisibleRange: (
    top: number,
    height: number,
  ) => { top: number; bottom: number } | undefined;
  resolveVisibleWindow: () => VisibleWindowResult<unknown>;
} & ReplacementRendererAdapter<C, T>;

/**
 * Self-contained subsystem that manages item replacement (cross-fade + height)
 * animations for a VirtualizedRenderer.
 */
export class ReplacementController<
  C extends CanvasRenderingContext2D,
  T extends {},
> {
  #replacementAnimations = new WeakMap<T, ReplacementAnimation<C>>();
  #activeReplacementItems = new Set<T>();
  #windowTranslateAnimation: WindowTranslateAnimation | undefined;

  // Visible-item snapshot used to decide whether an update can be animated.
  #drawnItems = new Set<T>();
  #visibleItems = new Set<T>();
  #hasVisibleItemSnapshot = false;
  #visibleSnapshotState: ControlledState | undefined;
  #visibleSnapshotShowsShortList = false;
  #visibleSnapshotTrailingGap = 0;

  captureVisibleItemSnapshot(
    window: VisibleWindow<unknown>,
    items: readonly T[],
    viewportHeight: number,
    snapshotState: ControlledState,
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
    this.#hasVisibleItemSnapshot = true;
    this.#visibleSnapshotState = snapshotState;
    this.#visibleSnapshotShowsShortList =
      window.drawList.length > 0 &&
      items.length > 0 &&
      window.drawList.length === items.length &&
      minVisibleIndex === 0 &&
      maxVisibleIndex === items.length - 1 &&
      topMostY >= -Number.EPSILON &&
      bottomMostY < viewportHeight - Number.EPSILON;
    this.#visibleSnapshotTrailingGap = this.#visibleSnapshotShowsShortList
      ? Math.max(0, viewportHeight - bottomMostY)
      : 0;
  }

  /**
   * Removes animations for items that are no longer visible.
   * Returns true if any animation was canceled or finalized.
   */
  pruneInvisible(
    adapter: Pick<ReplacementRendererAdapter<C, T>, "onDeleteComplete">,
  ): boolean {
    let changed = false;
    for (const item of [...this.#activeReplacementItems]) {
      const animation = this.#replacementAnimations.get(item);
      const isTracked =
        animation?.kind === "insert"
          ? this.#drawnItems.has(item)
          : this.#visibleItems.has(item);
      if (isTracked) {
        continue;
      }
      this.#replacementAnimations.delete(item);
      this.#activeReplacementItems.delete(item);
      if (animation?.kind === "delete") {
        adapter.onDeleteComplete(item);
      }
      changed = true;
    }
    return changed;
  }

  /** Advance all active animations and return true if any are still running. */
  prepare(
    now: number,
    adapter: Pick<ReplacementRendererAdapter<C, T>, "onDeleteComplete">,
  ): boolean {
    let keepAnimating = false;
    this.#cleanupWindowTranslateAnimation(now);
    if (this.#windowTranslateAnimation != null) {
      keepAnimating = true;
    }
    for (const item of [...this.#activeReplacementItems]) {
      if (this.readAnimation(item, now, adapter) != null) {
        keepAnimating = true;
      }
    }
    return keepAnimating;
  }

  getWindowTranslateY(now: number): number {
    this.#cleanupWindowTranslateAnimation(now);
    const animation = this.#windowTranslateAnimation;
    if (animation == null) {
      return 0;
    }
    return interpolate(
      animation.fromTranslateY,
      animation.toTranslateY,
      animation.startTime,
      animation.duration,
      now,
    );
  }

  /**
   * Returns the active animation for an item, or undefined if none / already
   * completed (and cleans up completed animations as a side effect).
   */
  readAnimation(
    item: T,
    now: number,
    adapter?: Pick<ReplacementRendererAdapter<C, T>, "onDeleteComplete">,
  ): ReplacementAnimation<C> | undefined {
    const animation = this.#replacementAnimations.get(item);
    if (animation == null) {
      return undefined;
    }
    if (getProgress(animation.startTime, animation.duration, now) >= 1) {
      this.#replacementAnimations.delete(item);
      this.#activeReplacementItems.delete(item);
      if (animation.kind === "delete") {
        adapter?.onDeleteComplete(item);
      }
      return undefined;
    }
    return animation;
  }

  /** Returns the effective rendered height for an item, accounting for animations. */
  getItemHeight(
    item: T,
    now: number,
    adapter: Pick<
      ReplacementRendererAdapter<C, T>,
      "renderItem" | "measureNode"
    >,
  ): number {
    const replacement = this.readAnimation(item, now);
    if (replacement != null) {
      return this.#sampleReplacementHeight(replacement, now);
    }
    const node = adapter.renderItem(item);
    return adapter.measureNode(node).height;
  }

  /** Resolves an item to its draw/hittest callbacks for the current frame. */
  resolveItem(
    item: T,
    now: number,
    adapter: ReplacementRendererAdapter<C, T>,
  ): { value: VirtualizedResolvedItem; height: number } {
    const replacement = this.readAnimation(item, now, adapter);
    if (replacement == null) {
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

    const slotHeight = this.#sampleReplacementHeight(replacement, now);
    const layers = this.#readReplacementLayers(
      replacement,
      now,
      adapter.measureNode,
    );

    return {
      value: {
        draw: (y) =>
          this.#drawReplacementLayers(layers, slotHeight, y, adapter),
        hittest: () => false,
      },
      height: slotHeight,
    };
  }

  handleListStateChange(
    change: ListStateChange<T>,
    ctx: ReplacementUpdateContext<C, T>,
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
        this.#replacementAnimations.delete(change.item);
        this.#activeReplacementItems.delete(change.item);
        break;
      case "unshift":
        this.handleUnshift(change.count, change.animation?.duration, ctx);
        break;
      case "push":
        this.handlePush(
          change.count,
          change.animation?.duration,
          change.animation?.distance,
          change.animation?.fade ?? true,
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
    ctx: ReplacementUpdateContext<C, T>,
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
      this.#replacementAnimations.delete(prevItem);
      this.#activeReplacementItems.delete(prevItem);
      return;
    }

    const now = getNow();
    const nextNode = ctx.renderItem(nextItem);
    const nextHeight = ctx.measureNode(nextNode).height;
    const animation = this.readAnimation(prevItem, now, ctx);
    const currentVisualState = this.#readCurrentVisualState(
      prevItem,
      animation,
      now,
      ctx,
    );

    const outgoing =
      currentVisualState.alpha > ALPHA_EPSILON
        ? this.#createLayer(
            currentVisualState.node,
            currentVisualState.alpha,
            0,
            now,
            normalizedDuration,
            currentVisualState.placement,
            currentVisualState.translateY,
            0,
          )
        : undefined;
    const incoming = this.#createLayer(
      nextNode,
      0,
      1,
      now,
      normalizedDuration,
      currentVisualState.placement,
      currentVisualState.translateY,
      0,
    );

    this.#replacementAnimations.delete(prevItem);
    this.#replacementAnimations.set(nextItem, {
      kind: "update",
      outgoing,
      incoming,
      fromHeight: currentVisualState.height,
      toHeight: nextHeight,
      startTime: now,
      duration: normalizedDuration,
    });
    this.#activeReplacementItems.delete(prevItem);
    this.#activeReplacementItems.add(nextItem);
  }

  handleDelete(
    item: T,
    duration: number | undefined,
    ctx: ReplacementUpdateContext<C, T>,
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
      this.#replacementAnimations.delete(item);
      this.#activeReplacementItems.delete(item);
      ctx.onDeleteComplete(item);
      return;
    }

    const now = getNow();
    const animation = this.readAnimation(item, now, ctx);
    const currentVisualState = this.#readCurrentVisualState(
      item,
      animation,
      now,
      ctx,
    );

    const outgoing =
      currentVisualState.alpha > ALPHA_EPSILON
        ? this.#createLayer(
            currentVisualState.node,
            currentVisualState.alpha,
            0,
            now,
            normalizedDuration,
            currentVisualState.placement,
            currentVisualState.translateY,
            0,
          )
        : undefined;

    this.#replacementAnimations.set(item, {
      kind: "delete",
      outgoing,
      incoming: undefined,
      fromHeight: currentVisualState.height,
      toHeight: 0,
      startTime: now,
      duration: normalizedDuration,
    });
    this.#activeReplacementItems.add(item);
  }

  handlePush(
    count: number,
    duration: number | undefined,
    distance: number | undefined,
    fade: boolean,
    ctx: ReplacementUpdateContext<C, T>,
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
      this.#replacementAnimations.set(item, {
        kind: "insert",
        outgoing: undefined,
        incoming: this.#createLayer(
          node,
          fade ? 0 : 1,
          1,
          now,
          duration,
          "start",
          resolvedDistance,
          0,
        ),
        fromHeight: itemHeight,
        toHeight: itemHeight,
        startTime: now,
        duration,
      });
      this.#activeReplacementItems.add(item);
    }
  }

  handleUnshift(
    count: number,
    duration: number | undefined,
    ctx: ReplacementUpdateContext<C, T>,
  ): void {
    if (
      count <= 0 ||
      !(typeof duration === "number" && duration > 0) ||
      !this.#canAnimateInsert("unshift", count, ctx)
    ) {
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
    const travel = Math.min(insertedHeight, this.#visibleSnapshotTrailingGap);
    if (!(travel > 0) || !Number.isFinite(travel)) {
      return;
    }
    this.#windowTranslateAnimation = {
      fromTranslateY: this.getWindowTranslateY(now) - travel,
      toTranslateY: 0,
      startTime: now,
      duration,
    };
  }

  /** Clears all animation state (e.g., on list reset). */
  reset(): void {
    this.#replacementAnimations = new WeakMap<T, ReplacementAnimation<C>>();
    this.#activeReplacementItems.clear();
    this.#windowTranslateAnimation = undefined;
    this.#drawnItems.clear();
    this.#visibleItems.clear();
    this.#hasVisibleItemSnapshot = false;
    this.#visibleSnapshotState = undefined;
    this.#visibleSnapshotShowsShortList = false;
    this.#visibleSnapshotTrailingGap = 0;
  }

  #createLayer(
    node: Node<C>,
    fromAlpha: number,
    toAlpha: number,
    startTime: number,
    duration: number,
    placement: AnimatedLayerPlacement,
    fromTranslateY: number,
    toTranslateY: number,
  ): ReplacementLayer<C> {
    return {
      node,
      fromAlpha,
      toAlpha,
      fromTranslateY,
      toTranslateY,
      placement,
      startTime,
      duration,
    };
  }

  #sampleLayerAlpha(layer: ReplacementLayer<C>, now: number): number {
    return interpolate(
      layer.fromAlpha,
      layer.toAlpha,
      layer.startTime,
      layer.duration,
      now,
    );
  }

  #sampleLayerTranslateY(layer: ReplacementLayer<C>, now: number): number {
    return interpolate(
      layer.fromTranslateY,
      layer.toTranslateY,
      layer.startTime,
      layer.duration,
      now,
    );
  }

  #sampleReplacementHeight(
    animation: ReplacementAnimation<C>,
    now: number,
  ): number {
    return interpolate(
      animation.fromHeight,
      animation.toHeight,
      animation.startTime,
      animation.duration,
      now,
    );
  }

  #readReplacementLayers(
    animation: ReplacementAnimation<C>,
    now: number,
    measureNode: (node: Node<C>) => Box,
  ): SampledLayer<C>[] {
    return [animation.outgoing, animation.incoming]
      .filter((layer): layer is ReplacementLayer<C> => layer != null)
      .map((layer) => ({
        alpha: this.#sampleLayerAlpha(layer, now),
        node: layer.node,
        nodeHeight: measureNode(layer.node).height,
        placement: layer.placement,
        translateY: this.#sampleLayerTranslateY(layer, now),
      }))
      .filter((layer) => layer.alpha > ALPHA_EPSILON);
  }

  #drawReplacementLayers(
    layers: SampledLayer<C>[],
    slotHeight: number,
    y: number,
    adapter: ReplacementRendererAdapter<C, T>,
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
        const layerY =
          y +
          this.#getPlacementOffset(
            layer.placement,
            slotHeight,
            layer.nodeHeight,
          ) +
          layer.translateY;
        if (adapter.drawNode(layer.node, 0, layerY)) {
          result = true;
        }
      } finally {
        adapter.graphics.restore();
      }
    }
    return result;
  }

  #getPlacementOffset(
    placement: AnimatedLayerPlacement,
    slotHeight: number,
    nodeHeight: number,
  ): number {
    return placement === "end" ? slotHeight - nodeHeight : 0;
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
    ctx: ReplacementUpdateContext<C, T>,
  ): boolean {
    if (nextIndex < 0) {
      return false;
    }
    if (
      this.#hasVisibleItemSnapshot &&
      this.#visibleSnapshotState != null &&
      sameState(this.#visibleSnapshotState, ctx.position, ctx.offset)
    ) {
      return (
        this.#visibleItems.has(prevItem) ||
        this.#activeReplacementItems.has(prevItem)
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
    ctx: ReplacementUpdateContext<C, T>,
  ): boolean {
    if (
      !this.#hasVisibleItemSnapshot ||
      this.#visibleSnapshotState == null ||
      !this.#visibleSnapshotShowsShortList
    ) {
      return false;
    }

    const expectedPosition =
      direction === "unshift" && this.#visibleSnapshotState.position != null
        ? this.#visibleSnapshotState.position + count
        : this.#visibleSnapshotState.position;
    return sameState(
      {
        position: expectedPosition,
        offset: this.#visibleSnapshotState.offset,
      },
      ctx.position,
      ctx.offset,
    );
  }

  #readCurrentVisualState(
    item: T,
    animation: ReplacementAnimation<C> | undefined,
    now: number,
    ctx: ReplacementUpdateContext<C, T>,
  ): CurrentVisualState<C> {
    if (animation?.incoming != null) {
      return {
        node: animation.incoming.node,
        alpha: this.#sampleLayerAlpha(animation.incoming, now),
        height: this.#sampleReplacementHeight(animation, now),
        placement: animation.incoming.placement,
        translateY: this.#sampleLayerTranslateY(animation.incoming, now),
      };
    }
    if (animation?.outgoing != null) {
      return {
        node: animation.outgoing.node,
        alpha: this.#sampleLayerAlpha(animation.outgoing, now),
        height: this.#sampleReplacementHeight(animation, now),
        placement: animation.outgoing.placement,
        translateY: this.#sampleLayerTranslateY(animation.outgoing, now),
      };
    }

    const node = ctx.renderItem(item);
    return {
      node,
      alpha: 1,
      height: ctx.measureNode(node).height,
      placement: ctx.defaultAnimatedPlacement,
      translateY: 0,
    };
  }

  #cleanupWindowTranslateAnimation(now: number): void {
    const animation = this.#windowTranslateAnimation;
    if (
      animation != null &&
      getProgress(animation.startTime, animation.duration, now) >= 1
    ) {
      this.#windowTranslateAnimation = undefined;
    }
  }
}
