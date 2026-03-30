import type { Box, Context, DynValue, HitTest, Node, RenderFeedback, RendererOptions } from "./types";
import { shallow, shallowMerge } from "./utils";
import { getNodeParent } from "./registry";

export class BaseRenderer<C extends CanvasRenderingContext2D, O extends {} = {}> {
  graphics: C;
  #ctx: Context<C>;
  #lastWidth: number;
  #cache = new WeakMap<Node<C>, Box>();

  protected get context(): Context<C> {
    return shallow(this.#ctx);
  }

  constructor(
    graphics: C,
    readonly options: RendererOptions & O,
  ) {
    this.graphics = graphics;
    this.graphics.textRendering = "optimizeLegibility";
    const self = this;
    this.#ctx = {
      graphics: this.graphics,
      get remainingWidth() {
        return this.graphics.canvas.clientWidth;
      },
      set remainingWidth(value: number) {
        Object.defineProperty(this, "remainingWidth", { value, writable: true });
      },
      alignment: "left",
      reverse: false,
      measureNode(node: Node<C>) {
        return self.measureNode(node, this);
      },
      invalidateNode: this.invalidateNode.bind(this),
      resolveDynValue<T>(value: DynValue<C, T>): T {
        if (typeof value === "function") {
          return value(this.graphics);
        }
        return value as T;
      },
      with<T>(cb: (g: C) => T): T {
        this.graphics.save();
        try {
          return cb(this.graphics);
        } finally {
          this.graphics.restore();
        }
      },
    };
    this.#lastWidth = this.graphics.canvas.clientWidth;
  }

  invalidateNode(node: Node<C>): void {
    this.#cache.delete(node);
    let it: Node<C> | undefined = node;
    while ((it = getNodeParent(it))) {
      this.#cache.delete(it);
    }
  }

  measureNode(node: Node<C>, ctx?: Context<C>): Box {
    if (this.#lastWidth !== this.graphics.canvas.clientWidth) {
      this.#cache = new WeakMap<Node<C>, Box>();
      this.#lastWidth = this.graphics.canvas.clientWidth;
    } else {
      const result = this.#cache.get(node);
      if (result != null) {
        return result;
      }
    }
    const result = node.measure(ctx ?? this.context);
    this.#cache.set(node, result);
    return result;
  }
}

export class DebugRenderer<C extends CanvasRenderingContext2D> extends BaseRenderer<C> {
  draw(node: Node<C>): boolean {
    const { clientWidth: viewportWidth, clientHeight: viewportHeight } = this.graphics.canvas;
    this.graphics.clearRect(0, 0, viewportWidth, viewportHeight);
    return node.draw(this.context, 0, 0);
  }

  hittest(node: Node<C>, test: HitTest): boolean {
    return node.hittest(this.context, test);
  }
}

export function memoRenderItem<C extends CanvasRenderingContext2D, T extends {}>(
  renderItem: (item: T) => Node<C>,
): ((item: T) => Node<C>) & { reset: (key: T) => boolean } {
  const cache = new WeakMap<object, Node<C>>();

  function fn(item: T): Node<C> {
    const key = item as unknown as object;
    const cached = cache.get(key);
    if (cached != null) {
      return cached;
    }
    const result = renderItem(item);
    cache.set(key, result);
    return result;
  }

  return Object.assign(fn, {
    reset: (key: T) => cache.delete(key as unknown as object),
  });
}

export class ListState<T extends {}> {
  offset = 0;
  position = Number.NaN;
  items: T[] = [];

  unshift(...items: T[]): void {
    this.unshiftAll(items);
  }

  unshiftAll(items: T[]): void {
    this.position += items.length;
    this.items = items.concat(this.items);
  }

  push(...items: T[]): void {
    this.pushAll(items);
  }

  pushAll(items: T[]): void {
    this.items.push(...items);
  }

  reset(): void {
    this.items = [];
    this.offset = 0;
    this.position = Number.NaN;
  }

