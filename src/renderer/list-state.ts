/**
 * Mutable list state shared with virtualized renderers.
 */
export class ListState<T extends {}> {
  /** Pixel offset from the anchored item edge. */
  offset = 0;
  /** Anchor item index, or `undefined` to use the renderer default. */
  position: number | undefined;
  /** Items currently managed by the renderer. */
  items: T[] = [];

  /**
   * @param items Initial list items.
   */
  constructor(items: T[] = []) {
    this.items = [...items];
  }

  /** Prepends one or more items. */
  unshift(...items: T[]): void {
    this.unshiftAll(items);
  }

  /** Prepends an array of items. */
  unshiftAll(items: T[]): void {
    if (this.position != null) {
      this.position += items.length;
    }
    this.items = items.concat(this.items);
  }

  /** Appends one or more items. */
  push(...items: T[]): void {
    this.pushAll(items);
  }

  /** Appends an array of items. */
  pushAll(items: T[]): void {
    this.items.push(...items);
  }

  /**
   * Sets the current anchor item and pixel offset.
   */
  setAnchor(position: number, offset = 0): void {
    this.position = Number.isFinite(position) ? Math.trunc(position) : undefined;
    this.offset = Number.isFinite(offset) ? offset : 0;
  }

  /**
   * Replaces all items and clears scroll state.
   */
  reset(items: T[] = []): void {
    this.items = [...items];
    this.offset = 0;
    this.position = undefined;
  }

  /** Clears the current scroll anchor while keeping the items. */
  resetScroll(): void {
    this.offset = 0;
    this.position = undefined;
  }

  /** Applies a relative pixel scroll delta. */
  applyScroll(delta: number): void {
    this.offset += delta;
  }
}
