import type { Node } from "../../types";
import type { ListStateChange } from "../list-state";
import type { VisibleWindowResult } from "./solver";
import {
  type ActiveItemTransition,
  type BoundaryInsertDirection,
  type LayerAnimation,
  type SampledItemTransition,
  type SampledLayer,
  type ScalarAnimation,
  type TransitionLifecycleAdapter,
  type TransitionPlanningAdapter,
  type TransitionRenderAdapter,
} from "./transition-runtime";
import { VisibilitySnapshot } from "./transition-snapshot";
import { TransitionStore } from "./transition-store";
import { clamp, getNow, interpolate } from "./virtualized-animation";
import {
  ALPHA_EPSILON,
  type AutoFollowBoundary,
  type VirtualizedResolvedItem,
} from "./virtualized-types";

type CurrentVisualState<C extends CanvasRenderingContext2D> = {
  node: Node<C>;
  alpha: number;
  height: number;
  translateY: number;
};

type BoundaryInsertItemPlan<
  C extends CanvasRenderingContext2D,
  T extends {},
> = {
  entries: Array<{
    item: T;
    transition: ActiveItemTransition<C>;
  }>;
};

export type BoundaryInsertPlan<
  C extends CanvasRenderingContext2D,
  T extends {},
> = BoundaryInsertItemPlan<C, T>;

type MeasuredItem<C extends CanvasRenderingContext2D, T extends {}> = {
  item: T;
  node: Node<C>;
  height: number;
};

function normalizeDuration(duration: number | undefined): number {
  return Math.max(
    0,
    typeof duration === "number" && Number.isFinite(duration) ? duration : 0,
  );
}

function createScalarAnimation(
  from: number,
  to: number,
  startTime: number,
  duration: number,
): ScalarAnimation {
  return {
    from,
    to,
    startTime,
    duration,
  };
}

function createLayerAnimation<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  fromAlpha: number,
  toAlpha: number,
  startTime: number,
  duration: number,
  fromTranslateY: number,
  toTranslateY: number,
): LayerAnimation<C> {
  return {
    node,
    alpha: createScalarAnimation(fromAlpha, toAlpha, startTime, duration),
    translateY: createScalarAnimation(
      fromTranslateY,
      toTranslateY,
      startTime,
      duration,
    ),
  };
}

function findVisibleEntry(
  index: number,
  resolveVisibleWindow: () => VisibleWindowResult<unknown>,
  readVisibleRange: TransitionPlanningAdapter<
    CanvasRenderingContext2D,
    {}
  >["readVisibleRange"],
):
  | {
      index: number;
      offset: number;
      height: number;
    }
  | undefined {
  if (index < 0) {
    return undefined;
  }
  const solution = resolveVisibleWindow();
  for (const entry of solution.window.drawList) {
    if (entry.index !== index) {
      continue;
    }
    if (
      readVisibleRange(entry.offset + solution.window.shift, entry.height) !=
      null
    ) {
      return entry;
    }
  }
  return undefined;
}

function isIndexVisible(
  index: number,
  resolveVisibleWindow: () => VisibleWindowResult<unknown>,
  readVisibleRange: TransitionPlanningAdapter<
    CanvasRenderingContext2D,
    {}
  >["readVisibleRange"],
): boolean {
  return (
    findVisibleEntry(index, resolveVisibleWindow, readVisibleRange) != null
  );
}

function resolveAnimationEligibility<T extends {}>(params: {
  index: number;
  item: T;
  position: number | undefined;
  offset: number;
  snapshot: VisibilitySnapshot<T>;
  hasActiveTransition: boolean;
  resolveVisibleWindow: () => VisibleWindowResult<unknown>;
  readOuterVisibleRange: TransitionPlanningAdapter<
    CanvasRenderingContext2D,
    {}
  >["readOuterVisibleRange"];
}): boolean {
  if (params.index < 0) {
    return false;
  }
  if (params.snapshot.matchesCurrentState(params.position, params.offset)) {
    return params.snapshot.tracks(params.item, "drawn");
  }
  return isIndexVisible(
    params.index,
    params.resolveVisibleWindow,
    params.readOuterVisibleRange,
  );
}

