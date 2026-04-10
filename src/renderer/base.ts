import {
  forEachNodeAncestor,
  getNodeRevision,
} from "../internal/node-registry";
import type {
  Box,
  Context,
  DynValue,
  FlexLayoutResult,
  HitTest,
  LayoutConstraints,
  Node,
  RendererOptions,
} from "../types";
import { shallow } from "../utils";

const MAX_CONSTRAINT_VARIANTS = 8;

type LayoutCacheAccess<C extends CanvasRenderingContext2D> = {
  getLayoutResult(
    node: Node<C>,
    constraints?: LayoutConstraints,
  ): FlexLayoutResult<C> | undefined;
  setLayoutResult(
    node: Node<C>,
    result: FlexLayoutResult<C>,
    constraints?: LayoutConstraints,
  ): void;
};

type TextLayoutCacheAccess<C extends CanvasRenderingContext2D> = {
  getTextLayout<T>(node: Node<C>, key: string): T | undefined;
  setTextLayout<T>(node: Node<C>, key: string, layout: T): void;
};

type BoxCacheEntry = {
  revision: number;
  box: Box;
};

type LayoutCacheEntry<C extends CanvasRenderingContext2D> = {
  revision: number;
  layout: FlexLayoutResult<C>;
};

type TextLayoutCacheEntry = {
  revision: number;
  layout: unknown;
};

type RendererContext<C extends CanvasRenderingContext2D> = Context<C> &
  LayoutCacheAccess<C> &
  TextLayoutCacheAccess<C>;

function constraintKey(constraints: LayoutConstraints | undefined): string {
  if (constraints == null) return "";
  return `${constraints.minWidth ?? ""},${constraints.maxWidth ?? ""},${constraints.minHeight ?? ""},${constraints.maxHeight ?? ""}`;
}

/**
 * Base renderer that provides measurement, layout caching, and drawing helpers.
 */
export class BaseRenderer<
  C extends CanvasRenderingContext2D,
  O extends {} = {},
> {
  /** Canvas rendering context used by this renderer. */
  graphics: C;
  #ctx: RendererContext<C>;
  #lastWidth: number;
  #cache = new WeakMap<Node<C>, Map<string, BoxCacheEntry>>();
  #layoutCache = new WeakMap<Node<C>, Map<string, LayoutCacheEntry<C>>>();
  #textLayoutCache = new WeakMap<Node<C>, Map<string, TextLayoutCacheEntry>>();

  protected get context(): Context<C> {
    return shallow(this.#ctx);
  }

  /**
   * @param graphics Canvas rendering context used for all layout and drawing.
   * @param options Renderer-specific options.
   */
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
      setLayoutResult(
        node: Node<C>,
        result: FlexLayoutResult<C>,
        constraints?: LayoutConstraints,
      ) {
        self.setLayoutResult(node, result, constraints);
      },
      getTextLayout<T>(node: Node<C>, key: string) {
        return self.getTextLayout<T>(node, key);
      },
      setTextLayout<T>(node: Node<C>, key: string, layout: T) {
        self.setTextLayout(node, key, layout);
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

  #clearAllCaches(): void {
    this.#cache = new WeakMap<Node<C>, Map<string, BoxCacheEntry>>();
    this.#layoutCache = new WeakMap<
      Node<C>,
      Map<string, LayoutCacheEntry<C>>
    >();
    this.#textLayoutCache = new WeakMap<
      Node<C>,
      Map<string, TextLayoutCacheEntry>
    >();
  }

  #syncCachesToViewportWidth(): void {
    const width = this.graphics.canvas.clientWidth;
    if (this.#lastWidth === width) {
      return;
    }
    this.#clearAllCaches();
    this.#lastWidth = width;
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

  /**
   * Drops cached measurements for a node and every ancestor that depends on it.
   */
  invalidateNode(node: Node<C>): void {
    this.#syncCachesToViewportWidth();
    this.#cache.delete(node);
    this.#layoutCache.delete(node);
    this.#textLayoutCache.delete(node);
    forEachNodeAncestor(node, (ancestor) => {
      this.#cache.delete(ancestor);
      this.#layoutCache.delete(ancestor);
      this.#textLayoutCache.delete(ancestor);
    });
  }

  /**
   * Returns the cached layout result for a node under the given constraints, if available.
   */
  getLayoutResult(
    node: Node<C>,
    constraints?: LayoutConstraints,
  ): FlexLayoutResult<C> | undefined {
    this.#syncCachesToViewportWidth();
    const nodeCache = this.#layoutCache.get(node);
    if (nodeCache == null) {
      return undefined;
    }
    const key = constraintKey(constraints);
    const cached = nodeCache.get(key);
    if (cached == null) {
      return undefined;
    }
    if (cached.revision !== getNodeRevision(node)) {
      nodeCache.delete(key);
      return undefined;
    }
    return cached.layout;
  }

  /**
   * Stores a layout result for later draw and hit-test passes.
   */
  setLayoutResult(
    node: Node<C>,
    result: FlexLayoutResult<C>,
    constraints?: LayoutConstraints,
  ): void {
    this.#syncCachesToViewportWidth();
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

  protected getTextLayout<T>(node: Node<C>, key: string): T | undefined {
    this.#syncCachesToViewportWidth();
    const nodeCache = this.#textLayoutCache.get(node);
    if (nodeCache == null) {
      return undefined;
    }
    const cached = nodeCache.get(key);
    if (cached == null) {
      return undefined;
    }
    if (cached.revision !== getNodeRevision(node)) {
      nodeCache.delete(key);
      return undefined;
    }
    return cached.layout as T;
  }

  protected setTextLayout<T>(node: Node<C>, key: string, layout: T): void {
    this.#syncCachesToViewportWidth();
    let nodeCache = this.#textLayoutCache.get(node);
    if (nodeCache == null) {
      nodeCache = new Map();
      this.#textLayoutCache.set(node, nodeCache);
    } else if (nodeCache.size >= MAX_CONSTRAINT_VARIANTS) {
      const firstKey = nodeCache.keys().next().value!;
      nodeCache.delete(firstKey);
    }
    nodeCache.set(key, {
      revision: getNodeRevision(node),
      layout,
    });
  }

  /**
   * Measures a node under optional constraints, using cached results when possible.
   */
  measureNode(node: Node<C>, constraints?: LayoutConstraints): Box {
    this.#syncCachesToViewportWidth();
    {
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

/**
 * Immediate-mode renderer for a single root node.
 */
export class DebugRenderer<
  C extends CanvasRenderingContext2D,
> extends BaseRenderer<C> {
  /**
   * Clears the viewport and draws the provided root node.
   */
  draw(node: Node<C>): boolean {
    const { clientWidth: viewportWidth, clientHeight: viewportHeight } =
      this.graphics.canvas;
    this.graphics.clearRect(0, 0, viewportWidth, viewportHeight);
    return this.drawRootNode(node);
  }

  /**
   * Hit-tests the provided root node using viewport-relative coordinates.
   */
  hittest(node: Node<C>, test: HitTest): boolean {
    return this.hittestRootNode(node, test);
  }
}
