import type { Box, Context, Node } from "../../types";
import type { ListStateChange } from "../list-state";
import type {
  ResolvedListLayoutOptions,
  VisibleWindow,
  VisibleWindowResult,
} from "./solver";
import {
  clamp,
  getNow,
  getProgress,
  interpolate,
  sameState,
} from "./base-animation";
import {
  ALPHA_EPSILON,
  type ControlledState,
  type VirtualizedResolvedItem,
} from "./base-types";

export type TransitionRenderAdapter<
  C extends CanvasRenderingContext2D,
  T extends {},
> = {
  renderItem: (item: T) => Node<C>;
  measureNode: (node: Node<C>) => Box;
  drawNode: (node: Node<C>, x: number, y: number) => boolean;
  getRootContext: () => Context<C>;
  graphics: C;
  getItemIndex: (item: T) => number;
  resolveVisibleWindowForState: (
    state: ControlledState,
    now: number,
  ) => VisibleWindowResult<unknown>;
};

export type TransitionLifecycleAdapter<T extends {}> = {
  onDeleteComplete: (item: T) => void;
};

export type TransitionPlanningAdapter<
  C extends CanvasRenderingContext2D,
  T extends {},
> = Pick<TransitionRenderAdapter<C, T>, "renderItem" | "measureNode"> & {
  items: readonly T[];
  position: number | undefined;
  offset: number;
  underflowAlign: ResolvedListLayoutOptions["underflowAlign"];
  readListState: () => ControlledState;
  readVisibleRange: (
    top: number,
    height: number,
  ) => { top: number; bottom: number } | undefined;
  resolveVisibleWindow: () => VisibleWindowResult<unknown>;
  resolveVisibleWindowForState: (
    state: ControlledState,
    now: number,
  ) => VisibleWindowResult<unknown>;
};

export type ScalarAnimation = {
  from: number;
  to: number;
  startTime: number;
  duration: number;
};

export type LayerAnimation<C extends CanvasRenderingContext2D> = {
  node: Node<C>;
  alpha: ScalarAnimation;
  translateY: ScalarAnimation;
};

export type ActiveItemTransition<C extends CanvasRenderingContext2D> = {
  kind: "update" | "delete" | "insert";
  layers: LayerAnimation<C>[];
  height: ScalarAnimation;
  retention: "drawn" | "visible";
};

export type SampledLayer<C extends CanvasRenderingContext2D> = {
  alpha: number;
  node: Node<C>;
  translateY: number;
};

export type SampledItemTransition<C extends CanvasRenderingContext2D> = {
  kind: ActiveItemTransition<C>["kind"];
  slotHeight: number;
  layers: SampledLayer<C>[];
  retention: ActiveItemTransition<C>["retention"];
};

export type BoundaryInsertDirection = "push" | "unshift";

export type BoundaryInsertStrategy =
  | "item-enter"
  | "viewport-slide"
  | "hard-cut";

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