export function canAnimateExistingItem<T extends {}>(params: {
  index: number;
  item: T;
  position: number | undefined;
  offset: number;
  snapshot: VisibilitySnapshot<T>;
  hasActiveTransition: boolean;
  resolveVisibleWindow: () => VisibleWindowResult<unknown>;
  readOuterVisibleRange: TransitionPlanningAdapter<
    CanvasRenderingContext2D,
    {}
  >["readOuterVisibleRange"];
}): boolean {
  return resolveAnimationEligibility(params);
}

function hasVisibleBoundaryInsertItems<
  C extends CanvasRenderingContext2D,
  T extends {},
>(
  direction: BoundaryInsertDirection,
  count: number,
  ctx: TransitionPlanningAdapter<C, T>,
): boolean {
  if (count <= 0) {
    return false;
  }
  const start = direction === "push" ? ctx.items.length - count : 0;
  const end =
    direction === "push" ? ctx.items.length : Math.min(count, ctx.items.length);
  if (start < 0 || end <= start) {
    return false;
  }

  const solution = ctx.resolveVisibleWindow();
  return solution.window.drawList.some(
    (entry) =>
      entry.index >= start &&
      entry.index < end &&
      ctx.readOuterVisibleRange(
        entry.offset + solution.window.shift,
        entry.height,
      ) != null,
  );
}

export function sampleScalarAnimation(
  animation: ScalarAnimation,
  now: number,
): number {
  return interpolate(
    animation.from,
    animation.to,
    animation.startTime,
    animation.duration,
    now,
  );
}

export function sampleLayerAnimation<C extends CanvasRenderingContext2D>(
  layer: LayerAnimation<C>,
  now: number,
): SampledLayer<C> | undefined {
  const alpha = sampleScalarAnimation(layer.alpha, now);
  if (alpha <= ALPHA_EPSILON) {
    return undefined;
  }
  return {
    alpha,
    node: layer.node,
    translateY: sampleScalarAnimation(layer.translateY, now),
  };
}

export function sampleActiveTransition<C extends CanvasRenderingContext2D>(
  transition: ActiveItemTransition<C>,
  now: number,
): SampledItemTransition<C> {
  return sampleTransition(transition, now);
}

function sampleTransition<C extends CanvasRenderingContext2D>(
  transition: ActiveItemTransition<C>,
  now: number,
): SampledItemTransition<C> {
  return {
    kind: transition.kind,
    slotHeight: sampleScalarAnimation(transition.height, now),
    layers: transition.layers
      .map((layer) => sampleLayerAnimation(layer, now))
      .filter((layer): layer is SampledLayer<C> => layer != null),
    retention: transition.retention,
  };
}

function planExistingItemTransition<C extends CanvasRenderingContext2D>(
  params:
    | {
        kind: "update";
        duration: number;
        canAnimate: boolean;
        now: number;
        currentVisualState: CurrentVisualState<C>;
        nextNode: Node<C>;
        nextHeight: number;
      }
    | {
        kind: "delete";
        duration: number;
        canAnimate: boolean;
        now: number;
        currentVisualState: CurrentVisualState<C>;
      },
): ActiveItemTransition<C> | undefined {
  if (!params.canAnimate || params.duration <= 0) {
    return undefined;
  }
  if (params.kind === "update" && !Number.isFinite(params.nextHeight)) {
    return undefined;
  }

  const layers: LayerAnimation<C>[] = [];
  if (params.currentVisualState.alpha > ALPHA_EPSILON) {
    layers.push(
      createLayerAnimation(
        params.currentVisualState.node,
        params.currentVisualState.alpha,
        0,
        params.now,
        params.duration,
        params.currentVisualState.translateY,
        0,
      ),
    );
  }

  if (params.kind === "update") {
    layers.push(
      createLayerAnimation(
        params.nextNode,
        0,
        1,
        params.now,
        params.duration,
        params.currentVisualState.translateY,
        0,
      ),
    );
    return {
      kind: "update",
      layers,
      height: createScalarAnimation(
        params.currentVisualState.height,
        params.nextHeight,
        params.now,
        params.duration,
      ),
      retention: "drawn",
    };
  }

  return {
    kind: "delete",
    layers,
    height: createScalarAnimation(
      params.currentVisualState.height,
      0,
      params.now,
      params.duration,
    ),
    retention: "drawn",
  };
}

