import { describe, expect, test } from "bun:test";

import type { Box, Context, HitTest, Node } from "../../src/types";
import {
  TransitionStore,
  VisibilitySnapshot,
  canAnimateExistingItem,
  remapAnchorAfterDeletes,
  sampleActiveTransition,
  type ActiveItemTransition,
  type LayerAnimation,
  type ScalarAnimation,
} from "../../src/renderer/virtualized/base-transition";
import { resolveListViewport } from "../../src/renderer/virtualized/solver";

type C = CanvasRenderingContext2D;
type Item = { id: string };

const dummyNode: Node<C> = {
  measure(_ctx: Context<C>): Box {
    return { width: 10, height: 10 };
  },
  draw(_ctx: Context<C>, _x: number, _y: number): boolean {
    return false;
  },
  hittest(_ctx: Context<C>, _test: HitTest): boolean {
    return false;
  },
};

function scalar(
  from: number,
  to: number,
  startTime = 0,
  duration = 100,
): ScalarAnimation {
  return {
    from,
    to,
    startTime,
    duration,
  };
}

function layer(
  fromAlpha: number,
  toAlpha: number,
  fromTranslateY = 0,
  toTranslateY = 0,
): LayerAnimation<C> {
  return {
    node: dummyNode,
    alpha: scalar(fromAlpha, toAlpha),
    translateY: scalar(fromTranslateY, toTranslateY),
  };
}

