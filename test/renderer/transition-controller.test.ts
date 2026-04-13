import { describe, expect, test } from "bun:test";

import { resolveListViewport } from "../../src/renderer/virtualized/solver";
import {
  TransitionController,
  type TransitionLifecycleAdapter,
  type TransitionPlanningAdapter,
} from "../../src/renderer/virtualized/transition-controller";
import type { Box, Context, HitTest, Node } from "../../src/types";
import { mockPerformanceNow } from "../helpers/graphics";

type C = CanvasRenderingContext2D;
type Item = { id: string; height: number };
type DrawEntry = { index: number; offset: number; height: number };
type WindowState = {
  drawList: Array<DrawEntry & { value: null }>;
  shift: number;
};

const viewport = resolveListViewport(100, undefined);

function createNode(item: Item): Node<C> {
  return {
    measure(_ctx: Context<C>): Box {
      return { width: 320, height: item.height };
    },
    draw(_ctx: Context<C>, _x: number, _y: number): boolean {
      return false;
    },
    hittest(_ctx: Context<C>, _test: HitTest): boolean {
      return false;
    },
  };
}

function readVisibleRange(
  top: number,
  height: number,
): { top: number; bottom: number } | undefined {
  if (top + height <= 0 || top >= 100) {
    return undefined;
  }
  return {
    top: Math.max(0, -top),
    bottom: Math.min(height, 100 - top),
  };
}

function windowState(entries: DrawEntry[]): WindowState {
  return {
    drawList: entries.map((entry) => ({ ...entry, value: null })),
    shift: 0,
  };
}

function solution(
  window: WindowState,
  state: { position: number; offset: number },
) {
  return {
    window,
    normalizedState: state,
    resolutionPath: window.drawList.map((entry) => entry.index),
  };
}

function createAdapter(
  items: Item[],
  currentWindow: () => WindowState,
  previousStateWindow: WindowState,
  previousState: { position: number; offset: number } = {
    position: 0,
    offset: 0,
  },
): TransitionPlanningAdapter<C, Item> {
  return {
    anchorMode: "top",
    items,
    position: previousState.position,
    offset: previousState.offset,
    renderItem: (item) => createNode(item),
    measureNode: (node) => node.measure({} as Context<C>),
    viewport,
    readVisibleRange,
    readOuterVisibleRange: readVisibleRange,
    resolveVisibleWindow: () => solution(currentWindow(), previousState),
    resolveVisibleWindowForState: (state) =>
      (state.position ?? 0) === previousState.position &&
      state.offset === previousState.offset
        ? solution(previousStateWindow, {
            position: state.position ?? 0,
            offset: state.offset,
          })
        : solution(currentWindow(), {
            position: state.position ?? 0,
            offset: state.offset,
          }),
  };
}

function createLifecycle(items: Item[]): TransitionLifecycleAdapter<Item> & {
  captureTimes: number[];
  deleted: string[];
  snapped: Array<{ id: string; boundary: "top" | "bottom" }>;
} {
  const captureTimes: number[] = [];
  const deleted: string[] = [];
  const snapped: Array<{ id: string; boundary: "top" | "bottom" }> = [];
  return {
    captureTimes,
    deleted,
    snapped,
    onDeleteComplete(item) {
      deleted.push(item.id);
    },
    captureVisualAnchor(now) {
      captureTimes.push(now);
      return undefined;
    },
    restoreVisualAnchor() {},
    readScrollState: () => ({ position: 0, offset: 0 }),
    readItemIndex: (item) => items.indexOf(item),
    snapItemToViewportBoundary(item, boundary) {
      snapped.push({ id: item.id, boundary });
    },
    onTransitionSettleScrollAdjusted() {},
    beginAutoFollowBoundaryObservation() {},
    endAutoFollowBoundaryObservation() {},
    invalidateAutoFollowBoundary() {},
  };
}

