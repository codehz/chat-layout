import { describe, expect, test } from "bun:test";

import {
  drainInternalListScrollCommands,
  drainInternalListStateChanges,
  ListState,
  readInternalListScrollCommandTime,
} from "../../src/renderer/list-state";

type Item = {
  id: string;
};

describe("ListState item identity", () => {
  test("update replaces by item reference and queues an index-free change", () => {
    const first = { id: "first" };
    const second = { id: "second" };
    const next = { id: "next" };
    const list = new ListState<Item>([first, second]);

    list.update(first, next, { duration: 180 });
    const changes = drainInternalListStateChanges(list);

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

  test("delete queues an index-free change and defers removal while animated", () => {
    const first = { id: "first" };
    const second = { id: "second" };
    const list = new ListState<Item>([first, second]);

    list.delete(first, { duration: 180 });
    const changes = drainInternalListStateChanges(list);

    expect(list.items).toEqual([first, second]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      type: "delete",
      item: first,
      animation: { duration: 180 },
    });
    expect("index" in changes[0]!).toBe(false);
  });

  test("delete with zero duration removes immediately and queues finalize change", () => {
    const first = { id: "first" };
    const second = { id: "second" };
    const list = new ListState<Item>([first, second]);

    list.delete(first, { duration: 0 });
    const changes = drainInternalListStateChanges(list);

    expect(list.items).toEqual([second]);
    expect(changes).toEqual([
      {
        type: "delete-finalize",
        item: first,
      },
    ]);
  });

  test("delete rejects missing items and non-object items", () => {
    const first = { id: "first" };
    const missing = { id: "missing" };
    const list = new ListState<Item>([first]);

    expect(() => list.delete(missing)).toThrow("item is not present");
    expect(() => new ListState<number>([1, 2, 3]).delete(1)).toThrow(
      "only supports object items",
    );
  });

  test("delete is idempotent for pending items and pending deletes cannot be updated", () => {
    const first = { id: "first" };
    const second = { id: "second" };
    const list = new ListState<Item>([first, second]);

    list.delete(first, { duration: 180 });
    list.delete(first, { duration: 180 });
    const changes = drainInternalListStateChanges(list);

    expect(changes).toHaveLength(1);
    expect(() => list.update(first, { id: "next" })).toThrow(
      "pending deletion",
    );
  });

  test("update rejects missing targets, reused identities, and duplicate replacements", () => {
    const first = { id: "first" };
    const second = { id: "second" };
    const missing = { id: "missing" };
    const list = new ListState<Item>([first, second]);

    expect(() => list.update(missing, { id: "next" })).toThrow(
      "targetItem is not present",
    );
    expect(() => list.update(first, first)).toThrow(
      "requires nextItem to be a new object reference",
    );
    expect(() => list.update(first, second)).toThrow(
      "nextItem is already present",
    );
  });

  test("update only supports object items", () => {
    const list = new ListState<number>([1, 2, 3]);

    expect(() => list.update(1, 4)).toThrow("only supports object items");
  });

  test("duplicate item references are rejected on construction and list mutations", () => {
    const item = { id: "shared" };
    const other = { id: "other" };

    expect(() => new ListState<Item>([item, item])).toThrow(
      "unique object references",
    );

    const list = new ListState<Item>([item]);
    expect(() => {
      list.items = [other, other];
    }).toThrow("unique object references");
    expect(() => list.reset([other, other])).toThrow(
      "unique object references",
    );
    expect(() => list.push(item)).toThrow("unique object references");
    expect(() => list.unshift(item)).toThrow("unique object references");
  });

  test("scroll position and offset are read-only to external callers", () => {
    const list = new ListState<Item>([{ id: "existing" }]);

    expect(() => {
      (
        list as ListState<Item> & {
          position: number | undefined;
        }
      ).position = 1;
    }).toThrow(TypeError);
    expect(() => {
      (
        list as ListState<Item> & {
          offset: number;
        }
      ).offset = 10;
    }).toThrow(TypeError);
  });

  test("pushAll and unshiftAll keep hard-cut behavior by default", () => {
    const existing = { id: "existing" };
    const list = new ListState<Item>([existing]);

    list.pushAll([{ id: "tail" }]);
    list.unshiftAll([{ id: "head" }]);
    const changes = drainInternalListStateChanges(list);

    expect(changes).toEqual([
      {
        type: "push",
        count: 1,
        animation: undefined,
      },
      {
        type: "unshift",
        count: 1,
        animation: undefined,
      },
    ]);
  });

  test("pushAll and unshiftAll normalize animated insertion options", () => {
    const list = new ListState<Item>([{ id: "existing" }]);

    list.pushAll([{ id: "tail" }], {
      duration: 180,
      autoFollow: true,
    });
    list.unshiftAll([{ id: "head" }], {
      duration: 180,
      autoFollow: true,
    });
    const changes = drainInternalListStateChanges(list);

    expect(changes).toEqual([
      {
        type: "push",
        count: 1,
        animation: {
          duration: 180,
          autoFollow: true,
        },
      },
      {
        type: "unshift",
        count: 1,
        animation: {
          duration: 180,
          autoFollow: true,
        },
      },
    ]);
  });

  test("pushAll and unshiftAll default follow duration to the insert animation default", () => {
    const list = new ListState<Item>([{ id: "existing" }]);

    list.pushAll([{ id: "tail" }], {
      autoFollow: true,
    });
    list.unshiftAll([{ id: "head" }], {
      autoFollow: true,
    });
    const changes = drainInternalListStateChanges(list);

    expect(changes).toEqual([
      {
        type: "push",
        count: 1,
        animation: {
          duration: 220,
          autoFollow: true,
        },
      },
      {
        type: "unshift",
        count: 1,
        animation: {
          duration: 220,
          autoFollow: true,
        },
      },
    ]);
  });

  test("pushAll and unshiftAll drop animation payloads when duration is non-positive", () => {
    const list = new ListState<Item>([{ id: "existing" }]);

    list.pushAll([{ id: "tail" }], {
      duration: 0,
      autoFollow: true,
    });
    list.unshiftAll([{ id: "head" }], {
      duration: -1,
      autoFollow: true,
    });
    const changes = drainInternalListStateChanges(list);

    expect(changes).toEqual([
      {
        type: "push",
        count: 1,
        animation: undefined,
      },
      {
        type: "unshift",
        count: 1,
        animation: undefined,
      },
    ]);
  });

  test("drain returns queued changes in order and clears the queue", () => {
    const first = { id: "first" };
    const second = { id: "second" };
    const replacement = { id: "replacement" };
    const list = new ListState<Item>([first]);

    list.push(second);
    list.update(first, replacement, { duration: 80 });

    expect(drainInternalListStateChanges(list)).toEqual([
      {
        type: "push",
        count: 1,
        animation: undefined,
      },
      {
        type: "update",
        prevItem: first,
        nextItem: replacement,
        animation: { duration: 80 },
      },
    ]);
    expect(drainInternalListStateChanges(list)).toEqual([]);
  });

  test("scrollTo helpers queue independent scroll commands in order", () => {
    const list = new ListState<Item>([{ id: "existing" }]);

    list.scrollTo(8.9, {
      animated: false,
      block: "center",
      duration: 180,
    });
    list.scrollToTop();
    list.scrollToBottom({
      duration: Number.NaN,
      onComplete: () => undefined,
    });

    const commands = drainInternalListScrollCommands(list);

    expect(commands).toHaveLength(3);
    expect(commands).toEqual([
      {
        type: "index",
        index: 8.9,
        options: {
          animated: false,
          block: "center",
          duration: 180,
        },
      },
      {
        type: "boundary",
        boundary: "top",
        options: {},
      },
      {
        type: "boundary",
        boundary: "bottom",
        options: {
          onComplete: expect.any(Function),
        },
      },
    ]);
    expect(readInternalListScrollCommandTime(commands[0]!)).toEqual(
      expect.any(Number),
    );
    expect(drainInternalListStateChanges(list)).toEqual([]);
    expect(drainInternalListScrollCommands(list)).toEqual([]);
  });
});
