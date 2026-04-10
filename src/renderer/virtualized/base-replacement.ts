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
  getAnimatedLayerOffset: (slotHeight: number, nodeHeight: number) => number;
  onDeleteComplete: (item: T) => void;
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

  // Visible-item snapshot used to decide whether an update can be animated.
  #visibleItems = new Set<T>();
  #hasVisibleItemSnapshot = false;
  #visibleSnapshotState: ControlledState | undefined;

  captureVisibleItemSnapshot(
    window: VisibleWindow<unknown>,
    items: readonly T[],
    readVisibleRange: (
      top: number,
      height: number,
    ) => { top: number; bottom: number } | undefined,
    readListState: () => ControlledState,
  ): void {
    const nextVisibleItems = new Set<T>();
    for (const { idx, offset, height } of window.drawList) {
      if (readVisibleRange(offset + window.shift, height) == null) {
        continue;
      }
      const item = items[idx];
      if (item != null) {
        nextVisibleItems.add(item);
      }
    }
    this.#visibleItems = nextVisibleItems;
    this.#hasVisibleItemSnapshot = true;
    this.#visibleSnapshotState = readListState();
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
      if (this.#visibleItems.has(item)) {
        continue;
      }
      const animation = this.#replacementAnimations.get(item);
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
    for (const item of [...this.#activeReplacementItems]) {
      if (this.readAnimation(item, now, adapter) != null) {
        keepAnimating = true;
      }
    }
    return keepAnimating;
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
      case "push":
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

    let currentNode: Node<C>;
    let currentAlpha = 1;
    let fromHeight: number;
    if (animation == null || animation.incoming == null) {
      currentNode = ctx.renderItem(prevItem);
      fromHeight = ctx.measureNode(currentNode).height;
    } else {
      currentNode = animation.incoming.node;
      currentAlpha = this.#sampleLayerAlpha(animation.incoming, now);
      fromHeight = this.#sampleReplacementHeight(animation, now);
    }

    const outgoing =
      currentAlpha > ALPHA_EPSILON
        ? this.#createLayer(
            currentNode,
            currentAlpha,
            0,
            now,
            normalizedDuration,
          )
        : undefined;
    const incoming = this.#createLayer(nextNode, 0, 1, now, normalizedDuration);

    this.#replacementAnimations.delete(prevItem);
    this.#replacementAnimations.set(nextItem, {
      kind: "update",
      outgoing,
      incoming,
      fromHeight,
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

    let currentNode: Node<C>;
    let currentAlpha = 1;
    let fromHeight: number;
    if (animation == null) {
      currentNode = ctx.renderItem(item);
      fromHeight = ctx.measureNode(currentNode).height;
    } else if (animation.incoming != null) {
      currentNode = animation.incoming.node;
      currentAlpha = this.#sampleLayerAlpha(animation.incoming, now);
      fromHeight = this.#sampleReplacementHeight(animation, now);
    } else if (animation.outgoing != null) {
      currentNode = animation.outgoing.node;
      currentAlpha = this.#sampleLayerAlpha(animation.outgoing, now);
      fromHeight = this.#sampleReplacementHeight(animation, now);
    } else {
      currentNode = ctx.renderItem(item);
      fromHeight = ctx.measureNode(currentNode).height;
    }

    const outgoing =
      currentAlpha > ALPHA_EPSILON
        ? this.#createLayer(
            currentNode,
            currentAlpha,
            0,
            now,
            normalizedDuration,
          )
        : undefined;

    this.#replacementAnimations.set(item, {
      kind: "delete",
      outgoing,
      incoming: undefined,
      fromHeight,
      toHeight: 0,
      startTime: now,
      duration: normalizedDuration,
    });
    this.#activeReplacementItems.add(item);
  }

  /** Clears all animation state (e.g., on list reset). */
  reset(): void {
    this.#replacementAnimations = new WeakMap<T, ReplacementAnimation<C>>();
    this.#activeReplacementItems.clear();
    this.#visibleItems.clear();
    this.#hasVisibleItemSnapshot = false;
    this.#visibleSnapshotState = undefined;
  }

  #createLayer(
    node: Node<C>,
    fromAlpha: number,
    toAlpha: number,
    startTime: number,
    duration: number,
  ): ReplacementLayer<C> {
    return { node, fromAlpha, toAlpha, startTime, duration };
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
  ): { alpha: number; node: Node<C>; nodeHeight: number }[] {
    return [animation.outgoing, animation.incoming]
      .filter((layer): layer is ReplacementLayer<C> => layer != null)
      .map((layer) => ({
        alpha: this.#sampleLayerAlpha(layer, now),
        node: layer.node,
        nodeHeight: measureNode(layer.node).height,
      }))
      .filter((layer) => layer.alpha > ALPHA_EPSILON);
  }

  #drawReplacementLayers(
    layers: { alpha: number; node: Node<C>; nodeHeight: number }[],
    slotHeight: number,
    y: number,
    adapter: ReplacementRendererAdapter<C, T>,
  ): boolean {
    if (slotHeight <= 0) {
      return false;
    }

    let result = false;
    const width = adapter.graphics.canvas.clientWidth;
    for (const layer of layers) {
      const alpha = clamp(layer.alpha, 0, 1);
      if (alpha <= ALPHA_EPSILON) {
        continue;
      }

      adapter.graphics.save();
      try {
        adapter.graphics.beginPath?.();
        adapter.graphics.rect?.(0, y, width, slotHeight);
        adapter.graphics.clip?.();
        if (typeof adapter.graphics.globalAlpha === "number") {
          adapter.graphics.globalAlpha *= alpha;
        }
        const layerY =
          y + adapter.getAnimatedLayerOffset(slotHeight, layer.nodeHeight);
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
}
