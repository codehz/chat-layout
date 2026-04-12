import type { ControlledState } from "./base-types";
import { VIEWPORT_BOUNDARY_EPSILON } from "./base-types";
import { sameState } from "./base-animation";
import type { ListViewportMetrics, VisibleWindow } from "./solver";
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
  #atStartBoundary = false;
  #atEndBoundary = false;
  #minDrawnIndex = Number.POSITIVE_INFINITY;
  #maxDrawnIndex = Number.NEGATIVE_INFINITY;
  #topBoundaryItem: T | undefined;
  #bottomBoundaryItem: T | undefined;

  get coversShortList(): boolean {
    return (
      this.#hasSnapshot && this.#snapshotState != null && this.#coversShortList
    );
  }

  get hasSnapshot(): boolean {
    return this.#hasSnapshot;
  }

  get previousState(): ControlledState | undefined {
    return this.#previousSnapshotState;
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
    viewport: ListViewportMetrics,
    snapshotState: ControlledState,
    readVisibleRange: (top: number, height: number) => VisibleRange | undefined,
    readOuterVisibleRange: (
      top: number,
      height: number,
    ) => VisibleRange | undefined,
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
    const effectiveShift = window.shift;

    for (const { idx, offset, height } of window.drawList) {
      const y = offset + effectiveShift;
      topMostY = Math.min(topMostY, y);
      bottomMostY = Math.max(bottomMostY, y + height);

      const item = items[idx];
      if (item != null && readOuterVisibleRange(y, height) != null) {
        nextDrawnItems.add(item);
        nextMinDrawnIndex = Math.min(nextMinDrawnIndex, idx);
        nextMaxDrawnIndex = Math.max(nextMaxDrawnIndex, idx);
      }
      if (item == null) {
        continue;
      }

      const visibleRange = readVisibleRange(y, height);
      if (visibleRange != null) {
        minVisibleIndex = Math.min(minVisibleIndex, idx);
        maxVisibleIndex = Math.max(maxVisibleIndex, idx);
        nextVisibleItems.add(item);
        if (y < nextTopBoundaryY) {
          nextTopBoundaryY = y;
          nextTopBoundaryItem = item;
        }
        if (y + height > nextBottomBoundaryY) {
          nextBottomBoundaryY = y + height;
          nextBottomBoundaryItem = item;
        }
      }
    }

    this.#drawnItems = nextDrawnItems;
    this.#visibleItems = nextVisibleItems;
    this.#hasSnapshot = true;
    this.#snapshotState = snapshotState;
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
      topMostY >= viewport.contentTop - VIEWPORT_BOUNDARY_EPSILON &&
      bottomMostY <= viewport.contentBottom + VIEWPORT_BOUNDARY_EPSILON &&
      contentHeight < viewport.contentHeight - VIEWPORT_BOUNDARY_EPSILON;
    this.#atStartBoundary =
      window.drawList.length > 0 &&
      items.length > 0 &&
      minVisibleIndex === 0 &&
      topMostY >= viewport.contentTop - VIEWPORT_BOUNDARY_EPSILON;
    this.#atEndBoundary =
      window.drawList.length > 0 &&
      items.length > 0 &&
      maxVisibleIndex === items.length - 1 &&
      bottomMostY <= viewport.contentBottom + VIEWPORT_BOUNDARY_EPSILON;
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
    this.#atStartBoundary = false;
    this.#atEndBoundary = false;
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
