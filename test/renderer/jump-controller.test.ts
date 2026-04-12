import { describe, expect, test } from "bun:test";

import {
  applyAnchorToState,
  clampItemIndex,
  getTargetAnchorForItem,
  readAnchorFromState,
} from "../../src/renderer/virtualized/anchor-model";
import { JumpController } from "../../src/renderer/virtualized/jump-controller";
import { mockPerformanceNow } from "../helpers/graphics";

type State = {
  position?: number;
  offset: number;
};

function createController(params?: {
  heights?: number[];
  state?: State;
  viewportHeight?: number;
}) {
  let heights = params?.heights ?? [20, 20, 20];
  let state: State = params?.state ?? { position: 0, offset: 0 };
  const viewportHeight = params?.viewportHeight ?? 100;
  const getHeight = (index: number) => heights[index] ?? 0;
  const controller = new JumpController({
    minJumpDuration: 160,
    maxJumpDuration: 420,
    jumpDurationPerPixel: 0.7,
    getItemCount: () => heights.length,
    readListState: () => ({ ...state }),
    normalizeListState: (nextState) => ({
      position:
        typeof nextState.position === "number" &&
        Number.isFinite(nextState.position)
          ? Math.min(
              Math.max(Math.trunc(nextState.position), 0),
              heights.length - 1,
            )
          : 0,
      offset: nextState.offset,
    }),
    readAnchor: (normalizedState) =>
      readAnchorFromState(heights.length, normalizedState, "top", getHeight),
    applyAnchor: (anchor) => {
      const nextState = applyAnchorToState(
        heights.length,
        anchor,
        "top",
        getHeight,
      );
      if (nextState != null) {
        state = nextState;
      }
    },
    getDefaultJumpBlock: () => "start",
    getTargetAnchor: (index, block) =>
      getTargetAnchorForItem(
        heights.length,
        index,
        block,
        "top",
        viewportHeight,
        getHeight,
      ),
    clampItemIndex: (index) => clampItemIndex(index, heights.length),
    getItemHeight: getHeight,
  });
  return {
    controller,
    getState: () => ({ ...state }),
    setState(nextState: State) {
      state = nextState;
    },
    setHeights(nextHeights: number[]) {
      heights = nextHeights;
    },
    syncCapabilities(top: boolean, bottom: boolean) {
      controller.syncAutoFollowCapabilities({ top, bottom });
    },
  };
}

describe("jump controller", () => {
  test("keeps boundary-insert animation when the bottom capability allows auto-follow", () => {
    const harness = createController({
      heights: [20, 20, 20, 20],
      state: { position: 2, offset: 0 },
    });
    harness.controller.commit(harness.getState());
    harness.syncCapabilities(false, true);

    const nextChange = harness.controller.handleListStateChange({
      type: "push",
      count: 1,
      animation: {
        duration: 220,
        autoFollow: true,
      },
    });

    expect(nextChange).toEqual({
      type: "push",
      count: 1,
      animation: {
        duration: 220,
        autoFollow: true,
      },
    });
  });

  test("confirmed bottom capability survives matching inserts and resets after manual scroll", () => {
    const harness = createController({
      heights: [20, 20, 20, 20],
      state: { position: 2, offset: 0 },
    });
    harness.controller.commit(harness.getState());
    harness.syncCapabilities(false, true);

    harness.controller.handleListStateChange({
      type: "push",
      count: 1,
      animation: {
        duration: 0,
        autoFollow: true,
      },
    });
    harness.controller.commit(harness.getState());

    harness.setHeights([20, 20, 20, 20, 20]);
    const chainedChange = harness.controller.handleListStateChange({
      type: "push",
      count: 1,
      animation: {
        duration: 220,
        autoFollow: true,
      },
    });
    expect(chainedChange).toMatchObject({
      type: "push",
      count: 1,
      animation: {
        duration: 220,
        autoFollow: true,
      },
    });

    harness.setState({ position: 1, offset: 0 });
    harness.controller.beforeFrame();
    harness.setHeights([20, 20, 20, 20, 20, 20]);
    const resetChange = harness.controller.handleListStateChange({
      type: "push",
      count: 1,
      animation: {
        duration: 220,
        autoFollow: true,
      },
    });
    expect(resetChange).toMatchObject({
      type: "push",
      count: 1,
      animation: {
        duration: 220,
        autoFollow: true,
      },
    });
  });

  test("same-direction in-flight follow rebases the current anchor before retargeting", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const harness = createController({
        heights: [10, 10, 10],
        state: { position: 1, offset: 0 },
        viewportHeight: 10,
      });
      harness.controller.commit(harness.getState());
      harness.syncCapabilities(false, true);

      harness.controller.handleListStateChange({
        type: "push",
        count: 1,
        animation: {
          duration: 100,
          autoFollow: true,
        },
      });

      now.current = 50;
      harness.setHeights([10, 10, 10, 10]);
      const nextChange = harness.controller.handleListStateChange({
        type: "push",
        count: 1,
        animation: {
          duration: 100,
          autoFollow: true,
        },
      });

      expect(nextChange).toMatchObject({
        type: "push",
        count: 1,
        animation: {
          duration: 100,
          autoFollow: true,
        },
      });
      expect(
        readAnchorFromState(
          4,
          harness.getState() as Required<State>,
          "top",
          (index) => [10, 10, 10, 10][index] ?? 0,
        ),
      ).toBeCloseTo(1.5);
    } finally {
      restoreNow();
    }
  });

  test("boundary jumps expose effective auto-follow before the first render sync", () => {
    const harness = createController({
      heights: [20, 20, 20, 20, 20, 20],
      state: { position: 0, offset: 0 },
      viewportHeight: 40,
    });

    harness.controller.jumpToBoundary("bottom", { duration: 100 });
    expect(harness.controller.getEffectiveAutoFollowCapabilities()).toEqual({
      top: false,
      bottom: true,
    });

    harness.controller.syncAutoFollowCapabilities({
      top: false,
      bottom: false,
    });
    expect(harness.controller.getEffectiveAutoFollowCapabilities()).toEqual({
      top: false,
      bottom: true,
    });
  });

  test("external scroll cancels an in-flight manual jump on the next prepare", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const harness = createController({
        heights: [20, 20, 20],
        state: { position: 0, offset: 0 },
      });

      harness.controller.jumpTo(2, { duration: 100 });
      harness.setState({ position: 1, offset: 0 });
      now.current = 10;

      expect(harness.controller.prepare(now.current)).toBe(false);
      expect(harness.controller.finishFrame(false)).toBe(false);
    } finally {
      restoreNow();
    }
  });
});