function resolveAutoFollowBoundaryRisk<
  C extends CanvasRenderingContext2D,
  T extends {},
>(
  index: number,
  ctx: TransitionPlanningAdapter<C, T>,
  snapshot: VisibilitySnapshot<T>,
): AutoFollowBoundary | undefined {
  const drawnRange = snapshot.readDrawnIndexRange();
  if (
    index < 0 ||
    !snapshot.hasSnapshot ||
    drawnRange == null ||
    !Number.isFinite(drawnRange.minIndex) ||
    !Number.isFinite(drawnRange.maxIndex)
  ) {
    return undefined;
  }
  if (ctx.anchorMode === "bottom") {
    return index <= drawnRange.minIndex ? "top" : undefined;
  }
  return index >= drawnRange.maxIndex ? "bottom" : undefined;
}

function canClassifyAutoFollowBoundaryRisk<T extends {}>(
  index: number,
  snapshot: VisibilitySnapshot<T>,
): boolean {
  return (
    index >= 0 && snapshot.hasSnapshot && snapshot.readDrawnIndexRange() != null
  );
}

function beginTransitionAutoFollowObservation<
  C extends CanvasRenderingContext2D,
  T extends {},
>(
  transition: ActiveItemTransition<C>,
  lifecycle: TransitionLifecycleAdapter<T>,
): void {
  if (transition.observedAutoFollowBoundary == null) {
    return;
  }
  lifecycle.beginAutoFollowBoundaryObservation(
    transition.observedAutoFollowBoundary,
  );
}

function endTransitionAutoFollowObservation<
  C extends CanvasRenderingContext2D,
  T extends {},
>(
  transition: ActiveItemTransition<C> | undefined,
  lifecycle: TransitionLifecycleAdapter<T>,
): void {
  if (transition?.observedAutoFollowBoundary == null) {
    return;
  }
  lifecycle.endAutoFollowBoundaryObservation(
    transition.observedAutoFollowBoundary,
  );
}

function invalidateAutoFollowBoundaryRisk<T extends {}>(
  boundary: AutoFollowBoundary | undefined,
  canClassify: boolean,
  lifecycle: TransitionLifecycleAdapter<T>,
): void {
  if (boundary != null) {
    lifecycle.invalidateAutoFollowBoundary(boundary);
    return;
  }
  if (!canClassify) {
    lifecycle.invalidateAutoFollowBoundary(undefined);
  }
}

function planBoundaryInsertItems<
  C extends CanvasRenderingContext2D,
  T extends {},
>(params: {
  duration: number;
  animateHeight: boolean;
  now: number;
  measuredItems: MeasuredItem<C, T>[];
}): BoundaryInsertItemPlan<C, T> | undefined {
  const entries: BoundaryInsertItemPlan<C, T>["entries"] = [];
  for (const { item, node, height } of params.measuredItems) {
    if (!Number.isFinite(height) || height < 0) {
      return undefined;
    }
    entries.push({
      item,
      transition: {
        kind: "insert",
        layers: [
          createLayerAnimation(node, 0, 1, params.now, params.duration, 0, 0),
        ],
        height: createScalarAnimation(
          params.animateHeight ? 0 : height,
          height,
          params.now,
          params.duration,
        ),
        retention: "drawn",
      },
    });
  }
  return entries.length === 0 ? undefined : { entries };
}

function measureBoundaryInsertItems<
  C extends CanvasRenderingContext2D,
  T extends {},
