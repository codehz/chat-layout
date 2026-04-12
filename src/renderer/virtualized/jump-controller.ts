import type {
  InsertListItemsAnimationOptions,
  ListStateChange,
} from "../list-state";
import {
  buildJumpPath,
  clamp,
  getAnchorAtDistance,
  getNow,
  getProgress,
  sameState,
  smoothstep,
} from "./base-animation";
import type {
  AutoFollowBoundary,
  AutoFollowCapabilities,
  ControlledState,
  JumpAnimation,
} from "./base-types";
import type { JumpBlock } from "./anchor-model";
import type { NormalizedListState } from "./solver";

type JumpOptions = {
  animated?: boolean;
  block?: JumpBlock;
  duration?: number;
  onComplete?: () => void;
};

type BoundaryFollowChange<T extends {}> = {
  change: Extract<ListStateChange<T>, { type: "push" } | { type: "unshift" }>;
  boundary: AutoFollowBoundary;
  direction: "push" | "unshift";
  count: number;
  animation: InsertListItemsAnimationOptions | undefined;
};

export interface JumpControllerOptions<T extends {}> {
  minJumpDuration: number;
  maxJumpDuration: number;
  jumpDurationPerPixel: number;
  getItemCount: () => number;
  readListState: () => ControlledState;
  normalizeListState: (state: ControlledState) => NormalizedListState;
  readAnchor: (state: NormalizedListState) => number;
  applyAnchor: (anchor: number) => void;
  getDefaultJumpBlock: () => JumpBlock;
  getTargetAnchor: (index: number, block: JumpBlock) => number;
  clampItemIndex: (index: number) => number;
  getItemHeight: (index: number) => number;
}

export class JumpController<T extends {}> {
  #canAutoFollowTop = false;
  #canAutoFollowBottom = false;
  #pendingAutoFollowRecomputeTop = true;
  #pendingAutoFollowRecomputeBottom = true;
  #lastViewportWidth: number | undefined;
  #controlledState: ControlledState | undefined;
  #jumpAnimation: JumpAnimation | undefined;
  #lastCommittedState: ControlledState | undefined;
  #hasPendingListChange = false;
  #pendingPostJumpBoundary: AutoFollowBoundary | undefined;
  #pendingPostJumpBoundaryBlocked = false;
  readonly #options: JumpControllerOptions<T>;

  constructor(options: JumpControllerOptions<T>) {
    this.#options = options;
  }

  beforeFrame(): void {
    const currentState = this.#options.readListState();
    if (
      !this.#hasPendingListChange &&
      this.#lastCommittedState != null &&
      !sameState(
        this.#lastCommittedState,
        currentState.position,
        currentState.offset,
      )
    ) {
      this.#cancelJumpAnimation();
      this.#clearPendingPostJumpBoundary();
      this.#markAutoFollowRecompute();
    }
    this.#hasPendingListChange = false;
  }

  noteViewportWidth(width: number): void {
    if (!Number.isFinite(width)) {
      return;
    }
    if (this.#lastViewportWidth == null) {
      this.#lastViewportWidth = width;
      return;
    }
    if (Object.is(this.#lastViewportWidth, width)) {
      return;
    }
    this.#lastViewportWidth = width;
    this.#clearPendingPostJumpBoundary();
    this.#markAutoFollowRecompute();
  }

  prepare(now: number): boolean {
    const animation = this.#jumpAnimation;
    if (animation == null) {
      return false;
    }
    if (this.#options.getItemCount() === 0) {
      this.#cancelJumpAnimation();
      return false;
    }
    const currentState = this.#options.readListState();
    if (
      this.#controlledState != null &&
      !sameState(
        this.#controlledState,
        currentState.position,
        currentState.offset,
      )
    ) {
      this.#clearPendingPostJumpBoundary();
      this.#cancelJumpAnimation();
      this.#markAutoFollowRecompute();
      return false;
    }

    const progress = getProgress(animation.startTime, animation.duration, now);
    const eased = progress >= 1 ? 1 : smoothstep(progress);
    const anchor = getAnchorAtDistance(
      animation.path,
      animation.path.totalDistance * eased,
    );
    this.#options.applyAnchor(anchor);
    animation.needsMoreFrames = progress < 1;
    if (
      !animation.needsMoreFrames &&
      this.#pendingPostJumpBoundary != null &&
      !this.#pendingPostJumpBoundaryBlocked
    ) {
      this.#armAutoFollowBoundary(this.#pendingPostJumpBoundary);
    }
    return animation.needsMoreFrames;
  }

  finishFrame(requestRedraw: boolean): boolean {
    const animation = this.#jumpAnimation;
    if (animation == null) {
      return requestRedraw;
    }

    if (animation.needsMoreFrames) {
      this.#controlledState = this.#options.readListState();
      return true;
    }

    const boundary =
      this.#pendingPostJumpBoundaryBlocked === true
        ? undefined
        : this.#pendingPostJumpBoundary;
    const onComplete = animation.onComplete;
    this.#cancelJumpAnimation();
    this.#clearPendingPostJumpBoundary();
    if (boundary != null) {
      this.#armAutoFollowBoundary(boundary);
    }
    onComplete?.();
    return requestRedraw || this.#jumpAnimation != null;
  }

  commit(state: ControlledState): void {
    this.#lastCommittedState = {
      position: state.position,
      offset: state.offset,
    };
  }

