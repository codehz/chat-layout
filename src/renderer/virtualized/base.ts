import type { HitTest, Node, RenderFeedback } from "../../types";
import { BaseRenderer } from "../base";
import {
  ListState,
  subscribeListState,
  type ListStateChange,
} from "../list-state";
import type {
  NormalizedListState,
  VisibleListState,
  VisibleWindow,
} from "./solver";

/**
 * Options for programmatic scrolling to a target item.
 */
export interface JumpToOptions {
  /** Whether to animate the jump. Defaults to `true`. */
  animated?: boolean;
  /** Which edge of the item should align with the viewport. */
  block?: "start" | "center" | "end";
  /** Animation duration in milliseconds. */
  duration?: number;
  /** Called after the jump completes or finishes animating. */
  onComplete?: () => void;
}

type ControlledState = {
  position?: number;
  offset: number;
};

type JumpAnimation = {
  startAnchor: number;
  targetAnchor: number;
  startTime: number;
  duration: number;
  needsMoreFrames: boolean;
  onComplete: (() => void) | undefined;
};

type ReplacementLayer<C extends CanvasRenderingContext2D> = {
  key: number;
  node: Node<C>;
  fromAlpha: number;
  toAlpha: number;
  startTime: number;
  duration: number;
};

type ReplacementAnimation<C extends CanvasRenderingContext2D> = {
  currentLayerKey: number;
  layers: ReplacementLayer<C>[];
  fromHeight: number;
  toHeight: number;
  startTime: number;
  duration: number;
};

type VirtualizedResolvedItem<C extends CanvasRenderingContext2D> = {
  draw: (y: number) => boolean;
  hittest: (test: HitTest, y: number) => boolean;
};

