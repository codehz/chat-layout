import { describe, expect, test } from "bun:test";

import { emitWeakListeners, pruneWeakListenerMap, type WeakListenerRecord } from "../../src/renderer/weak-listeners";

function createFakeRef<T extends object>(initial: T | undefined) {
  let current = initial;
  return {
    ref: {
      deref(): T | undefined {
        return current;
      },
    },
    set(value: T | undefined) {
      current = value;
    },
  };
}

describe("weak listeners", () => {
  test("emitWeakListeners notifies live owners and prunes dead ones", () => {
    const liveOwner = { id: "live" };
    const deadOwner = { id: "dead" };
    const liveRef = createFakeRef(liveOwner);
    const deadRef = createFakeRef(deadOwner);
    const seen: string[] = [];
    const listeners = new Map<symbol, WeakListenerRecord<{ id: string }, string>>([
      [
        Symbol("live"),
        {
          ownerRef: liveRef.ref,
          notify(owner, event) {
            seen.push(`${owner.id}:${event}`);
          },
        },
      ],
      [
        Symbol("dead"),
        {
          ownerRef: deadRef.ref,
          notify(owner, event) {
            seen.push(`${owner.id}:${event}`);
          },
        },
      ],
    ]);

    deadRef.set(undefined);
    emitWeakListeners(listeners, "change");

    expect(seen).toEqual(["live:change"]);
    expect(listeners.size).toBe(1);
  });

  test("pruneWeakListenerMap removes stale records before the next dispatch", () => {
    const firstOwner = { id: "first" };
    const secondOwner = { id: "second" };
    const firstRef = createFakeRef(firstOwner);
    const secondRef = createFakeRef(secondOwner);
    const listeners = new Map<symbol, WeakListenerRecord<{ id: string }, string>>([
      [
        Symbol("first"),
        {
          ownerRef: firstRef.ref,
          notify() {},
        },
      ],
      [
        Symbol("second"),
        {
          ownerRef: secondRef.ref,
          notify() {},
        },
      ],
    ]);

    firstRef.set(undefined);
    pruneWeakListenerMap(listeners);

    expect(listeners.size).toBe(1);
    const remaining = [...listeners.values()][0];
    expect(remaining?.ownerRef.deref()?.id).toBe("second");
  });
});