>(
  direction: BoundaryInsertDirection,
  count: number,
  ctx: TransitionPlanningAdapter<C, T>,
): MeasuredItem<C, T>[] | undefined {
  const start = direction === "push" ? ctx.items.length - count : 0;
  const end =
    direction === "push" ? ctx.items.length : Math.min(count, ctx.items.length);
  if (start < 0 || end < start) {
    return undefined;
  }

  const measured: MeasuredItem<C, T>[] = [];
  for (let index = start; index < end; index += 1) {
    const item = ctx.items[index];
    if (item == null) {
      continue;
    }
    const node = ctx.renderItem(item);
    const height = ctx.measureNode(node).height;
    measured.push({ item, node, height });
  }
  return measured;
}

export function drawSampledLayers<
  C extends CanvasRenderingContext2D,
  T extends {},
>(
  sampled: SampledItemTransition<C>,
  y: number,
  adapter: Pick<TransitionRenderAdapter<C, T>, "drawNode" | "graphics">,
): boolean {
  if (sampled.slotHeight <= 0) {
    return false;
  }

  let result = false;
  for (const layer of sampled.layers) {
    const alpha = clamp(layer.alpha, 0, 1);
    if (alpha <= ALPHA_EPSILON) {
      continue;
    }
    adapter.graphics.save();
    try {
      if (sampled.kind === "insert") {
        adapter.graphics.beginPath();
        adapter.graphics.rect(
          0,
          y,
          adapter.graphics.canvas.clientWidth,
          sampled.slotHeight,
        );
        adapter.graphics.clip();
      }
      if (typeof adapter.graphics.globalAlpha === "number") {
        adapter.graphics.globalAlpha *= alpha;
      }
      if (adapter.drawNode(layer.node, 0, y + layer.translateY)) {
        result = true;
      }
    } finally {
      adapter.graphics.restore();
    }
  }
  return result;
}

export function planUpdateTransition<
  C extends CanvasRenderingContext2D,
  T extends {},
>(
  prevItem: T,
  nextItem: T,
  duration: number | undefined,
  now: number,
  currentVisualState: CurrentVisualState<C>,
  ctx: TransitionPlanningAdapter<C, T>,
  snapshot: VisibilitySnapshot<T>,
  store: TransitionStore<C, T>,
): ActiveItemTransition<C> | undefined {
  const nextIndex = ctx.items.indexOf(nextItem);
  const nextNode = ctx.renderItem(nextItem);
  const nextHeight = ctx.measureNode(nextNode).height;
  return planExistingItemTransition({
    kind: "update",
    duration: normalizeDuration(duration),
    canAnimate: resolveAnimationEligibility({
      index: nextIndex,
      item: prevItem,
      position: ctx.position,
      offset: ctx.offset,
      snapshot,
      hasActiveTransition: store.has(prevItem),
      resolveVisibleWindow: ctx.resolveVisibleWindow,
      readOuterVisibleRange: ctx.readOuterVisibleRange,
    }),
    now,
    currentVisualState,
    nextNode,
    nextHeight,
  });
}

export function planDeleteTransition<
  C extends CanvasRenderingContext2D,
  T extends {},
>(
  item: T,
  duration: number | undefined,
  now: number,
  currentVisualState: CurrentVisualState<C>,
  ctx: TransitionPlanningAdapter<C, T>,
  snapshot: VisibilitySnapshot<T>,
  store: TransitionStore<C, T>,
): ActiveItemTransition<C> | undefined {
  const index = ctx.items.indexOf(item);
  return planExistingItemTransition({
    kind: "delete",
    duration: normalizeDuration(duration),
    canAnimate: resolveAnimationEligibility({
      index,
      item,
      position: ctx.position,
      offset: ctx.offset,
      snapshot,
      hasActiveTransition: store.has(item),
      resolveVisibleWindow: ctx.resolveVisibleWindow,
      readOuterVisibleRange: ctx.readOuterVisibleRange,
    }),
    now,
    currentVisualState,
  });
}

export function planBoundaryInsertTransition<
  C extends CanvasRenderingContext2D,
  T extends {},
