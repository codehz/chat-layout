import { describe, expect, test } from "bun:test";

import {
  normalizeChatState,
  normalizeTimelineState,
  resolveChatVisibleWindow,
  resolveTimelineVisibleWindow,
} from "./renderer/virtualized/solver";

describe("virtualized solvers", () => {
  test("normalization uses explicit undefined position instead of NaN sentinels", () => {
    expect(normalizeTimelineState(3, { position: undefined, offset: 5 })).toEqual({
      position: 0,
      offset: 5,
    });
    expect(normalizeChatState(3, { position: undefined, offset: -5 })).toEqual({
      position: 2,
      offset: -5,
    });
  });

  test("timeline solver returns normalized state and leaves the input state untouched", () => {
    const state = { position: undefined, offset: 0 };

    const solution = resolveTimelineVisibleWindow([20, 30, 40], state, 45, (height) => ({
      value: height,
      height,
    }));

    expect(state).toEqual({ position: undefined, offset: 0 });
    expect(solution.normalizedState).toEqual({ position: 0, offset: 0 });
    expect(solution.window.drawList.map(({ idx }) => idx)).toEqual([0, 1]);
  });

  test("chat solver returns normalized state and leaves the input state untouched", () => {
    const state = { position: undefined, offset: 0 };

    const solution = resolveChatVisibleWindow([20, 30, 40], state, 45, (height) => ({
      value: height,
      height,
    }));

    expect(state).toEqual({ position: undefined, offset: 0 });
    expect(solution.normalizedState).toEqual({ position: 2, offset: 0 });
    expect(solution.window.drawList.map(({ idx }) => idx)).toEqual([2, 1]);
  });
});
