import { VirtualizedRenderer } from "./base";
import type { JumpToOptions } from "./base";
import {
  normalizeChatState,
  resolveChatVisibleWindow,
  type NormalizedListState,
  type VisibleListState,
} from "./solver";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Virtualized renderer anchored to the bottom, suitable for chat-style UIs.
 */
export class ChatRenderer<
  C extends CanvasRenderingContext2D,
  T extends {},
> extends VirtualizedRenderer<C, T> {
  protected _resolveVisibleWindow(now: number) {
    return resolveChatVisibleWindow(
      this.items,
      this._readListState(),
      this.graphics.canvas.clientHeight,
      (item, idx) => {
        return this._resolveItem(item, idx, now);
      },
    );
  }

  protected _getDefaultJumpBlock(): NonNullable<JumpToOptions["block"]> {
    return "end";
  }

  protected _normalizeListState(state: VisibleListState): NormalizedListState {
    return normalizeChatState(this.items.length, state);
  }

  protected _readAnchor(state: NormalizedListState): number {
    if (this.items.length === 0) {
      return 0;
    }
    const height = this._getItemHeight(state.position);
    return height > 0
      ? state.position + 1 - state.offset / height
      : state.position + 1;
  }

  protected _applyAnchor(anchor: number): void {
    if (this.items.length === 0) {
      return;
    }
    const clampedAnchor = clamp(anchor, 0, this.items.length);
    const position = clamp(
      Math.ceil(clampedAnchor) - 1,
      0,
      this.items.length - 1,
    );
    const height = this._getItemHeight(position);
    const offset = height > 0 ? (position + 1 - clampedAnchor) * height : 0;
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
        return this._getAnchorAtOffset(index, viewportHeight);
      case "center":
        return this._getAnchorAtOffset(index, height / 2 + viewportHeight / 2);
      case "end":
        return this._getAnchorAtOffset(index, height);
    }
  }

  protected _getAnimatedLayerOffset(
    slotHeight: number,
    nodeHeight: number,
  ): number {
    return slotHeight - nodeHeight;
  }
}
