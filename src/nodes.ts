import type {
  Axis,
  Box,
  ChildLayoutResult,
  Context,
  CrossAxisAlignment,
  DynValue,
  FlexLayoutResult,
  FlexContainerOptions,
  FlexItemOptions,
  HitTest,
  LayoutConstraints,
  Node,
  TextWhitespaceMode,
  TextAlign,
} from "./types";
import { computeContentBox, createRect, findChildAtPoint, getSingleChildLayout } from "./layout";
import { layoutFirstLine, layoutFirstLineIntrinsic, layoutText, layoutTextIntrinsic } from "./text";
import { shallow, shallowMerge } from "./utils";
import { attachNodeToParent, attachNodesToParent, replaceNodeParent } from "./registry";

function withConstraints<C extends CanvasRenderingContext2D>(
  ctx: Context<C>,
  constraints: LayoutConstraints | undefined,
): Context<C> {
  const next = shallow(ctx);
  next.constraints = constraints;
  return next;
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

function shrinkConstraint(value: number | undefined, padding: number): number | undefined {
  if (value == null) {
    return undefined;
  }
  return Math.max(0, value - padding);
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
  initialConstraints?: LayoutConstraints;
  finalConstraints?: LayoutConstraints;
  allocatedMain?: number;
  grow: number;
  effectiveAlign: CrossAxisAlignment;
  stretch: boolean;
  frameMain: number;
  frameCross: number;
};

type LayoutCacheAccess<C extends CanvasRenderingContext2D> = {
  getLayoutResult(node: Node<C>, constraints?: LayoutConstraints): FlexLayoutResult<C> | undefined;
  setLayoutResult(node: Node<C>, result: FlexLayoutResult<C>, constraints?: LayoutConstraints): void;
};

type LayoutContext<C extends CanvasRenderingContext2D> = Context<C> & LayoutCacheAccess<C>;

type MeasuredLayout<C extends CanvasRenderingContext2D> = {
  box: Box;
  layout: FlexLayoutResult<C>;
};

function getLayoutContext<C extends CanvasRenderingContext2D>(ctx: Context<C>): LayoutContext<C> {
  return ctx as LayoutContext<C>;
}

function readLayoutResult<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
): FlexLayoutResult<C> | undefined {
  return getLayoutContext(ctx).getLayoutResult(node, ctx.constraints);
}

function writeLayoutResult<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
  result: FlexLayoutResult<C>,
): void {
  getLayoutContext(ctx).setLayoutResult(node, result, ctx.constraints);
}

export abstract class Group<C extends CanvasRenderingContext2D> implements Node<C> {
  constructor(readonly children: Node<C>[]) {
    attachNodesToParent(children, this);
  }

  abstract measure(ctx: Context<C>): Box;
  abstract draw(ctx: Context<C>, x: number, y: number): boolean;
  abstract hittest(ctx: Context<C>, test: HitTest): boolean;
}

export class Wrapper<C extends CanvasRenderingContext2D> implements Node<C> {
  #inner: Node<C>;

