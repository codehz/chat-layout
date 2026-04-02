import type {
  Alignment,
  Axis,
  Box,
  ChildLayoutResult,
  Context,
  CrossAxisAlignment,
  DynValue,
  FlexContainerOptions,
  FlexItemOptions,
  HitTest,
  LayoutConstraints,
  Node,
  TextAlign,
} from "./types";
import { createRect, findChildAtPoint, getSingleChildLayout, pointInRect } from "./layout";
import { layoutFirstLine, layoutText } from "./text";
import { shallow, shallowMerge } from "./utils";
import { registerNodeParent, unregisterNodeParent } from "./registry";

function withConstraints<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  constraints: LayoutConstraints | undefined,
): Context<C> {
  const next = shallow(ctx);
  next.constraints = constraints;
  if (constraints?.maxWidth != null) {
    next.remainingWidth = constraints.maxWidth;
  }
  return next;
}

function resolveAvailableWidth<C extends CanvasRenderingContext2D>(ctx: Context<C>): number {
  return ctx.constraints?.maxWidth ?? ctx.remainingWidth;
}

function resolveHorizontalOffset(align: TextAlign, availableWidth: number, childWidth: number): number {
  switch (align) {
    case "center":
      return (availableWidth - childWidth) / 2;
    case "end":
      return availableWidth - childWidth;
    case "start":
      return 0;
  }
}

function toTextAlign(alignment: Alignment): TextAlign {
  switch (alignment) {
    case "center":
      return "center";
    case "right":
      return "end";
    case "left":
      return "start";
  }
}

function getMainSize(axis: Axis, box: Box): number {
  return axis === "row" ? box.width : box.height;
}

function getCrossSize(axis: Axis, box: Box): number {
  return axis === "row" ? box.height : box.width;
}

function getMinMain(axis: Axis, constraints?: LayoutConstraints): number | undefined {
  return axis === "row" ? constraints?.minWidth : constraints?.minHeight;
}

function getMaxMain(axis: Axis, constraints?: LayoutConstraints): number | undefined {
  return axis === "row" ? constraints?.maxWidth : constraints?.maxHeight;
}

function getMinCross(axis: Axis, constraints?: LayoutConstraints): number | undefined {
  return axis === "row" ? constraints?.minHeight : constraints?.minWidth;
}

function getMaxCross(axis: Axis, constraints?: LayoutConstraints): number | undefined {
  return axis === "row" ? constraints?.maxHeight : constraints?.maxWidth;
}

function createAxisConstraints(
  axis: Axis,
  constraints: LayoutConstraints | undefined,
  main: { min?: number; max?: number },
  cross: { min?: number; max?: number } = {},
): LayoutConstraints | undefined {
  if (
    constraints == null &&
    main.min == null &&
    main.max == null &&
    cross.min == null &&
    cross.max == null
  ) {
    return undefined;
  }

  const next: LayoutConstraints = {
    ...constraints,
  };
  if (axis === "row") {
    next.minWidth = main.min;
    next.maxWidth = main.max;
    next.minHeight = cross.min;
    next.maxHeight = cross.max;
  } else {
    next.minHeight = main.min;
    next.maxHeight = main.max;
    next.minWidth = cross.min;
    next.maxWidth = cross.max;
  }
  return next;
}

function clampToConstraints(value: number, min?: number, max?: number): number {
  let result = value;
  if (min != null) {
    result = Math.max(result, min);
  }
  if (max != null) {
    result = Math.min(result, max);
  }
  return result;
}

function getCrossAlignment(alignSelf: CrossAxisAlignment | "auto" | undefined, alignItems: CrossAxisAlignment): CrossAxisAlignment {
  if (alignSelf == null || alignSelf === "auto") {
    return alignItems;
  }
  return alignSelf;
}

