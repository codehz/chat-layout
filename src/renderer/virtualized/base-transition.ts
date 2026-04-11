import type { ListStateChange } from "../list-state";
import { getNow, getProgress } from "./base-animation";
import type { ControlledState, VirtualizedResolvedItem } from "./base-types";
import type { VisibleWindow } from "./solver";
import {
  getTransitionedItemHeight,
  handleTransitionStateChange,
  resolveTransitionedItem,
} from "./transition-planner";
import { VisibilitySnapshot } from "./transition-snapshot";
import {
  TransitionStore,
  type StoredTransitionEntry,
} from "./transition-store";
import { sampleScalarAnimation } from "./transition-planner";
import type {
  BoundaryInsertDirection,
  ScalarAnimation,
  TransitionLifecycleAdapter,
  TransitionPlanningAdapter,
  TransitionRenderAdapter,
} from "./transition-runtime";

export {
  canAnimateExistingItem,
  drawSampledLayers,
  resolveBoundaryInsertStrategy,
  sampleActiveTransition,
  sampleLayerAnimation,
  sampleScalarAnimation,
} from "./transition-planner";
export { VisibilitySnapshot } from "./transition-snapshot";
export { TransitionStore } from "./transition-store";
export type {
  ActiveItemTransition,
  BoundaryInsertDirection,
  BoundaryInsertStrategy,
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

export class TransitionController<
  C extends CanvasRenderingContext2D,
  T extends {},
> {
  #store = new TransitionStore<C, T>();
  #snapshot = new VisibilitySnapshot<T>();
  #viewportTranslateAnimation: ScalarAnimation | undefined;

  captureVisibilitySnapshot(
    window: VisibleWindow<unknown>,
    resolutionPath: readonly number[],
    items: readonly T[],
    viewportHeight: number,
    snapshotState: ControlledState,
    extraShift: number,
    readVisibleRange: TransitionPlanningAdapter<C, T>["readVisibleRange"],
  ): void {
    this.#snapshot.capture(
      window,
      resolutionPath,
      items,
      viewportHeight,
      snapshotState,
      extraShift,
      readVisibleRange,
    );
  }

  pruneInvisible(lifecycle: TransitionLifecycleAdapter<T>): boolean {
    return this.pruneInvisibleAt(getNow(), lifecycle);
  }

  prepare(now: number, lifecycle: TransitionLifecycleAdapter<T>): boolean {
    this.settle(now, lifecycle);
    this.#cleanupViewportTranslateAnimation(now);
    const keepViewportAnimating = this.#viewportTranslateAnimation != null;
    return this.#store.prepare(now) || keepViewportAnimating;
  }

  getViewportTranslateY(now: number): number {
    this.#cleanupViewportTranslateAnimation(now);
    return this.#viewportTranslateAnimation == null
      ? 0
      : sampleScalarAnimation(this.#viewportTranslateAnimation, now);
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
    const result = handleTransitionStateChange(
      this.#store,
      this.#snapshot,
      this.getViewportTranslateY(now),
      change,
      ctx,
      lifecycle,
    );
    if (change.type === "reset" || change.type === "set") {
      this.#viewportTranslateAnimation = undefined;
      return;
    }
    if (result.viewportAnimation != null) {
      this.#viewportTranslateAnimation = result.viewportAnimation;
    }
  }

  settle(now: number, lifecycle: TransitionLifecycleAdapter<T>): boolean {
    const changed = this.#settleTransitions(
      this.#store.findCompleted(now),
      now,
      lifecycle,
    );
    this.#cleanupViewportTranslateAnimation(now);
    return changed;
  }

  pruneInvisibleAt(
    now: number,
    lifecycle: TransitionLifecycleAdapter<T>,
  ): boolean {
    return this.#settleTransitions(
      this.#store.findInvisible(this.#snapshot),
      now,
      lifecycle,
    );
  }

  reset(): void {
    this.#store.reset();
    this.#snapshot.reset();
    this.#viewportTranslateAnimation = undefined;
  }

  #cleanupViewportTranslateAnimation(now: number): void {
    const animation = this.#viewportTranslateAnimation;
    if (animation == null) {
      return;
    }
    if (getProgress(animation.startTime, animation.duration, now) >= 1) {
      this.#viewportTranslateAnimation = undefined;
    }
  }

  #settleTransitions(
    removals: readonly StoredTransitionEntry<C, T>[],
    now: number,
    lifecycle: TransitionLifecycleAdapter<T>,
  ): boolean {
    if (removals.length === 0) {
      return false;
    }

    const anchor = lifecycle.captureVisualAnchor(now);
    for (const { item, transition } of removals) {
      this.#store.delete(item);
      if (transition.kind === "delete") {
        lifecycle.onDeleteComplete(item);
      }
    }
    if (anchor != null && Number.isFinite(anchor)) {
      lifecycle.restoreVisualAnchor(anchor);
    }
    return true;
  }
}
