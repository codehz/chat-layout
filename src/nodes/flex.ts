import { computeContentBox, createRect } from "../layout";
import type {
  Axis,
  Box,
  ChildLayoutResult,
  Context,
  CrossAxisAlignment,
  FlexContainerOptions,
  FlexItemOptions,
  HitTest,
  LayoutConstraints,
  Node,
} from "../types";
import { Group, measureNodeMinContent, Wrapper } from "./base";
import { drawLayoutChildren, hittestLayoutChildren, writeLayoutResult } from "./shared";

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
  initialConstraints?: LayoutConstraints;
  finalConstraints?: LayoutConstraints;
  allocatedMain?: number;
  grow: number;
  effectiveAlign: CrossAxisAlignment;
  stretch: boolean;
  frameMain: number;
  frameCross: number;
};

type MeasuredLayout<C extends CanvasRenderingContext2D> = {
  box: Box;
  layout: {
    containerBox: ChildLayoutResult<C>["rect"];
    contentBox: ChildLayoutResult<C>["contentBox"];
    children: ChildLayoutResult<C>[];
    constraints?: LayoutConstraints;
  };
};

function readFlexItemOptions<C extends CanvasRenderingContext2D>(child: Node<C>): FlexItemOptions {
  if (child instanceof FlexItem) {
    return child.item;
  }
  return {};
}

export function computeFlexLayout<C extends CanvasRenderingContext2D>(
  children: readonly Node<C>[],
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

export class FlexItem<C extends CanvasRenderingContext2D> extends Wrapper<C> {
  constructor(
    inner: Node<C>,
    readonly item: FlexItemOptions = {},
  ) {
    super(inner);
  }
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

  measureMinContent(ctx: Context<C>): Box {
    const axis = this.options.direction ?? "row";
    const gap = this.options.gap ?? 0;
    const orderedChildren = this.options.reverse ? [...this.children].reverse() : this.children;
    const gapTotal = orderedChildren.length > 1 ? gap * (orderedChildren.length - 1) : 0;
    const childConstraints = createAxisConstraints(
      axis,
      ctx.constraints,
      {
        min: undefined,
        max: undefined,
      },
      {
        min: undefined,
        max: getMaxCross(axis, ctx.constraints),
      },
    );

    let width = axis === "row" ? gapTotal : 0;
    let height = axis === "column" ? gapTotal : 0;

    for (const child of orderedChildren) {
      const measured = measureNodeMinContent(ctx, child, childConstraints);
      if (axis === "row") {
        width += measured.width;
        height = Math.max(height, measured.height);
      } else {
        width = Math.max(width, measured.width);
        height += measured.height;
      }
    }

    return { width, height };
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    return drawLayoutChildren(this, ctx, x, y);
  }

  hittest(ctx: Context<C>, test: HitTest): boolean {
    return hittestLayoutChildren(this, ctx, test, "contentBox");
  }
}
