import type {
  Box,
  Context,
  DynValue,
  FlexLayoutResult,
  HitTest,
  LayoutConstraints,
  Node,
  RenderFeedback,
  RendererOptions,
} from "./types";
import { shallow, shallowMerge } from "./utils";
import { forEachNodeAncestor, getNodeRevision } from "./registry";

/** 每个节点最多保留的约束变体数量，防止缓存无限累积 */
const MAX_CONSTRAINT_VARIANTS = 8;

type LayoutCacheAccess<C extends CanvasRenderingContext2D> = {
  getLayoutResult(node: Node<C>, constraints?: LayoutConstraints): FlexLayoutResult<C> | undefined;
  setLayoutResult(node: Node<C>, result: FlexLayoutResult<C>, constraints?: LayoutConstraints): void;
};

type BoxCacheEntry = {
  revision: number;
  box: Box;
};

type LayoutCacheEntry<C extends CanvasRenderingContext2D> = {
  revision: number;
  layout: FlexLayoutResult<C>;
};

type RendererContext<C extends CanvasRenderingContext2D> = Context<C> & LayoutCacheAccess<C>;

function constraintKey(constraints: LayoutConstraints | undefined): string {
  if (constraints == null) return "";
  return `${constraints.minWidth ?? ""},${constraints.maxWidth ?? ""},${constraints.minHeight ?? ""},${constraints.maxHeight ?? ""}`;
}

export class BaseRenderer<C extends CanvasRenderingContext2D, O extends {} = {}> {
  graphics: C;
  #ctx: RendererContext<C>;
  #lastWidth: number;
  #cache = new WeakMap<Node<C>, Map<string, BoxCacheEntry>>();
  #layoutCache = new WeakMap<Node<C>, Map<string, LayoutCacheEntry<C>>>();

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
      measureNode(node: Node<C>, constraints?: LayoutConstraints) {
        return self.measureNode(node, constraints);
      },
      getLayoutResult(node: Node<C>, constraints?: LayoutConstraints) {
        return self.getLayoutResult(node, constraints);
      },
      setLayoutResult(node: Node<C>, result: FlexLayoutResult<C>, constraints?: LayoutConstraints) {
        self.setLayoutResult(node, result, constraints);
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

  protected getRootConstraints(): LayoutConstraints {
    return {
      maxWidth: this.graphics.canvas.clientWidth,
    };
  }

  protected getRootContext(): Context<C> {
    const ctx = this.context;
    ctx.constraints = this.getRootConstraints();
    return ctx;
  }

  protected measureRootNode(node: Node<C>): Box {
    return this.measureNode(node, this.getRootConstraints());
  }

  protected drawRootNode(node: Node<C>, x = 0, y = 0): boolean {
    this.measureRootNode(node);
    return node.draw(this.getRootContext(), x, y);
  }

  protected hittestRootNode(node: Node<C>, test: HitTest): boolean {
    this.measureRootNode(node);
    return node.hittest(this.getRootContext(), test);
  }

  invalidateNode(node: Node<C>): void {
    this.#cache.delete(node);
    this.#layoutCache.delete(node);
    forEachNodeAncestor(node, (ancestor) => {
      this.#cache.delete(ancestor);
      this.#layoutCache.delete(ancestor);
    });
  }

  getLayoutResult(node: Node<C>, constraints?: LayoutConstraints): FlexLayoutResult<C> | undefined {
    const nodeCache = this.#layoutCache.get(node);
    if (nodeCache == null) {
      return undefined;
    }
    const cached = nodeCache.get(constraintKey(constraints));
    if (cached == null) {
      return undefined;
    }
    if (cached.revision !== getNodeRevision(node)) {
      nodeCache.delete(constraintKey(constraints));
      return undefined;
    }
    return cached.layout;
  }

  setLayoutResult(node: Node<C>, result: FlexLayoutResult<C>, constraints?: LayoutConstraints): void {
    let nodeCache = this.#layoutCache.get(node);
    if (nodeCache == null) {
      nodeCache = new Map();
      this.#layoutCache.set(node, nodeCache);
    } else if (nodeCache.size >= MAX_CONSTRAINT_VARIANTS) {
      const firstKey = nodeCache.keys().next().value!;
      nodeCache.delete(firstKey);
    }
    nodeCache.set(constraintKey(constraints), {
      revision: getNodeRevision(node),
      layout: result,
    });
  }

  measureNode(node: Node<C>, constraints?: LayoutConstraints): Box {
    if (this.#lastWidth !== this.graphics.canvas.clientWidth) {
      this.#cache = new WeakMap<Node<C>, Map<string, BoxCacheEntry>>();
      this.#layoutCache = new WeakMap<Node<C>, Map<string, LayoutCacheEntry<C>>>();
      this.#lastWidth = this.graphics.canvas.clientWidth;
    } else {
      const nodeCache = this.#cache.get(node);
      if (nodeCache != null) {
        const key = constraintKey(constraints);
        const cached = nodeCache.get(key);
        if (cached != null) {
          if (cached.revision === getNodeRevision(node)) {
            return cached.box;
          }
          nodeCache.delete(key);
        }
      }
    }
    const ctx = this.context;
    if (constraints != null) {
      ctx.constraints = constraints;
    }
    const result = node.measure(ctx);
    const key = constraintKey(constraints);
    let nodeCache = this.#cache.get(node);
    if (nodeCache == null) {
      nodeCache = new Map();
      this.#cache.set(node, nodeCache);
    } else if (nodeCache.size >= MAX_CONSTRAINT_VARIANTS) {
      // 超出上限时移除最早插入的条目，避免无限累积
      const firstKey = nodeCache.keys().next().value!;
      nodeCache.delete(firstKey);
    }
    nodeCache.set(key, {
      revision: getNodeRevision(node),
      box: result,
    });
    return result;
  }
}

export class DebugRenderer<C extends CanvasRenderingContext2D> extends BaseRenderer<C> {
  draw(node: Node<C>): boolean {
    const { clientWidth: viewportWidth, clientHeight: viewportHeight } = this.graphics.canvas;
    this.graphics.clearRect(0, 0, viewportWidth, viewportHeight);
    return this.drawRootNode(node);
  }