function getJustifySpacing(
  justifyContent: NonNullable<FlexContainerOptions["justifyContent"]>,
  freeSpace: number,
  itemCount: number,
  gap: number,
): { leading: number; between: number } {
  switch (justifyContent) {
    case "center":
      return { leading: freeSpace / 2, between: gap };
    case "end":
      return { leading: freeSpace, between: gap };
    case "space-between":
      return {
        leading: 0,
        between: itemCount > 1 ? gap + freeSpace / (itemCount - 1) : gap,
      };
    case "space-around":
      return {
        leading: itemCount > 0 ? freeSpace / itemCount / 2 : 0,
        between: itemCount > 0 ? gap + freeSpace / itemCount : gap,
      };
    case "space-evenly":
      return {
        leading: itemCount > 0 ? freeSpace / (itemCount + 1) : 0,
        between: itemCount > 0 ? gap + freeSpace / (itemCount + 1) : gap,
      };
    case "start":
    default:
      return { leading: 0, between: gap };
  }
}

function getCrossOffset(align: CrossAxisAlignment, frameCross: number, contentCross: number): number {
  switch (align) {
    case "center":
      return (frameCross - contentCross) / 2;
    case "end":
      return frameCross - contentCross;
    case "stretch":
    case "start":
    default:
      return 0;
  }
}

function createRectFromAxis(axis: Axis, main: number, cross: number, mainSize: number, crossSize: number) {
  return axis === "row"
    ? createRect(main, cross, mainSize, crossSize)
    : createRect(cross, main, crossSize, mainSize);
}

type FlexMeasurement<C extends CanvasRenderingContext2D> = {
  child: Node<C>;
  item: FlexItemOptions;
  measured: Box;
  constraints?: LayoutConstraints;
  grow: number;
  effectiveAlign: CrossAxisAlignment;
  stretch: boolean;
  frameMain: number;
  frameCross: number;
};

export abstract class Group<C extends CanvasRenderingContext2D> implements Node<C> {
  constructor(readonly children: Node<C>[]) {
    for (const child of children) {
      registerNodeParent(child, this);
    }
  }

  abstract measure(ctx: Context<C>): Box;
  abstract draw(ctx: Context<C>, x: number, y: number): boolean;
  abstract hittest(ctx: Context<C>, test: HitTest): boolean;

  get flex(): boolean {
    return this.children.some((item) => item.flex);
  }
}

export class VStack<C extends CanvasRenderingContext2D> extends Group<C> {
  constructor(
    children: Node<C>[],
    readonly options: { gap?: number; alignment?: "left" | "center" | "right"; expand?: boolean } = {},
  ) {
    super(children);
  }

  measure(ctx: Context<C>): Box {
    return measureFlexLayout(
      this,
      this.children,
      {
        direction: "column",
        gap: this.options.gap,
        alignItems: toTextAlign(this.options.alignment ?? ctx.alignment) === "start"
          ? "start"
          : toTextAlign(this.options.alignment ?? ctx.alignment) === "center"
            ? "center"
            : "end",
        expandMain: this.options.expand ?? true,
      },
      ctx,
    );
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return drawLayoutChildren(this, ctx, x, y);
  }

  private drawLegacy(ctx: Context<C>, x: number, y: number): boolean {
    let result = false;
    const { width: fullWidth } = ctx.measureNode(this, ctx.constraints);
    const alignment = this.options.alignment ?? ctx.alignment;
    if (this.options.alignment != null) {
      ctx.alignment = this.options.alignment;
    }

    for (const [index, child] of this.children.entries()) {
      if (this.options.gap != null && index !== 0) {
        y += this.options.gap;
      }
      const childConstraints = ctx.constraints
        ? {
            ...ctx.constraints,
          }
        : undefined;
      const { width, height } = shallow(ctx).measureNode(child, childConstraints);
      const curCtx = shallow(ctx);
      let requestRedraw: boolean;
      if (alignment === "right") {
        requestRedraw = child.draw(curCtx, x + fullWidth - width, y);
      } else if (alignment === "center") {
        requestRedraw = child.draw(curCtx, x + (fullWidth - width) / 2, y);
      } else {
        requestRedraw = child.draw(curCtx, x, y);
      }
      result ||= requestRedraw;
      y += height;
    }
    return result;
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    return hittestLayoutChildren(this, ctx, test, "contentBox");
  }