type BoundaryInsertPlan<C extends CanvasRenderingContext2D, T extends {}> =
  | BoundaryInsertItemPlan<C, T>
  | BoundaryInsertViewportPlan;

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
  readVisibleRange: (
    top: number,
    height: number,
  ) => { top: number; bottom: number } | undefined,
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
  readVisibleRange: (
    top: number,
    height: number,
  ) => { top: number; bottom: number } | undefined,
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
  readVisibleRange: (
    top: number,
    height: number,
  ) => { top: number; bottom: number } | undefined;
}): boolean {
  if (params.index < 0) {
    return false;
  }
  if (params.snapshot.matchesCurrentState(params.position, params.offset)) {
    return params.snapshot.isVisible(params.item);
  }
  return isIndexVisible(
    params.index,
    params.resolveVisibleWindow,
    params.readVisibleRange,
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
  readVisibleRange: (
    top: number,
    height: number,
  ) => { top: number; bottom: number } | undefined;
}): boolean {
  return resolveAnimationEligibility(params);
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
      retention: "visible",
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
    retention: "visible",
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

export class VisibilitySnapshot<T extends {}> {
  #drawnItems = new Set<T>();
  #visibleItems = new Set<T>();
  #hasSnapshot = false;
  #snapshotState: ControlledState | undefined;
  #emptyState: ControlledState | undefined;
  #coversShortList = false;
  #topGap = 0;
  #bottomGap = 0;
  #atStartBoundary = false;
  #atEndBoundary = false;

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

  capture(
    window: VisibleWindow<unknown>,
    resolutionPath: readonly number[],
    items: readonly T[],
    viewportHeight: number,
    snapshotState: ControlledState,
    extraShift: number,
    readVisibleRange: (
      top: number,
      height: number,
    ) => { top: number; bottom: number } | undefined,
  ): void {
    const nextDrawnItems = new Set<T>();
    const nextVisibleItems = new Set<T>();
    let minVisibleIndex = Number.POSITIVE_INFINITY;
    let maxVisibleIndex = Number.NEGATIVE_INFINITY;
    let topMostY = Number.POSITIVE_INFINITY;
    let bottomMostY = Number.NEGATIVE_INFINITY;
    const effectiveShift = window.shift + extraShift;

    for (const idx of resolutionPath) {
      void idx;
    }

    for (const { idx, offset, height } of window.drawList) {
      minVisibleIndex = Math.min(minVisibleIndex, idx);
      maxVisibleIndex = Math.max(maxVisibleIndex, idx);
      const y = offset + effectiveShift;
      topMostY = Math.min(topMostY, y);
      bottomMostY = Math.max(bottomMostY, y + height);

      const item = items[idx];
      if (item != null) {
        nextDrawnItems.add(item);
      }
      if (
        item == null ||
        readVisibleRange(offset + effectiveShift, height) == null
      ) {
        continue;
      }
      nextVisibleItems.add(item);
    }

    this.#drawnItems = nextDrawnItems;
    this.#visibleItems = nextVisibleItems;
    this.#hasSnapshot = true;
    this.#snapshotState = snapshotState;
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

  tracks(item: T, retention: "drawn" | "visible"): boolean {
    return retention === "drawn"
      ? this.#drawnItems.has(item)
      : this.#visibleItems.has(item);
  }

  reset(): void {
    this.#drawnItems.clear();
    this.#visibleItems.clear();
    this.#hasSnapshot = false;
    this.#snapshotState = undefined;
    this.#emptyState = undefined;
    this.#coversShortList = false;
    this.#topGap = 0;
    this.#bottomGap = 0;
    this.#atStartBoundary = false;
    this.#atEndBoundary = false;
  }
}

export class TransitionStore<C extends CanvasRenderingContext2D, T extends {}> {
  #transitions = new Map<T, ActiveItemTransition<C>>();

  get size(): number {
    return this.#transitions.size;
  }

  has(item: T): boolean {
    return this.#transitions.has(item);
  }

  set(item: T, transition: ActiveItemTransition<C>): void {
    this.#transitions.set(item, transition);
  }

  replace(prevItem: T, nextItem: T, transition: ActiveItemTransition<C>): void {
    this.#transitions.delete(prevItem);
    this.#transitions.set(nextItem, transition);
  }

  delete(item: T): ActiveItemTransition<C> | undefined {
    const transition = this.#transitions.get(item);
    if (transition != null) {
      this.#transitions.delete(item);
    }
    return transition;
  }

  readActive(
    item: T,
    now: number,
    lifecycle?: TransitionLifecycleAdapter<T>,
  ): ActiveItemTransition<C> | undefined {
    const transition = this.#transitions.get(item);
    if (transition == null) {
      return undefined;
    }
    if (
      getProgress(
        transition.height.startTime,
        transition.height.duration,
        now,
      ) >= 1
    ) {
      this.#transitions.delete(item);
      if (transition.kind === "delete") {
        lifecycle?.onDeleteComplete(item);
      }
      return undefined;
    }
    return transition;
  }

  prepare(now: number, lifecycle: TransitionLifecycleAdapter<T>): boolean {
    let keepAnimating = false;
    for (const item of [...this.#transitions.keys()]) {
      if (this.readActive(item, now, lifecycle) != null) {
        keepAnimating = true;
      }
    }
    return keepAnimating;
  }

  pruneInvisible(
    snapshot: VisibilitySnapshot<T>,
    lifecycle: TransitionLifecycleAdapter<T>,
  ): boolean {
    let changed = false;
    for (const [item, transition] of [...this.#transitions.entries()]) {
      if (snapshot.tracks(item, transition.retention)) {
        continue;
      }
      this.#transitions.delete(item);
      if (transition.kind === "delete") {
        lifecycle.onDeleteComplete(item);
      }
      changed = true;
    }
    return changed;
  }

  reset(): void {
    this.#transitions.clear();
  }
}

function planUpdateTransition<C extends CanvasRenderingContext2D, T extends {}>(
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
      readVisibleRange: ctx.readVisibleRange,
    }),
    now,
    currentVisualState,
    nextNode,
    nextHeight,
  });
}

