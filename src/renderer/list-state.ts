export class ListState<T extends {}> {
  offset = 0;
  position: number | undefined;
  items: T[] = [];

  constructor(items: T[] = []) {
    this.items = [...items];
  }

  unshift(...items: T[]): void {
    this.unshiftAll(items);
  }

  unshiftAll(items: T[]): void {
    if (this.position != null) {
      this.position += items.length;
    }
    this.items = items.concat(this.items);
  }

  push(...items: T[]): void {
    this.pushAll(items);
  }

  pushAll(items: T[]): void {
    this.items.push(...items);
  }

  setAnchor(position: number, offset = 0): void {
    this.position = Number.isFinite(position) ? Math.trunc(position) : undefined;
    this.offset = Number.isFinite(offset) ? offset : 0;
  }

  reset(items: T[] = []): void {
    this.items = [...items];
    this.offset = 0;
    this.position = undefined;
  }

  resetScroll(): void {
    this.offset = 0;
    this.position = undefined;
  }

  applyScroll(delta: number): void {
    this.offset += delta;
  }
}
