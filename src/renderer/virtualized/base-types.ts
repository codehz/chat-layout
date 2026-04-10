import type { HitTest, Node } from "../../types";

/** Scroll position snapshot used to detect external state changes. */
export type ControlledState = {
  position?: number;
  offset: number;
};

/** Tracks an in-progress programmatic jump animation. */
export type JumpAnimation = {
  startAnchor: number;
  targetAnchor: number;
  startTime: number;
  duration: number;
  needsMoreFrames: boolean;
  onComplete: (() => void) | undefined;
};

/** A single cross-fade layer within a replacement animation. */
export type ReplacementLayer<C extends CanvasRenderingContext2D> = {
  node: Node<C>;
  fromAlpha: number;
  toAlpha: number;
  startTime: number;
  duration: number;
};

/** Full state for an item replacement (cross-fade + height) animation. */
export type ReplacementAnimation<C extends CanvasRenderingContext2D> = {
  outgoing: ReplacementLayer<C> | undefined;
  incoming: ReplacementLayer<C>;
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