  private hittestLegacy(ctx: Context<C>, test: HitTest): boolean {
    let y = 0;
    const { width: fullWidth } = ctx.measureNode(this, ctx.constraints);
    const alignment = this.options.alignment ?? ctx.alignment;
    if (this.options.alignment != null) {
      ctx.alignment = this.options.alignment;
    }

    for (const [index, child] of this.children.entries()) {
      if (this.options.gap != null && index !== 0) {
        y += this.options.gap;
      }

      const childConstraints = ctx.constraints
        ? {
            ...ctx.constraints,
          }
        : undefined;
      const { width, height } = shallow(ctx).measureNode(child, childConstraints);
      const curCtx = shallow(ctx);
      if (test.y >= y && test.y < y + height) {
        let x: number;
        if (alignment === "right") {
          x = test.x - fullWidth + width;
        } else if (alignment === "center") {
          x = test.x - (fullWidth - width) / 2;
        } else {
          x = test.x;
        }
        if (x < 0 || x >= width) {
          return false;
        }
        return child.hittest(
          curCtx,
          shallowMerge(test, {
            x,
            y: test.y - y,
          }),
        );
      }
      y += height;
    }
    return false;
  }
}

export class HStack<C extends CanvasRenderingContext2D> extends Group<C> {
  constructor(
    readonly children: Node<C>[],
    readonly options: { reverse?: boolean; gap?: number; expand?: boolean } = {},
  ) {
    super(children);
  }

  measure(ctx: Context<C>): Box {
    return measureFlexLayout(
      this,
      this.children,
      {
        direction: "row",
        gap: this.options.gap,
        reverse: this.options.reverse ?? ctx.reverse,
        expandMain: this.options.expand ?? true,
      },
      ctx,
    );
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return drawLayoutChildren(this, ctx, x, y);
  }

  private drawLegacy(ctx: Context<C>, x: number, y: number): boolean {
    let result = false;
    const reverse = this.options.reverse ?? ctx.reverse;
    if (this.options.reverse) {
      ctx.reverse = this.options.reverse;
    }

    if (reverse) {
      x += ctx.measureNode(this, ctx.constraints).width;
      for (const [index, child] of this.children.entries()) {
        const gap = this.options.gap != null && index !== 0 ? this.options.gap : undefined;
        if (gap) {
          x -= gap;
        }
        // 传递约束给子节点
        const childConstraints = ctx.constraints
          ? {
              ...ctx.constraints,
              minWidth: ctx.constraints.minWidth != null ? ctx.constraints.minWidth - (ctx.measureNode(this, ctx.constraints).width - x) : undefined,
              maxWidth: ctx.constraints.maxWidth != null ? ctx.constraints.maxWidth - (ctx.measureNode(this, ctx.constraints).width - x) : undefined,
            }
          : undefined;
        const curCtx = shallow(ctx);
        if (childConstraints != null) {
          curCtx.constraints = childConstraints;
          if (childConstraints.maxWidth != null) {
            curCtx.remainingWidth = childConstraints.maxWidth;
          }
        }
        const { width } = curCtx.measureNode(child, childConstraints);
        x -= width;
        const requestRedraw = child.draw(curCtx, x, y);
        result ||= requestRedraw;
      }
    } else {
      for (const [index, child] of this.children.entries()) {
        const gap = this.options.gap != null && index !== 0 ? this.options.gap : undefined;
        if (gap) {
          x += gap;
        }
        // 传递约束给子节点
        const childConstraints = ctx.constraints
          ? {
              ...ctx.constraints,
              minWidth: ctx.constraints.minWidth != null ? ctx.constraints.minWidth - x : undefined,
              maxWidth: ctx.constraints.maxWidth != null ? ctx.constraints.maxWidth - x : undefined,
            }
          : undefined;
        const curCtx = shallow(ctx);
        if (childConstraints != null) {
          curCtx.constraints = childConstraints;
          if (childConstraints.maxWidth != null) {
            curCtx.remainingWidth = childConstraints.maxWidth;
          }
        }
        const requestRedraw = child.draw(curCtx, x, y);
        result ||= requestRedraw;
        const { width } = curCtx.measureNode(child, childConstraints);
        x += width;
      }
    }

    return result;
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    return hittestLayoutChildren(this, ctx, test, "contentBox");
  }

