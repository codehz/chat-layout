import { describe, expect, test } from "bun:test";

import {
  normalizeChatState,
  normalizeTimelineState,
  resolveChatVisibleWindow,
  resolveVisibleWindow,
  resolveTimelineVisibleWindow,
} from "../../src/renderer/virtualized/solver";

describe("virtualized solvers", () => {
  test("normalization uses explicit undefined position instead of NaN sentinels", () => {
    expect(
      normalizeTimelineState(3, { position: undefined, offset: 5 }),
    ).toEqual({
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

    const solution = resolveTimelineVisibleWindow(
      [20, 30, 40],
      state,
      45,
      (height) => ({
        value: height,
        height,
      }),
    );

    expect(state).toEqual({ position: undefined, offset: 0 });
    expect(solution.normalizedState).toEqual({ position: 0, offset: 0 });
    expect(solution.window.drawList.map(({ idx }) => idx)).toEqual([0, 1]);
  });

  test("chat solver returns normalized state and leaves the input state untouched", () => {
    const state = { position: undefined, offset: 0 };

    const solution = resolveChatVisibleWindow(
      [20, 30, 40],
      state,
      45,
      (height) => ({
        value: height,
        height,
      }),
    );

    expect(state).toEqual({ position: undefined, offset: 0 });
    expect(solution.normalizedState).toEqual({ position: 2, offset: 0 });
    expect(solution.window.drawList.map(({ idx }) => idx)).toEqual([2, 1]);
  });

  test("core solver matches the direction-specific wrappers", () => {
    const items = [20, 30, 40];
    const state = { position: undefined, offset: 0 };
    const resolveItem = (height: number) => ({
      value: height,
      height,
    });

    expect(
      resolveVisibleWindow(items, state, 45, resolveItem, "forward"),
    ).toEqual(resolveTimelineVisibleWindow(items, state, 45, resolveItem));
    expect(
      resolveVisibleWindow(items, state, 45, resolveItem, "backward"),
    ).toEqual(resolveChatVisibleWindow(items, state, 45, resolveItem));
  });

  test("core solver backfills the viewport in both directions", () => {
    const items = [40, 40, 40];
    const state = { position: 1, offset: 0 };
    const resolveItem = (height: number) => ({
      value: height,
      height,
    });

    const forward = resolveVisibleWindow(
      items,
      state,
      100,
      resolveItem,
      "forward",
    );
    expect(forward.normalizedState).toEqual({ position: 1, offset: 20 });
    expect(forward.window.shift).toBe(20);
    expect(forward.window.drawList.map(({ idx }) => idx)).toEqual([1, 2, 0]);

    const backward = resolveVisibleWindow(
      items,
      state,
      100,
      resolveItem,
      "backward",
    );
    expect(backward.normalizedState).toEqual({ position: 2, offset: 20 });
    expect(backward.window.shift).toBe(-20);
    expect(backward.window.drawList.map(({ idx }) => idx)).toEqual([1, 0, 2]);
  });
});
