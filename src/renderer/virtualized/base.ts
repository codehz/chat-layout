import type { HitTest, Node, RenderFeedback } from "../../types";
import { BaseRenderer } from "../base";
import {
  ListState,
  subscribeListState,
  type ListStateChange,
} from "../list-state";
import { clamp, getNow } from "./base-animation";
import type {
  AutoFollowCapabilities,
  ControlledState,
  VirtualizedResolvedItem,
} from "./base-types";
import { prepareFrameSession } from "./frame-session";
import { JumpController } from "./jump-controller";
import {
  TransitionController,
  type TransitionLifecycleAdapter,
  type TransitionPlanningAdapter,
  type TransitionRenderAdapter,
  type VirtualizedRuntime,
} from "./base-transition";
import type {
  ListViewportMetrics,
  NormalizedListState,
  ResolvedListLayoutOptions,
  VisibleListState,
  VisibleWindow,
  VisibleWindowResult,
} from "./solver";
import { resolveListViewport } from "./solver";

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

  #jumpController: JumpController<T>;
  #transitionController = new TransitionController<C, T>();

  constructor(
    graphics: C,
    options: {
      renderItem: (item: T) => Node<C>;
      list: ListState<T>;
    },
  ) {
    super(graphics, options);
    this.#jumpController = new JumpController<T>({
      minJumpDuration: VirtualizedRenderer.MIN_JUMP_DURATION,
      maxJumpDuration: VirtualizedRenderer.MAX_JUMP_DURATION,
      jumpDurationPerPixel: VirtualizedRenderer.JUMP_DURATION_PER_PIXEL,
      getItemCount: () => this.items.length,
      readListState: this._readListState.bind(this),
      normalizeListState: this._normalizeListState.bind(this),
      readAnchor: (state) =>
        this._readAnchor(state, this._getItemHeight.bind(this)),
      applyAnchor: this._applyAnchor.bind(this),
      getDefaultJumpBlock: this._getDefaultJumpBlock.bind(this),
      getTargetAnchor: this._getTargetAnchor.bind(this),
      clampItemIndex: this._clampItemIndex.bind(this),
      getItemHeight: this._getItemHeight.bind(this),
    });
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
    this.#jumpController.beforeFrame();
    const now = getNow();
    const keepAnimating = this._prepareRender(now);
    const { clientWidth: viewportWidth, clientHeight: viewportHeight } =
      this.graphics.canvas;
    this.graphics.clearRect(0, 0, viewportWidth, viewportHeight);

    const frame = prepareFrameSession({
      now,
      resolveVisibleWindow: (frameNow) => this._resolveVisibleWindow(frameNow),
      getViewportTranslateY: (frameNow) =>
        this.#transitionController.getViewportTranslateY(frameNow),
      captureVisibleItemSnapshot: (solution, extraShift) =>
        this._captureVisibleItemSnapshot(solution, extraShift),
      pruneTransitionAnimations: (window, frameNow) =>
        this._pruneTransitionAnimations(window, frameNow),
    });
    const autoFollowCapabilities =
      this.#jumpController.syncAutoFollowCapabilities(
        this._readAutoFollowCapabilities(
          frame.solution.window,
          frame.viewportTranslateY,
        ),
      );
    const requestRedraw = this._renderVisibleWindow(
      frame.solution.window,
      feedback,
      frame.viewportTranslateY,
    );
    if (feedback != null) {
      feedback.canAutoFollowTop = autoFollowCapabilities.top;
      feedback.canAutoFollowBottom = autoFollowCapabilities.bottom;
    }
    this._commitListState(frame.solution.normalizedState);

    return this._finishRender(
      keepAnimating || requestRedraw || frame.requestSettleRedraw,
    );
  }

  /** Hit-tests the current visible window. */
  hittest(test: {
    x: number;
    y: number;
    type: "click" | "auxclick" | "hover";
  }): boolean {
    this.#jumpController.beforeFrame();
    const now = getNow();
    this.#transitionController.settle(
      now,
      this.#getTransitionLifecycleAdapter(),
    );
    const frame = prepareFrameSession({
      now,
      resolveVisibleWindow: (frameNow) => this._resolveVisibleWindow(frameNow),
      getViewportTranslateY: (frameNow) =>
        this.#transitionController.getViewportTranslateY(frameNow),
      captureVisibleItemSnapshot: (solution, extraShift) =>
        this._captureVisibleItemSnapshot(solution, extraShift),
      pruneTransitionAnimations: (window, frameNow) =>
        this._pruneTransitionAnimations(window, frameNow),
    });
    this.#jumpController.syncAutoFollowCapabilities(
      this._readAutoFollowCapabilities(
        frame.solution.window,
        frame.viewportTranslateY,
      ),
    );
    return this._hittestVisibleWindow(
      frame.solution.window,
      test,
      frame.viewportTranslateY,
    );
  }

  protected _readListState(): VisibleListState {
    return {
      position: this.position,
      offset: this.offset,
    };
  }

  protected _resolveVisibleWindow(now: number) {
    return this._resolveVisibleWindowForState(this._readListState(), now);
  }

  protected _commitListState(state: NormalizedListState): void {
    this.position = state.position;
    this.offset = state.offset;
    this.#jumpController.commit(state);
  }

  /**
   * Scrolls the viewport to the requested item index.
   */
  jumpTo(index: number, options: JumpToOptions = {}): void {
    this.#jumpController.jumpTo(index, options);
  }

  /**
   * Scrolls the viewport to the visual top edge and arms top auto-follow immediately.
   */
  jumpToTop(options: JumpToOptions = {}): void {
    this.#jumpController.jumpToBoundary("top", options);
  }

  /**
   * Scrolls the viewport to the visual bottom edge and arms bottom auto-follow immediately.
   */
  jumpToBottom(options: JumpToOptions = {}): void {
    this.#jumpController.jumpToBoundary("bottom", options);
  }

  protected _resetRenderFeedback(feedback?: RenderFeedback): void {
    if (feedback == null) {
      return;
    }
    feedback.minIdx = Number.NaN;
    feedback.maxIdx = Number.NaN;
    feedback.min = Number.NaN;
    feedback.max = Number.NaN;
    feedback.canAutoFollowTop = false;
    feedback.canAutoFollowBottom = false;
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
    const viewport = this._getViewportMetrics();

    for (const { idx, value: item, offset, height } of list) {
      const y = offset + shift + viewport.contentTop;
      if (feedback != null) {
        this._accumulateRenderFeedback(feedback, idx, y, height);
      }
      if (y + height < 0 || y > viewport.outerHeight) {
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

  protected _readAutoFollowCapabilities(
    window: VisibleWindow<VirtualizedResolvedItem>,
    extraShift = 0,
  ): AutoFollowCapabilities {
    if (window.drawList.length === 0 || this.items.length === 0) {
      return {
        top: false,
        bottom: false,
      };
    }

    let minIndex = Number.POSITIVE_INFINITY;
    let maxIndex = Number.NEGATIVE_INFINITY;
    let topMostY = Number.POSITIVE_INFINITY;
    let bottomMostY = Number.NEGATIVE_INFINITY;
    const effectiveShift = window.shift + extraShift;
    const viewport = this._getViewportMetrics();

    for (const { idx, offset, height } of window.drawList) {
      minIndex = Math.min(minIndex, idx);
      maxIndex = Math.max(maxIndex, idx);
      const y = offset + effectiveShift + viewport.contentTop;
      topMostY = Math.min(topMostY, y);
      bottomMostY = Math.max(bottomMostY, y + height);
    }

    return {
      top: minIndex === 0 && topMostY >= viewport.contentTop - Number.EPSILON,
      bottom:
        maxIndex === this.items.length - 1 &&
        bottomMostY <= viewport.contentBottom + Number.EPSILON,
    };
  }

  protected _readVisibleRange(
    top: number,
    height: number,
  ): { top: number; bottom: number } | undefined {
    if (!Number.isFinite(top) || !Number.isFinite(height) || height <= 0) {
      return undefined;
    }

    const viewport = this._getViewportMetrics();
    const visibleTop = clamp(viewport.contentTop - top, 0, height);
    const visibleBottom = clamp(viewport.contentBottom - top, 0, height);
    if (visibleBottom <= visibleTop) {
      return undefined;
    }

    return {
      top: visibleTop,
      bottom: visibleBottom,
    };
  }

  protected _readOuterVisibleRange(
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
    now: number,
  ): boolean {
    return this.#transitionController.pruneInvisibleAt(
      now,
      this.#getTransitionPlanningAdapter(),
      this.#getTransitionLifecycleAdapter(),
    );
  }

  protected _hittestVisibleWindow(
    window: VisibleWindow<VirtualizedResolvedItem>,
    test: HitTest,
    extraShift = 0,
  ): boolean {
    const viewport = this._getViewportMetrics();
    for (const { value: item, offset, height } of window.drawList) {
      const y = offset + window.shift + extraShift + viewport.contentTop;
      if (test.y < y || test.y >= y + height) {
        continue;
      }
      return item.hittest(test, y);
    }
    return false;
  }

  protected _captureVisibleItemSnapshot(
    solution: VisibleWindowResult<unknown>,
    extraShift = 0,
  ): void {
    const normalizedState = this._normalizeListState(this._readListState());
    const viewport = this._getViewportMetrics();
    this.#transitionController.captureVisibilitySnapshot(
      solution.window,
      solution.resolutionPath,
      this.items,
      viewport,
      normalizedState,
      extraShift,
      this._readVisibleRange.bind(this),
      this._readOuterVisibleRange.bind(this),
    );
  }

  protected _prepareRender(now: number): boolean {
    const keepTransitioning = this.#transitionController.prepare(
      now,
      this.#getTransitionLifecycleAdapter(),
    );
    const keepJumping = this.#jumpController.prepare(now);
    return keepTransitioning || keepJumping;
  }

  protected _finishRender(requestRedraw: boolean): boolean {
    return this.#jumpController.finishFrame(requestRedraw);
  }

  protected _clampItemIndex(index: number): number {
    return clamp(
      Number.isFinite(index) ? Math.trunc(index) : 0,
      0,
      this.items.length - 1,
    );
  }

  protected _getItemHeight(index: number): number {
    return this._getItemHeightAt(index, getNow());
  }

  protected _getItemHeightAt(index: number, now: number): number {
    const item = this.items[index]!;
    return this.#transitionController.getItemHeight(item, now, {
      renderItem: this.options.renderItem,
      measureNode: this.measureRootNode.bind(this),
    });
  }

  protected _readAnchorAt(now: number): number | undefined {
    if (this.items.length <= 0) {
      return undefined;
    }
    const state = this._normalizeListState(this._readListState());
    return this._readAnchor(state, (index) =>
      this._getItemHeightAt(index, now),
    );
  }

  protected _restoreAnchor(anchor: number): void {
    if (!Number.isFinite(anchor) || this.items.length <= 0) {
      return;
    }
    this._applyAnchor(anchor);
  }

  #snapItemToViewportBoundary(item: T, boundary: "top" | "bottom"): void {
    const index = this.items.indexOf(item);
    if (index < 0) {
      return;
    }
    this._applyAnchor(
      this._getTargetAnchor(index, boundary === "top" ? "start" : "end"),
    );
  }

  protected _resolveItem(
    item: T,
    _index: number,
    now: number,
  ): { value: VirtualizedResolvedItem; height: number } {
    return this.#transitionController.resolveItem(
      item,
      now,
      this.#getTransitionRenderAdapter(),
      this.#getTransitionLifecycleAdapter(),
    );
  }

  protected abstract _normalizeListState(
    state: VisibleListState,
  ): NormalizedListState;
  protected abstract _getLayoutOptions(): ResolvedListLayoutOptions;
  protected abstract _resolveVisibleWindowForState(
    state: VisibleListState,
    now: number,
  ): VisibleWindowResult<VirtualizedResolvedItem>;
  protected abstract _readAnchor(
    state: NormalizedListState,
    readItemHeight: (index: number) => number,
  ): number;
  protected abstract _applyAnchor(anchor: number): void;
  protected abstract _getDefaultJumpBlock(): NonNullable<
    JumpToOptions["block"]
  >;
  protected abstract _getTargetAnchor(
    index: number,
    block: NonNullable<JumpToOptions["block"]>,
  ): number;

  protected _getViewportMetrics(): ListViewportMetrics {
    return resolveListViewport(
      this.graphics.canvas.clientHeight,
      this._getLayoutOptions().padding,
    );
  }

  #handleDeleteComplete(item: T): void {
    this.options.list.finalizeDelete(item);
  }

  #getTransitionLifecycleAdapter(): TransitionLifecycleAdapter<T> {
    return {
      onDeleteComplete: this.#handleDeleteComplete.bind(this),
      captureVisualAnchor: this._readAnchorAt.bind(this),
      restoreVisualAnchor: this._restoreAnchor.bind(this),
      readItemIndex: (item) => this.items.indexOf(item),
      snapItemToViewportBoundary: this.#snapItemToViewportBoundary.bind(this),
    };
  }

  #getVirtualizedRuntime(): VirtualizedRuntime<C, T> {
    const viewport = this._getViewportMetrics();
    return {
      items: this.items,
      position: this.position,
      offset: this.offset,
      renderItem: this.options.renderItem,
      measureNode: this.measureRootNode.bind(this),
      viewport,
      readVisibleRange: this._readVisibleRange.bind(this),
      readOuterVisibleRange: this._readOuterVisibleRange.bind(this),
      resolveVisibleWindow: () => this._resolveVisibleWindow(getNow()),
      resolveVisibleWindowForState: (state, now) =>
        this._resolveVisibleWindowForState(state, now),
    };
  }

  #getTransitionRenderAdapter(): TransitionRenderAdapter<C, T> {
    const runtime = this.#getVirtualizedRuntime();
    return {
      renderItem: runtime.renderItem,
      measureNode: runtime.measureNode,
      drawNode: this.drawRootNode.bind(this),
      getRootContext: this.getRootContext.bind(this),
      graphics: this.graphics,
    };
  }

  #getTransitionPlanningAdapter(): TransitionPlanningAdapter<C, T> {
    return {
      ...this.#getVirtualizedRuntime(),
      underflowAlign: this._getLayoutOptions().underflowAlign,
    };
  }

  #handleListStateChange(change: ListStateChange<T>): void {
    const nextChange = this.#jumpController.handleListStateChange(change);
    this.#transitionController.handleListStateChange(
      nextChange,
      this.#getTransitionPlanningAdapter(),
      this.#getTransitionLifecycleAdapter(),
    );
  }
}
