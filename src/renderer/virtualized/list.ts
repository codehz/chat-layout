import { VirtualizedRenderer } from "./base";
import type { JumpToOptions } from "./base";
import type { Node } from "../../types";
import type { ListState } from "../list-state";
import {
  normalizeVisibleState,
  resolveListLayoutOptions,
  resolveVisibleWindow,
  type ListLayoutOptions,
  type NormalizedListState,
  type ResolvedListLayoutOptions,
  type VisibleListState,
} from "./solver";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface ListRendererOptions<
  C extends CanvasRenderingContext2D,
  T extends {},
> extends ListLayoutOptions {
  renderItem: (item: T) => Node<C>;
  list: ListState<T>;
}

/**
 * Virtualized list renderer with configurable anchor semantics.
 */
export class ListRenderer<
  C extends CanvasRenderingContext2D,
  T extends {},
> extends VirtualizedRenderer<C, T> {
  readonly #layout: ResolvedListLayoutOptions;

  constructor(graphics: C, options: ListRendererOptions<C, T>) {
    super(graphics, options);
    this.#layout = resolveListLayoutOptions(options);
  }

  protected _getLayoutOptions(): ResolvedListLayoutOptions {
    return this.#layout;
  }

  protected _resolveVisibleWindow(now: number) {
    return resolveVisibleWindow(
      this.items,
      this._readListState(),
      this.graphics.canvas.clientHeight,
      (item, idx) => {
        return this._resolveItem(item, idx, now);
      },
      this.#layout,
    );
  }

  protected _getDefaultJumpBlock(): NonNullable<JumpToOptions["block"]> {
    return this.#layout.anchorMode === "top" ? "start" : "end";
  }

  protected _normalizeListState(state: VisibleListState): NormalizedListState {
    return normalizeVisibleState(this.items.length, state, this.#layout);
  }

  protected _readAnchor(state: NormalizedListState): number {
    if (this.items.length === 0) {
      return 0;
    }

    const height = this._getItemHeight(state.position);
    if (this.#layout.anchorMode === "top") {
      return height > 0
        ? state.position - state.offset / height
        : state.position;
    }
    return height > 0
      ? state.position + 1 - state.offset / height
      : state.position + 1;
  }

  protected _applyAnchor(anchor: number): void {
    if (this.items.length === 0) {
      return;
    }

    const clampedAnchor = clamp(anchor, 0, this.items.length);
    if (this.#layout.anchorMode === "top") {
      const position = clamp(
        Math.floor(clampedAnchor),
        0,
        this.items.length - 1,
      );
      const height = this._getItemHeight(position);
      const offset = height > 0 ? -(clampedAnchor - position) * height : 0;
      this._commitListState({
        position,
        offset: Object.is(offset, -0) ? 0 : offset,
      });
      return;
    }

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

    if (this.#layout.anchorMode === "top") {
      switch (block) {
        case "start":
          return this._getAnchorAtOffset(index, 0);
        case "center":
          return this._getAnchorAtOffset(
            index,
            height / 2 - viewportHeight / 2,
          );
        case "end":
          return this._getAnchorAtOffset(index, height - viewportHeight);
      }
    }

    switch (block) {
      case "start":
        return this._getAnchorAtOffset(index, viewportHeight);
      case "center":
        return this._getAnchorAtOffset(index, height / 2 + viewportHeight / 2);
      case "end":
        return this._getAnchorAtOffset(index, height);
    }
  }
}
