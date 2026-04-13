import type { Box, Context, Node } from "../../types";
import type {
  ListViewportMetrics,
  ResolvedListLayoutOptions,
  VisibleWindowResult,
} from "./solver";
import type {
  AutoFollowBoundary,
  ListScrollStateSnapshot,
} from "./virtualized-types";

export type VisibleRange = {
  top: number;
  bottom: number;
};

export type TransitionLifecycleAdapter<T extends {}> = {
  onDeleteComplete: (item: T) => void;
  captureVisualAnchor: (now: number) => number | undefined;
  restoreVisualAnchor: (anchor: number) => void;
  readScrollState: () => ListScrollStateSnapshot;
  readItemIndex: (item: T) => number;
  snapItemToViewportBoundary: (item: T, boundary: "top" | "bottom") => void;
  onTransitionSettleScrollAdjusted: () => void;
  beginAutoFollowBoundaryObservation: (boundary: AutoFollowBoundary) => void;
  endAutoFollowBoundaryObservation: (boundary: AutoFollowBoundary) => void;
  invalidateAutoFollowBoundary: (
    boundary: AutoFollowBoundary | undefined,
  ) => void;
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
  viewport: ListViewportMetrics;
  readVisibleRange: (top: number, height: number) => VisibleRange | undefined;
  readOuterVisibleRange: (
    top: number,
    height: number,
  ) => VisibleRange | undefined;
  resolveVisibleWindow: () => VisibleWindowResult<unknown>;
  resolveVisibleWindowForState: (
    state: ListScrollStateSnapshot,
    now: number,
  ) => VisibleWindowResult<unknown>;
};

export type TransitionPlanningAdapter<
  C extends CanvasRenderingContext2D,
  T extends {},
> = VirtualizedRuntime<C, T> & {
  anchorMode: ResolvedListLayoutOptions["anchorMode"];
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
  observedAutoFollowBoundary?: AutoFollowBoundary;
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