  constructor(inner: Node<C>) {
    this.#inner = inner;
    attachNodeToParent(this.#inner, this);
  }

  get inner(): Node<C> {
    return this.#inner;
  }

  set inner(newNode: Node<C>) {
    if (newNode === this.#inner) {
      return;
    }
    replaceNodeParent(this.#inner, newNode, this);
    this.#inner = newNode;
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
    const paddingTop = this.#top;
    const paddingBottom = this.#bottom;
    const horizontalPadding = paddingLeft + paddingRight;
    const verticalPadding = paddingTop + paddingBottom;
    // 创建子节点的约束
    const childConstraints = ctx.constraints
      ? {
          ...ctx.constraints,
          minWidth: shrinkConstraint(ctx.constraints.minWidth, horizontalPadding),
          maxWidth: shrinkConstraint(ctx.constraints.maxWidth, horizontalPadding),
          minHeight: shrinkConstraint(ctx.constraints.minHeight, verticalPadding),
          maxHeight: shrinkConstraint(ctx.constraints.maxHeight, verticalPadding),
        }
      : undefined;
    const { width, height } = ctx.measureNode(this.inner, childConstraints);
    const containerBox = createRect(
      0,
      0,
      clampToConstraints(width + horizontalPadding, ctx.constraints?.minWidth, ctx.constraints?.maxWidth),
      clampToConstraints(height + verticalPadding, ctx.constraints?.minHeight, ctx.constraints?.maxHeight),
    );
    const childRect = createRect(paddingLeft, paddingTop, width, height);
    writeLayoutResult(this, ctx, {
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
    });
    return {
      width: containerBox.width,
      height: containerBox.height,
    };
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    const layoutResult = readLayoutResult(this, ctx);
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
    const layoutResult = readLayoutResult(this, ctx);
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
    const availableWidth = ctx.constraints?.maxWidth;
    const expand = this.options.expand ?? true;
    const childConstraints = ctx.constraints
      ? {
          ...ctx.constraints,
        }
      : undefined;
    const childBox = ctx.measureNode(this.inner, childConstraints);
    let width = expand && availableWidth != null ? availableWidth : childBox.width;
    if (ctx.constraints?.minWidth != null) {
      width = Math.max(width, ctx.constraints.minWidth);
    }
    if (ctx.constraints?.maxWidth != null) {
      width = Math.min(width, ctx.constraints.maxWidth);
    }

    const align = this.options.align ?? "start";
    const childRect = createRect(resolveHorizontalOffset(align, width, childBox.width), 0, childBox.width, childBox.height);

    writeLayoutResult(this, ctx, {
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
    });

    return {
      width,
      height: childBox.height,
    };
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    const layoutResult = readLayoutResult(this, ctx);
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
    const layoutResult = readLayoutResult(this, ctx);
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

function readFlexItemOptions<C extends CanvasRenderingContext2D>(child: Node<C>): FlexItemOptions {
  if (child instanceof FlexItem) {
    return child.item;
  }
  return {};
}

function ensureLayoutResult<C extends CanvasRenderingContext2D>(
  node: Node<C>,
  ctx: Context<C>,
) {
  return readLayoutResult(node, ctx);
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

function computeFlexLayout<C extends CanvasRenderingContext2D>(
  children: Node<C>[],
  options: FlexContainerOptions,
  constraints: LayoutConstraints | undefined,
  measureChild: (node: Node<C>, constraints?: LayoutConstraints) => Box,
): MeasuredLayout<C> {
  const axis = options.direction ?? "row";
  const gap = options.gap ?? 0;
  const justifyContent = options.justifyContent ?? "start";
  const alignItems = options.alignItems ?? "start";
  const reverse = options.reverse ?? false;
  const mainAxisSize = options.mainAxisSize ?? "fill";
  const orderedChildren = reverse ? [...children].reverse() : children;
  const maxMain = getMaxMain(axis, constraints);
  const minMain = getMinMain(axis, constraints);
  const maxCross = getMaxCross(axis, constraints);
  const minCross = getMinCross(axis, constraints);
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
    const stretch = effectiveAlign === "stretch";
    const childConstraints = createAxisConstraints(
      axis,
      constraints,
      {
        max: finiteMain && availableMain != null ? Math.max(0, availableMain - consumedMain) : maxMain,
      },
      {
        min: undefined,
        max: maxCross,
      },
    );
    const measured = measureChild(child, childConstraints);
    const frameMain = getMainSize(axis, measured);
    const frameCross = getCrossSize(axis, measured);
    measurements.set(child, {
      child,
      item,
      measured,
      initialConstraints: childConstraints,
      finalConstraints: childConstraints,
      allocatedMain: undefined,
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
    const stretch = effectiveAlign === "stretch";
    const allocatedMain = finiteMain && remainingMain != null && totalGrow > 0 ? (remainingMain * grow) / totalGrow : undefined;
    const childConstraints = createAxisConstraints(
      axis,
      constraints,
      {
        max: allocatedMain,
      },
      {
        min: undefined,
        max: maxCross,
      },
    );
    const measured = measureChild(child, childConstraints);
    const measuredMain = getMainSize(axis, measured);
    const frameMain = allocatedMain ?? measuredMain;
    const frameCross = getCrossSize(axis, measured);
    measurements.set(child, {
      child,
      item,
      measured,
      initialConstraints: childConstraints,
      finalConstraints: childConstraints,
      allocatedMain,
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

  const containerMain = finiteMain && mainAxisSize === "fill"
    ? Math.max(maxMain!, contentMain)
    : clampToConstraints(contentMain, minMain, maxMain);
  const containerCross = clampToConstraints(contentCross, minCross, maxCross);
  if (finiteCross) {
    for (const child of orderedChildren) {
      const measurement = measurements.get(child)!;
      if (!measurement.stretch) {
        continue;
      }

      const finalConstraints = createAxisConstraints(
        axis,
        measurement.initialConstraints,
        {
          min: getMinMain(axis, measurement.initialConstraints),
          max: getMaxMain(axis, measurement.initialConstraints),
        },
        {
          min: containerCross,
          max: containerCross,
        },
      );
      const remeasured = measureChild(child, finalConstraints);
      measurement.measured = remeasured;
      measurement.finalConstraints = finalConstraints;
      measurement.frameCross = containerCross;
      measurement.frameMain = measurement.allocatedMain ?? getMainSize(axis, remeasured);
    }

    contentMain = gapTotal;
    contentCross = 0;
    for (const child of orderedChildren) {
      const measurement = measurements.get(child)!;
      contentMain += measurement.frameMain;
      contentCross = Math.max(contentCross, getCrossSize(axis, measurement.measured));
    }
  }

  const finalContainerMain = finiteMain && mainAxisSize === "fill"
    ? Math.max(maxMain!, contentMain)
    : clampToConstraints(contentMain, minMain, maxMain);
  const freeSpace = Math.max(0, finalContainerMain - contentMain);
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
      constraints: measurement.finalConstraints,
    });
    cursor += measurement.frameMain + spacing.between;
  }

  const containerBox = axis === "row"
    ? createRect(0, 0, finalContainerMain, containerCross)
    : createRect(0, 0, containerCross, finalContainerMain);
  const finalContentBox = childResults.length > 0
    ? computeContentBox(childResults)
    : createRect(0, 0, 0, 0);

  return {
    box: {
      width: containerBox.width,
      height: containerBox.height,
    },
    layout: {
      containerBox,
      contentBox: finalContentBox,
      children: childResults,
      constraints,
    },
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
    const result = computeFlexLayout(this.children, this.options, ctx.constraints, (node, constraints) => ctx.measureNode(node, constraints));
    writeLayoutResult(this, ctx, result.layout);
    return result.box;
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
      whitespace?: TextWhitespaceMode;
    },
  ) {}

  measure(ctx: Context<C>): Box {
    return ctx.with((g) => {
      g.font = this.options.font;
      const maxWidth = ctx.constraints?.maxWidth;
      const { width, lines } = maxWidth == null
        ? layoutTextIntrinsic(ctx, this.text, this.options.whitespace)
        : layoutText(ctx, this.text, maxWidth, this.options.whitespace);
      return { width, height: lines.length * this.options.lineHeight };
    });
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return ctx.with((g) => {
      g.font = this.options.font;
      g.fillStyle = ctx.resolveDynValue(this.options.style);
      const maxWidth = ctx.constraints?.maxWidth;
      const { lines } = maxWidth == null
        ? layoutTextIntrinsic(ctx, this.text, this.options.whitespace)
        : layoutText(ctx, this.text, maxWidth, this.options.whitespace);
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
      whitespace?: TextWhitespaceMode;
    },
  ) {}

  measure(ctx: Context<C>): Box {
    return ctx.with((g) => {
      g.font = this.options.font;
      const maxWidth = ctx.constraints?.maxWidth;
      const { width } = maxWidth == null
        ? layoutFirstLineIntrinsic(ctx, this.text, this.options.whitespace)
        : layoutFirstLine(ctx, this.text, maxWidth, this.options.whitespace);
      return { width, height: this.options.lineHeight };
    });
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return ctx.with((g) => {
      g.font = this.options.font;
      g.fillStyle = ctx.resolveDynValue(this.options.style);
      const maxWidth = ctx.constraints?.maxWidth;
      const { text, shift } = maxWidth == null
        ? layoutFirstLineIntrinsic(ctx, this.text, this.options.whitespace)
        : layoutFirstLine(ctx, this.text, maxWidth, this.options.whitespace);
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
