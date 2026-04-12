import type { ListStateChange } from "../list-state";
import type { ListViewportMetrics, VisibleWindow } from "./solver";
import {
  getTransitionedItemHeight,
  handleTransitionStateChange,
  resolveTransitionedItem,
} from "./transition-planner";
import type {
  BoundaryInsertDirection,
  TransitionLifecycleAdapter,
  TransitionPlanningAdapter,
  TransitionRenderAdapter,
} from "./transition-runtime";
import { VisibilitySnapshot } from "./transition-snapshot";
import {
  TransitionStore,
  type StoredTransitionEntry,
} from "./transition-store";
import { getNow, sameState } from "./virtualized-animation";
import type {
  ListScrollStateSnapshot,
  VirtualizedResolvedItem,
} from "./virtualized-types";

export {
  canAnimateExistingItem,
  drawSampledLayers,
  sampleActiveTransition,
  sampleLayerAnimation,
  sampleScalarAnimation,
} from "./transition-planner";
export type {
  ActiveItemTransition,
  BoundaryInsertDirection,
  LayerAnimation,
  SampledItemTransition,
  SampledLayer,
  ScalarAnimation,
  TransitionLifecycleAdapter,
  TransitionPlanningAdapter,
  TransitionRenderAdapter,
  VirtualizedRuntime,
  VisibleRange,
} from "./transition-runtime";
export { VisibilitySnapshot } from "./transition-snapshot";
export { TransitionStore } from "./transition-store";

export function remapAnchorAfterDeletes(
  anchor: number,
  deletedIndices: readonly number[],
): number {
  if (!Number.isFinite(anchor) || deletedIndices.length === 0) {
    return anchor;
  }

  const sortedIndices = [...deletedIndices]
    .filter((index) => Number.isFinite(index) && index >= 0)
    .sort((a, b) => a - b);
  let removedBeforeAnchor = 0;

  for (const index of sortedIndices) {
    if (anchor > index + 1) {
      removedBeforeAnchor += 1;
      continue;
    }
    if (anchor >= index) {
      return index - removedBeforeAnchor;
    }
  }

  return anchor - removedBeforeAnchor;
}

type NaturalBoundarySnap<T extends {}> = {
  item: T;
  boundary: "top" | "bottom";
};

export class TransitionController<
  C extends CanvasRenderingContext2D,
  T extends {},
