import { forEachNodeAncestor, getNodeRevision } from "../internal/node-registry";
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