  private hittestLegacy(ctx: Context<C>, test: HitTest): boolean {
    const reverse = this.options.reverse ?? ctx.reverse;
    if (this.options.reverse) {
      ctx.reverse = this.options.reverse;
    }

    if (reverse) {
      let x = ctx.measureNode(this, ctx.constraints).width;
      for (const [index, child] of this.children.entries()) {
        const gap = this.options.gap != null && index !== 0 ? this.options.gap : undefined;
        if (gap) {
          x -= gap;
          ctx.remainingWidth -= gap;
        }
        const { width, height } = shallow(ctx).measureNode(child);
        x -= width;
        if (x <= test.x && test.x < x + width) {
          if (test.y >= height) {
            return false;
          }
          return child.hittest(
            shallow(ctx),
            shallowMerge(test, {
              x: test.x - x,
            }),
          );
        }
        ctx.remainingWidth -= width;
      }
    } else {
      let x = 0;
      for (const [index, child] of this.children.entries()) {
        const gap = this.options.gap != null && index !== 0 ? this.options.gap : undefined;
        if (gap) {
          x += gap;
          ctx.remainingWidth -= gap;
        }
        const { width, height } = shallow(ctx).measureNode(child);
        if (x <= test.x && test.x < x + width) {
          if (test.y >= height) {
            return false;
          }
          return child.hittest(
            shallow(ctx),
            shallowMerge(test, {
              x: test.x - x,
            }),
          );
        }
        x += width;
        ctx.remainingWidth -= width;
      }
    }

    return false;
  }
}

export class Wrapper<C extends CanvasRenderingContext2D> implements Node<C> {
  #inner: Node<C>;

  constructor(inner: Node<C>) {
    this.#inner = inner;
    registerNodeParent(this.#inner, this);
  }

  get inner(): Node<C> {
    return this.#inner;
  }

  set inner(newNode: Node<C>) {
    if (newNode === this.#inner) {
      return;
    }
    unregisterNodeParent(this.#inner);
    this.#inner = newNode;
    registerNodeParent(newNode, this);
  }

  get flex(): boolean {
    return this.inner.flex;
  }

  measure(ctx: Context<C>): Box {
    return this.inner.measure(ctx);
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return this.inner.draw(ctx, x, y);
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    return this.inner.hittest(ctx, test);
  }
}

export class PaddingBox<C extends CanvasRenderingContext2D> extends Wrapper<C> {
  constructor(
    inner: Node<C>,
    readonly padding: {
      top?: number;
      bottom?: number;
      left?: number;
      right?: number;
    } = {},
  ) {
    super(inner);
  }

  get #top(): number {
    return this.padding.top ?? 0;
  }

  get #bottom(): number {
    return this.padding.bottom ?? 0;
  }

