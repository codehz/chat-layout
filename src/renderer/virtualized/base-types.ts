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

export type JumpAnimationSource =
  | { kind: "manual" }
  | { kind: "auto-follow"; direction: "push" | "unshift" };

/** Tracks an in-progress programmatic jump animation. */
export type JumpAnimation = {
  path: JumpPath;
  startTime: number;
  duration: number;
  needsMoreFrames: boolean;
  onComplete: (() => void) | undefined;
  source: JumpAnimationSource;
};

/** Per-item draw/hittest callbacks produced by the resolver. */
export type VirtualizedResolvedItem = {
  draw: (y: number) => boolean;
  hittest: (test: HitTest, y: number) => boolean;
};

/** Alpha values below this threshold are treated as fully transparent. */
export const ALPHA_EPSILON = 1e-3;
