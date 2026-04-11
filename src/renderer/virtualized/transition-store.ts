import { getProgress } from "./base-animation";
import type {
  ActiveItemTransition,
  TransitionLifecycleAdapter,
} from "./transition-runtime";
import { VisibilitySnapshot } from "./transition-snapshot";

export class TransitionStore<C extends CanvasRenderingContext2D, T extends {}> {
  #transitions = new Map<T, ActiveItemTransition<C>>();

  get size(): number {
    return this.#transitions.size;
  }

  has(item: T): boolean {
    return this.#transitions.has(item);
  }

  set(item: T, transition: ActiveItemTransition<C>): void {
    this.#transitions.set(item, transition);
  }

  replace(prevItem: T, nextItem: T, transition: ActiveItemTransition<C>): void {
    this.#transitions.delete(prevItem);
    this.#transitions.set(nextItem, transition);
  }

  delete(item: T): ActiveItemTransition<C> | undefined {
    const transition = this.#transitions.get(item);
    if (transition != null) {
      this.#transitions.delete(item);
    }
    return transition;
  }

  readActive(
    item: T,
    now: number,
    lifecycle?: TransitionLifecycleAdapter<T>,
  ): ActiveItemTransition<C> | undefined {
    const transition = this.#transitions.get(item);
    if (transition == null) {
      return undefined;
    }
    if (
      getProgress(
        transition.height.startTime,
        transition.height.duration,
        now,
      ) >= 1
    ) {
      this.#transitions.delete(item);
      if (transition.kind === "delete") {
        lifecycle?.onDeleteComplete(item);
      }
      return undefined;
    }
    return transition;
  }

  prepare(now: number, lifecycle: TransitionLifecycleAdapter<T>): boolean {
    let keepAnimating = false;
    for (const item of [...this.#transitions.keys()]) {
      if (this.readActive(item, now, lifecycle) != null) {
        keepAnimating = true;
      }
    }
    return keepAnimating;
  }

  pruneInvisible(
    snapshot: VisibilitySnapshot<T>,
    lifecycle: TransitionLifecycleAdapter<T>,
  ): boolean {
    let changed = false;
    for (const [item, transition] of [...this.#transitions.entries()]) {
      if (snapshot.tracks(item, transition.retention)) {
        continue;
      }
      this.#transitions.delete(item);
      if (transition.kind === "delete") {
        lifecycle.onDeleteComplete(item);
      }
      changed = true;
    }
    return changed;
  }

  reset(): void {
    this.#transitions.clear();
  }
}