const ALPHA_EPSILON = 1e-3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sameState(
  state: ControlledState,
  position: number | undefined,
  offset: number,
): boolean {
  return Object.is(state.position, position) && Object.is(state.offset, offset);
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function getProgress(startTime: number, duration: number, now: number): number {
  if (!(duration > 0)) {
    return 1;
  }
  return clamp((now - startTime) / duration, 0, 1);
}

function interpolate(
  from: number,
  to: number,
  startTime: number,
  duration: number,
  now: number,
): number {
  const progress = getProgress(startTime, duration, now);
  const eased = progress >= 1 ? 1 : smoothstep(progress);
  return from + (to - from) * eased;
}

function getNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

/**
 * Shared base class for virtualized list renderers.
 */
export abstract class VirtualizedRenderer<
  C extends CanvasRenderingContext2D,
  T extends {},
> extends BaseRenderer<
  C,
  {
    renderItem: (item: T) => Node<C>;
    list: ListState<T>;
  }
> {
  static readonly MIN_JUMP_DURATION = 160;
  static readonly MAX_JUMP_DURATION = 420;
  static readonly JUMP_DURATION_PER_ITEM = 28;

  #controlledState: ControlledState | undefined;
  #jumpAnimation: JumpAnimation | undefined;
  #replacementAnimations = new WeakMap<T, ReplacementAnimation<C>>();
  #activeReplacementItems = new Set<T>();
  #visibleItems = new Set<T>();
  #hasVisibleItemSnapshot = false;
  #nextReplacementLayerKey = 0;

  constructor(
    graphics: C,
    options: {
      renderItem: (item: T) => Node<C>;
      list: ListState<T>;
    },
  ) {
    super(graphics, options);
    subscribeListState(options.list, this, (owner, change) => {
      owner.#handleListStateChange(change);
    });
  }

  /** Current anchor item index. */
  get position(): number | undefined {
    return this.options.list.position;
  }

  /** Updates the current anchor item index. */
  set position(value: number | undefined) {
    this.options.list.position = value;
  }

  /** Pixel offset from the anchored item edge. */
  get offset(): number {
    return this.options.list.offset;
  }

  /** Updates the pixel offset from the anchored item edge. */
  set offset(value: number) {
    this.options.list.offset = value;
  }

  /** Items currently available to the renderer. */
  get items(): T[] {
    return this.options.list.items;
  }

  /** Replaces the current item collection. */
  set items(value: T[]) {
    this.options.list.items = value;
  }

  /** Renders the current visible window. */
  abstract render(feedback?: RenderFeedback): boolean;
  /** Hit-tests the current visible window. */
  abstract hittest(test: {
    x: number;
    y: number;
    type: "click" | "auxclick" | "hover";
  }): boolean;

  protected _readListState(): VisibleListState {
    return {
      position: this.position,
      offset: this.offset,
    };
  }

  protected _commitListState(state: NormalizedListState): void {
    this.position = state.position;
    this.offset = state.offset;
  }

  /**
   * Scrolls the viewport to the requested item index.
   */
  jumpTo(index: number, options: JumpToOptions = {}): void {
    if (this.items.length === 0) {
      this.#cancelJumpAnimation();
      return;
    }

    const targetIndex = this._clampItemIndex(index);
    const currentState = this._normalizeListState(this._readListState());
    const targetBlock = options.block ?? this._getDefaultJumpBlock();
    const targetAnchor = this._getTargetAnchor(targetIndex, targetBlock);

    const animated = options.animated ?? true;
    if (!animated) {
      this.#cancelJumpAnimation();
      this._applyAnchor(targetAnchor);
      options.onComplete?.();
      return;
    }

    const startAnchor = this._readAnchor(currentState);
    if (!Number.isFinite(startAnchor)) {
      this.#cancelJumpAnimation();
      this._applyAnchor(targetAnchor);
      options.onComplete?.();
      return;
    }

    const duration = clamp(
      options.duration ??
        VirtualizedRenderer.MIN_JUMP_DURATION +
          Math.abs(targetAnchor - startAnchor) *
            VirtualizedRenderer.JUMP_DURATION_PER_ITEM,
      0,
      VirtualizedRenderer.MAX_JUMP_DURATION,
    );

    if (
      duration <= 0 ||
      Math.abs(targetAnchor - startAnchor) <= Number.EPSILON
    ) {
      this.#cancelJumpAnimation();
      this._applyAnchor(targetAnchor);
      options.onComplete?.();
      return;
    }

    this.#jumpAnimation = {
      startAnchor,
      targetAnchor,
      startTime: getNow(),
      duration,
      needsMoreFrames: true,
      onComplete: options.onComplete,
    };
    this.#controlledState = this._readListState();
  }

  protected _resetRenderFeedback(feedback?: RenderFeedback): void {
    if (feedback == null) {
      return;
    }
    feedback.minIdx = Number.NaN;
    feedback.maxIdx = Number.NaN;
    feedback.min = Number.NaN;
    feedback.max = Number.NaN;
  }

  protected _accumulateRenderFeedback(
    feedback: RenderFeedback,
    idx: number,
    top: number,
    height: number,
  ): void {
    const visibleRange = this._readVisibleRange(top, height);
    if (visibleRange == null) {
      return;
    }

    const itemMin = idx + visibleRange.top / height;
    const itemMax = idx + visibleRange.bottom / height;
    feedback.minIdx = Number.isNaN(feedback.minIdx)
      ? idx
      : Math.min(idx, feedback.minIdx);
    feedback.maxIdx = Number.isNaN(feedback.maxIdx)
      ? idx
      : Math.max(idx, feedback.maxIdx);
    feedback.min = Number.isNaN(feedback.min)
      ? itemMin
      : Math.min(itemMin, feedback.min);
    feedback.max = Number.isNaN(feedback.max)
      ? itemMax
      : Math.max(itemMax, feedback.max);
  }

  protected _renderDrawList(
    list: VisibleWindow<VirtualizedResolvedItem<C>>["drawList"],
    shift: number,
    feedback?: RenderFeedback,
  ): boolean {
    let result = false;
    const viewportHeight = this.graphics.canvas.clientHeight;

    for (const { idx, value: item, offset, height } of list) {
      const y = offset + shift;
      if (feedback != null) {
        this._accumulateRenderFeedback(feedback, idx, y, height);
      }
      if (y + height < 0 || y > viewportHeight) {
        continue;
      }
      if (item.draw(y)) {
        result = true;
      }
    }

    return result;
  }

  protected _renderVisibleWindow(
    window: VisibleWindow<VirtualizedResolvedItem<C>>,
    feedback?: RenderFeedback,
  ): boolean {
    this._resetRenderFeedback(feedback);
    return this._renderDrawList(window.drawList, window.shift, feedback);
  }

  protected _readVisibleRange(
    top: number,
    height: number,
  ): { top: number; bottom: number } | undefined {
    if (!Number.isFinite(top) || !Number.isFinite(height) || height <= 0) {
      return undefined;
    }

    const viewportHeight = this.graphics.canvas.clientHeight;
    const visibleTop = clamp(-top, 0, height);
    const visibleBottom = clamp(viewportHeight - top, 0, height);
    if (visibleBottom <= visibleTop) {
      return undefined;
    }

    return {
      top: visibleTop,
      bottom: visibleBottom,
    };
  }

  protected _updateVisibleItemSnapshot(
    window: VisibleWindow<unknown>,
  ): boolean {
    const nextVisibleItems = new Set<T>();
    for (const { idx, offset, height } of window.drawList) {
      if (this._readVisibleRange(offset + window.shift, height) == null) {
        continue;
      }
      const item = this.items[idx];
      if (item != null) {
        nextVisibleItems.add(item);
      }
    }

    this.#visibleItems = nextVisibleItems;
    this.#hasVisibleItemSnapshot = true;

    let canceled = false;
    for (const item of [...this.#activeReplacementItems]) {
      if (nextVisibleItems.has(item)) {
        continue;
      }
      this.#replacementAnimations.delete(item);
      this.#activeReplacementItems.delete(item);
      canceled = true;
    }
    return canceled;
  }

  protected _hittestVisibleWindow(
    window: VisibleWindow<VirtualizedResolvedItem<C>>,
    test: HitTest,
  ): boolean {
    for (const { value: item, offset, height } of window.drawList) {
      const y = offset + window.shift;
      if (test.y < y || test.y >= y + height) {
        continue;
      }
      return item.hittest(test, y);
    }
    return false;
  }

  protected _prepareRender(): boolean {
    const now = getNow();
    const keepReplacing = this.#prepareReplacementAnimations(now);
    const animation = this.#jumpAnimation;
    if (animation == null) {
      return keepReplacing;
    }
    if (this.items.length === 0) {
      this.#cancelJumpAnimation();
      return keepReplacing;
    }
    if (
      this.#controlledState != null &&
      !sameState(this.#controlledState, this.position, this.offset)
    ) {
      this.#cancelJumpAnimation();
      return keepReplacing;
    }

    const anchor = interpolate(
      animation.startAnchor,
      animation.targetAnchor,
      animation.startTime,
      animation.duration,
      now,
    );
    const progress = getProgress(animation.startTime, animation.duration, now);
    this._applyAnchor(anchor);
    animation.needsMoreFrames = progress < 1;
    return keepReplacing || animation.needsMoreFrames;
  }

  protected _finishRender(requestRedraw: boolean): boolean {
    const animation = this.#jumpAnimation;
    if (animation == null) {
      return requestRedraw;
    }

    if (animation.needsMoreFrames) {
      this.#controlledState = this._readListState();
      return true;
    }

    const onComplete = animation.onComplete;
    this.#cancelJumpAnimation();
    onComplete?.();
    return requestRedraw || this.#jumpAnimation != null;
  }

  protected _clampItemIndex(index: number): number {
    return clamp(
      Number.isFinite(index) ? Math.trunc(index) : 0,
      0,
      this.items.length - 1,
    );
  }

  protected _getItemHeight(index: number): number {
    const now = getNow();
    const item = this.items[index]!;
    const replacement = this.#readReplacementAnimation(item, now);
    if (replacement != null) {
      return this.#sampleReplacementHeight(replacement, now);
    }
    const node = this.options.renderItem(item);
    return this.measureRootNode(node).height;
  }

  protected _resolveItem(
    item: T,
    _index: number,
    now: number,
  ): { value: VirtualizedResolvedItem<C>; height: number } {
    const replacement = this.#readReplacementAnimation(item, now);
    if (replacement == null) {
      const node = this.options.renderItem(item);
      return {
        value: {
          draw: (y) => this.drawRootNode(node, 0, y),
          hittest: (test, y) =>
            node.hittest(this.getRootContext(), {
              ...test,
              y: test.y - y,
            }),
        },
        height: this.measureRootNode(node).height,
      };
    }

    const slotHeight = this.#sampleReplacementHeight(replacement, now);
    const layers = replacement.layers
      .map((layer) => ({
        alpha: this.#sampleLayerAlpha(layer, now),
        node: layer.node,
        nodeHeight: this.measureRootNode(layer.node).height,
      }))
      .filter((layer) => layer.alpha > ALPHA_EPSILON);

    return {
      value: {
        draw: (y) => this.#drawReplacementLayers(layers, slotHeight, y),
        hittest: () => false,
      },
      height: slotHeight,
    };
  }

  protected _getAnchorAtOffset(index: number, offset: number): number {
    if (this.items.length === 0) {
      return 0;
    }

    let currentIndex = this._clampItemIndex(index);
    let remaining = Number.isFinite(offset) ? offset : 0;
    while (true) {
      if (remaining < 0) {
        if (currentIndex === 0) {
          return 0;
        }
        currentIndex -= 1;
        const height = this._getItemHeight(currentIndex);
        if (height > 0) {
          remaining += height;
        }
        continue;
      }

      const height = this._getItemHeight(currentIndex);
      if (height > 0) {
        if (remaining <= height) {
          return currentIndex + remaining / height;
        }
        remaining -= height;
      } else if (remaining === 0) {
        return currentIndex;
      }

      if (currentIndex === this.items.length - 1) {
        return this.items.length;
      }
      currentIndex += 1;
    }
  }

  protected abstract _normalizeListState(
    state: VisibleListState,
  ): NormalizedListState;
  protected abstract _readAnchor(state: NormalizedListState): number;
  protected abstract _applyAnchor(anchor: number): void;
  protected abstract _getDefaultJumpBlock(): NonNullable<
    JumpToOptions["block"]
  >;
  protected abstract _getTargetAnchor(
    index: number,
    block: NonNullable<JumpToOptions["block"]>,
  ): number;
  protected abstract _getAnimatedLayerOffset(
    slotHeight: number,
    nodeHeight: number,
  ): number;

  #cancelJumpAnimation(): void {
    this.#jumpAnimation = undefined;
    this.#controlledState = undefined;
  }

  #createReplacementLayer(
    node: Node<C>,
    fromAlpha: number,
    toAlpha: number,
    startTime: number,
    duration: number,
  ): ReplacementLayer<C> {
    return {
      key: ++this.#nextReplacementLayerKey,
      node,
      fromAlpha,
      toAlpha,
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

  #isLayerComplete(layer: ReplacementLayer<C>, now: number): boolean {
    return (
      getProgress(layer.startTime, layer.duration, now) >= 1 &&
      Math.abs(layer.toAlpha - this.#sampleLayerAlpha(layer, now)) <=
        ALPHA_EPSILON
    );
  }

  #readReplacementAnimation(
    item: T,
    now: number,
  ): ReplacementAnimation<C> | undefined {
    const animation = this.#replacementAnimations.get(item);
    if (animation == null) {
      return undefined;
    }

    const currentLayer = animation.layers.find(
      (layer) => layer.key === animation.currentLayerKey,
    );
    if (currentLayer == null) {
      this.#replacementAnimations.delete(item);
      this.#activeReplacementItems.delete(item);
      return undefined;
    }

    animation.layers = animation.layers.filter(
      (layer) =>
        layer.key === animation.currentLayerKey ||
        !this.#isLayerComplete(layer, now),
    );
    if (
      getProgress(animation.startTime, animation.duration, now) >= 1 &&
      this.#isLayerComplete(currentLayer, now) &&
      animation.layers.length === 1
    ) {
      this.#replacementAnimations.delete(item);
      this.#activeReplacementItems.delete(item);
      return undefined;
    }

    return animation;
  }

  #prepareReplacementAnimations(now: number): boolean {
    let keepAnimating = false;
    for (const item of [...this.#activeReplacementItems]) {
      if (this.#readReplacementAnimation(item, now) != null) {
        keepAnimating = true;
      }
    }
    return keepAnimating;
  }

  #drawReplacementLayers(
    layers: { alpha: number; node: Node<C>; nodeHeight: number }[],
    slotHeight: number,
    y: number,
  ): boolean {
    if (slotHeight <= 0) {
      return false;
    }

    let result = false;
    const width = this.graphics.canvas.clientWidth;
    for (const layer of layers) {
      const alpha = clamp(layer.alpha, 0, 1);
      if (alpha <= ALPHA_EPSILON) {
        continue;
      }

      this.graphics.save();
      try {
        this.graphics.beginPath?.();
        this.graphics.rect?.(0, y, width, slotHeight);
        this.graphics.clip?.();
        if (typeof this.graphics.globalAlpha === "number") {
          this.graphics.globalAlpha *= alpha;
        }
        const layerY =
          y + this._getAnimatedLayerOffset(slotHeight, layer.nodeHeight);
        if (this.drawRootNode(layer.node, 0, layerY)) {
          result = true;
        }
      } finally {
        this.graphics.restore();
      }
    }
    return result;
  }

  #handleListStateChange(change: ListStateChange<T>): void {
    switch (change.type) {
      case "update":
        this.#handleUpdate(
          change.prevItem,
          change.nextItem,
          change.animation?.duration,
        );
        break;
      case "unshift":
      case "push":
        break;
      case "reset":
      case "set":
        this.#replacementAnimations = new WeakMap<T, ReplacementAnimation<C>>();
        this.#activeReplacementItems.clear();
        this.#visibleItems.clear();
        this.#hasVisibleItemSnapshot = false;
        break;
    }
  }

  #handleUpdate(prevItem: T, nextItem: T, duration: number | undefined): void {
    const normalizedDuration = Math.max(
      0,
      typeof duration === "number" && Number.isFinite(duration) ? duration : 0,
    );
    if (
      normalizedDuration <= 0 ||
      (this.#hasVisibleItemSnapshot &&
        !this.#visibleItems.has(prevItem) &&
        !this.#activeReplacementItems.has(prevItem))
    ) {
      this.#replacementAnimations.delete(prevItem);
      this.#activeReplacementItems.delete(prevItem);
      return;
    }

    const now = getNow();
    const nextNode = this.options.renderItem(nextItem);
    const nextHeight = this.measureRootNode(nextNode).height;
    const animation = this.#readReplacementAnimation(prevItem, now);
    if (animation == null) {
      const prevNode = this.options.renderItem(prevItem);
      const outgoing = this.#createReplacementLayer(
        prevNode,
        1,
        0,
        now,
        normalizedDuration,
      );
      const incoming = this.#createReplacementLayer(
        nextNode,
        0,
        1,
        now,
        normalizedDuration,
      );
      this.#replacementAnimations.set(nextItem, {
        currentLayerKey: incoming.key,
        layers: [outgoing, incoming],
        fromHeight: this.measureRootNode(prevNode).height,
        toHeight: nextHeight,
        startTime: now,
        duration: normalizedDuration,
      });
      this.#activeReplacementItems.delete(prevItem);
      this.#activeReplacementItems.add(nextItem);
      return;
    }

    const currentLayer = animation.layers.find(
      (layer) => layer.key === animation.currentLayerKey,
    );
    const currentNode = currentLayer?.node ?? this.options.renderItem(prevItem);
    const currentAlpha =
      currentLayer == null ? 1 : this.#sampleLayerAlpha(currentLayer, now);
    const layers = animation.layers.filter(
      (layer) =>
        layer.key !== animation.currentLayerKey &&
        !this.#isLayerComplete(layer, now),
    );
    if (currentAlpha > ALPHA_EPSILON) {
      layers.push(
        this.#createReplacementLayer(
          currentNode,
          currentAlpha,
          0,
          now,
          normalizedDuration,
        ),
      );
    }
    const incoming = this.#createReplacementLayer(
      nextNode,
      0,
      1,
      now,
      normalizedDuration,
    );
    layers.push(incoming);
    this.#replacementAnimations.delete(prevItem);
    this.#replacementAnimations.set(nextItem, {
      currentLayerKey: incoming.key,
      layers,
      fromHeight: this.#sampleReplacementHeight(animation, now),
      toHeight: nextHeight,
      startTime: now,
      duration: normalizedDuration,
    });
    this.#activeReplacementItems.delete(prevItem);
    this.#activeReplacementItems.add(nextItem);
  }
}
