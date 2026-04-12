import type { Box, Context, Node } from "../../types";
import type { ResolvedListLayoutOptions, VisibleWindowResult } from "./solver";

export type VisibleRange = {
  top: number;
  bottom: number;
};

export type TransitionLifecycleAdapter<T extends {}> = {
  onDeleteComplete: (item: T) => void;
  captureVisualAnchor: (now: number) => number | undefined;
  restoreVisualAnchor: (anchor: number) => void;
  readItemIndex: (item: T) => number;
};

export type VirtualizedRuntime<
  C extends CanvasRenderingContext2D,
  T extends {},
> = {
  items: readonly T[];
  position: number | undefined;
  offset: number;
  renderItem: (item: T) => Node<C>;
  measureNode: (node: Node<C>) => Box;
  readVisibleRange: (top: number, height: number) => VisibleRange | undefined;
  resolveVisibleWindow: () => VisibleWindowResult<unknown>;
};

export type TransitionPlanningAdapter<
  C extends CanvasRenderingContext2D,
  T extends {},
> = VirtualizedRuntime<C, T> & {
  underflowAlign: ResolvedListLayoutOptions["underflowAlign"];
};

export type TransitionRenderAdapter<
  C extends CanvasRenderingContext2D,
  T extends {},
> = Pick<VirtualizedRuntime<C, T>, "renderItem" | "measureNode"> & {
  drawNode: (node: Node<C>, x: number, y: number) => boolean;
  getRootContext: () => Context<C>;
  graphics: C;
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
