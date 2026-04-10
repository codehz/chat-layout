import { VirtualizedRenderer } from "./base";
import type { JumpToOptions } from "./base";
import type { TransitionPlacement } from "./base-types";
import {
  normalizeTimelineState,
  resolveTimelineVisibleWindow,
  type NormalizedListState,
  type VisibleListState,
} from "./solver";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Virtualized renderer anchored to the top, suitable for timeline-style UIs.
 */
export class TimelineRenderer<
  C extends CanvasRenderingContext2D,
  T extends {},
> extends VirtualizedRenderer<C, T> {
  protected _resolveVisibleWindow(now: number) {
    return resolveTimelineVisibleWindow(
      this.items,
      this._readListState(),
      this.graphics.canvas.clientHeight,
      (item, idx) => {
        return this._resolveItem(item, idx, now);
      },
    );
  }

  protected _getDefaultJumpBlock(): NonNullable<JumpToOptions["block"]> {
    return "start";
  }

  protected _normalizeListState(state: VisibleListState): NormalizedListState {
    return normalizeTimelineState(this.items.length, state);
  }

  protected _readAnchor(state: NormalizedListState): number {
    if (this.items.length === 0) {
      return 0;
    }
    const height = this._getItemHeight(state.position);
    return height > 0 ? state.position - state.offset / height : state.position;
  }

  protected _applyAnchor(anchor: number): void {
    if (this.items.length === 0) {
      return;
    }
    const clampedAnchor = clamp(anchor, 0, this.items.length);
    const position = clamp(Math.floor(clampedAnchor), 0, this.items.length - 1);
    const height = this._getItemHeight(position);
    const offset = height > 0 ? -(clampedAnchor - position) * height : 0;
    this._commitListState({
      position,
      offset: Object.is(offset, -0) ? 0 : offset,
    });
  }

  protected _getTargetAnchor(
    index: number,
    block: NonNullable<JumpToOptions["block"]>,
  ): number {
    const height = this._getItemHeight(index);
    const viewportHeight = this.graphics.canvas.clientHeight;

    switch (block) {
      case "start":
        return this._getAnchorAtOffset(index, 0);
      case "center":
        return this._getAnchorAtOffset(index, height / 2 - viewportHeight / 2);
      case "end":
        return this._getAnchorAtOffset(index, height - viewportHeight);
    }
  }

  protected _getDefaultAnimatedPlacement(): TransitionPlacement {
    return "start";
  }
}