  hittest(node: Node<C>, test: HitTest): boolean {
    return this.hittestRootNode(node, test);
  }
}

function isWeakMapKey(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

export function memoRenderItem<C extends CanvasRenderingContext2D, T extends object>(
  renderItem: (item: T) => Node<C>,
): ((item: T) => Node<C>) & { reset: (key: T) => boolean } {
  const cache = new WeakMap<object, Node<C>>();

  function fn(item: T): Node<C> {
    if (!isWeakMapKey(item)) {
      throw new TypeError("memoRenderItem() only supports object items. Use memoRenderItemBy() for primitive keys.");
    }
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

export function memoRenderItemBy<C extends CanvasRenderingContext2D, T, K>(
  keyOf: (item: T) => K,
  renderItem: (item: T) => Node<C>,
): ((item: T) => Node<C>) & { reset: (item: T) => boolean; resetKey: (key: K) => boolean } {
  const cache = new Map<K, Node<C>>();

  function fn(item: T): Node<C> {
    const key = keyOf(item);
    const cached = cache.get(key);
    if (cached != null) {
      return cached;
    }
    const result = renderItem(item);
    cache.set(key, result);
    return result;
  }

  return Object.assign(fn, {
    reset: (item: T) => cache.delete(keyOf(item)),
    resetKey: (key: K) => cache.delete(key),
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

type VisibleWindow<C extends CanvasRenderingContext2D> = {
  drawList: DrawItem<C>[];
  shift: number;
};

export interface JumpToOptions {
  animated?: boolean;
  block?: "start" | "center" | "end";
  duration?: number;
  onComplete?: () => void;
}

type ControlledState = {
  position: number;
  offset: number;
};

type JumpAnimation = {
  startAnchor: number;
  targetAnchor: number;
  startTime: number;
  duration: number;
  needsMoreFrames: boolean;
  onComplete: (() => void) | undefined;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sameState(state: ControlledState, position: number, offset: number): boolean {
  return Object.is(state.position, position) && Object.is(state.offset, offset);
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function getNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export abstract class VirtualizedRenderer<C extends CanvasRenderingContext2D, T extends {}> extends BaseRenderer<
  C,
  {
    renderItem: (item: T) => Node<C>;
    list: ListState<T>;
  }
> {
  static readonly MIN_JUMP_DURATION = 160;
  static readonly MAX_JUMP_DURATION = 420;
  static readonly JUMP_DURATION_PER_ITEM = 28;

  #controlledState: ControlledState | undefined;
  #jumpAnimation: JumpAnimation | undefined;

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

  jumpTo(index: number, options: JumpToOptions = {}): void {
    if (this.items.length === 0) {
      this.#cancelJumpAnimation();
      return;
    }

    const targetIndex = this._clampItemIndex(index);
    this._prepareAnchorState();
    const targetBlock = options.block ?? this._getDefaultJumpBlock();
    const targetAnchor = this._getTargetAnchor(targetIndex, targetBlock);

    const animated = options.animated ?? true;
    if (!animated) {
      this.#cancelJumpAnimation();
      this._applyAnchor(targetAnchor);
      options.onComplete?.();
      return;
    }

    const startAnchor = this._readAnchor();
    if (!Number.isFinite(startAnchor)) {
      this.#cancelJumpAnimation();
      this._applyAnchor(targetAnchor);
      options.onComplete?.();
      return;
    }

    const duration = clamp(
      options.duration ??
        VirtualizedRenderer.MIN_JUMP_DURATION +
          Math.abs(targetAnchor - startAnchor) * VirtualizedRenderer.JUMP_DURATION_PER_ITEM,
      0,
      VirtualizedRenderer.MAX_JUMP_DURATION,
    );

    if (duration <= 0 || Math.abs(targetAnchor - startAnchor) <= Number.EPSILON) {
      this.#cancelJumpAnimation();
      this._applyAnchor(targetAnchor);
      options.onComplete?.();
      return;
    }

    this.#jumpAnimation = {
      startAnchor,
      targetAnchor,
      startTime: getNow(),
      duration,
      needsMoreFrames: true,
      onComplete: options.onComplete,
    };
    this.#controlledState = {
      position: this.position,
      offset: this.offset,
    };
  }

  protected _resetRenderFeedback(feedback?: RenderFeedback): void {
    if (feedback == null) {
      return;
    }
    feedback.minIdx = Number.NaN;
    feedback.maxIdx = Number.NaN;
    feedback.min = Number.NaN;
    feedback.max = Number.NaN;
  }

  protected _accumulateRenderFeedback(feedback: RenderFeedback, idx: number, top: number, height: number): void {
    if (!Number.isFinite(top) || !Number.isFinite(height) || height <= 0) {
      return;
    }

    const viewportHeight = this.graphics.canvas.clientHeight;
    const visibleTop = clamp(-top, 0, height);
    const visibleBottom = clamp(viewportHeight - top, 0, height);
    if (visibleBottom <= visibleTop) {
      return;
    }

    const itemMin = idx + visibleTop / height;
    const itemMax = idx + visibleBottom / height;
    feedback.minIdx = Number.isNaN(feedback.minIdx) ? idx : Math.min(idx, feedback.minIdx);
    feedback.maxIdx = Number.isNaN(feedback.maxIdx) ? idx : Math.max(idx, feedback.maxIdx);
    feedback.min = Number.isNaN(feedback.min) ? itemMin : Math.min(itemMin, feedback.min);
    feedback.max = Number.isNaN(feedback.max) ? itemMax : Math.max(itemMax, feedback.max);
  }

  protected _renderDrawList(list: DrawItem<C>[], shift: number, feedback?: RenderFeedback): boolean {
    let result = false;
    const viewportHeight = this.graphics.canvas.clientHeight;

    for (const { idx, node, offset, height } of list) {
      const y = offset + shift;
      if (feedback != null) {
        this._accumulateRenderFeedback(feedback, idx, y, height);
      }
      if (y + height < 0 || y > viewportHeight) {
        continue;
      }
      if (this.drawRootNode(node, 0, y)) {
        result = true;
      }
    }

    return result;
  }

  protected _renderVisibleWindow(window: VisibleWindow<C>, feedback?: RenderFeedback): boolean {
    this._resetRenderFeedback(feedback);
    return this._renderDrawList(window.drawList, window.shift, feedback);
  }

  protected _hittestVisibleWindow(window: VisibleWindow<C>, test: HitTest): boolean {
    for (const { node, offset, height } of window.drawList) {
      const y = offset + window.shift;
      if (test.y < y || test.y >= y + height) {
        continue;
      }
      return node.hittest(
        this.getRootContext(),
        shallowMerge(test, {
          y: test.y - y,
        }),
      );
    }
    return false;
  }

  protected _prepareRender(): boolean {
    const animation = this.#jumpAnimation;
    if (animation == null) {
      return false;
    }
    if (this.items.length === 0) {
      this.#cancelJumpAnimation();
      return false;
    }
    if (this.#controlledState != null && !sameState(this.#controlledState, this.position, this.offset)) {
      this.#cancelJumpAnimation();
      return false;
    }

    const progress = clamp((getNow() - animation.startTime) / animation.duration, 0, 1);
    const eased = progress >= 1 ? 1 : smoothstep(progress);
    const anchor = animation.startAnchor + (animation.targetAnchor - animation.startAnchor) * eased;
    this._applyAnchor(anchor);
    animation.needsMoreFrames = progress < 1;
    return animation.needsMoreFrames;
  }

  protected _finishRender(requestRedraw: boolean): boolean {
    const animation = this.#jumpAnimation;
    if (animation == null) {
      return requestRedraw;
    }

    if (animation.needsMoreFrames) {
      this.#controlledState = {
        position: this.position,
        offset: this.offset,
      };
      return true;
    }

    const onComplete = animation.onComplete;
    this.#cancelJumpAnimation();
    onComplete?.();
    return requestRedraw || this.#jumpAnimation != null;
  }

  protected _clampItemIndex(index: number): number {
    return clamp(Number.isFinite(index) ? Math.trunc(index) : 0, 0, this.items.length - 1);
  }

  protected _getItemHeight(index: number): number {
    const item = this.items[index];
    const node = this.options.renderItem(item);
    return this.measureRootNode(node).height;
  }

  protected _getAnchorAtOffset(index: number, offset: number): number {
    if (this.items.length === 0) {
      return 0;
    }

    let currentIndex = this._clampItemIndex(index);
    let remaining = Number.isFinite(offset) ? offset : 0;
    while (true) {
      if (remaining < 0) {
        if (currentIndex === 0) {
          return 0;
        }
        currentIndex -= 1;
        const height = this._getItemHeight(currentIndex);
        if (height > 0) {
          remaining += height;
        }
        continue;
      }

      const height = this._getItemHeight(currentIndex);
      if (height > 0) {
        if (remaining <= height) {
          return currentIndex + remaining / height;
        }
        remaining -= height;
      } else if (remaining === 0) {
        return currentIndex;
      }

      if (currentIndex === this.items.length - 1) {
        return this.items.length;
      }
      currentIndex += 1;
    }
  }

  protected abstract _prepareAnchorState(): void;
  protected abstract _readAnchor(): number;
  protected abstract _applyAnchor(anchor: number): void;
  protected abstract _getDefaultJumpBlock(): NonNullable<JumpToOptions["block"]>;
  protected abstract _getTargetAnchor(index: number, block: NonNullable<JumpToOptions["block"]>): number;

  #cancelJumpAnimation(): void {
    this.#jumpAnimation = undefined;
    this.#controlledState = undefined;
  }
}

export class TimelineRenderer<C extends CanvasRenderingContext2D, T extends {}> extends VirtualizedRenderer<C, T> {
  #resolveVisibleWindow(): VisibleWindow<C> {
    this._prepareAnchorState();
    if (this.items.length === 0) {
      return { drawList: [], shift: 0 };
    }

    const viewportHeight = this.graphics.canvas.clientHeight;
    let drawLength = 0;

    if (this.offset > 0) {
      if (this.position === 0) {
        this.offset = 0;
      } else {
        for (let i = this.position - 1; i >= 0; i -= 1) {
          const item = this.items[i];
          const node = this.options.renderItem(item);
          const { height } = this.measureRootNode(node);
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
      const { height } = this.measureRootNode(node);
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
          const { height } = this.measureRootNode(node);
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

    return { drawList, shift };
  }

  protected _getDefaultJumpBlock(): NonNullable<JumpToOptions["block"]> {
    return "start";
  }

  protected _prepareAnchorState(): void {
    if (this.items.length === 0) {
      return;
    }
    if (!Number.isFinite(this.position)) {
      this.position = 0;
      if (!Number.isFinite(this.offset)) {
        this.offset = 0;
      }
      return;
    }
    this.position = this._clampItemIndex(this.position);
    if (!Number.isFinite(this.offset)) {
      this.offset = 0;
    }
  }

  protected _readAnchor(): number {
    this._prepareAnchorState();
    if (this.items.length === 0) {
      return 0;
    }
    const height = this._getItemHeight(this.position);
    return height > 0 ? this.position - this.offset / height : this.position;
  }

  protected _applyAnchor(anchor: number): void {
    if (this.items.length === 0) {
      return;
    }
    const clampedAnchor = clamp(anchor, 0, this.items.length);
    const position = clamp(Math.floor(clampedAnchor), 0, this.items.length - 1);
    const height = this._getItemHeight(position);
    this.position = position;
    const offset = height > 0 ? -(clampedAnchor - position) * height : 0;
    this.offset = Object.is(offset, -0) ? 0 : offset;
  }

  protected _getTargetAnchor(index: number, block: NonNullable<JumpToOptions["block"]>): number {
    const height = this._getItemHeight(index);
    const viewportHeight = this.graphics.canvas.clientHeight;

    switch (block) {
      case "start":
        return this._getAnchorAtOffset(index, 0);
      case "center":
        return this._getAnchorAtOffset(index, height / 2 - viewportHeight / 2);
      case "end":
        return this._getAnchorAtOffset(index, height - viewportHeight);
    }
  }

  render(feedback?: RenderFeedback): boolean {
    const keepAnimating = this._prepareRender();
    const { clientWidth: viewportWidth, clientHeight: viewportHeight } = this.graphics.canvas;
    this.graphics.clearRect(0, 0, viewportWidth, viewportHeight);
    const window = this.#resolveVisibleWindow();
    const requestRedraw = this._renderVisibleWindow(window, feedback);
    return this._finishRender(keepAnimating || requestRedraw);
  }

  hittest(test: HitTest): boolean {
    return this._hittestVisibleWindow(this.#resolveVisibleWindow(), test);
  }
}

export class ChatRenderer<C extends CanvasRenderingContext2D, T extends {}> extends VirtualizedRenderer<C, T> {
  #resolveVisibleWindow(): VisibleWindow<C> {
    this._prepareAnchorState();
    if (this.items.length === 0) {
      return { drawList: [], shift: 0 };
    }

    const viewportHeight = this.graphics.canvas.clientHeight;
    let drawLength = 0;

    if (this.offset < 0) {
      if (this.position === this.items.length - 1) {
        this.offset = 0;
      } else {
        for (let i = this.position + 1; i < this.items.length; i += 1) {
          const item = this.items[i];
          const node = this.options.renderItem(item);
          const { height } = this.measureRootNode(node);
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
      const { height } = this.measureRootNode(node);
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
          const { height } = this.measureRootNode(node);
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

    return { drawList, shift };
  }

  protected _getDefaultJumpBlock(): NonNullable<JumpToOptions["block"]> {
    return "end";
  }

  protected _prepareAnchorState(): void {
    if (this.items.length === 0) {
      return;
    }
    if (!Number.isFinite(this.position)) {
      this.position = this.items.length - 1;
      if (!Number.isFinite(this.offset)) {
        this.offset = 0;
      }
      return;
    }
    this.position = this._clampItemIndex(this.position);
    if (!Number.isFinite(this.offset)) {
      this.offset = 0;
    }
  }

  protected _readAnchor(): number {
    this._prepareAnchorState();
    if (this.items.length === 0) {
      return 0;
    }
    const height = this._getItemHeight(this.position);
    return height > 0 ? this.position + 1 - this.offset / height : this.position + 1;
  }

  protected _applyAnchor(anchor: number): void {
    if (this.items.length === 0) {
      return;
    }
    const clampedAnchor = clamp(anchor, 0, this.items.length);
    const position = clamp(Math.ceil(clampedAnchor) - 1, 0, this.items.length - 1);
    const height = this._getItemHeight(position);
    this.position = position;
    const offset = height > 0 ? (position + 1 - clampedAnchor) * height : 0;
    this.offset = Object.is(offset, -0) ? 0 : offset;
  }

  protected _getTargetAnchor(index: number, block: NonNullable<JumpToOptions["block"]>): number {
    const height = this._getItemHeight(index);
    const viewportHeight = this.graphics.canvas.clientHeight;

    switch (block) {
      case "start":
        return this._getAnchorAtOffset(index, viewportHeight);
      case "center":
        return this._getAnchorAtOffset(index, height / 2 + viewportHeight / 2);
      case "end":
        return this._getAnchorAtOffset(index, height);
    }
  }

  render(feedback?: RenderFeedback): boolean {
    const keepAnimating = this._prepareRender();
    const { clientWidth: viewportWidth, clientHeight: viewportHeight } = this.graphics.canvas;
    this.graphics.clearRect(0, 0, viewportWidth, viewportHeight);
    const window = this.#resolveVisibleWindow();
    const requestRedraw = this._renderVisibleWindow(window, feedback);
    return this._finishRender(keepAnimating || requestRedraw);
  }

  hittest(test: HitTest): boolean {
    return this._hittestVisibleWindow(this.#resolveVisibleWindow(), test);
  }
}
