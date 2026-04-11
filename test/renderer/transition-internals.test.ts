import { describe, expect, test } from "bun:test";

import type { Box, Context, HitTest, Node } from "../../src/types";
import {
  TransitionStore,
  VisibilitySnapshot,
  canAnimateExistingItem,
  resolveBoundaryInsertStrategy,
  sampleActiveTransition,
  type ActiveItemTransition,
  type LayerAnimation,
  type ScalarAnimation,
} from "../../src/renderer/virtualized/base-transition";

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
      100,
      { position: 0, offset: 0 },
      0,
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
        readVisibleRange,
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
        readVisibleRange,
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
        readVisibleRange,
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
        readVisibleRange,
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
        readVisibleRange,
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
        readVisibleRange,
      }),
    ).toBe(false);
  });
});

describe("transition boundary insert strategy", () => {
  test("strategy matrix depends only on direction, underflow alignment, and short-list snapshot", () => {
    expect(resolveBoundaryInsertStrategy("push", "top", false)).toBe(
      "hard-cut",
    );
    expect(resolveBoundaryInsertStrategy("push", "bottom", false)).toBe(
      "hard-cut",
    );
    expect(resolveBoundaryInsertStrategy("unshift", "top", false)).toBe(
      "hard-cut",
    );
    expect(resolveBoundaryInsertStrategy("unshift", "bottom", false)).toBe(
      "hard-cut",
    );

    expect(resolveBoundaryInsertStrategy("push", "top", true)).toBe(
      "item-enter",
    );
    expect(resolveBoundaryInsertStrategy("push", "bottom", true)).toBe(
      "viewport-slide",
    );
    expect(resolveBoundaryInsertStrategy("unshift", "top", true)).toBe(
      "viewport-slide",
    );
    expect(resolveBoundaryInsertStrategy("unshift", "bottom", true)).toBe(
      "item-enter",
    );
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
        layers: [layer(0, 1, 24, 0)],
        height: scalar(30, 30),
        retention: "drawn",
      }),
      50,
    );
    expect(sampledInsert.slotHeight).toBeCloseTo(30);
    expect(sampledInsert.layers).toHaveLength(1);
    expect(sampledInsert.layers[0]?.alpha).toBeCloseTo(0.5);
    expect(sampledInsert.layers[0]?.translateY).toBeCloseTo(12);
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
      80,
      { position: 1, offset: 5 },
      0,
      readVisibleRange,
    );

    expect(snapshot.coversShortList).toBe(true);
    expect(snapshot.topGap).toBe(10);
    expect(snapshot.bottomGap).toBe(30);
    expect(snapshot.matchesBoundaryInsertState("push", 2, 1, 5)).toBe(true);
    expect(snapshot.matchesBoundaryInsertState("unshift", 2, 3, 5)).toBe(true);
    expect(snapshot.matchesBoundaryInsertState("unshift", 2, 1, 5)).toBe(false);
  });
});

describe("transition store lifecycle", () => {
  test("completed delete transitions finalize through the active-read cleanup path", () => {
    const store = new TransitionStore<C, Item>();
    const item = { id: "ghost" };
    const finalized: Item[] = [];

    store.set(
      item,
      transition("delete", {
        layers: [layer(1, 0)],
        height: scalar(20, 0),
      }),
    );

    expect(
      store.prepare(50, {
        onDeleteComplete: (completedItem) => finalized.push(completedItem),
      }),
    ).toBe(true);
    expect(finalized).toEqual([]);

    expect(
      store.readActive(item, 100, {
        onDeleteComplete: (completedItem) => finalized.push(completedItem),
      }),
    ).toBeUndefined();
    expect(finalized).toEqual([item]);
    expect(store.size).toBe(0);
  });

  test("offscreen pruning finalizes delete ghosts and manual removal skips callbacks", () => {
    const finalized: Item[] = [];
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
      prunedStore.pruneInvisible(new VisibilitySnapshot<Item>(), {
        onDeleteComplete: (completedItem) => finalized.push(completedItem),
      }),
    ).toBe(true);
    expect(finalized).toEqual([deleteItem]);
    expect(prunedStore.size).toBe(0);

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
    expect(finalized).toEqual([deleteItem]);
  });

  test("visible-retained transitions survive pruning while they still have any visible area", () => {
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
      100,
      { position: 0, offset: 0 },
      0,
      readVisibleRange,
    );

    expect(
      store.pruneInvisible(snapshot, {
        onDeleteComplete: () => {
          throw new Error(
            "should not finalize while the item is still visible",
          );
        },
      }),
    ).toBe(false);
    expect(store.size).toBe(1);
  });
});
