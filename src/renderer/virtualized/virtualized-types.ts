import type { HitTest } from "../../types";

/** Scroll position snapshot used to detect external state changes. */
export type ListScrollStateSnapshot = {
  position?: number;
  offset: number;
};

export type AutoFollowBoundary = "top" | "bottom";

export type AutoFollowCapabilities = {
  top: boolean;
  bottom: boolean;
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

/** Per-item draw/hittest callbacks produced by the resolver. */
export type VirtualizedResolvedItem = {
  draw: (y: number) => boolean;
  hittest: (test: HitTest, y: number) => boolean;
};

/** Alpha values below this threshold are treated as fully transparent. */
export const ALPHA_EPSILON = 1e-3;

/**
 * Pixel-space tolerance for viewport boundary checks.
 * This is intentionally much larger than Number.EPSILON so summed fractional
 * heights and padded viewports do not lose boundary alignment due to floating
 * point drift.
 */
export const VIEWPORT_BOUNDARY_EPSILON = 1e-6;