  get #left(): number {
    return this.padding.left ?? 0;
  }

  get #right(): number {
    return this.padding.right ?? 0;
  }

  measure(ctx: Context<C>): Box {
    const paddingLeft = this.#left;
    const paddingRight = this.#right;
    // 创建子节点的约束
    const childConstraints = ctx.constraints
      ? {
          ...ctx.constraints,
          minWidth: ctx.constraints.minWidth != null ? ctx.constraints.minWidth - paddingLeft - paddingRight : undefined,
          maxWidth: ctx.constraints.maxWidth != null ? ctx.constraints.maxWidth - paddingLeft - paddingRight : undefined,
        }
      : undefined;
    const { width, height } = ctx.measureNode(this.inner, childConstraints);
    const containerBox = createRect(0, 0, width + paddingLeft + paddingRight, height + this.#top + this.#bottom);
    const childRect = createRect(paddingLeft, this.#top, width, height);
    ctx.setLayoutResult(
      this,
      {
        containerBox,
        contentBox: childRect,
        children: [
          {
            node: this.inner,
            rect: childRect,
            contentBox: childRect,
            constraints: childConstraints,
          },
        ],
        constraints: ctx.constraints,
      },
      ctx.constraints,
    );
    return {
      width: containerBox.width,
      height: containerBox.height,
    };
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    let layoutResult = ctx.getLayoutResult(this, ctx.constraints);
    if (!layoutResult) {
      ctx.measureNode(this, ctx.constraints);
      layoutResult = ctx.getLayoutResult(this, ctx.constraints);
    }
    if (!layoutResult) {
      return this.inner.draw(ctx, x + this.#left, y + this.#top);
    }

    const childResult = getSingleChildLayout(layoutResult);
    if (!childResult) {
      return false;
    }

    return childResult.node.draw(
      withConstraints(ctx, childResult.constraints),
      x + childResult.rect.x,
      y + childResult.rect.y,
    );
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    let layoutResult = ctx.getLayoutResult(this, ctx.constraints);
    if (!layoutResult) {
      ctx.measureNode(this, ctx.constraints);
      layoutResult = ctx.getLayoutResult(this, ctx.constraints);
    }
    if (!layoutResult) {
      return false;
    }

    const hit = findChildAtPoint(layoutResult.children, test.x, test.y, "rect");
    if (!hit) {
      return false;
    }

    return hit.child.node.hittest(
      withConstraints(ctx, hit.child.constraints),
      shallowMerge(test, {
        x: hit.localX,
        y: hit.localY,
      }),
    );
  }
}

export class Place<C extends CanvasRenderingContext2D> extends Wrapper<C> {
  constructor(
    inner: Node<C>,
    readonly options: {
      align?: TextAlign;
      expand?: boolean;
    } = {},
  ) {
    super(inner);
  }

  measure(ctx: Context<C>): Box {
    const availableWidth = resolveAvailableWidth(ctx);
    const expand = this.options.expand ?? true;
    const childConstraints = ctx.constraints
      ? {
          ...ctx.constraints,
        }
      : expand && Number.isFinite(availableWidth)
        ? { maxWidth: availableWidth }
        : undefined;
    const childBox = ctx.measureNode(this.inner, childConstraints);
    let width = expand ? availableWidth : childBox.width;
    if (ctx.constraints?.minWidth != null) {
      width = Math.max(width, ctx.constraints.minWidth);
    }
    if (ctx.constraints?.maxWidth != null) {
      width = Math.min(width, ctx.constraints.maxWidth);
    }

    const align = this.options.align ?? "start";
    const childRect = createRect(resolveHorizontalOffset(align, width, childBox.width), 0, childBox.width, childBox.height);

    ctx.setLayoutResult(
      this,
      {
        containerBox: createRect(0, 0, width, childBox.height),
        contentBox: childRect,
        children: [
          {
            node: this.inner,
            rect: childRect,
            contentBox: createRect(0, 0, childBox.width, childBox.height),
            constraints: childConstraints,
          },
        ],
        constraints: ctx.constraints,
      },
      ctx.constraints,
    );

    return {
      width,
      height: childBox.height,
    };
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    let layoutResult = ctx.getLayoutResult(this, ctx.constraints);
    if (!layoutResult) {
      ctx.measureNode(this, ctx.constraints);
      layoutResult = ctx.getLayoutResult(this, ctx.constraints);
    }
    if (!layoutResult) {
      return this.inner.draw(ctx, x, y);
    }

    const childResult = getSingleChildLayout(layoutResult);
    if (!childResult) {
      return false;
    }
    const childCtx = withConstraints(ctx, childResult.constraints);
    return childResult.node.draw(childCtx, x + childResult.rect.x, y + childResult.rect.y);
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    let layoutResult = ctx.getLayoutResult(this, ctx.constraints);
    if (!layoutResult) {
      ctx.measureNode(this, ctx.constraints);
      layoutResult = ctx.getLayoutResult(this, ctx.constraints);
    }
    if (!layoutResult) {
      return false;
    }

    const hit = findChildAtPoint(layoutResult.children, test.x, test.y, "rect");
    if (!hit) {
      return false;
    }

    return hit.child.node.hittest(
      withConstraints(ctx, hit.child.constraints),
      shallowMerge(test, {
        x: hit.localX,
        y: hit.localY,
      }),
    );
  }
}

export class FlexItem<C extends CanvasRenderingContext2D> extends Wrapper<C> {
  constructor(
    inner: Node<C>,
    readonly item: FlexItemOptions = {},
  ) {
    super(inner);
  }
}

/** @deprecated 使用 Place 替代 */
export class AlignBox<C extends CanvasRenderingContext2D> extends Place<C> {
  constructor(
    inner: Node<C>,
    readonly legacyOptions: {
      alignment: Alignment;
    },
  ) {
    super(inner, {
      align: toTextAlign(legacyOptions.alignment),
      expand: true,
    });
  }

  measure(ctx: Context<C>): Box {
    ctx.alignment = this.legacyOptions.alignment;
    return super.measure(ctx);
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    ctx.alignment = this.legacyOptions.alignment;
    return super.draw(ctx, x, y);
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    ctx.alignment = this.legacyOptions.alignment;
    return super.hittest(ctx, test);
  }
}

function readFlexItemOptions<C extends CanvasRenderingContext2D>(child: Node<C>): FlexItemOptions {
  if (child instanceof FlexItem) {
    return child.item;
  }
  if (child.flex) {
    return { grow: 1 };
  }
  return {};
}

function ensureLayoutResult<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
) {
  let layoutResult = ctx.getLayoutResult(node, ctx.constraints);
  if (!layoutResult) {
    ctx.measureNode(node, ctx.constraints);
    layoutResult = ctx.getLayoutResult(node, ctx.constraints);
  }
  return layoutResult;
}

function drawLayoutChildren<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  x: number,
  y: number,
): boolean {
  const layoutResult = ensureLayoutResult(node, ctx);
  if (!layoutResult) {
    return false;
  }

  let result = false;
  for (const childResult of layoutResult.children) {
    result ||= childResult.node.draw(
      withConstraints(ctx, childResult.constraints),
      x + childResult.contentBox.x,
      y + childResult.contentBox.y,
    );
  }
  return result;
}

