import type { Node } from "../../types";
import type { ListState, ScrollToOptions } from "../list-state";
import {
  applyAnchorToState,
  getTargetAnchorForItem,
  readAnchorFromState,
} from "./anchor-model";
import { VirtualizedRenderer } from "./base";
import {
  normalizeListPadding,
  normalizeVisibleState,
  resolveListLayoutOptions,
  resolveListViewport,
  resolveVisibleWindow,
  type ListLayoutOptions,
  type ListPadding,
  type NormalizedListState,
  type ResolvedListLayoutOptions,
  type VisibleListState,
} from "./solver";

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
  #layout: ResolvedListLayoutOptions;

  constructor(graphics: C, options: ListRendererOptions<C, T>) {
    super(graphics, options);
    this.#layout = resolveListLayoutOptions(options);
  }

  get padding(): ListPadding {
    return { ...this.#layout.padding };
  }

  set padding(value: ListPadding) {
    const nextPadding = normalizeListPadding(value);
    if (
      nextPadding.top === this.#layout.padding.top &&
      nextPadding.bottom === this.#layout.padding.bottom
    ) {
      return;
    }

    const anchor = this._readAnchorAt(performance.now());
    this.#layout = {
      ...this.#layout,
      padding: nextPadding,
    };
    if (anchor != null) {
      this._restoreAnchor(anchor);
    }
  }

  protected _getLayoutOptions(): ResolvedListLayoutOptions {
    return this.#layout;
  }

  protected _resolveVisibleWindowForState(
    state: VisibleListState,
    now: number,
  ) {
    return resolveVisibleWindow(
      this.items,
      state,
      resolveListViewport(
        this.graphics.canvas.clientHeight,
        this.#layout.padding,
      ),
      (item, idx) => this._resolveItem(item, idx, now),
      this.#layout,
    );
  }

  protected _getDefaultJumpBlock(): NonNullable<ScrollToOptions["block"]> {
    return this.#layout.anchorMode === "top" ? "start" : "end";
  }

  protected _normalizeListState(state: VisibleListState): NormalizedListState {
    return normalizeVisibleState(this.items.length, state, this.#layout);
  }

  protected _readAnchor(
    state: NormalizedListState,
    readItemHeight: (index: number) => number,
  ): number {
    return readAnchorFromState(
      this.items.length,
      state,
      this.#layout.anchorMode,
      readItemHeight,
    );
  }

  protected _applyAnchor(anchor: number): void {
    const state = applyAnchorToState(
      this.items.length,
      anchor,
      this.#layout.anchorMode,
      this._getItemHeight.bind(this),
    );
    if (state == null) {
      return;
    }
    this._commitListState(state);
  }

  protected _getTargetAnchor(
    index: number,
    block: NonNullable<ScrollToOptions["block"]>,
  ): number {
    return getTargetAnchorForItem(
      this.items.length,
      index,
      block,
      this.#layout.anchorMode,
      resolveListViewport(
        this.graphics.canvas.clientHeight,
        this.#layout.padding,
      ).contentHeight,
      this._getItemHeight.bind(this),
    );
  }
}
