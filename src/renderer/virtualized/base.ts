import type { HitTest, Node, RenderFeedback } from "../../types";
import { BaseRenderer } from "../base";
import {
  ListState,
  subscribeListState,
  type ListStateChange,
} from "../list-state";
import {
  buildJumpPath,
  clamp,
  getNow,
  getAnchorAtDistance,
  getProgress,
  sameState,
  smoothstep,
} from "./base-animation";
import {
  type ControlledState,
  type JumpAnimation,
  type VirtualizedResolvedItem,
} from "./base-types";
import {
  TransitionController,
  type TransitionContext,
  type TransitionRendererAdapter,
} from "./base-transition";
import type {
  NormalizedListState,
  ResolvedListLayoutOptions,
  VisibleListState,
  VisibleWindow,
  VisibleWindowResult,
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
  static readonly JUMP_DURATION_PER_PIXEL = 0.7;

  #controlledState: ControlledState | undefined;
  #jumpAnimation: JumpAnimation | undefined;
  #transitionController = new TransitionController<C, T>();

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
  render(feedback?: RenderFeedback): boolean {
    const now = getNow();
    const keepAnimating = this._prepareRender(now);
    const { clientWidth: viewportWidth, clientHeight: viewportHeight } =
      this.graphics.canvas;
    this.graphics.clearRect(0, 0, viewportWidth, viewportHeight);

    let solution = this._resolveVisibleWindow(now);
    let viewportTranslateY =
      this.#transitionController.getViewportTranslateY(now);
    this._captureVisibleItemSnapshot(solution.window, viewportTranslateY);
    const requestSettleRedraw = this._pruneTransitionAnimations(
      solution.window,
    );
    if (requestSettleRedraw) {
      solution = this._resolveVisibleWindow(now);
      viewportTranslateY =
        this.#transitionController.getViewportTranslateY(now);
      this._captureVisibleItemSnapshot(solution.window, viewportTranslateY);
    }
    const requestRedraw = this._renderVisibleWindow(
      solution.window,
      feedback,
      viewportTranslateY,
    );
    this._commitListState(solution.normalizedState);

    return this._finishRender(
      keepAnimating || requestRedraw || requestSettleRedraw,
    );
  }

  /** Hit-tests the current visible window. */
  hittest(test: {
    x: number;
    y: number;
    type: "click" | "auxclick" | "hover";
  }): boolean {
    const now = getNow();
    let solution = this._resolveVisibleWindow(now);
    let viewportTranslateY =
      this.#transitionController.getViewportTranslateY(now);
    this._captureVisibleItemSnapshot(solution.window, viewportTranslateY);
    if (this._pruneTransitionAnimations(solution.window)) {
      solution = this._resolveVisibleWindow(now);
      viewportTranslateY =
        this.#transitionController.getViewportTranslateY(now);
      this._captureVisibleItemSnapshot(solution.window, viewportTranslateY);
    }
    return this._hittestVisibleWindow(
      solution.window,
      test,
      viewportTranslateY,
    );
  }

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

    const path = buildJumpPath(
      this.items.length,
      this._getItemHeight.bind(this),
      startAnchor,
      targetAnchor,
    );
    const duration = clamp(
      options.duration ??
        VirtualizedRenderer.MIN_JUMP_DURATION +
          path.totalDistance * VirtualizedRenderer.JUMP_DURATION_PER_PIXEL,
      0,
      VirtualizedRenderer.MAX_JUMP_DURATION,
    );

    if (duration <= 0 || path.totalDistance <= Number.EPSILON) {
      this.#cancelJumpAnimation();
      this._applyAnchor(targetAnchor);
      options.onComplete?.();
      return;
    }

    this.#jumpAnimation = {
      path,
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
    list: VisibleWindow<VirtualizedResolvedItem>["drawList"],
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
    window: VisibleWindow<VirtualizedResolvedItem>,
    feedback?: RenderFeedback,
    extraShift = 0,
  ): boolean {
    this._resetRenderFeedback(feedback);
    return this._renderDrawList(
      window.drawList,
      window.shift + extraShift,
      feedback,
    );
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

  protected _pruneTransitionAnimations(
    _window: VisibleWindow<unknown>,
  ): boolean {
    return this.#transitionController.pruneInvisible({
      onDeleteComplete: this.#handleDeleteComplete.bind(this),
    });
  }

  protected _hittestVisibleWindow(
    window: VisibleWindow<VirtualizedResolvedItem>,
    test: HitTest,
    extraShift = 0,
  ): boolean {
    for (const { value: item, offset, height } of window.drawList) {
      const y = offset + window.shift + extraShift;
      if (test.y < y || test.y >= y + height) {
        continue;
      }
      return item.hittest(test, y);
    }
    return false;
  }

  protected _captureVisibleItemSnapshot(
    window: VisibleWindow<unknown>,
    extraShift = 0,
  ): void {
    const normalizedState = this._normalizeListState(this._readListState());
    this.#transitionController.captureVisibilitySnapshot(
      window,
      this.items,
      this.graphics.canvas.clientHeight,
      normalizedState,
      this._getLayoutOptions(),
      extraShift,
      this._readVisibleRange.bind(this),
    );
  }

  protected _prepareRender(now: number): boolean {
    const keepTransitioning = this.#transitionController.prepare(now, {
      onDeleteComplete: this.#handleDeleteComplete.bind(this),
    });
    const animation = this.#jumpAnimation;
    if (animation == null) {
      return keepTransitioning;
    }
    if (this.items.length === 0) {
      this.#cancelJumpAnimation();
      return keepTransitioning;
    }
    if (
      this.#controlledState != null &&
      !sameState(this.#controlledState, this.position, this.offset)
    ) {
      this.#cancelJumpAnimation();
      return keepTransitioning;
    }

    const progress = getProgress(animation.startTime, animation.duration, now);
    const eased = progress >= 1 ? 1 : smoothstep(progress);
    const anchor = getAnchorAtDistance(
      animation.path,
      animation.path.totalDistance * eased,
    );
    this._applyAnchor(anchor);
    animation.needsMoreFrames = progress < 1;
    return keepTransitioning || animation.needsMoreFrames;
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
    const item = this.items[index]!;
    return this.#transitionController.getItemHeight(item, getNow(), {
      renderItem: this.options.renderItem,
      measureNode: this.measureRootNode.bind(this),
    });
  }

  protected _resolveItem(
    item: T,
    _index: number,
    now: number,
  ): { value: VirtualizedResolvedItem; height: number } {
    return this.#transitionController.resolveItem(
      item,
      now,
      this.#getTransitionRendererAdapter(),
    );
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
  protected abstract _getLayoutOptions(): ResolvedListLayoutOptions;
  protected abstract _resolveVisibleWindow(
    now: number,
  ): VisibleWindowResult<VirtualizedResolvedItem>;
  protected abstract _readAnchor(state: NormalizedListState): number;
  protected abstract _applyAnchor(anchor: number): void;
  protected abstract _getDefaultJumpBlock(): NonNullable<
    JumpToOptions["block"]
  >;
  protected abstract _getTargetAnchor(
    index: number,
    block: NonNullable<JumpToOptions["block"]>,
  ): number;

  // ── Jump animation ─────────────────────────────────────────────────────────

  #cancelJumpAnimation(): void {
    this.#jumpAnimation = undefined;
    this.#controlledState = undefined;
  }

  // ── Transition animation delegation ────────────────────────────────────────

  #handleDeleteComplete(item: T): void {
    this.options.list.finalizeDelete(item);
  }

  #getTransitionRendererAdapter(): TransitionRendererAdapter<C, T> {
    return {
      renderItem: this.options.renderItem,
      measureNode: this.measureRootNode.bind(this),
      drawNode: this.drawRootNode.bind(this),
      getRootContext: this.getRootContext.bind(this),
      graphics: this.graphics,
      onDeleteComplete: this.#handleDeleteComplete.bind(this),
    };
  }

  #getTransitionContext(): TransitionContext<C, T> {
    return {
      ...this.#getTransitionRendererAdapter(),
      items: this.items,
      position: this.position,
      offset: this.offset,
      layout: this._getLayoutOptions(),
      readListState: this._readListState.bind(this),
      readVisibleRange: this._readVisibleRange.bind(this),
      resolveVisibleWindow: () => this._resolveVisibleWindow(getNow()),
    };
  }

  #handleListStateChange(change: ListStateChange<T>): void {
    this.#transitionController.handleListStateChange(
      change,
      this.#getTransitionContext(),
    );
  }
}