function hittestLayoutChildren<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  test: HitTest,
  box: "rect" | "contentBox" = "contentBox",
): boolean {
  const layoutResult = ensureLayoutResult(node, ctx);
  if (!layoutResult) {
    return false;
  }

  const hit = findChildAtPoint(layoutResult.children, test.x, test.y, box);
  if (!hit) {
    return false;
  }

  return hit.child.node.hittest(
    withConstraints(ctx, hit.child.constraints),
    shallowMerge(test, {
      x: hit.localX,
      y: hit.localY,
    }),
  );
}

function measureFlexLayout<C extends CanvasRenderingContext2D>(
  owner: Node<C>,
  children: Node<C>[],
  options: FlexContainerOptions,
  ctx: Context<C>,
): Box {
  const axis = options.direction ?? "row";
  const gap = options.gap ?? 0;
  const justifyContent = options.justifyContent ?? "start";
  const alignItems = options.alignItems ?? "start";
  const reverse = options.reverse ?? false;
  const expandMain = options.expandMain ?? true;
  const orderedChildren = reverse ? [...children].reverse() : children;
  const maxMain = getMaxMain(axis, ctx.constraints);
  const minMain = getMinMain(axis, ctx.constraints);
  const maxCross = getMaxCross(axis, ctx.constraints);
  const minCross = getMinCross(axis, ctx.constraints);
  const gapTotal = orderedChildren.length > 1 ? gap * (orderedChildren.length - 1) : 0;
  const finiteMain = maxMain != null;
  const finiteCross = maxCross != null;
  const availableMain = finiteMain ? Math.max(0, maxMain - gapTotal) : undefined;
  let consumedMain = 0;
  let totalGrow = 0;
  const measurements = new Map<Node<C>, FlexMeasurement<C>>();

  for (const child of orderedChildren) {
    const item = readFlexItemOptions(child);
    const grow = item.grow ?? 0;
    totalGrow += grow;
    if (grow > 0 && finiteMain) {
      continue;
    }

    const effectiveAlign = getCrossAlignment(item.alignSelf, alignItems);
    const stretch = effectiveAlign === "stretch" && finiteCross;
    const childConstraints = createAxisConstraints(
      axis,
      ctx.constraints,
      {
        max: finiteMain && availableMain != null ? Math.max(0, availableMain - consumedMain) : maxMain,
      },
      stretch
        ? {
            min: maxCross,
            max: maxCross,
          }
        : {
            min: undefined,
            max: maxCross,
          },
    );
    const measured = ctx.measureNode(child, childConstraints);
    const frameMain = getMainSize(axis, measured);
    const frameCross = stretch && maxCross != null ? maxCross : getCrossSize(axis, measured);
    measurements.set(child, {
      child,
      item,
      measured,
      constraints: childConstraints,
      grow,
      effectiveAlign,
      stretch,
      frameMain,
      frameCross,
    });
    consumedMain += frameMain;
  }

  const remainingMain = finiteMain && availableMain != null ? Math.max(0, availableMain - consumedMain) : undefined;

  for (const child of orderedChildren) {
    if (measurements.has(child)) {
      continue;
    }
    const item = readFlexItemOptions(child);
    const grow = item.grow ?? 0;
    const effectiveAlign = getCrossAlignment(item.alignSelf, alignItems);
    const stretch = effectiveAlign === "stretch" && finiteCross;
    const allocatedMain = finiteMain && remainingMain != null && totalGrow > 0 ? (remainingMain * grow) / totalGrow : undefined;
    const childConstraints = createAxisConstraints(
      axis,
      ctx.constraints,
      {
        max: allocatedMain,
      },
      stretch
        ? {
            min: maxCross,
            max: maxCross,
          }
        : {
            min: undefined,
            max: maxCross,
          },
    );
    const measured = ctx.measureNode(child, childConstraints);
    const measuredMain = getMainSize(axis, measured);
    const frameMain = allocatedMain ?? measuredMain;
    const frameCross = stretch && maxCross != null ? maxCross : getCrossSize(axis, measured);
    measurements.set(child, {
      child,
      item,
      measured,
      constraints: childConstraints,
      grow,
      effectiveAlign,
      stretch,
      frameMain,
      frameCross,
    });
  }

  let contentMain = gapTotal;
  let contentCross = 0;
  for (const child of orderedChildren) {
    const measurement = measurements.get(child)!;
    contentMain += measurement.frameMain;
    contentCross = Math.max(contentCross, measurement.frameCross);
  }

  const containerMain = finiteMain && expandMain
    ? Math.max(maxMain!, contentMain)
    : clampToConstraints(contentMain, minMain, maxMain);
  const containerCross = finiteCross ? Math.max(maxCross!, contentCross) : clampToConstraints(contentCross, minCross, maxCross);
  const freeSpace = Math.max(0, containerMain - contentMain);
  const spacing = getJustifySpacing(justifyContent, freeSpace, orderedChildren.length, gap);
  const childResults: ChildLayoutResult<C>[] = [];
  let cursor = spacing.leading;

  for (const child of orderedChildren) {
    const measurement = measurements.get(child)!;
    const frameCross = measurement.stretch && finiteCross ? containerCross : measurement.frameCross;
    const contentMainSize = getMainSize(axis, measurement.measured);
    const contentCrossSize = getCrossSize(axis, measurement.measured);
    const rectCross = measurement.stretch ? 0 : getCrossOffset(measurement.effectiveAlign, containerCross, frameCross);
    const contentCrossOffset = rectCross + getCrossOffset(measurement.effectiveAlign, frameCross, contentCrossSize);
    const rect = createRectFromAxis(axis, cursor, rectCross, measurement.frameMain, frameCross);
    const contentBox = createRectFromAxis(axis, cursor, contentCrossOffset, contentMainSize, contentCrossSize);

    childResults.push({
      node: child,
      rect,
      contentBox,
      constraints: measurement.constraints,
    });
    cursor += measurement.frameMain + spacing.between;
  }

  const containerBox = axis === "row"
    ? createRect(0, 0, containerMain, containerCross)
    : createRect(0, 0, containerCross, containerMain);

  ctx.setLayoutResult(
    owner,
    {
      containerBox,
      contentBox: axis === "row"
        ? createRect(0, 0, contentMain, contentCross)
        : createRect(0, 0, contentCross, contentMain),
      children: childResults,
      constraints: ctx.constraints,
    },
    ctx.constraints,
  );

  return {
    width: containerBox.width,
    height: containerBox.height,
  };
}

