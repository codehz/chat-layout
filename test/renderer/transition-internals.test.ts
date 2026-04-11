import { describe, expect, test } from "bun:test";

import type { Box, Context, HitTest, Node } from "../../src/types";
import {
  TransitionStore,
  VisibilitySnapshot,
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
    anchorPolicy: { mode: "flow" },
    retention: "layout",
    ...options,
  };
}

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

  test("layout-retained transitions survive pruning while the resolution path still tracks them", () => {
    const item = { id: "layout-item" };
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
      { drawList: [], shift: 0 },
      [0],
      [item],
      40,
      { position: 0, offset: 0 },
      0,
      () => undefined,
    );

    expect(
      store.pruneInvisible(snapshot, {
        onDeleteComplete: () => {
          throw new Error("should not finalize while still on the layout path");
        },
      }),
    ).toBe(false);
    expect(store.size).toBe(1);
  });
});
