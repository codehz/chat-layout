import type { ControlledState } from "./base-types";
import { sameState } from "./base-animation";
import type { VisibleWindow } from "./solver";
import type {
  BoundaryInsertDirection,
  VisibleRange,
} from "./transition-runtime";

export class VisibilitySnapshot<T extends {}> {
  #drawnItems = new Set<T>();
  #visibleItems = new Set<T>();
  #previousVisibleItems = new Set<T>();
  #hasSnapshot = false;
  #snapshotState: ControlledState | undefined;
  #previousSnapshotState: ControlledState | undefined;
  #emptyState: ControlledState | undefined;
  #coversShortList = false;
  #topGap = 0;
  #bottomGap = 0;
  #atStartBoundary = false;
  #atEndBoundary = false;
  #currentExtraShift = 0;
  #minDrawnIndex = Number.POSITIVE_INFINITY;
  #maxDrawnIndex = Number.NEGATIVE_INFINITY;
  #topBoundaryItem: T | undefined;
  #bottomBoundaryItem: T | undefined;

  get coversShortList(): boolean {
    return (
      this.#hasSnapshot && this.#snapshotState != null && this.#coversShortList
    );
  }

  get topGap(): number {
    return this.#topGap;
  }

  get bottomGap(): number {
    return this.#bottomGap;
  }

  get previousState(): ControlledState | undefined {
    return this.#previousSnapshotState;
  }

  get currentExtraShift(): number {
    return this.#currentExtraShift;
  }