function transition(
  kind: ActiveItemTransition<C>["kind"],
  options: Partial<ActiveItemTransition<C>> = {},
): ActiveItemTransition<C> {
  return {
    kind,
    layers: [],
    height: scalar(0, 0),
    retention: "visible",
    ...options,
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

function resolveVisibleWindow(
  drawList: Array<{
    idx: number;
    offset: number;
    height: number;
  }>,
): () => {
  window: {
    drawList: Array<{
      idx: number;
      offset: number;
      height: number;
      value: null;
    }>;
    shift: number;
  };
  normalizedState: { position: number; offset: number };
  resolutionPath: number[];
} {
  return () => ({
    window: {
      drawList: drawList.map((entry) => ({ ...entry, value: null })),
      shift: 0,
    },
    normalizedState: {
      position: 0,
      offset: 0,
    },
    resolutionPath: drawList.map((entry) => entry.idx),
  });
}

const viewport100 = resolveListViewport(100, undefined);
const viewport80 = resolveListViewport(80, undefined);

describe("transition eligibility", () => {
  test("uses the matching snapshot when available and otherwise falls back to the live solved window", () => {
    const item = { id: "item" };
    const snapshot = new VisibilitySnapshot<Item>();
    snapshot.capture(
      {
        drawList: [{ idx: 0, offset: 10, height: 20, value: null }],
        shift: 0,
      },
      [0],
      [item],
      viewport100,
      { position: 0, offset: 0 },
      readVisibleRange,
      readVisibleRange,
    );

    expect(
      canAnimateExistingItem({
        index: 0,
        item,
        position: 0,
        offset: 0,
        snapshot,
        hasActiveTransition: false,
        resolveVisibleWindow: resolveVisibleWindow([]),
        readOuterVisibleRange: readVisibleRange,
      }),
    ).toBe(true);

    expect(
      canAnimateExistingItem({
        index: 0,
        item: { id: "hidden" },
        position: 0,
        offset: 0,
        snapshot,
        hasActiveTransition: false,
        resolveVisibleWindow: resolveVisibleWindow([
          { idx: 0, offset: 10, height: 20 },
        ]),
        readOuterVisibleRange: readVisibleRange,
      }),
    ).toBe(false);

    expect(
      canAnimateExistingItem({
        index: 0,
        item: { id: "ghost" },
        position: 0,
        offset: 0,
        snapshot,
        hasActiveTransition: true,
        resolveVisibleWindow: resolveVisibleWindow([]),
        readOuterVisibleRange: readVisibleRange,
      }),
    ).toBe(false);

    expect(
      canAnimateExistingItem({
        index: 1,
        item: { id: "live-visible" },
        position: 1,
        offset: 0,
        snapshot,
        hasActiveTransition: false,
        resolveVisibleWindow: resolveVisibleWindow([
          { idx: 1, offset: 15, height: 25 },
        ]),
        readOuterVisibleRange: readVisibleRange,
      }),
    ).toBe(true);

    expect(
      canAnimateExistingItem({
        index: 1,
        item: { id: "live-hidden" },
        position: 1,
        offset: 0,
        snapshot,
        hasActiveTransition: false,
        resolveVisibleWindow: resolveVisibleWindow([
          { idx: 1, offset: 140, height: 25 },
        ]),
        readOuterVisibleRange: readVisibleRange,
      }),
    ).toBe(false);

    expect(
      canAnimateExistingItem({
        index: -1,
        item,
        position: 0,
        offset: 0,
        snapshot,
        hasActiveTransition: true,
        resolveVisibleWindow: resolveVisibleWindow([
          { idx: 0, offset: 10, height: 20 },
        ]),
        readOuterVisibleRange: readVisibleRange,
      }),
    ).toBe(false);
  });
});

describe("transition sampling", () => {
  test("update, delete, and insert share the same sampling model", () => {
    const sampledUpdate = sampleActiveTransition(
      transition("update", {
        layers: [layer(1, 0), layer(0, 1)],
        height: scalar(20, 60),
      }),
      50,
    );
    expect(sampledUpdate.slotHeight).toBeCloseTo(40);
    expect(sampledUpdate.layers).toHaveLength(2);
    expect(sampledUpdate.layers[0]?.alpha).toBeCloseTo(0.5);
    expect(sampledUpdate.layers[1]?.alpha).toBeCloseTo(0.5);

    const sampledDelete = sampleActiveTransition(
      transition("delete", {
        layers: [layer(1, 0)],
        height: scalar(20, 0),
      }),
      50,
    );
    expect(sampledDelete.slotHeight).toBeCloseTo(10);
    expect(sampledDelete.layers).toHaveLength(1);
    expect(sampledDelete.layers[0]?.alpha).toBeCloseTo(0.5);

    const sampledInsert = sampleActiveTransition(
      transition("insert", {
        layers: [layer(0, 1)],
        height: scalar(0, 30),
        retention: "drawn",
      }),
      50,
    );
    expect(sampledInsert.slotHeight).toBeCloseTo(15);
    expect(sampledInsert.layers).toHaveLength(1);
    expect(sampledInsert.layers[0]?.alpha).toBeCloseTo(0.5);
    expect(sampledInsert.layers[0]?.translateY).toBeCloseTo(0);
  });
});

describe("delete-finalize anchor remapping", () => {
  test("shifts anchors left when deletions happen entirely before them", () => {
    expect(remapAnchorAfterDeletes(4.25, [1])).toBeCloseTo(3.25);
    expect(remapAnchorAfterDeletes(4.25, [1, 3])).toBeCloseTo(2.25);
  });

  test("collapses anchors that land inside a deleted interval", () => {
    expect(remapAnchorAfterDeletes(1.5, [1])).toBeCloseTo(1);
    expect(remapAnchorAfterDeletes(3.2, [1, 3])).toBeCloseTo(2);
  });

  test("leaves anchors unchanged when deletions happen after them", () => {
    expect(remapAnchorAfterDeletes(0.75, [2])).toBeCloseTo(0.75);
    expect(remapAnchorAfterDeletes(1, [3, 5])).toBeCloseTo(1);
  });

  test("applies multiple same-frame deletes in old-index order", () => {
    expect(remapAnchorAfterDeletes(2.5, [2, 1])).toBeCloseTo(1);
    expect(remapAnchorAfterDeletes(5.5, [4, 1, 3])).toBeCloseTo(2.5);
  });
});

describe("visibility snapshot", () => {
  test("tracks short-list gaps and expected boundary-insert state", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const snapshot = new VisibilitySnapshot<Item>();

    snapshot.capture(
      {
        drawList: [
          { idx: 0, offset: 10, height: 20, value: null },
          { idx: 1, offset: 30, height: 20, value: null },
        ],
        shift: 0,
      },
      [0, 1],
      [a, b],
      viewport80,
      { position: 1, offset: 5 },
      readVisibleRange,
      readVisibleRange,
    );

    expect(snapshot.coversShortList).toBe(true);
    expect(snapshot.matchesBoundaryInsertState("push", 2, 1, 5)).toBe(true);
    expect(snapshot.matchesBoundaryInsertState("unshift", 2, 3, 5)).toBe(true);
    expect(snapshot.matchesBoundaryInsertState("unshift", 2, 1, 5)).toBe(false);
  });

  test("tracks rendered empty-list snapshots separately from generic no-snapshot cases", () => {
    const snapshot = new VisibilitySnapshot<Item>();

    expect(snapshot.matchesEmptyBoundaryInsertState("push", 1, 0, 0)).toBe(
      false,
    );

    snapshot.capture(
      {
        drawList: [],
        shift: 0,
      },
      [],
      [],
      viewport80,
      { position: 0, offset: 0 },
      readVisibleRange,
      readVisibleRange,
    );

    expect(snapshot.matchesEmptyBoundaryInsertState("push", 1, 0, 0)).toBe(
      true,
    );
    expect(snapshot.matchesEmptyBoundaryInsertState("unshift", 2, 2, 0)).toBe(
      true,
    );
    expect(snapshot.matchesEmptyBoundaryInsertState("push", 1, 1, 0)).toBe(
      false,
    );
  });
});

describe("transition store lifecycle", () => {
  test("completed delete transitions remain discoverable until an explicit settlement pass removes them", () => {
    const store = new TransitionStore<C, Item>();
    const item = { id: "ghost" };

    store.set(
      item,
      transition("delete", {
        layers: [layer(1, 0)],
        height: scalar(20, 0),
      }),
    );

    expect(store.prepare(50)).toBe(true);

    expect(store.readActive(item, 100)).toBeUndefined();
    expect(
      store.findCompleted(100).map(({ item: completed }) => completed),
    ).toEqual([item]);
    expect(store.size).toBe(1);
  });

  test("offscreen pruning reports delete ghosts for external settlement and manual removal skips callbacks", () => {
    const deleteItem = { id: "delete" };
    const insertItem = { id: "insert" };

    const prunedStore = new TransitionStore<C, Item>();
    prunedStore.set(
      deleteItem,
      transition("delete", {
        layers: [layer(1, 0)],
        height: scalar(20, 0),
      }),
    );
    prunedStore.set(
      insertItem,
      transition("insert", {
        layers: [layer(0, 1)],
        height: scalar(20, 20),
        retention: "drawn",
      }),
    );

    expect(
      prunedStore
        .findInvisible(new VisibilitySnapshot<Item>())
        .map(({ item }) => item),
    ).toEqual([deleteItem]);
    expect(prunedStore.size).toBe(2);

    const manualStore = new TransitionStore<C, Item>();
    manualStore.set(
      deleteItem,
      transition("delete", {
        layers: [layer(1, 0)],
        height: scalar(20, 0),
      }),
    );
    expect(manualStore.delete(deleteItem)?.kind).toBe("delete");
    expect(manualStore.size).toBe(0);
  });

  test("visible-retained transitions survive invisible scans while they still have any visible area", () => {
    const item = { id: "visible-item" };
    const store = new TransitionStore<C, Item>();
    const snapshot = new VisibilitySnapshot<Item>();

    store.set(
      item,
      transition("delete", {
        layers: [layer(1, 0)],
        height: scalar(20, 0),
      }),
    );
    snapshot.capture(
      {
        drawList: [{ idx: 0, offset: 90, height: 20, value: null }],
        shift: 0,
      },
      [0],
      [item],
      viewport100,
      { position: 0, offset: 0 },
      readVisibleRange,
      readVisibleRange,
    );

    expect(store.findInvisible(snapshot)).toEqual([]);
    expect(store.size).toBe(1);
  });
});