  resetScroll(): void {
    this.offset = 0;
    this.position = Number.NaN;
  }

  applyScroll(delta: number): void {
    this.offset += delta;
  }
}

type DrawItem<C extends CanvasRenderingContext2D> = {
  idx: number;
  node: Node<C>;
  offset: number;
  height: number;
};

export abstract class VirtualizedRenderer<C extends CanvasRenderingContext2D, T extends {}> extends BaseRenderer<
  C,
  {
    renderItem: (item: T) => Node<C>;
    list: ListState<T>;
  }
> {
  get position(): number {
    return this.options.list.position;
  }

  set position(value: number) {
    this.options.list.position = value;
  }

  get offset(): number {
    return this.options.list.offset;
  }

  set offset(value: number) {
    this.options.list.offset = value;
  }

  get items(): T[] {
    return this.options.list.items;
  }

  set items(value: T[]) {
    this.options.list.items = value;
  }

  abstract render(feedback?: RenderFeedback): boolean;
  abstract hittest(test: HitTest): boolean;

  protected _renderDrawList(list: DrawItem<C>[], shift: number, feedback?: RenderFeedback): boolean {
    let result = false;
    const viewportHeight = this.graphics.canvas.clientHeight;

    for (const { idx, node, offset, height } of list) {
      const y = offset + shift;
      if (y + height < 0 || y > viewportHeight) {
        continue;
      }
      if (feedback != null) {
        feedback.minIdx = Number.isNaN(feedback.minIdx) ? idx : Math.min(idx, feedback.minIdx);
        feedback.maxIdx = Number.isNaN(feedback.maxIdx) ? idx : Math.max(idx, feedback.maxIdx);
        if (feedback.minIdx === idx) {
          feedback.min = idx - Math.min(0, y) / height;
        }
        if (feedback.maxIdx === idx) {
          feedback.max = idx - Math.max(0, y + height - viewportHeight) / height;
        }
      }
      if (node.draw(this.context, 0, y)) {
        result = true;
      }
    }

    return result;
  }
}

export class TimelineRenderer<C extends CanvasRenderingContext2D, T extends {}> extends VirtualizedRenderer<C, T> {
  render(feedback?: RenderFeedback): boolean {
    const { clientWidth: viewportWidth, clientHeight: viewportHeight } = this.graphics.canvas;
    this.graphics.clearRect(0, 0, viewportWidth, viewportHeight);

    let drawLength = 0;
    if (Number.isNaN(this.position)) {
      this.position = 0;
    }

    if (this.offset > 0) {
      if (this.position === 0) {
        this.offset = 0;
      } else {
        for (let i = this.position - 1; i >= 0; i -= 1) {
          const item = this.items[i];
          const node = this.options.renderItem(item);
          const { height } = this.measureNode(node);
          this.position = i;
          this.offset -= height;
          if (this.offset <= 0) {
            break;
          }
        }
        if (this.position === 0 && this.offset > 0) {
          this.offset = 0;
        }
      }
    }

    let y = this.offset;
    const drawList: DrawItem<C>[] = [];
    for (let i = this.position; i < this.items.length; i += 1) {
      const item = this.items[i];
      const node = this.options.renderItem(item);
      const { height } = this.measureNode(node);
      if (y + height > 0) {
        drawList.push({ idx: i, node, offset: y, height });
        drawLength += height;
      } else {
        this.offset += height;
        this.position = i + 1;
      }
      y += height;
      if (y >= viewportHeight) {
        break;
      }
    }

    let shift = 0;
    if (y < viewportHeight) {
      if (this.position === 0 && drawLength < viewportHeight) {
        shift = -this.offset;
        this.offset = 0;
      } else {
        shift = viewportHeight - y;
        y = (this.offset += shift);
        let lastIdx = -1;
        for (let i = this.position - 1; i >= 0; i -= 1) {
          const item = this.items[(lastIdx = i)];
          const node = this.options.renderItem(item);
          const { height } = this.measureNode(node);
          drawLength += height;
          y -= height;
          drawList.push({ idx: i, node, offset: y - shift, height });
          if (y < 0) {
            break;
          }
        }
        if (lastIdx === 0 && drawLength < viewportHeight) {
          shift = -drawList[drawList.length - 1].offset;
          this.position = 0;
          this.offset = 0;
        }
      }
    }

    return this._renderDrawList(drawList, shift, feedback);
  }

