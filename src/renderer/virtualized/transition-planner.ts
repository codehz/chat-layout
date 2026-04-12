import type { Node } from "../../types";
import type { ListStateChange } from "../list-state";
import { clamp, getNow, interpolate } from "./base-animation";
import { ALPHA_EPSILON, type VirtualizedResolvedItem } from "./base-types";
import type { ResolvedListLayoutOptions, VisibleWindowResult } from "./solver";
import {
  type ActiveItemTransition,
  type BoundaryInsertDirection,
  type BoundaryInsertStrategy,
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
  kind: "item-enter";
  entries: Array<{
    item: T;
    transition: ActiveItemTransition<C>;
  }>;
};

type BoundaryInsertViewportPlan = {
  kind: "viewport-slide";
  animation: ScalarAnimation;
};

export type BoundaryInsertPlan<
  C extends CanvasRenderingContext2D,
  T extends {},
> = BoundaryInsertItemPlan<C, T> | BoundaryInsertViewportPlan;

type MeasuredItem<C extends CanvasRenderingContext2D, T extends {}> = {
  item: T;
  node: Node<C>;
  height: number;
};

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

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
      idx: number;
      offset: number;
      height: number;
    }
  | undefined {
  if (index < 0) {
    return undefined;
  }
  const solution = resolveVisibleWindow();
  for (const entry of solution.window.drawList) {
    if (entry.idx !== index) {
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
      entry.idx >= start &&
      entry.idx < end &&
      ctx.readOuterVisibleRange(
        entry.offset + solution.window.shift,
        entry.height,
      ) != null,
  );
}

export function resolveBoundaryInsertStrategy(
  direction: BoundaryInsertDirection,
  underflowAlign: ResolvedListLayoutOptions["underflowAlign"],
  coversShortListSnapshot: boolean,
): BoundaryInsertStrategy {
  if (!coversShortListSnapshot) {
    return "hard-cut";
  }
  if (
    (direction === "push" && underflowAlign === "bottom") ||
    (direction === "unshift" && underflowAlign === "top")
  ) {
    return "viewport-slide";
  }
  return "item-enter";
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

function planViewportShift(params: {
  currentTranslateY: number;
  travel: number;
  direction: "positive" | "negative";
  now: number;
  duration: number;
}): ScalarAnimation | undefined {
  if (!isFinitePositive(params.travel) || params.duration <= 0) {
    return undefined;
  }
  const from =
    params.direction === "positive"
      ? params.currentTranslateY + params.travel
      : params.currentTranslateY - params.travel;
  return createScalarAnimation(from, 0, params.now, params.duration);
}

function planBoundaryInsert<
  C extends CanvasRenderingContext2D,
  T extends {},
>(params: {
  direction: BoundaryInsertDirection;
  duration: number;
  distance: number | undefined;
  now: number;
  strategy: BoundaryInsertStrategy;
  snapshot: VisibilitySnapshot<T>;
  currentTranslateY: number;
  measuredItems: MeasuredItem<C, T>[];
}): BoundaryInsertPlan<C, T> | undefined {
  switch (params.strategy) {
    case "hard-cut":
      return undefined;
    case "item-enter":
      return planBoundaryInsertItems(params);
    case "viewport-slide":
      return planBoundaryInsertViewportShift(params);
  }
}

function planBoundaryInsertItems<
  C extends CanvasRenderingContext2D,
  T extends {},
>(params: {
  direction: BoundaryInsertDirection;
  duration: number;
  distance: number | undefined;
  now: number;
  measuredItems: MeasuredItem<C, T>[];
}): BoundaryInsertItemPlan<C, T> | undefined {
  const entries: BoundaryInsertItemPlan<C, T>["entries"] = [];
  const signedDistance = params.direction === "push" ? 1 : -1;
  for (const { item, node, height } of params.measuredItems) {
    if (!Number.isFinite(height) || height < 0) {
      return undefined;
    }
    const resolvedDistance =
      typeof params.distance === "number" && Number.isFinite(params.distance)
        ? Math.max(0, params.distance)
        : Math.min(24, height);
    entries.push({
      item,
      transition: {
        kind: "insert",
        layers: [
          createLayerAnimation(
            node,
            0,
            1,
            params.now,
            params.duration,
            signedDistance * resolvedDistance,
            0,
          ),
        ],
        height: createScalarAnimation(
          height,
          height,
          params.now,
          params.duration,
        ),
        retention: "drawn",
      },
    });
  }
  return entries.length === 0 ? undefined : { kind: "item-enter", entries };
}

function planBoundaryInsertViewportShift<
  C extends CanvasRenderingContext2D,
  T extends {},
>(params: {
  direction: BoundaryInsertDirection;
  duration: number;
  now: number;
  snapshot: VisibilitySnapshot<T>;
  currentTranslateY: number;
  measuredItems: MeasuredItem<C, T>[];
}): BoundaryInsertViewportPlan | undefined {
  let insertedHeight = 0;
  for (const { height } of params.measuredItems) {
    if (!Number.isFinite(height) || height <= 0) {
      return undefined;
    }
    insertedHeight += height;
  }
  if (!isFinitePositive(insertedHeight)) {
    return undefined;
  }

  const gap =
    params.direction === "push"
      ? params.snapshot.topGap
      : params.snapshot.bottomGap;
  const travel = Math.min(insertedHeight, gap);
  const animation = planViewportShift({
    currentTranslateY: params.currentTranslateY,
    travel,
    direction: params.direction === "push" ? "positive" : "negative",
    now: params.now,
    duration: params.duration,
  });
  return animation == null ? undefined : { kind: "viewport-slide", animation };
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
  distance: number | undefined,
  now: number,
  currentTranslateY: number,
  ctx: TransitionPlanningAdapter<C, T>,
  snapshot: VisibilitySnapshot<T>,
): BoundaryInsertPlan<C, T> | undefined {
  const normalizedDuration = normalizeDuration(duration);
  if (count <= 0 || normalizedDuration <= 0) {
    return undefined;
  }
  const hasShortListSnapshot = snapshot.matchesBoundaryInsertState(
    direction,
    count,
    ctx.position,
    ctx.offset,
  );
  const strategy = hasShortListSnapshot
    ? resolveBoundaryInsertStrategy(direction, ctx.underflowAlign, true)
    : snapshot.matchesEmptyBoundaryInsertState(
          direction,
          count,
          ctx.position,
          ctx.offset,
        )
      ? "item-enter"
      : snapshot.hasSnapshot &&
          hasVisibleBoundaryInsertItems(direction, count, ctx)
        ? "item-enter"
        : "hard-cut";
  if (strategy === "hard-cut") {
    return undefined;
  }
  const measuredItems = measureBoundaryInsertItems(direction, count, ctx);
  if (measuredItems == null) {
    return undefined;
  }
  return planBoundaryInsert({
    direction,
    duration: normalizedDuration,
    distance,
    now,
    strategy,
    snapshot,
    currentTranslateY,
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
  currentViewportTranslateY: number,
  change: ListStateChange<T>,
  ctx: TransitionPlanningAdapter<C, T>,
  lifecycle: TransitionLifecycleAdapter<T>,
): {
  viewportAnimation?: ScalarAnimation;
} {
  switch (change.type) {
    case "update": {
      const now = getNow();
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
        store.delete(change.prevItem);
        return {};
      }
      store.replace(change.prevItem, change.nextItem, transition);
      return {};
    }
    case "delete": {
      const now = getNow();
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
        store.delete(change.item);
        lifecycle.onDeleteComplete(change.item);
        return {};
      }
      store.set(change.item, transition);
      return {};
    }
    case "delete-finalize":
      store.delete(change.item);
      return {};
    case "unshift":
    case "push": {
      const now = getNow();
      const plan = planBoundaryInsertTransition(
        change.type,
        change.count,
        change.animation?.duration,
        change.animation?.distance,
        now,
        currentViewportTranslateY,
        ctx,
        snapshot,
      );
      if (plan == null) {
        return {};
      }
      if (plan.kind === "viewport-slide") {
        return {
          viewportAnimation: plan.animation,
        };
      }
      for (const entry of plan.entries) {
        store.set(entry.item, entry.transition);
      }
      return {};
    }
    case "reset":
    case "set":
      store.reset();
      snapshot.reset();
      return {};
  }
}