export class Flex<C extends CanvasRenderingContext2D> extends Group<C> {
  constructor(
    children: Node<C>[],
    readonly options: FlexContainerOptions = {},
  ) {
    super(children);
  }

  measure(ctx: Context<C>): Box {
    return measureFlexLayout(this, this.children, this.options, ctx);
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return drawLayoutChildren(this, ctx, x, y);
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    return hittestLayoutChildren(this, ctx, test, "contentBox");
  }
}

export class MultilineText<C extends CanvasRenderingContext2D> implements Node<C> {
  constructor(
    readonly text: string,
    readonly options: {
      lineHeight: number;
      font: string;
      alignment: "left" | "center" | "right";
      style: DynValue<C, string>;
    },
  ) {}

  get flex(): boolean {
    return true;
  }

  measure(ctx: Context<C>): Box {
    return ctx.with((g) => {
      g.font = this.options.font;
      // 优先使用约束中的 maxWidth，否则回退到 remainingWidth
      const maxWidth = ctx.constraints?.maxWidth ?? ctx.remainingWidth;
      const { width, lines } = layoutText(ctx, this.text, maxWidth);
      return { width, height: lines.length * this.options.lineHeight };
    });
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return ctx.with((g) => {
      g.font = this.options.font;
      g.fillStyle = ctx.resolveDynValue(this.options.style);
      const maxWidth = ctx.constraints?.maxWidth ?? ctx.remainingWidth;
      const { lines } = layoutText(ctx, this.text, maxWidth);
      switch (this.options.alignment) {
        case "left":
          for (const { text, shift } of lines) {
            g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
            y += this.options.lineHeight;
          }
          break;
        case "right":
          const rightWidth = Math.max(...lines.map(l => l.width));
          x += rightWidth;
          g.textAlign = "right";
          for (const { text, shift } of lines) {
            g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
            y += this.options.lineHeight;
          }
          break;
        case "center":
          const centerWidth = Math.max(...lines.map(l => l.width));
          x += centerWidth / 2;
          g.textAlign = "center";
          for (const { text, shift } of lines) {
            g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
            y += this.options.lineHeight;
          }
          break;
      }
      return false;
    });
  }

