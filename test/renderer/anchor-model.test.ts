import { describe, expect, test } from "bun:test";

import {
  applyAnchorToState,
  clampItemIndex,
  getAnchorAtOffset,
  getTargetAnchorForItem,
  readAnchorFromState,
} from "../../src/renderer/virtualized/anchor-model";

function readHeight(heights: number[]): (index: number) => number {
  return (index) => heights[index] ?? 0;
}

describe("anchor model", () => {
  test("top-anchor read/apply round-trips fractional anchors", () => {
    const heights = [20, 40, 60];
    const state = applyAnchorToState(
      heights.length,
      1.5,
      "top",
      readHeight(heights),
    );

    expect(state).toEqual({
      position: 1,
      offset: -20,
    });
    expect(
      readAnchorFromState(heights.length, state!, "top", readHeight(heights)),
    ).toBeCloseTo(1.5);
  });

  test("bottom-anchor read/apply round-trips fractional anchors", () => {
    const heights = [20, 40, 60];
    const state = applyAnchorToState(
      heights.length,
      1.5,
      "bottom",
      readHeight(heights),
    );

    expect(state).toEqual({
      position: 1,
      offset: 20,
    });
    expect(
      readAnchorFromState(
        heights.length,
        state!,
        "bottom",
        readHeight(heights),
      ),
    ).toBeCloseTo(1.5);
  });

  test("target anchor calculation matches block alignment semantics", () => {
    const heights = [30, 50, 70, 90];
    const viewportHeight = 100;

    expect(
      getTargetAnchorForItem(
        heights.length,
        2,
        "start",
        "top",
        viewportHeight,
        readHeight(heights),
      ),
    ).toBeCloseTo(getAnchorAtOffset(heights.length, 2, 0, readHeight(heights)));
    expect(
      getTargetAnchorForItem(
        heights.length,
        2,
        "center",
        "top",
        viewportHeight,
        readHeight(heights),
      ),
    ).toBeCloseTo(
      getAnchorAtOffset(
        heights.length,
        2,
        heights[2]! / 2 - viewportHeight / 2,
        readHeight(heights),
      ),
    );
    expect(
      getTargetAnchorForItem(
        heights.length,
        1,
        "end",
        "bottom",
        viewportHeight,
        readHeight(heights),
      ),
    ).toBeCloseTo(
      getAnchorAtOffset(heights.length, 1, heights[1]!, readHeight(heights)),
    );
  });

  test("index and anchor math clamp cleanly at list edges", () => {
    const heights = [25, 35];
    expect(clampItemIndex(-10, heights.length)).toBe(0);
    expect(clampItemIndex(99, heights.length)).toBe(1);
    expect(
      getTargetAnchorForItem(
        heights.length,
        99,
        "center",
        "top",
        120,
        readHeight(heights),
      ),
    ).toBeCloseTo(
      getAnchorAtOffset(
        heights.length,
        1,
        heights[1]! / 2 - 60,
        readHeight(heights),
      ),
    );
    expect(
      applyAnchorToState(heights.length, -10, "top", readHeight(heights)),
    ).toEqual({
      position: 0,
      offset: 0,
    });
    expect(
      applyAnchorToState(heights.length, 99, "bottom", readHeight(heights)),
    ).toEqual({
      position: 1,
      offset: 0,
    });
  });
});
