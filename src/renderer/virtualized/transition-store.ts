import type { ActiveItemTransition } from "./transition-runtime";
import { VisibilitySnapshot } from "./transition-snapshot";
import { getProgress } from "./virtualized-animation";

export type StoredTransitionEntry<
  C extends CanvasRenderingContext2D,
  T extends {},
> = {
  item: T;
  transition: ActiveItemTransition<C>;
};

export class TransitionStore<C extends CanvasRenderingContext2D, T extends {}> {
  #transitions = new Map<T, ActiveItemTransition<C>>();

  get size(): number {
    return this.#transitions.size;
  }

  has(item: T): boolean {
    return this.#transitions.has(item);
  }

  set(
    item: T,
    transition: ActiveItemTransition<C>,
  ): ActiveItemTransition<C> | undefined {
    const previous = this.#transitions.get(item);
    this.#transitions.set(item, transition);
    return previous;
  }

  replace(
    prevItem: T,
    nextItem: T,
    transition: ActiveItemTransition<C>,
  ): ActiveItemTransition<C> | undefined {
    const previous = this.#transitions.get(prevItem);
    this.#transitions.delete(prevItem);
    this.#transitions.set(nextItem, transition);
    return previous;
  }

  delete(item: T): ActiveItemTransition<C> | undefined {
    const transition = this.#transitions.get(item);
    if (transition != null) {
      this.#transitions.delete(item);
    }
    return transition;
  }

  readActive(item: T, now: number): ActiveItemTransition<C> | undefined {
    const transition = this.#transitions.get(item);
    if (transition == null) {
      return undefined;
    }
    return this.#isComplete(transition, now) ? undefined : transition;
  }

  prepare(now: number): boolean {
    for (const transition of this.#transitions.values()) {
      if (!this.#isComplete(transition, now)) {
        return true;
      }
    }
    return false;
  }

  findCompleted(now: number): StoredTransitionEntry<C, T>[] {
    return [...this.#transitions.entries()]
      .filter(([, transition]) => this.#isComplete(transition, now))
      .map(([item, transition]) => ({ item, transition }));
  }

  findInvisible(
    snapshot: VisibilitySnapshot<T>,
  ): StoredTransitionEntry<C, T>[] {
    return [...this.#transitions.entries()]
      .filter(
        ([item, transition]) =>
          !snapshot.tracks(item, transition.retention) &&
          !(transition.kind === "insert" && !snapshot.wasVisible(item)),
      )
      .map(([item, transition]) => ({ item, transition }));
  }

  entries(): StoredTransitionEntry<C, T>[] {
    return [...this.#transitions.entries()].map(([item, transition]) => ({
      item,
      transition,
    }));
  }

  reset(): void {
    this.#transitions.clear();
  }

  #isComplete(transition: ActiveItemTransition<C>, now: number): boolean {
    return (
      getProgress(
        transition.height.startTime,
        transition.height.duration,
        now,
      ) >= 1
    );
  }
}
