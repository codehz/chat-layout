import type { HitTest, Node } from "../../types";

/** Scroll position snapshot used to detect external state changes. */
export type ControlledState = {
  position?: number;
  offset: number;
};

/** A positive-length pixel segment within a jump path. */
export type JumpPathSegment = {
  anchorStart: number;
  anchorEnd: number;
  distanceStart: number;
  distanceEnd: number;
};

/** Precomputed mapping between anchor-space and pixel-space for a jump. */
export type JumpPath = {
  startAnchor: number;
  targetAnchor: number;
  totalDistance: number;
  segments: JumpPathSegment[];
};

/** Tracks an in-progress programmatic jump animation. */
export type JumpAnimation = {
  path: JumpPath;
  startTime: number;
  duration: number;
  needsMoreFrames: boolean;
  onComplete: (() => void) | undefined;
};

/** Placement for a single layer within an item transition. */
export type TransitionPlacement = "start" | "end";

/** A single cross-fade layer within an item transition. */
export type TransitionLayer<C extends CanvasRenderingContext2D> = {
  node: Node<C>;
  fromAlpha: number;
  toAlpha: number;
  fromTranslateY: number;
  toTranslateY: number;
  placement: TransitionPlacement;
  startTime: number;
  duration: number;
};

/** Full state for an item transition (cross-fade + height). */
export type ItemTransition<C extends CanvasRenderingContext2D> = {
  kind: "update" | "delete" | "insert";
  fromLayer: TransitionLayer<C> | undefined;
  /** undefined for delete transitions where the slot shrinks to nothing. */
  toLayer: TransitionLayer<C> | undefined;
  fromHeight: number;
  toHeight: number;
  startTime: number;
  duration: number;
};

/** Per-item draw/hittest callbacks produced by the resolver. */
export type VirtualizedResolvedItem = {
  draw: (y: number) => boolean;
  hittest: (test: HitTest, y: number) => boolean;
};

/** Alpha values below this threshold are treated as fully transparent. */
export const ALPHA_EPSILON = 1e-3;