  hittest(test: HitTest): boolean {
    const viewportHeight = this.graphics.canvas.clientHeight;
    let y = this.offset;

    for (let i = this.position; i < this.items.length; i += 1) {
      const item = this.items[i];
      const node = this.options.renderItem(item);
      const { height } = this.measureNode(node);
      if (test.y < y + height) {
        return node.hittest(
          this.context,
          shallowMerge(test, {
            y: test.y - y,
          }),
        );
      }
      y += height;
      if (y >= viewportHeight) {
        break;
      }
    }
    return false;
  }
}

export class ChatRenderer<C extends CanvasRenderingContext2D, T extends {}> extends VirtualizedRenderer<C, T> {
  render(feedback?: RenderFeedback): boolean {
    const { clientWidth: viewportWidth, clientHeight: viewportHeight } = this.graphics.canvas;
    this.graphics.clearRect(0, 0, viewportWidth, viewportHeight);

    let drawLength = 0;
    if (Number.isNaN(this.position)) {
      this.position = this.items.length - 1;
    }

    if (this.offset < 0) {
      if (this.position === this.items.length - 1) {
        this.offset = 0;
      } else {
        for (let i = this.position + 1; i < this.items.length; i += 1) {
          const item = this.items[i];
          const node = this.options.renderItem(item);
          const { height } = this.measureNode(node);
          this.position = i;
          this.offset += height;
          if (this.offset > 0) {
            break;
          }
        }
      }
    }

    let y = viewportHeight + this.offset;
    const drawList: DrawItem<C>[] = [];
    for (let i = this.position; i >= 0; i -= 1) {
      const item = this.items[i];
      const node = this.options.renderItem(item);
      const { height } = this.measureNode(node);
      y -= height;
      if (y <= viewportHeight) {
        drawList.push({ idx: i, node, offset: y, height });
        drawLength += height;
      } else {
        this.offset -= height;
        this.position = i - 1;
      }
      if (y < 0) {
        break;
      }
    }

    let shift = 0;
    if (y > 0) {
      shift = -y;
      if (drawLength < viewportHeight) {
        y = drawLength;
        for (let i = this.position + 1; i < this.items.length; i += 1) {
          const item = this.items[i];
          const node = this.options.renderItem(item);
          const { height } = this.measureNode(node);
          drawList.push({ idx: i, node, offset: y - shift, height });
          y = (drawLength += height);
          this.position = i;
          if (y >= viewportHeight) {
            break;
          }
        }
        if (drawLength < viewportHeight) {
          this.offset = 0;
        } else {
          this.offset = drawLength - viewportHeight;
        }
      } else {
        this.offset = drawLength - viewportHeight;
      }
    }

    return this._renderDrawList(drawList, shift, feedback);
  }

  hittest(test: HitTest): boolean {
    const viewportHeight = this.graphics.canvas.clientHeight;

    let drawLength = 0;
    const heights: Array<readonly [Node<C>, number]> = [];
    for (let i = this.position; i >= 0; i -= 1) {
      const item = this.items[i];
      const node = this.options.renderItem(item);
      const { height } = this.measureNode(node);
      drawLength += height;
      heights.push([node, height]);
    }

    let y = drawLength < viewportHeight ? drawLength : viewportHeight + this.offset;
    if (test.y > y) {
      return false;
    }

    for (const [node, height] of heights) {
      y -= height;
      if (test.y > y) {
        return node.hittest(
          this.context,
          shallowMerge(test, {
            y: test.y - y,
          }),
        );
      }
    }
    return false;
  }
}
