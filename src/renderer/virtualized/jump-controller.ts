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
  JumpAnimationSource,
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
  #confirmedAutoFollowTop = false;
  #confirmedAutoFollowBottom = false;
  #controlledState: ControlledState | undefined;
  #jumpAnimation: JumpAnimation | undefined;
  #lastCommittedState: ControlledState | undefined;
  #hasPendingListChange = false;
  #pendingBoundaryJumpTop = false;
  #pendingBoundaryJumpBottom = false;
  readonly #options: JumpControllerOptions<T>;

  constructor(options: JumpControllerOptions<T>) {
    this.#options = options;
  }

  beforeFrame(): void {
    const currentState = this.#options.readListState();
    if (
      !this.#hasPendingListChange &&
      this.#jumpAnimation == null &&
      this.#lastCommittedState != null &&
      !sameState(
        this.#lastCommittedState,
        currentState.position,
        currentState.offset,
      )
    ) {
      this.#clearPendingBoundaryJumps();
    }
    this.#hasPendingListChange = false;
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
    if (
      this.#controlledState != null &&
      !sameState(
        this.#controlledState,
        this.#options.readListState().position,
        this.#options.readListState().offset,
      )
    ) {
      this.#clearPendingBoundaryJumps();
      this.#cancelJumpAnimation();
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

    const onComplete = animation.onComplete;
    this.#cancelJumpAnimation();
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
    this.#clearPendingBoundaryJumps();
    if (this.#options.getItemCount() === 0) {
      this.#cancelJumpAnimation();
      return;
    }
    this.#startJumpToIndex(index, options, { kind: "manual" });
  }

  jumpToBoundary(
    boundary: AutoFollowBoundary,
    options: JumpOptions = {},
  ): void {
    this.#clearPendingBoundaryJumps();
    if (this.#options.getItemCount() === 0) {
      this.#cancelJumpAnimation();
      return;
    }
    this.#armBoundaryJump(boundary);
    this.#startJumpToIndex(
      boundary === "bottom" ? this.#options.getItemCount() - 1 : 0,
      {
        ...options,
        block: boundary === "bottom" ? "end" : "start",
      },
      { kind: "boundary-jump", boundary },
    );
  }

  syncAutoFollowCapabilities(
    capabilities: AutoFollowCapabilities,
  ): AutoFollowCapabilities {
    this.#confirmedAutoFollowTop = capabilities.top;
    this.#confirmedAutoFollowBottom = capabilities.bottom;
    this.#clearPendingBoundaryJumps();
    return this.getEffectiveAutoFollowCapabilities();
  }

  getEffectiveAutoFollowCapabilities(): AutoFollowCapabilities {
    return {
      top: this.#hasEffectiveAutoFollowCapability("top"),
      bottom: this.#hasEffectiveAutoFollowCapability("bottom"),
    };
  }

  handleListStateChange(change: ListStateChange<T>): ListStateChange<T> {
    this.#hasPendingListChange = true;
    const followChange = this.#resolveAutoFollowChange(change);
    const canChainAutoFollow =
      followChange != null
        ? this.#shouldChainAutoFollow(followChange.boundary)
        : false;
    const canCapabilityAutoFollow =
      followChange != null
        ? this.#shouldAutoFollowFromCapability(
            followChange.boundary,
            followChange.direction,
            followChange.count,
          )
        : false;
    if (
      followChange != null &&
      (canChainAutoFollow || canCapabilityAutoFollow)
    ) {
      if (canChainAutoFollow) {
        this.#rebaseJumpAnchorForBoundaryInsert(
          followChange.direction,
          followChange.count,
          getNow(),
        );
      }
      this.#startJumpToIndex(
        followChange.boundary === "bottom"
          ? this.#options.getItemCount() - 1
          : 0,
        {
          block: followChange.boundary === "bottom" ? "end" : "start",
          duration: followChange.animation?.duration,
        },
        { kind: "auto-follow", boundary: followChange.boundary },
      );
      return {
        ...followChange.change,
        animation: undefined,
      };
    }
    return change;
  }

  #cancelJumpAnimation(): void {
    this.#jumpAnimation = undefined;
    this.#controlledState = undefined;
  }

  #startJumpToIndex(
    index: number,
    options: JumpOptions,
    source: JumpAnimationSource,
  ): void {
    const targetIndex = this.#options.clampItemIndex(index);
    const currentState = this.#options.normalizeListState(
      this.#options.readListState(),
    );
    const targetBlock = options.block ?? this.#options.getDefaultJumpBlock();
    const targetAnchor = this.#options.getTargetAnchor(
      targetIndex,
      targetBlock,
    );

    const animated = options.animated ?? true;
    if (!animated) {
      this.#cancelJumpAnimation();
      this.#options.applyAnchor(targetAnchor);
      options.onComplete?.();
      return;
    }

    const startAnchor = this.#options.readAnchor(currentState);
    if (!Number.isFinite(startAnchor)) {
      this.#cancelJumpAnimation();
      this.#options.applyAnchor(targetAnchor);
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
      options.onComplete?.();
      return;
    }

    this.#jumpAnimation = {
      path,
      startTime: getNow(),
      duration,
      needsMoreFrames: true,
      onComplete: options.onComplete,
      source,
    };
    this.#controlledState = this.#options.readListState();
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

  #shouldAutoFollowFromCapability(
    boundary: AutoFollowBoundary,
    direction: "push" | "unshift",
    count: number,
  ): boolean {
    return (
      this.#hasEffectiveAutoFollowCapability(boundary) &&
      this.#matchesLastCommittedStateAfterBoundaryInsert(direction, count)
    );
  }

  #shouldChainAutoFollow(boundary: AutoFollowBoundary): boolean {
    return this.#readJumpBoundary() === boundary;
  }

  #rebaseJumpAnchorForBoundaryInsert(
    direction: "push" | "unshift",
    count: number,
    now: number,
  ): void {
    const animation = this.#jumpAnimation;
    if (animation == null) {
      return;
    }
    const progress = getProgress(animation.startTime, animation.duration, now);
    const eased = progress >= 1 ? 1 : smoothstep(progress);
    const anchorAtNow = getAnchorAtDistance(
      animation.path,
      animation.path.totalDistance * eased,
    );
    this.#cancelJumpAnimation();
    this.#options.applyAnchor(
      direction === "unshift" ? anchorAtNow + count : anchorAtNow,
    );
  }

  #matchesLastCommittedStateAfterBoundaryInsert(
    direction: "push" | "unshift",
    count: number,
  ): boolean {
    const state = this.#lastCommittedState;
    if (state == null) {
      return false;
    }
    return sameState(
      {
        position:
          direction === "unshift" && state.position != null
            ? state.position + count
            : state.position,
        offset: state.offset,
      },
      this.#options.readListState().position,
      this.#options.readListState().offset,
    );
  }

  #hasEffectiveAutoFollowCapability(boundary: AutoFollowBoundary): boolean {
    const animationBoundary = this.#readJumpBoundary();
    return boundary === "top"
      ? this.#confirmedAutoFollowTop ||
          this.#pendingBoundaryJumpTop ||
          animationBoundary === "top"
      : this.#confirmedAutoFollowBottom ||
          this.#pendingBoundaryJumpBottom ||
          animationBoundary === "bottom";
  }

  #readJumpBoundary(): AutoFollowBoundary | undefined {
    const source = this.#jumpAnimation?.source;
    if (source == null || source.kind === "manual") {
      return undefined;
    }
    return source.boundary;
  }

  #armBoundaryJump(boundary: AutoFollowBoundary): void {
    this.#pendingBoundaryJumpTop = boundary === "top";
    this.#pendingBoundaryJumpBottom = boundary === "bottom";
  }

  #clearPendingBoundaryJumps(): void {
    this.#pendingBoundaryJumpTop = false;
    this.#pendingBoundaryJumpBottom = false;
  }
}