function planDeleteTransition<C extends CanvasRenderingContext2D, T extends {}>(
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
      readVisibleRange: ctx.readVisibleRange,
    }),
    now,
    currentVisualState,
  });
}

function planBoundaryInsertTransition<
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

function getItemHeight<C extends CanvasRenderingContext2D, T extends {}>(
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

function resolveTransitionedItem<
  C extends CanvasRenderingContext2D,
  T extends {},
>(
  item: T,
  now: number,
  store: TransitionStore<C, T>,
  adapter: TransitionRenderAdapter<C, T>,
  lifecycle: TransitionLifecycleAdapter<T>,
): { value: VirtualizedResolvedItem; height: number } {
  const transition = store.readActive(item, now, lifecycle);
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

function readCurrentVisualState<
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
    readVisibleRange: (
      top: number,
      height: number,
    ) => { top: number; bottom: number } | undefined,
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
    return this.#store.pruneInvisible(this.#snapshot, lifecycle);
  }

  prepare(now: number, lifecycle: TransitionLifecycleAdapter<T>): boolean {
    this.#cleanupViewportTranslateAnimation(now);
    const keepViewportAnimating = this.#viewportTranslateAnimation != null;
    return this.#store.prepare(now, lifecycle) || keepViewportAnimating;
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
    return getItemHeight(item, now, this.#store, adapter);
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
    switch (change.type) {
      case "update":
        this.#handleUpdate(
          change.prevItem,
          change.nextItem,
          change.animation?.duration,
          ctx,
        );
        return;
      case "delete":
        this.#handleDelete(
          change.item,
          change.animation?.duration,
          ctx,
          lifecycle,
        );
        return;
      case "delete-finalize":
        this.#store.delete(change.item);
        return;
      case "unshift":
        this.#handleBoundaryInsert(
          "unshift",
          change.count,
          change.animation?.duration,
          change.animation?.distance,
          ctx,
        );
        return;
      case "push":
        this.#handleBoundaryInsert(
          "push",
          change.count,
          change.animation?.duration,
          change.animation?.distance,
          ctx,
        );
        return;
      case "reset":
      case "set":
        this.reset();
        return;
    }
  }

  reset(): void {
    this.#store.reset();
    this.#snapshot.reset();
    this.#viewportTranslateAnimation = undefined;
  }

  #handleUpdate(
    prevItem: T,
    nextItem: T,
    duration: number | undefined,
    ctx: TransitionPlanningAdapter<C, T>,
  ): void {
    const now = getNow();
    const currentVisualState = readCurrentVisualState(
      prevItem,
      now,
      this.#store,
      ctx,
    );
    const transition = planUpdateTransition(
      prevItem,
      nextItem,
      duration,
      now,
      currentVisualState,
      ctx,
      this.#snapshot,
      this.#store,
    );
    if (transition == null) {
      this.#store.delete(prevItem);
      return;
    }
    this.#store.replace(prevItem, nextItem, transition);
  }

  #handleDelete(
    item: T,
    duration: number | undefined,
    ctx: TransitionPlanningAdapter<C, T>,
    lifecycle: TransitionLifecycleAdapter<T>,
  ): void {
    const now = getNow();
    const currentVisualState = readCurrentVisualState(
      item,
      now,
      this.#store,
      ctx,
    );
    const transition = planDeleteTransition(
      item,
      duration,
      now,
      currentVisualState,
      ctx,
      this.#snapshot,
      this.#store,
    );
    if (transition == null) {
      this.#store.delete(item);
      lifecycle.onDeleteComplete(item);
      return;
    }
    this.#store.set(item, transition);
  }

  #handleBoundaryInsert(
    direction: BoundaryInsertDirection,
    count: number,
    duration: number | undefined,
    distance: number | undefined,
    ctx: TransitionPlanningAdapter<C, T>,
  ): void {
    const now = getNow();
    const plan = planBoundaryInsertTransition(
      direction,
      count,
      duration,
      distance,
      now,
      this.getViewportTranslateY(now),
      ctx,
      this.#snapshot,
    );
    if (plan == null) {
      return;
    }
    if (plan.kind === "viewport-slide") {
      this.#viewportTranslateAnimation = plan.animation;
      return;
    }
    for (const entry of plan.entries) {
      this.#store.set(entry.item, entry.transition);
    }
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
}
