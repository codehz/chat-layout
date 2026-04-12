import type { VisibleWindow, VisibleWindowResult } from "./solver";

export interface PreparedFrameSession<T> {
  solution: VisibleWindowResult<T>;
  requestSettleRedraw: boolean;
}

export function prepareFrameSession<T>(params: {
  now: number;
  resolveVisibleWindow: (now: number) => VisibleWindowResult<T>;
  captureVisibleItemSnapshot: (solution: VisibleWindowResult<T>) => void;
  pruneTransitionAnimations: (window: VisibleWindow<T>, now: number) => boolean;
}): PreparedFrameSession<T> {
  let solution = params.resolveVisibleWindow(params.now);
  params.captureVisibleItemSnapshot(solution);
  const requestSettleRedraw = params.pruneTransitionAnimations(
    solution.window,
    params.now,
  );
  if (requestSettleRedraw) {
    solution = params.resolveVisibleWindow(params.now);
    params.captureVisibleItemSnapshot(solution);
  }
  return {
    solution,
    requestSettleRedraw,
  };
}
