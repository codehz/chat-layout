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
  followPredicate?: (
    direction: "push" | "unshift",
    count: number,
    position: number | undefined,
    offset: number,
  ) => boolean;
}) {
  let heights = params?.heights ?? [20, 20, 20];
  let state: State = params?.state ?? { position: 0, offset: 0 };
  let followPredicate = params?.followPredicate ?? (() => false);
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
    canAutoFollowBoundaryInsert: (direction, count, position, offset) =>
      followPredicate(direction, count, position, offset),
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
    setFollowPredicate(
      nextPredicate: (
        direction: "push" | "unshift",
        count: number,
        position: number | undefined,
        offset: number,
      ) => boolean,
    ) {
      followPredicate = nextPredicate;
    },
  };
}

describe("jump controller", () => {
  test("strips boundary-insert animation when the snapshot says to auto-follow", () => {
    const harness = createController({
      heights: [20, 20, 20, 20],
      state: { position: 2, offset: 0 },
      followPredicate: () => true,
    });

    const nextChange = harness.controller.handleListStateChange({
      type: "push",
      count: 1,
      animation: {
        duration: 220,
        followIfAtBoundary: true,
      },
    });

    expect(nextChange).toEqual({
      type: "push",
      count: 1,
      animation: undefined,
    });
  });

  test("settled auto-follow latch survives matching inserts and resets after manual scroll", () => {
    const harness = createController({
      heights: [20, 20, 20, 20],
      state: { position: 2, offset: 0 },
      followPredicate: () => true,
    });

    harness.controller.handleListStateChange({
      type: "push",
      count: 1,
      animation: {
        duration: 0,
        followIfAtBoundary: true,
      },
    });
    harness.controller.commit(harness.getState());

    harness.setHeights([20, 20, 20, 20, 20]);
    harness.setFollowPredicate(() => false);
    const chainedChange = harness.controller.handleListStateChange({
      type: "push",
      count: 1,
      animation: {
        duration: 220,
        followIfAtBoundary: true,
      },
    });
    expect(chainedChange).toMatchObject({
      type: "push",
      count: 1,
      animation: undefined,
    });

    harness.setState({ position: 1, offset: 0 });
    harness.controller.beforeFrame();
    harness.setHeights([20, 20, 20, 20, 20, 20]);
    const resetChange = harness.controller.handleListStateChange({
      type: "push",
      count: 1,
      animation: {
        duration: 220,
        followIfAtBoundary: true,
      },
    });
    expect(resetChange).toMatchObject({
      type: "push",
      count: 1,
      animation: {
        duration: 220,
        followIfAtBoundary: true,
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
        followPredicate: () => true,
      });

      harness.controller.handleListStateChange({
        type: "push",
        count: 1,
        animation: {
          duration: 100,
          followIfAtBoundary: true,
        },
      });

      now.current = 50;
      harness.setHeights([10, 10, 10, 10]);
      harness.setFollowPredicate(() => false);
      const nextChange = harness.controller.handleListStateChange({
        type: "push",
        count: 1,
        animation: {
          duration: 100,
          followIfAtBoundary: true,
        },
      });

      expect(nextChange).toMatchObject({
        type: "push",
        count: 1,
        animation: undefined,
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