> {
  #store = new TransitionStore<C, T>();
  #snapshot = new VisibilitySnapshot<T>();

  captureVisibilitySnapshot(
    window: VisibleWindow<unknown>,
    resolutionPath: readonly number[],
    items: readonly T[],
    viewport: ListViewportMetrics,
    snapshotState: ListScrollStateSnapshot,
    readVisibleRange: TransitionPlanningAdapter<C, T>["readVisibleRange"],
    readOuterVisibleRange: TransitionPlanningAdapter<
      C,
      T
    >["readOuterVisibleRange"],
  ): void {
    this.#snapshot.capture(
      window,
      resolutionPath,
      items,
      viewport,
      snapshotState,
      readVisibleRange,
      readOuterVisibleRange,
    );
  }

  pruneInvisible(
    ctx: TransitionPlanningAdapter<C, T>,
    lifecycle: TransitionLifecycleAdapter<T>,
  ): boolean {
    return this.pruneInvisibleAt(getNow(), ctx, lifecycle);
  }

  prepare(now: number, lifecycle: TransitionLifecycleAdapter<T>): boolean {
    this.settle(now, lifecycle);
    return this.#store.prepare(now);
  }

  canAutoFollowBoundaryInsert(
    direction: BoundaryInsertDirection,
    count: number,
    position: number | undefined,
    offset: number,
  ): boolean {
    return this.#snapshot.matchesFollowBoundaryInsertState(
      direction,
      count,
      position,
      offset,
    );
  }

  getItemHeight(
    item: T,
    now: number,
    adapter: Pick<TransitionRenderAdapter<C, T>, "renderItem" | "measureNode">,
  ): number {
    return getTransitionedItemHeight(item, now, this.#store, adapter);
  }

  resolveItem(
    item: T,
    now: number,
    adapter: TransitionRenderAdapter<C, T>,
    lifecycle: TransitionLifecycleAdapter<T>,
  ): { value: VirtualizedResolvedItem; height: number } {
    return resolveTransitionedItem(item, now, this.#store, adapter, lifecycle);
  }

  handleListStateChange(
    change: ListStateChange<T>,
    ctx: TransitionPlanningAdapter<C, T>,
    lifecycle: TransitionLifecycleAdapter<T>,
  ): void {
    const now = getNow();
    this.settle(now, lifecycle);
    handleTransitionStateChange(
      this.#store,
      this.#snapshot,
      change,
      ctx,
      lifecycle,
    );
  }

  settle(now: number, lifecycle: TransitionLifecycleAdapter<T>): boolean {
    return this.#settleTransitions(
      this.#store.findCompleted(now),
      now,
      lifecycle,
    );
  }

  pruneInvisibleAt(
    now: number,
    ctx: TransitionPlanningAdapter<C, T>,
    lifecycle: TransitionLifecycleAdapter<T>,
  ): boolean {
    const removals = this.#store.findInvisible(this.#snapshot);
    return this.#settleTransitions(
      removals,
      now,
      lifecycle,
      this.#resolveNaturalBoundarySnap(removals, now, ctx, lifecycle),
    );
  }

  reset(): void {
    this.#store.reset();
    this.#snapshot.reset();
  }

  #settleTransitions(
    removals: readonly StoredTransitionEntry<C, T>[],
    now: number,
    lifecycle: TransitionLifecycleAdapter<T>,
    boundarySnap?: NaturalBoundarySnap<T>,
  ): boolean {
    if (removals.length === 0) {
      return false;
    }

    const anchor = lifecycle.captureVisualAnchor(now);
    const beforeState = lifecycle.readScrollState();
    const completedDeleteIndices: number[] = [];
    for (const { item, transition } of removals) {
      if (transition.kind === "delete") {
        const index = lifecycle.readItemIndex(item);
        if (index >= 0) {
          completedDeleteIndices.push(index);
        }
      }
      this.#store.delete(item);
      if (transition.kind === "delete") {
        lifecycle.onDeleteComplete(item);
      }
    }
    if (anchor != null && Number.isFinite(anchor)) {
      lifecycle.restoreVisualAnchor(
        remapAnchorAfterDeletes(anchor, completedDeleteIndices),
      );
    }
    if (boundarySnap != null) {
      lifecycle.snapItemToViewportBoundary(
        boundarySnap.item,
        boundarySnap.boundary,
      );
    }
    const afterState = lifecycle.readScrollState();
    if (!sameState(beforeState, afterState.position, afterState.offset)) {
      lifecycle.onTransitionSettleScrollAdjusted();
    }
    return true;
  }

  #resolveNaturalBoundarySnap(
    removals: readonly StoredTransitionEntry<C, T>[],
    now: number,
    ctx: TransitionPlanningAdapter<C, T>,
    lifecycle: TransitionLifecycleAdapter<T>,
  ): NaturalBoundarySnap<T> | undefined {
    const previousState = this.#snapshot.previousState;
    const drawnRange = this.#snapshot.readDrawnIndexRange();
    if (previousState == null || drawnRange == null) {
      return undefined;
    }

    const naturalIndices: number[] = [];
    for (const { item, transition } of removals) {
      if (transition.kind !== "update" && transition.kind !== "delete") {
        continue;
      }

      const index = lifecycle.readItemIndex(item);
      if (index < 0 || !this.#snapshot.wasVisible(item)) {
        return undefined;
      }
      if (this.#isTransitionVisibleInState(index, previousState, now, ctx)) {
        return undefined;
      }
      naturalIndices.push(index);
    }

    if (naturalIndices.length === 0) {
      return undefined;
    }

    const allBefore = naturalIndices.every(
      (index) => index < drawnRange.minIndex,
    );
    if (allBefore) {
      const item = this.#snapshot.readBoundaryItem("top");
      return item == null ? undefined : { item, boundary: "top" };
    }

    const allAfter = naturalIndices.every(
      (index) => index > drawnRange.maxIndex,
    );
    if (allAfter) {
      const item = this.#snapshot.readBoundaryItem("bottom");
      return item == null ? undefined : { item, boundary: "bottom" };
    }

    return undefined;
  }

  #isTransitionVisibleInState(
    index: number,
    state: ListScrollStateSnapshot,
    now: number,
    ctx: TransitionPlanningAdapter<C, T>,
  ): boolean {
    const solution = ctx.resolveVisibleWindowForState(state, now);
    for (const entry of solution.window.drawList) {
      if (entry.index !== index) {
        continue;
      }
      return (
        ctx.readOuterVisibleRange(
          entry.offset + solution.window.shift,
          entry.height,
        ) != null
      );
    }
    return false;
  }
}
