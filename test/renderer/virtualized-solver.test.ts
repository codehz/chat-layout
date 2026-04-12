import { describe, expect, test } from "bun:test";

import {
  normalizeVisibleState,
  resolveListLayoutOptions,
  resolveVisibleWindow,
} from "../../src/renderer/virtualized/solver";

describe("virtualized solvers", () => {
  test("normalization uses explicit undefined position instead of NaN sentinels", () => {
    expect(
      normalizeVisibleState(
        3,
        { position: undefined, offset: 5 },
        resolveListLayoutOptions({ anchorMode: "top" }),
      ),
    ).toEqual({
      position: 0,
      offset: 5,
    });
    expect(
      normalizeVisibleState(
        3,
        { position: undefined, offset: -5 },
        resolveListLayoutOptions({ anchorMode: "bottom" }),
      ),
    ).toEqual({ position: 2, offset: -5 });
  });

  test("top-anchor solver returns normalized state and leaves the input state untouched", () => {
    const state = { position: undefined, offset: 0 };

    const solution = resolveVisibleWindow(
      [20, 30, 40],
      state,
      45,
      (height) => ({
        value: height,
        height,
      }),
      resolveListLayoutOptions({ anchorMode: "top" }),
    );

    expect(state).toEqual({ position: undefined, offset: 0 });
    expect(solution.normalizedState).toEqual({ position: 0, offset: 0 });
    expect(solution.resolutionPath).toEqual([0, 1]);
    expect(solution.window.drawList.map(({ index }) => index)).toEqual([0, 1]);
  });

  test("bottom-anchor solver returns normalized state and leaves the input state untouched", () => {
    const state = { position: undefined, offset: 0 };

    const solution = resolveVisibleWindow(
      [20, 30, 40],
      state,
      45,
      (height) => ({
        value: height,
        height,
      }),
      resolveListLayoutOptions({ anchorMode: "bottom" }),
    );

    expect(state).toEqual({ position: undefined, offset: 0 });
    expect(solution.normalizedState).toEqual({ position: 2, offset: 0 });
    expect(solution.resolutionPath).toEqual([2, 1]);
    expect(solution.window.drawList.map(({ index }) => index)).toEqual([2, 1]);
  });

  test("core solver defaults to top anchor and supports both anchor modes", () => {
    const items = [20, 30, 40];
    const state = { position: undefined, offset: 0 };
    const resolveItem = (height: number) => ({
      value: height,
      height,
    });

    expect(
      resolveVisibleWindow(
        items,
        state,
        45,
        resolveItem,
        resolveListLayoutOptions(),
      ),
    ).toEqual(
      resolveVisibleWindow(
        items,
        state,
        45,
        resolveItem,
        resolveListLayoutOptions({ anchorMode: "top" }),
      ),
    );
    expect(
      resolveVisibleWindow(
        items,
        state,
        45,
        resolveItem,
        resolveListLayoutOptions({ anchorMode: "bottom" }),
      ),
    ).not.toEqual(
      resolveVisibleWindow(
        items,
        state,
        45,
        resolveItem,
        resolveListLayoutOptions({ anchorMode: "top" }),
      ),
    );
    expect(
      resolveVisibleWindow(
        items,
        state,
        45,
        resolveItem,
        resolveListLayoutOptions({ underflowAlign: "top" }),
      ),
    ).toEqual(
      resolveVisibleWindow(
        items,
        state,
        45,
        resolveItem,
        resolveListLayoutOptions(),
      ),
    );
  });

  test("core solver aligns short lists to the bottom when requested", () => {
    const items = [20, 30];
    const state = { position: undefined, offset: 0 };
    const resolveItem = (height: number) => ({
      value: height,
      height,
    });

    const topAnchored = resolveVisibleWindow(
      items,
      state,
      100,
      resolveItem,
      resolveListLayoutOptions({
        anchorMode: "top",
        underflowAlign: "bottom",
      }),
    );
    expect(topAnchored.normalizedState).toEqual({ position: 0, offset: 0 });
    expect(topAnchored.window.shift).toBe(50);
    expect(topAnchored.window.drawList.map(({ offset }) => offset)).toEqual([
      0, 20,
    ]);

    const bottomAnchored = resolveVisibleWindow(
      items,
      state,
      100,
      resolveItem,
      resolveListLayoutOptions({
        anchorMode: "bottom",
        underflowAlign: "bottom",
      }),
    );
    expect(bottomAnchored.normalizedState).toEqual({ position: 1, offset: 0 });
    expect(bottomAnchored.window.shift).toBe(0);
    expect(bottomAnchored.window.drawList.map(({ offset }) => offset)).toEqual([
      70, 50,
    ]);
  });

  test("core solver backfills the viewport in both anchor modes", () => {
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
      resolveListLayoutOptions({ anchorMode: "top" }),
    );
    expect(forward.normalizedState).toEqual({ position: 1, offset: 20 });
    expect(forward.window.shift).toBe(20);
    expect(forward.window.drawList.map(({ index }) => index)).toEqual([
      1, 2, 0,
    ]);

    const backward = resolveVisibleWindow(
      items,
      state,
      100,
      resolveItem,
      resolveListLayoutOptions({ anchorMode: "bottom" }),
    );
    expect(backward.normalizedState).toEqual({ position: 2, offset: 20 });
    expect(backward.window.shift).toBe(-20);
    expect(backward.window.drawList.map(({ index }) => index)).toEqual([
      1, 0, 2,
    ]);
  });

  test("resolutionPath includes normalization-consumed items even when they are not drawn", () => {
    const solution = resolveVisibleWindow(
      [30, 40, 40],
      { position: 0, offset: -50 },
      40,
      (height) => ({
        value: height,
        height,
      }),
      resolveListLayoutOptions({ anchorMode: "top" }),
    );

    expect(solution.normalizedState).toEqual({ position: 1, offset: -20 });
    expect(solution.window.drawList.map(({ index }) => index)).toEqual([1, 2]);
    expect(solution.resolutionPath).toEqual([0, 1, 2]);
  });
});