>(
  direction: BoundaryInsertDirection,
  count: number,
  duration: number | undefined,
  now: number,
  ctx: TransitionPlanningAdapter<C, T>,
  snapshot: VisibilitySnapshot<T>,
): BoundaryInsertPlan<C, T> | undefined {
  const normalizedDuration = normalizeDuration(duration);
  if (count <= 0 || normalizedDuration <= 0) {
    return undefined;
  }
  const matchesBoundaryState = snapshot.matchesBoundaryInsertState(
    direction,
    count,
    ctx.position,
    ctx.offset,
  );
  const matchesFollowState = snapshot.matchesFollowBoundaryInsertState(
    direction,
    count,
    ctx.position,
    ctx.offset,
  );
  const matchesEmptyState = snapshot.matchesEmptyBoundaryInsertState(
    direction,
    count,
    ctx.position,
    ctx.offset,
  );
  const canAnimate =
    matchesBoundaryState ||
    matchesFollowState ||
    matchesEmptyState ||
    (snapshot.hasSnapshot &&
      hasVisibleBoundaryInsertItems(direction, count, ctx));
  if (!canAnimate) {
    return undefined;
  }
  const animateHeight = !(
    direction === "unshift" &&
    matchesFollowState &&
    !matchesBoundaryState &&
    !matchesEmptyState
  );
  const measuredItems = measureBoundaryInsertItems(direction, count, ctx);
  if (measuredItems == null) {
    return undefined;
  }
  return planBoundaryInsertItems({
    duration: normalizedDuration,
    animateHeight,
    now,
    measuredItems,
  });
}

export function getTransitionedItemHeight<
  C extends CanvasRenderingContext2D,
  T extends {},
>(
  item: T,
  now: number,
  store: TransitionStore<C, T>,
  adapter: Pick<TransitionRenderAdapter<C, T>, "renderItem" | "measureNode">,
): number {
  const transition = store.readActive(item, now);
  if (transition != null) {
    return sampleTransition(transition, now).slotHeight;
  }
  const node = adapter.renderItem(item);
  return adapter.measureNode(node).height;
}

export function resolveTransitionedItem<
  C extends CanvasRenderingContext2D,
  T extends {},
>(
  item: T,
  now: number,
  store: TransitionStore<C, T>,
  adapter: TransitionRenderAdapter<C, T>,
  lifecycle: TransitionLifecycleAdapter<T>,
): { value: VirtualizedResolvedItem; height: number } {
  const transition = store.readActive(item, now);
  if (transition == null) {
    const node = adapter.renderItem(item);
    return {
      value: {
        draw: (y) => adapter.drawNode(node, 0, y),
        hittest: (test, y) =>
          node.hittest(adapter.getRootContext(), { ...test, y: test.y - y }),
      },
      height: adapter.measureNode(node).height,
    };
  }

  const sampled = sampleTransition(transition, now);
  return {
    value: {
      draw: (y) => drawSampledLayers(sampled, y, adapter),
      hittest: () => false,
    },
    height: sampled.slotHeight,
  };
}

export function readCurrentVisualState<
  C extends CanvasRenderingContext2D,
  T extends {},
>(
  item: T,
  now: number,
  store: TransitionStore<C, T>,
  adapter: Pick<TransitionRenderAdapter<C, T>, "renderItem" | "measureNode">,
): CurrentVisualState<C> {
  const transition = store.readActive(item, now);
  if (transition != null && transition.layers.length > 0) {
    const primaryLayer = transition.layers[transition.layers.length - 1]!;
    return {
      node: primaryLayer.node,
      alpha: sampleScalarAnimation(primaryLayer.alpha, now),
      height: sampleScalarAnimation(transition.height, now),
      translateY: sampleScalarAnimation(primaryLayer.translateY, now),
    };
  }

  const node = adapter.renderItem(item);
  return {
    node,
    alpha: 1,
    height: adapter.measureNode(node).height,
    translateY: 0,
  };
}

export function handleTransitionStateChange<
  C extends CanvasRenderingContext2D,
  T extends {},