  readDrawnIndexRange():
    | {
        minIndex: number;
        maxIndex: number;
      }
    | undefined {
    if (
      !Number.isFinite(this.#minDrawnIndex) ||
      !Number.isFinite(this.#maxDrawnIndex)
    ) {
      return undefined;
    }
    return {
      minIndex: this.#minDrawnIndex,
      maxIndex: this.#maxDrawnIndex,
    };
  }

  readBoundaryItem(boundary: "top" | "bottom"): T | undefined {
    return boundary === "top"
      ? this.#topBoundaryItem
      : this.#bottomBoundaryItem;
  }

  capture(
    window: VisibleWindow<unknown>,
    _resolutionPath: readonly number[],
    items: readonly T[],
    viewportHeight: number,
    snapshotState: ControlledState,
    extraShift: number,
    readVisibleRange: (top: number, height: number) => VisibleRange | undefined,
  ): void {
    this.#previousVisibleItems = this.#visibleItems;
    this.#previousSnapshotState = this.#snapshotState;
    const nextDrawnItems = new Set<T>();
    const nextVisibleItems = new Set<T>();
    let minVisibleIndex = Number.POSITIVE_INFINITY;
    let maxVisibleIndex = Number.NEGATIVE_INFINITY;
    let topMostY = Number.POSITIVE_INFINITY;
    let bottomMostY = Number.NEGATIVE_INFINITY;
    let nextMinDrawnIndex = Number.POSITIVE_INFINITY;
    let nextMaxDrawnIndex = Number.NEGATIVE_INFINITY;
    let nextTopBoundaryItem: T | undefined;
    let nextBottomBoundaryItem: T | undefined;
    let nextTopBoundaryY = Number.POSITIVE_INFINITY;
    let nextBottomBoundaryY = Number.NEGATIVE_INFINITY;
    const effectiveShift = window.shift + extraShift;

    for (const { idx, offset, height } of window.drawList) {
      minVisibleIndex = Math.min(minVisibleIndex, idx);
      maxVisibleIndex = Math.max(maxVisibleIndex, idx);
      nextMinDrawnIndex = Math.min(nextMinDrawnIndex, idx);
      nextMaxDrawnIndex = Math.max(nextMaxDrawnIndex, idx);
      const y = offset + effectiveShift;
      topMostY = Math.min(topMostY, y);
      bottomMostY = Math.max(bottomMostY, y + height);

      const item = items[idx];
      if (item != null) {
        nextDrawnItems.add(item);
        if (y < nextTopBoundaryY) {
          nextTopBoundaryY = y;
          nextTopBoundaryItem = item;
        }
        if (y + height > nextBottomBoundaryY) {
          nextBottomBoundaryY = y + height;
          nextBottomBoundaryItem = item;
        }
      }
      if (item == null || readVisibleRange(y, height) == null) {
        continue;
      }
      nextVisibleItems.add(item);
    }

    this.#drawnItems = nextDrawnItems;
    this.#visibleItems = nextVisibleItems;
    this.#hasSnapshot = true;
    this.#snapshotState = snapshotState;
    this.#currentExtraShift = extraShift;
    this.#minDrawnIndex = nextMinDrawnIndex;
    this.#maxDrawnIndex = nextMaxDrawnIndex;
    this.#topBoundaryItem = nextTopBoundaryItem;
    this.#bottomBoundaryItem = nextBottomBoundaryItem;
    this.#emptyState =
      items.length === 0 && window.drawList.length === 0
        ? snapshotState
        : undefined;

    const contentHeight = bottomMostY - topMostY;
    this.#coversShortList =
      window.drawList.length > 0 &&
      items.length > 0 &&
      window.drawList.length === items.length &&
      minVisibleIndex === 0 &&
      maxVisibleIndex === items.length - 1 &&
      topMostY >= -Number.EPSILON &&
      bottomMostY <= viewportHeight + Number.EPSILON &&
      contentHeight < viewportHeight - Number.EPSILON;
    this.#topGap = this.#coversShortList ? Math.max(0, topMostY) : 0;
    this.#bottomGap = this.#coversShortList
      ? Math.max(0, viewportHeight - bottomMostY)
      : 0;
    this.#atStartBoundary =
      window.drawList.length > 0 &&
      items.length > 0 &&
      minVisibleIndex === 0 &&
      topMostY >= -Number.EPSILON;
    this.#atEndBoundary =
      window.drawList.length > 0 &&
      items.length > 0 &&
      maxVisibleIndex === items.length - 1 &&
      bottomMostY <= viewportHeight + Number.EPSILON;
  }

  matchesCurrentState(position: number | undefined, offset: number): boolean {
    return (
      this.#hasSnapshot &&
      this.#snapshotState != null &&
      sameState(this.#snapshotState, position, offset)
    );
  }

  matchesBoundaryInsertState(
    direction: BoundaryInsertDirection,
    count: number,
    position: number | undefined,
    offset: number,
  ): boolean {
    if (!this.coversShortList || this.#snapshotState == null) {
      return false;
    }
    return this.#matchesStateAfterBoundaryInsert(
      direction,
      count,
      position,
      offset,
    );
  }

  matchesFollowBoundaryInsertState(
    direction: BoundaryInsertDirection,
    count: number,
    position: number | undefined,
    offset: number,
  ): boolean {
    if (!this.#hasSnapshot || this.#snapshotState == null) {
      return false;
    }
    if (direction === "push" ? !this.#atEndBoundary : !this.#atStartBoundary) {
      return false;
    }
    return this.#matchesStateAfterBoundaryInsert(
      direction,
      count,
      position,
      offset,
    );
  }

  matchesEmptyBoundaryInsertState(
    direction: BoundaryInsertDirection,
    count: number,
    position: number | undefined,
    offset: number,
  ): boolean {
    const emptyState = this.#emptyState;
    if (!this.#hasSnapshot || emptyState == null) {
      return false;
    }
    const expectedPosition =
      direction === "unshift" && emptyState.position != null
        ? emptyState.position + count
        : emptyState.position;
    return sameState(
      {
        position: expectedPosition,
        offset: emptyState.offset,
      },
      position,
      offset,
    );
  }

  isVisible(item: T): boolean {
    return this.#visibleItems.has(item);
  }

  wasVisible(item: T): boolean {
    return this.#previousVisibleItems.has(item);
  }

  tracks(item: T, retention: "drawn" | "visible"): boolean {
    return retention === "drawn"
      ? this.#drawnItems.has(item)
      : this.#visibleItems.has(item);
  }

  reset(): void {
    this.#drawnItems.clear();
    this.#visibleItems.clear();
    this.#previousVisibleItems.clear();
    this.#hasSnapshot = false;
    this.#snapshotState = undefined;
    this.#previousSnapshotState = undefined;
    this.#emptyState = undefined;
    this.#coversShortList = false;
    this.#topGap = 0;
    this.#bottomGap = 0;
    this.#atStartBoundary = false;
    this.#atEndBoundary = false;
    this.#currentExtraShift = 0;
    this.#minDrawnIndex = Number.POSITIVE_INFINITY;
    this.#maxDrawnIndex = Number.NEGATIVE_INFINITY;
    this.#topBoundaryItem = undefined;
    this.#bottomBoundaryItem = undefined;
  }

  #matchesStateAfterBoundaryInsert(
    direction: BoundaryInsertDirection,
    count: number,
    position: number | undefined,
    offset: number,
  ): boolean {
    const snapshotState = this.#snapshotState;
    if (snapshotState == null) {
      return false;
    }
    const expectedPosition =
      direction === "unshift" && snapshotState.position != null
        ? snapshotState.position + count
        : snapshotState.position;
    return sameState(
      {
        position: expectedPosition,
        offset: snapshotState.offset,
      },
      position,
      offset,
    );
  }
}