describe("transition controller facade", () => {
  test("canAutoFollowBoundaryInsert reflects captured boundary state and reset clears snapshot and active transitions", () => {
    const controller = new TransitionController<C, Item>();
    const items = [
      { id: "head", height: 20 },
      { id: "tail", height: 20 },
    ];
    const currentWindow = windowState([
      { index: 0, offset: 0, height: 20 },
      { index: 1, offset: 20, height: 20 },
    ]);
    const ctx = createAdapter(items, () => currentWindow, currentWindow);
    const lifecycle = createLifecycle(items);

    controller.captureVisibilitySnapshot(
      currentWindow,
      [0, 1],
      items,
      viewport,
      { position: 0, offset: 0 },
      readVisibleRange,
      readVisibleRange,
    );
    expect(controller.canAutoFollowBoundaryInsert("push", 1, 0, 0)).toBe(true);
    expect(controller.canAutoFollowBoundaryInsert("unshift", 1, 1, 0)).toBe(
      true,
    );

    controller.handleListStateChange(
      {
        type: "delete",
        item: items[0]!,
        animation: { duration: 100 },
      },
      ctx,
      lifecycle,
      0,
    );
    expect(controller.prepare(50, lifecycle)).toBe(true);

    controller.reset();
    expect(controller.canAutoFollowBoundaryInsert("push", 1, 0, 0)).toBe(false);
    expect(controller.prepare(50, lifecycle)).toBe(false);
  });

  test("prepare returns true for active transitions and false after settling completed ones", () => {
    const activeController = new TransitionController<C, Item>();
    const activeItems = [{ id: "active", height: 20 }];
    const activeWindow = windowState([{ index: 0, offset: 0, height: 20 }]);
    const activeCtx = createAdapter(
      activeItems,
      () => activeWindow,
      activeWindow,
    );
    const activeLifecycle = createLifecycle(activeItems);

    activeController.captureVisibilitySnapshot(
      activeWindow,
      [0],
      activeItems,
      viewport,
      { position: 0, offset: 0 },
      readVisibleRange,
      readVisibleRange,
    );
    activeController.handleListStateChange(
      {
        type: "delete",
        item: activeItems[0]!,
        animation: { duration: 100 },
      },
      activeCtx,
      activeLifecycle,
      0,
    );
    expect(activeController.prepare(50, activeLifecycle)).toBe(true);
    expect(activeLifecycle.deleted).toEqual([]);

    const completedController = new TransitionController<C, Item>();
    const completedItems = [{ id: "done", height: 20 }];
    const completedWindow = windowState([{ index: 0, offset: 0, height: 20 }]);
    const completedCtx = createAdapter(
      completedItems,
      () => completedWindow,
      completedWindow,
    );
    const completedLifecycle = createLifecycle(completedItems);

    completedController.captureVisibilitySnapshot(
      completedWindow,
      [0],
      completedItems,
      viewport,
      { position: 0, offset: 0 },
      readVisibleRange,
      readVisibleRange,
    );
    completedController.handleListStateChange(
      {
        type: "delete",
        item: completedItems[0]!,
        animation: { duration: 100 },
      },
      completedCtx,
      completedLifecycle,
      0,
    );
    expect(completedController.prepare(150, completedLifecycle)).toBe(false);
    expect(completedLifecycle.deleted).toEqual(["done"]);
  });

  test("pruneInvisible uses the current time wrapper and snaps to the top boundary for removals before the drawn range", () => {
    const controller = new TransitionController<C, Item>();
    const ghost = { id: "ghost", height: 20 };
    const boundary = { id: "boundary", height: 20 };
    const items = [ghost, boundary];
    const visibleWithGhost = windowState([
      { index: 0, offset: 0, height: 20 },
      { index: 1, offset: 20, height: 20 },
    ]);
    const boundaryOnly = windowState([{ index: 1, offset: 0, height: 20 }]);
    let currentWindow = visibleWithGhost;
    const ctx = createAdapter(items, () => currentWindow, boundaryOnly, {
      position: 1,
      offset: 0,
    });
    const lifecycle = createLifecycle(items);

    controller.captureVisibilitySnapshot(
      visibleWithGhost,
      [0, 1],
      items,
      viewport,
      { position: 1, offset: 0 },
      readVisibleRange,
      readVisibleRange,
    );
    controller.handleListStateChange(
      {
        type: "delete",
        item: ghost,
        animation: { duration: 100 },
      },
      ctx,
      lifecycle,
      0,
    );

    currentWindow = boundaryOnly;
    controller.captureVisibilitySnapshot(
      boundaryOnly,
      [1],
      items,
      viewport,
      { position: 1, offset: 0 },
      readVisibleRange,
      readVisibleRange,
    );

    const now = { current: 150 };
    const restoreNow = mockPerformanceNow(now);
    try {
      expect(controller.pruneInvisible(ctx, lifecycle)).toBe(true);
    } finally {
      restoreNow();
    }

    expect(lifecycle.captureTimes).toEqual([150]);
    expect(lifecycle.deleted).toEqual(["ghost"]);
    expect(lifecycle.snapped).toEqual([{ id: "boundary", boundary: "top" }]);
  });

  test("pruneInvisible snaps to the bottom boundary for removals after the drawn range", () => {
    const controller = new TransitionController<C, Item>();
    const boundary = { id: "boundary", height: 20 };
    const ghost = { id: "ghost", height: 20 };
    const items = [boundary, ghost];
    const visibleWithGhost = windowState([
      { index: 0, offset: 0, height: 20 },
      { index: 1, offset: 20, height: 20 },
    ]);
    const boundaryOnly = windowState([{ index: 0, offset: 0, height: 20 }]);
    let currentWindow = visibleWithGhost;
    const ctx = createAdapter(items, () => currentWindow, boundaryOnly);
    const lifecycle = createLifecycle(items);

    controller.captureVisibilitySnapshot(
      visibleWithGhost,
      [0, 1],
      items,
      viewport,
      { position: 0, offset: 0 },
      readVisibleRange,
      readVisibleRange,
    );
    controller.handleListStateChange(
      {
        type: "delete",
        item: ghost,
        animation: { duration: 100 },
      },
      ctx,
      lifecycle,
      0,
    );

    currentWindow = boundaryOnly;
    controller.captureVisibilitySnapshot(
      boundaryOnly,
      [0],
      items,
      viewport,
      { position: 0, offset: 0 },
      readVisibleRange,
      readVisibleRange,
    );

    expect(controller.pruneInvisibleAt(150, ctx, lifecycle)).toBe(true);
    expect(lifecycle.snapped).toEqual([{ id: "boundary", boundary: "bottom" }]);
  });

  test("pruneInvisible does not snap when the resolved previous state still shows the removed item", () => {
    const controller = new TransitionController<C, Item>();
    const ghost = { id: "ghost", height: 20 };
    const boundary = { id: "boundary", height: 20 };
    const items = [ghost, boundary];
    const visibleWithGhost = windowState([
      { index: 0, offset: 0, height: 20 },
      { index: 1, offset: 20, height: 20 },
    ]);
    const boundaryOnly = windowState([{ index: 1, offset: 0, height: 20 }]);
    let currentWindow = visibleWithGhost;
    const ctx = createAdapter(items, () => currentWindow, visibleWithGhost, {
      position: 1,
      offset: 0,
    });
    const lifecycle = createLifecycle(items);

    controller.captureVisibilitySnapshot(
      visibleWithGhost,
      [0, 1],
      items,
      viewport,
      { position: 1, offset: 0 },
      readVisibleRange,
      readVisibleRange,
    );
    controller.handleListStateChange(
      {
        type: "delete",
        item: ghost,
        animation: { duration: 100 },
      },
      ctx,
      lifecycle,
      0,
    );

    currentWindow = boundaryOnly;
    controller.captureVisibilitySnapshot(
      boundaryOnly,
      [1],
      items,
      viewport,
      { position: 1, offset: 0 },
      readVisibleRange,
      readVisibleRange,
    );

    expect(controller.pruneInvisibleAt(150, ctx, lifecycle)).toBe(true);
    expect(lifecycle.snapped).toEqual([]);
  });
});