  jumpTo(index: number, options: JumpOptions = {}): void {
    this.#clearPendingPostJumpBoundary();
    if (this.#options.getItemCount() === 0) {
      this.#cancelJumpAnimation();
      return;
    }
    this.#startJumpToIndex(index, options);
  }

  jumpToBoundary(
    boundary: AutoFollowBoundary,
    options: JumpOptions = {},
  ): void {
    this.#clearPendingPostJumpBoundary();
    this.#armAutoFollowBoundary(boundary);
    if (this.#options.getItemCount() === 0) {
      this.#cancelJumpAnimation();
      return;
    }
    this.#startJumpToIndex(
      boundary === "bottom" ? this.#options.getItemCount() - 1 : 0,
      {
        ...options,
        block: boundary === "bottom" ? "end" : "start",
      },
    );
  }

  recomputeAutoFollowCapabilities(
    capabilities: AutoFollowCapabilities,
  ): AutoFollowCapabilities {
    if (this.#pendingAutoFollowRecomputeTop) {
      this.#canAutoFollowTop = capabilities.top;
      this.#pendingAutoFollowRecomputeTop = false;
    }
    if (this.#pendingAutoFollowRecomputeBottom) {
      this.#canAutoFollowBottom = capabilities.bottom;
      this.#pendingAutoFollowRecomputeBottom = false;
    }
    return this.getAutoFollowCapabilities();
  }

  getAutoFollowCapabilities(): AutoFollowCapabilities {
    return {
      top: this.#canAutoFollowTop,
      bottom: this.#canAutoFollowBottom,
    };
  }

  markAutoFollowForTransitionSettle(): void {
    this.#clearPendingPostJumpBoundary();
    this.#markAutoFollowRecompute();
  }

  handleListStateChange(change: ListStateChange<T>): ListStateChange<T> {
    this.#hasPendingListChange = true;
    switch (change.type) {
      case "reset":
      case "set":
        this.#cancelJumpAnimation();
        this.#clearPendingPostJumpBoundary();
        this.#markAutoFollowRecompute();
        return change;
      case "push":
      case "unshift":
        return this.#handleBoundaryInsert(change);
      default:
        return change;
    }
  }

  #handleBoundaryInsert(
    change: Extract<ListStateChange<T>, { type: "push" } | { type: "unshift" }>,
  ): ListStateChange<T> {
    const followChange = this.#resolveAutoFollowChange(change);
    const boundary = change.type === "push" ? "bottom" : "top";
    const matchesCommittedState =
      this.#matchesLastCommittedStateAfterBoundaryInsert(
        change.type,
        change.count,
      );
    if (this.#pendingPostJumpBoundary === boundary) {
      this.#pendingPostJumpBoundaryBlocked = true;
    }
    if (!matchesCommittedState) {
      this.#cancelJumpAnimation();
      this.#clearPendingPostJumpBoundary();
      this.#markAutoFollowRecompute();
      return change;
    }
    if (
      followChange == null ||
      !this.#hasAutoFollowCapability(followChange.boundary)
    ) {
      return change;
    }

    this.#clearPendingPostJumpBoundary();
    this.#materializeAnimatedAnchor(
      getNow(),
      followChange.direction,
      followChange.count,
    );
    this.#startJumpToIndex(
      followChange.boundary === "bottom" ? this.#options.getItemCount() - 1 : 0,
      {
        block: followChange.boundary === "bottom" ? "end" : "start",
        duration: followChange.animation?.duration,
      },
    );
    return change;
  }

  #cancelJumpAnimation(): void {
    this.#jumpAnimation = undefined;
    this.#controlledState = undefined;
  }

  #startJumpToIndex(index: number, options: JumpOptions): void {
    const targetIndex = this.#options.clampItemIndex(index);
    const targetBlock = options.block ?? this.#options.getDefaultJumpBlock();
    const settleBoundary = this.#resolveBoundaryLatchTarget(
      targetIndex,
      targetBlock,
    );

    this.#materializeAnimatedAnchor(getNow());

    const currentState = this.#options.normalizeListState(
      this.#options.readListState(),
    );
    const targetAnchor = this.#options.getTargetAnchor(
      targetIndex,
      targetBlock,
    );

    const animated = options.animated ?? true;
    if (!animated) {
      this.#cancelJumpAnimation();
      this.#options.applyAnchor(targetAnchor);
      if (settleBoundary != null) {
        this.#armAutoFollowBoundary(settleBoundary);
      }
      options.onComplete?.();
      return;
    }

    const startAnchor = this.#options.readAnchor(currentState);
    if (!Number.isFinite(startAnchor)) {
      this.#cancelJumpAnimation();
      this.#options.applyAnchor(targetAnchor);
      if (settleBoundary != null) {
        this.#armAutoFollowBoundary(settleBoundary);
      }
      options.onComplete?.();
      return;
    }

    const path = buildJumpPath(
      this.#options.getItemCount(),
      this.#options.getItemHeight,
      startAnchor,
      targetAnchor,
    );
    const duration = clamp(
      options.duration ??
        this.#options.minJumpDuration +
          path.totalDistance * this.#options.jumpDurationPerPixel,
      0,
      this.#options.maxJumpDuration,
    );

    if (duration <= 0 || path.totalDistance <= Number.EPSILON) {
      this.#cancelJumpAnimation();
      this.#options.applyAnchor(targetAnchor);
      if (settleBoundary != null) {
        this.#armAutoFollowBoundary(settleBoundary);
      }
      options.onComplete?.();
      return;
    }

    if (settleBoundary != null) {
      this.#pendingPostJumpBoundary = settleBoundary;
      this.#pendingPostJumpBoundaryBlocked = false;
    }

    this.#jumpAnimation = {
      path,
      startTime: getNow(),
      duration,
      needsMoreFrames: true,
      onComplete: options.onComplete,
    };
    this.#controlledState = this.#options.readListState();
  }

  #resolveBoundaryLatchTarget(
    index: number,
    block: JumpBlock,
  ): AutoFollowBoundary | undefined {
    const itemCount = this.#options.getItemCount();
    if (itemCount <= 0) {
      return undefined;
    }
    if (index === 0 && block === "start") {
      return "top";
    }
    if (index === itemCount - 1 && block === "end") {
      return "bottom";
    }
    return undefined;
  }

  #resolveAutoFollowChange(
    change: ListStateChange<T>,
  ): BoundaryFollowChange<T> | undefined {
    switch (change.type) {
      case "push":
      case "unshift":
        return change.animation?.autoFollow === true
          ? {
              change,
              boundary: change.type === "push" ? "bottom" : "top",
              direction: change.type,
              count: change.count,
              animation: change.animation,
            }
          : undefined;
      default:
        return undefined;
    }
  }

  #hasAutoFollowCapability(boundary: AutoFollowBoundary): boolean {
    return boundary === "top"
      ? this.#canAutoFollowTop
      : this.#canAutoFollowBottom;
  }

  #armAutoFollowBoundary(boundary: AutoFollowBoundary): void {
    if (boundary === "top") {
      this.#canAutoFollowTop = true;
      this.#pendingAutoFollowRecomputeTop = false;
      return;
    }
    this.#canAutoFollowBottom = true;
    this.#pendingAutoFollowRecomputeBottom = false;
  }

  #markAutoFollowRecompute(boundary?: AutoFollowBoundary): void {
    if (boundary == null || boundary === "top") {
      this.#pendingAutoFollowRecomputeTop = true;
    }
    if (boundary == null || boundary === "bottom") {
      this.#pendingAutoFollowRecomputeBottom = true;
    }
  }

  #clearPendingPostJumpBoundary(): void {
    this.#pendingPostJumpBoundary = undefined;
    this.#pendingPostJumpBoundaryBlocked = false;
  }

  #matchesLastCommittedStateAfterBoundaryInsert(
    direction: "push" | "unshift",
    count: number,
  ): boolean {
    const state = this.#lastCommittedState;
    if (state == null) {
      return false;
    }
    const currentState = this.#options.readListState();
    return sameState(
      {
        position:
          direction === "unshift" && currentState.position != null
            ? currentState.position - count
            : currentState.position,
        offset: currentState.offset,
      },
      state.position,
      state.offset,
    );
  }

  #materializeAnimatedAnchor(
    now: number,
    direction?: "push" | "unshift",
    count = 0,
  ): void {
    const animation = this.#jumpAnimation;
    if (animation == null) {
      return;
    }
    const progress = getProgress(animation.startTime, animation.duration, now);
    const eased = progress >= 1 ? 1 : smoothstep(progress);
    let anchor = getAnchorAtDistance(
      animation.path,
      animation.path.totalDistance * eased,
    );
    if (direction === "unshift") {
      anchor += count;
    }
    this.#cancelJumpAnimation();
    this.#options.applyAnchor(anchor);
  }
}