>(
  store: TransitionStore<C, T>,
  snapshot: VisibilitySnapshot<T>,
  change: ListStateChange<T>,
  ctx: TransitionPlanningAdapter<C, T>,
  lifecycle: TransitionLifecycleAdapter<T>,
  now = getNow(),
): void {
  switch (change.type) {
    case "update": {
      const nextIndex = ctx.items.indexOf(change.nextItem);
      const canClassifyRisk = canClassifyAutoFollowBoundaryRisk(
        nextIndex,
        snapshot,
      );
      const observedBoundary = resolveAutoFollowBoundaryRisk(
        nextIndex,
        ctx,
        snapshot,
      );
      const currentVisualState = readCurrentVisualState(
        change.prevItem,
        now,
        store,
        ctx,
      );
      const transition = planUpdateTransition(
        change.prevItem,
        change.nextItem,
        change.animation?.duration,
        now,
        currentVisualState,
        ctx,
        snapshot,
        store,
      );
      if (transition == null) {
        endTransitionAutoFollowObservation(
          store.delete(change.prevItem),
          lifecycle,
        );
        invalidateAutoFollowBoundaryRisk(
          observedBoundary,
          canClassifyRisk,
          lifecycle,
        );
        return;
      }
      transition.observedAutoFollowBoundary = observedBoundary;
      endTransitionAutoFollowObservation(
        store.replace(change.prevItem, change.nextItem, transition),
        lifecycle,
      );
      beginTransitionAutoFollowObservation(transition, lifecycle);
      return;
    }
    case "delete": {
      const index = ctx.items.indexOf(change.item);
      const canClassifyRisk = canClassifyAutoFollowBoundaryRisk(
        index,
        snapshot,
      );
      const observedBoundary = resolveAutoFollowBoundaryRisk(
        index,
        ctx,
        snapshot,
      );
      const currentVisualState = readCurrentVisualState(
        change.item,
        now,
        store,
        ctx,
      );
      const transition = planDeleteTransition(
        change.item,
        change.animation?.duration,
        now,
        currentVisualState,
        ctx,
        snapshot,
        store,
      );
      if (transition == null) {
        endTransitionAutoFollowObservation(
          store.delete(change.item),
          lifecycle,
        );
        invalidateAutoFollowBoundaryRisk(
          observedBoundary,
          canClassifyRisk,
          lifecycle,
        );
        lifecycle.onDeleteComplete(change.item);
        return;
      }
      transition.observedAutoFollowBoundary = observedBoundary;
      endTransitionAutoFollowObservation(
        store.set(change.item, transition),
        lifecycle,
      );
      beginTransitionAutoFollowObservation(transition, lifecycle);
      return;
    }
    case "delete-finalize":
      endTransitionAutoFollowObservation(store.delete(change.item), lifecycle);
      lifecycle.invalidateAutoFollowBoundary(undefined);
      return;
    case "unshift":
    case "push": {
      const plan = planBoundaryInsertTransition(
        change.type,
        change.count,
        change.animation?.duration,
        now,
        ctx,
        snapshot,
      );
      if (plan == null) {
        return;
      }
      for (const entry of plan.entries) {
        endTransitionAutoFollowObservation(
          store.set(entry.item, entry.transition),
          lifecycle,
        );
      }
      if (
        ctx.position == null &&
        snapshot.coversShortList &&
        ((change.type === "push" && ctx.anchorMode === "bottom") ||
          (change.type === "unshift" && ctx.anchorMode === "top"))
      ) {
        const boundary = change.type === "push" ? "bottom" : "top";
        const boundaryItem = snapshot.readBoundaryItem(boundary);
        if (boundaryItem != null) {
          lifecycle.snapItemToViewportBoundary(boundaryItem, boundary);
        }
      }
      return;
    }
    case "reset":
    case "set":
      for (const entry of store.entries()) {
        endTransitionAutoFollowObservation(entry.transition, lifecycle);
      }
      store.reset();
      snapshot.reset();
      return;
  }
}
