import { describe, expect, test } from "bun:test";

import { ListState, subscribeListState } from "../../src/renderer/list-state";

type Item = {
  id: string;
};

describe("ListState item identity", () => {
  test("update replaces by item reference and emits an index-free change", () => {
    const first = { id: "first" };
    const second = { id: "second" };
    const next = { id: "next" };
    const list = new ListState<Item>([first, second]);
    const owner = {};
    const changes: object[] = [];

    subscribeListState(list, owner, (_owner, change) => {
      changes.push(change);
    });

    list.update(first, next, { duration: 180 });

    expect(list.items).toEqual([next, second]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      type: "update",
      prevItem: first,
      nextItem: next,
      animation: { duration: 180 },
    });
    expect("index" in changes[0]!).toBe(false);
  });

  test("update rejects missing targets, reused identities, and duplicate replacements", () => {
    const first = { id: "first" };
    const second = { id: "second" };
    const missing = { id: "missing" };
    const list = new ListState<Item>([first, second]);

    expect(() => list.update(missing, { id: "next" })).toThrow("targetItem is not present");
    expect(() => list.update(first, first)).toThrow("requires nextItem to be a new object reference");
    expect(() => list.update(first, second)).toThrow("nextItem is already present");
  });

  test("update only supports object items", () => {
    const list = new ListState<number>([1, 2, 3]);

    expect(() => list.update(1, 4)).toThrow("only supports object items");
  });

  test("duplicate item references are rejected on construction and list mutations", () => {
    const item = { id: "shared" };
    const other = { id: "other" };

    expect(() => new ListState<Item>([item, item])).toThrow("unique object references");

    const list = new ListState<Item>([item]);
    expect(() => {
      list.items = [other, other];
    }).toThrow("unique object references");
    expect(() => list.reset([other, other])).toThrow("unique object references");
    expect(() => list.push(item)).toThrow("unique object references");
    expect(() => list.unshift(item)).toThrow("unique object references");
  });
});
