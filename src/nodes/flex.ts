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

function constraintsEqual(left: LayoutConstraints | undefined, right: LayoutConstraints | undefined): boolean {
  if (left === right) {
    return true;
  }
  if (left == null || right == null) {
    return left == null && right == null;
  }
  return left.minWidth === right.minWidth
    && left.maxWidth === right.maxWidth
    && left.minHeight === right.minHeight
    && left.maxHeight === right.maxHeight;
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

const SHRINK_EPSILON = 1e-6;

type FlexMeasurement<C extends CanvasRenderingContext2D> = {
  child: Node<C>;
  item: FlexItemOptions;
  basisMeasured: Box;
  measured: Box;
  basisConstraints?: LayoutConstraints;
  initialConstraints?: LayoutConstraints;
  finalConstraints?: LayoutConstraints;
  allocatedMain?: number;
  grow: number;
  shrink: number;
  effectiveAlign: CrossAxisAlignment;
  stretch: boolean;
  basis: number;
  minContentMain: number;
  finalMain: number;
  frozen: boolean;
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
  measureChildMinContent: (node: Node<C>, constraints?: LayoutConstraints) => Box,
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
  let totalGrow = 0;
  let totalBasis = 0;
  let nonGrowBasis = 0;
  const measurements = new Map<Node<C>, FlexMeasurement<C>>();
  const basisConstraints = createAxisConstraints(
    axis,
    constraints,
    {
      min: undefined,
      max: undefined,
    },
    {
      min: undefined,
      max: maxCross,
    },
  );

  for (const child of orderedChildren) {
    const item = readFlexItemOptions(child);
    const grow = item.grow ?? 0;
    const shrink = item.shrink ?? 0;
    totalGrow += grow;
    const effectiveAlign = getCrossAlignment(item.alignSelf, alignItems);
    const stretch = effectiveAlign === "stretch";
    const basisMeasured = measureChild(child, basisConstraints);
    const basis = getMainSize(axis, basisMeasured);

    totalBasis += basis;
    if (grow <= 0) {
      nonGrowBasis += basis;
    }

    measurements.set(child, {
      child,
      item,
      basisMeasured,
      measured: basisMeasured,
      basisConstraints,
      initialConstraints: basisConstraints,
      finalConstraints: basisConstraints,
      allocatedMain: undefined,
      grow,
      shrink,
      effectiveAlign,
      stretch,
      basis,
      minContentMain: basis,
      finalMain: basis,
      frozen: false,
      frameMain: basis,
      frameCross: getCrossSize(axis, basisMeasured),
    });
  }

  const entersShrinkPath = finiteMain && availableMain != null && totalBasis - availableMain > SHRINK_EPSILON;

  if (entersShrinkPath) {
    const totalDeficit = totalBasis - availableMain!;
    let remainingDeficit = totalDeficit;

    for (const child of orderedChildren) {
      const measurement = measurements.get(child)!;
      const minContentMeasured = measureChildMinContent(child, measurement.basisConstraints);
      measurement.minContentMain = Math.min(measurement.basis, getMainSize(axis, minContentMeasured));
      measurement.finalMain = measurement.basis;
      measurement.frozen = measurement.shrink <= 0 || measurement.basis - measurement.minContentMain <= SHRINK_EPSILON;
    }

    while (remainingDeficit > SHRINK_EPSILON) {
      const active = orderedChildren
        .map((child) => measurements.get(child)!)
        .filter((measurement) => !measurement.frozen && measurement.shrink > 0);
      const totalScaled = active.reduce((sum, measurement) => sum + measurement.shrink * measurement.basis, 0);

      if (active.length === 0 || totalScaled <= SHRINK_EPSILON) {
        break;
      }

      let frozeAny = false;
      for (const measurement of active) {
        const tentative = measurement.basis - remainingDeficit * ((measurement.shrink * measurement.basis) / totalScaled);
        if (tentative <= measurement.minContentMain + SHRINK_EPSILON) {
          measurement.finalMain = measurement.minContentMain;
          measurement.frozen = true;
          frozeAny = true;
        } else {
          measurement.finalMain = tentative;
        }
      }

      if (!frozeAny) {
        remainingDeficit = 0;
        break;
      }

      let absorbedDeficit = 0;
      for (const child of orderedChildren) {
        const measurement = measurements.get(child)!;
        if (measurement.frozen) {
          absorbedDeficit += Math.max(0, measurement.basis - measurement.finalMain);
        }
      }
      remainingDeficit = Math.max(0, totalDeficit - absorbedDeficit);
    }

    for (const child of orderedChildren) {
      const measurement = measurements.get(child)!;
      measurement.measured = measurement.basisMeasured;
      measurement.initialConstraints = measurement.basisConstraints;
      measurement.finalConstraints = createAxisConstraints(
        axis,
        constraints,
        {
          min: undefined,
          max: measurement.finalMain,
        },
        {
          min: undefined,
          max: maxCross,
        },
      );
      measurement.allocatedMain = undefined;
      measurement.frameMain = measurement.finalMain;
      measurement.frameCross = getCrossSize(axis, measurement.measured);
    }
  } else {
    const remainingMain = finiteMain && availableMain != null ? Math.max(0, availableMain - nonGrowBasis) : undefined;

    for (const child of orderedChildren) {
      const measurement = measurements.get(child)!;
      if (!(measurement.grow > 0 && finiteMain && remainingMain != null && totalGrow > 0)) {
        measurement.measured = measurement.basisMeasured;
        measurement.initialConstraints = measurement.basisConstraints;
        measurement.finalConstraints = finiteMain
          ? createAxisConstraints(
              axis,
              constraints,
              {
                min: undefined,
                max: measurement.finalMain,
              },
              {
                min: undefined,
                max: maxCross,
              },
            )
          : measurement.basisConstraints;
        measurement.allocatedMain = undefined;
        measurement.finalMain = measurement.basis;
        measurement.frameMain = measurement.basis;
        measurement.frameCross = getCrossSize(axis, measurement.measured);
        continue;
      }

      const allocatedMain = (remainingMain * measurement.grow) / totalGrow;
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
      measurement.measured = measured;
      measurement.initialConstraints = childConstraints;
      measurement.finalConstraints = childConstraints;
      measurement.allocatedMain = allocatedMain;
      measurement.finalMain = allocatedMain;
      measurement.frameMain = allocatedMain;
      measurement.frameCross = getCrossSize(axis, measured);
    }
  }

  for (const child of orderedChildren) {
    const measurement = measurements.get(child)!;
    if (!constraintsEqual(measurement.initialConstraints, measurement.finalConstraints)) {
      measurement.measured = measureChild(child, measurement.finalConstraints);
    }
    measurement.frameMain = measurement.finalMain;
    measurement.frameCross = getCrossSize(axis, measurement.measured);
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
        measurement.finalConstraints,
        {
          min: getMinMain(axis, measurement.finalConstraints),
          max: getMaxMain(axis, measurement.finalConstraints),
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

/**
 * Wraps a child node with per-item flex options.
 */
export class FlexItem<C extends CanvasRenderingContext2D> extends Wrapper<C> {
  /**
   * @param inner Wrapped child node.
   * @param item Flex behavior overrides for the child.
   */
  constructor(
    inner: Node<C>,
    readonly item: FlexItemOptions = {},
  ) {
    super(inner);
  }
}

/**
 * Lays out children in a single flex row or column.
 */
export class Flex<C extends CanvasRenderingContext2D> extends Group<C> {
  /**
   * @param children Child nodes in visual order.
   * @param options Flex container configuration.
   */
  constructor(
    children: Node<C>[],
    readonly options: FlexContainerOptions = {},
  ) {
    super(children);
  }

  measure(ctx: Context<C>): Box {
    const result = computeFlexLayout(
      this.children,
      this.options,
      ctx.constraints,
      (node, constraints) => ctx.measureNode(node, constraints),
      (node, constraints) => measureNodeMinContent(ctx, node, constraints),
    );
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
