import type { VisibleWindow, VisibleWindowResult } from "./solver";

export interface PreparedFrameSession<T> {
  solution: VisibleWindowResult<T>;
  viewportTranslateY: number;
  requestSettleRedraw: boolean;
}

export function prepareFrameSession<T>(params: {
  now: number;
  resolveVisibleWindow: (now: number) => VisibleWindowResult<T>;
  getViewportTranslateY: (now: number) => number;
  captureVisibleItemSnapshot: (
    solution: VisibleWindowResult<T>,
    extraShift: number,
  ) => void;
  pruneTransitionAnimations: (window: VisibleWindow<T>) => boolean;
}): PreparedFrameSession<T> {
  let solution = params.resolveVisibleWindow(params.now);
  let viewportTranslateY = params.getViewportTranslateY(params.now);
  params.captureVisibleItemSnapshot(solution, viewportTranslateY);
  const requestSettleRedraw = params.pruneTransitionAnimations(solution.window);
  if (requestSettleRedraw) {
    solution = params.resolveVisibleWindow(params.now);
    viewportTranslateY = params.getViewportTranslateY(params.now);
    params.captureVisibleItemSnapshot(solution, viewportTranslateY);
  }
  return {
    solution,
    viewportTranslateY,
    requestSettleRedraw,
  };
}
