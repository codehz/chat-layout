import type { Node, RenderFeedback } from "../../types";
import { BaseRenderer } from "../base";
import { ListState } from "../list-state";
import type { NormalizedListState, VisibleListState, VisibleWindow } from "./solver";

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sameState(state: ControlledState, position: number | undefined, offset: number): boolean {
  return Object.is(state.position, position) && Object.is(state.offset, offset);
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function getNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

/**
 * Shared base class for virtualized list renderers.
 */
export abstract class VirtualizedRenderer<C extends CanvasRenderingContext2D, T extends {}> extends BaseRenderer<
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
  abstract hittest(test: { x: number; y: number; type: "click" | "auxclick" | "hover" }): boolean;

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
          Math.abs(targetAnchor - startAnchor) * VirtualizedRenderer.JUMP_DURATION_PER_ITEM,
      0,
      VirtualizedRenderer.MAX_JUMP_DURATION,
    );

    if (duration <= 0 || Math.abs(targetAnchor - startAnchor) <= Number.EPSILON) {
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

  protected _accumulateRenderFeedback(feedback: RenderFeedback, idx: number, top: number, height: number): void {
    if (!Number.isFinite(top) || !Number.isFinite(height) || height <= 0) {
      return;
    }

    const viewportHeight = this.graphics.canvas.clientHeight;
    const visibleTop = clamp(-top, 0, height);
    const visibleBottom = clamp(viewportHeight - top, 0, height);
    if (visibleBottom <= visibleTop) {
      return;
    }

    const itemMin = idx + visibleTop / height;
    const itemMax = idx + visibleBottom / height;
    feedback.minIdx = Number.isNaN(feedback.minIdx) ? idx : Math.min(idx, feedback.minIdx);
    feedback.maxIdx = Number.isNaN(feedback.maxIdx) ? idx : Math.max(idx, feedback.maxIdx);
    feedback.min = Number.isNaN(feedback.min) ? itemMin : Math.min(itemMin, feedback.min);
    feedback.max = Number.isNaN(feedback.max) ? itemMax : Math.max(itemMax, feedback.max);
  }

  protected _renderDrawList(list: VisibleWindow<Node<C>>["drawList"], shift: number, feedback?: RenderFeedback): boolean {
    let result = false;
    const viewportHeight = this.graphics.canvas.clientHeight;

    for (const { idx, value: node, offset, height } of list) {
      const y = offset + shift;
      if (feedback != null) {
        this._accumulateRenderFeedback(feedback, idx, y, height);
      }
      if (y + height < 0 || y > viewportHeight) {
        continue;
      }
      if (this.drawRootNode(node, 0, y)) {
        result = true;
      }
    }

    return result;
  }

  protected _renderVisibleWindow(window: VisibleWindow<Node<C>>, feedback?: RenderFeedback): boolean {
    this._resetRenderFeedback(feedback);
    return this._renderDrawList(window.drawList, window.shift, feedback);
  }

  protected _hittestVisibleWindow(window: VisibleWindow<Node<C>>, test: { x: number; y: number; type: "click" | "auxclick" | "hover" }): boolean {
    for (const { value: node, offset, height } of window.drawList) {
      const y = offset + window.shift;
      if (test.y < y || test.y >= y + height) {
        continue;
      }
      return node.hittest(
        this.getRootContext(),
        {
          ...test,
          y: test.y - y,
        },
      );
    }
    return false;
  }

  protected _prepareRender(): boolean {
    const animation = this.#jumpAnimation;
    if (animation == null) {
      return false;
    }
    if (this.items.length === 0) {
      this.#cancelJumpAnimation();
      return false;
    }
    if (this.#controlledState != null && !sameState(this.#controlledState, this.position, this.offset)) {
      this.#cancelJumpAnimation();
      return false;
    }

    const progress = clamp((getNow() - animation.startTime) / animation.duration, 0, 1);
    const eased = progress >= 1 ? 1 : smoothstep(progress);
    const anchor = animation.startAnchor + (animation.targetAnchor - animation.startAnchor) * eased;
    this._applyAnchor(anchor);
    animation.needsMoreFrames = progress < 1;
    return animation.needsMoreFrames;
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
    return clamp(Number.isFinite(index) ? Math.trunc(index) : 0, 0, this.items.length - 1);
  }

  protected _getItemHeight(index: number): number {
    const item = this.items[index];
    const node = this.options.renderItem(item);
    return this.measureRootNode(node).height;
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

  protected abstract _normalizeListState(state: VisibleListState): NormalizedListState;
  protected abstract _readAnchor(state: NormalizedListState): number;
  protected abstract _applyAnchor(anchor: number): void;
  protected abstract _getDefaultJumpBlock(): NonNullable<JumpToOptions["block"]>;
  protected abstract _getTargetAnchor(index: number, block: NonNullable<JumpToOptions["block"]>): number;

  #cancelJumpAnimation(): void {
    this.#jumpAnimation = undefined;
    this.#controlledState = undefined;
  }
}