  hittest(_ctx: Context<C>, _test: HitTest): boolean {
    return false;
  }
}

export class Text<C extends CanvasRenderingContext2D> implements Node<C> {
  constructor(
    readonly text: string,
    readonly options: {
      lineHeight: number;
      font: string;
      style: DynValue<C, string>;
    },
  ) {}

  get flex(): boolean {
    return false;
  }

  measure(ctx: Context<C>): Box {
    return ctx.with((g) => {
      g.font = this.options.font;
      // 优先使用约束中的 maxWidth，否则回退到 remainingWidth
      const maxWidth = ctx.constraints?.maxWidth ?? ctx.remainingWidth;
      const { width, text, shift } = layoutFirstLine(ctx, this.text, maxWidth);
      return { width, height: this.options.lineHeight };
    });
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return ctx.with((g) => {
      g.font = this.options.font;
      g.fillStyle = ctx.resolveDynValue(this.options.style);
      const maxWidth = ctx.constraints?.maxWidth ?? ctx.remainingWidth;
      const { text, shift } = layoutFirstLine(ctx, this.text, maxWidth);
      g.fillText(text, x, y + (this.options.lineHeight + shift) / 2);
      return false;
    });
  }

  hittest(_ctx: Context<C>, _test: HitTest): boolean {
    return false;
  }
}

export class Fixed<C extends CanvasRenderingContext2D> implements Node<C> {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  get flex(): boolean {
    return false;
  }

  measure(_ctx: Context<C>): Box {
    return { width: this.width, height: this.height };
  }

  draw(_ctx: Context<C>, _x: number, _y: number): boolean {
    return false;
  }

  hittest(_ctx: Context<C>, _test: HitTest): boolean {
    return false;
  }
}
