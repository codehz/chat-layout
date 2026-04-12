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

type ScrollMutationSource = "external" | "internal";

function createController(params?: {
  heights?: number[];
  state?: State;
  viewportHeight?: number;
}) {
  let heights = params?.heights ?? [20, 20, 20];
  let state: State = params?.state ?? { position: 0, offset: 0 };
  let scrollMutation = {
    version: 0,
    source: "internal" as ScrollMutationSource,
  };
  const viewportHeight = params?.viewportHeight ?? 100;
  const getHeight = (index: number) => heights[index] ?? 0;
  const writeState = (nextState: State, source: ScrollMutationSource) => {
    const positionChanged = !Object.is(state.position, nextState.position);
    const offsetChanged = !Object.is(state.offset, nextState.offset);
    state = nextState;
    if (!positionChanged && !offsetChanged) {
      return;
    }
    scrollMutation = {
      version: scrollMutation.version + 1,
      source,
    };
  };
  const controller = new JumpController({
    minJumpDuration: 160,
    maxJumpDuration: 420,
    jumpDurationPerPixel: 0.7,
    getItemCount: () => heights.length,
    readListState: () => ({ ...state }),
    readScrollMutation: () => ({ ...scrollMutation }),
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
        writeState(nextState, "internal");
        controller.commit(nextState);
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
    setState(nextState: State, source: ScrollMutationSource = "external") {
      writeState(nextState, source);
    },
    setHeights(nextHeights: number[]) {
      heights = nextHeights;
    },
    recompute(top: boolean, bottom: boolean) {
      return controller.recomputeAutoFollowCapabilities({ top, bottom });
    },
  };
}

describe("jump controller", () => {
  test("boundary jumps arm the targeted latch immediately and survive pending recompute", () => {
    const harness = createController({
      heights: [20, 20, 20, 20, 20, 20],
      state: { position: 0, offset: 0 },
      viewportHeight: 40,
    });

    harness.controller.jumpToBoundary("bottom", { duration: 100 });
    expect(harness.controller.getAutoFollowCapabilities()).toEqual({
      top: false,
      bottom: true,
    });

    expect(harness.recompute(false, false)).toEqual({
      top: false,
      bottom: true,
    });
  });

  test("plain boundary-aligned jumps latch after animated completion", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const harness = createController({
        heights: [20, 20, 20, 20],
        state: { position: 0, offset: 0 },
        viewportHeight: 40,
      });

      harness.recompute(true, false);
      harness.controller.jumpTo(3, { block: "end", duration: 100 });

      now.current = 50;
      expect(harness.controller.prepare(now.current)).toBe(true);
      expect(harness.controller.finishFrame(false)).toBe(true);
      expect(harness.controller.getAutoFollowCapabilities()).toEqual({
        top: true,
        bottom: false,
      });

      now.current = 100;
      expect(harness.controller.prepare(now.current)).toBe(false);
      expect(harness.controller.getAutoFollowCapabilities()).toEqual({
        top: true,
        bottom: true,
      });
      expect(harness.controller.finishFrame(false)).toBe(false);
    } finally {
      restoreNow();
    }
  });

  test("internal scroll-state mutations do not get misclassified as manual scroll", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const harness = createController({
        heights: [41.125, 23.5, 57.375, 28.25],
        state: { position: 0, offset: 0 },
        viewportHeight: 80,
      });

      harness.recompute(true, false);
      harness.controller.jumpTo(3, { block: "end", duration: 200 });

      now.current = 100;
      expect(harness.controller.prepare(now.current)).toBe(true);
      expect(harness.controller.finishFrame(false)).toBe(true);

      const midState = harness.getState();
      harness.setState(
        {
          position: midState.position,
          offset: midState.offset + 12.5,
        },
        "internal",
      );

      now.current = 200;
      expect(harness.controller.prepare(now.current)).toBe(false);
      expect(harness.controller.getAutoFollowCapabilities()).toEqual({
        top: true,
        bottom: true,
      });
      expect(harness.controller.finishFrame(false)).toBe(false);
    } finally {
      restoreNow();
    }
  });

  test("same-direction follow inserts materialize the current animated anchor before retargeting", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const harness = createController({
        heights: [10, 10, 10],
        state: { position: 1, offset: 0 },
        viewportHeight: 10,
      });
      harness.controller.commit(harness.getState());
      harness.recompute(false, true);

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
      harness.controller.handleListStateChange({
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

  test("external scroll cancels an in-flight manual jump on the next prepare", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const harness = createController({
        heights: [20, 20, 20],
        state: { position: 0, offset: 0 },
      });

      harness.controller.jumpTo(2, { duration: 100 });
      harness.setState({ position: 1, offset: 0 }, "external");
      now.current = 10;

      expect(harness.controller.prepare(now.current)).toBe(false);
      expect(harness.controller.finishFrame(false)).toBe(false);
    } finally {
      restoreNow();
    }
  });

  test("stale latches do not auto-follow inserts after manual scroll before the next frame", () => {
    const harness = createController({
      heights: [20, 20, 20, 20],
      state: { position: 2, offset: 0 },
      viewportHeight: 40,
    });
    harness.controller.commit(harness.getState());
    harness.recompute(false, true);

    harness.setState({ position: 1, offset: 0 }, "external");
    harness.setHeights([20, 20, 20, 20, 20]);
    harness.controller.handleListStateChange({
      type: "push",
      count: 1,
      animation: {
        duration: 220,
        autoFollow: true,
      },
    });

    expect(harness.controller.getAutoFollowCapabilities()).toEqual({
      top: false,
      bottom: true,
    });
    expect(harness.controller.prepare(0)).toBe(false);
    expect(harness.recompute(false, false)).toEqual({
      top: false,
      bottom: false,
    });
  });

  test("rapid follow inserts are not cancelled by internal settle writes", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const harness = createController({
        heights: [20, 20, 20, 20],
        state: { position: 2, offset: 0 },
        viewportHeight: 40,
      });
      harness.controller.commit(harness.getState());
      harness.recompute(false, true);

      harness.setHeights([20, 20, 20, 20, 20]);
      harness.controller.handleListStateChange({
        type: "push",
        count: 1,
        animation: {
          duration: 200,
          autoFollow: true,
        },
      });

      now.current = 80;
      expect(harness.controller.prepare(now.current)).toBe(true);
      expect(harness.controller.finishFrame(false)).toBe(true);

      harness.setState({ position: 3, offset: 7.5 }, "internal");
      harness.setHeights([20, 20, 20, 20, 20, 20]);
      harness.controller.handleListStateChange({
        type: "push",
        count: 1,
        animation: {
          duration: 200,
          autoFollow: true,
        },
      });

      now.current = 200;
      expect(harness.controller.prepare(now.current)).toBe(true);
      expect(harness.controller.finishFrame(false)).toBe(true);
      expect(harness.controller.getAutoFollowCapabilities()).toEqual({
        top: false,
        bottom: true,
      });
    } finally {
      restoreNow();
    }
  });
});
