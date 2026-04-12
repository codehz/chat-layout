export type ListAnchorMode = "top" | "bottom";

export type ListUnderflowAlign = "top" | "bottom";

export interface ListPadding {
  top?: number;
  bottom?: number;
}

export interface ResolvedListPadding {
  top: number;
  bottom: number;
}

export interface ListLayoutOptions {
  anchorMode?: ListAnchorMode;
  underflowAlign?: ListUnderflowAlign;
  padding?: ListPadding;
}

export interface ResolvedListLayoutOptions {
  anchorMode: ListAnchorMode;
  underflowAlign: ListUnderflowAlign;
  padding: ResolvedListPadding;
}

export interface ListViewportMetrics {
  outerHeight: number;
  contentTop: number;
  contentBottom: number;
  contentHeight: number;
  outerContentTop: number;
  outerContentBottom: number;
}

export interface VisibleListState {
  position?: number;
  offset: number;
}

export interface NormalizedListState {
  position: number;
  offset: number;
}

export interface VisibleWindowEntry<T> {
  idx: number;
  value: T;
  offset: number;
  height: number;
}

export interface VisibleWindow<T> {
  drawList: VisibleWindowEntry<T>[];
  shift: number;
}

export interface VisibleWindowResult<T> {
  normalizedState: NormalizedListState;
  resolutionPath: number[];
  window: VisibleWindow<T>;
}

type ResolvedItem<T> = {
  value: T;
  height: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeOffset(offset: number): number {
  return Number.isFinite(offset) ? offset : 0;
}

export function normalizeListPadding(
  padding: ListPadding | undefined,
): ResolvedListPadding {
  const top =
    typeof padding?.top === "number" && Number.isFinite(padding.top)
      ? Math.max(0, padding.top)
      : 0;
  const bottom =
    typeof padding?.bottom === "number" && Number.isFinite(padding.bottom)
      ? Math.max(0, padding.bottom)
      : 0;
  return { top, bottom };
}

export function resolveListViewport(
  outerHeight: number,
  padding: ListPadding | ResolvedListPadding | undefined,
): ListViewportMetrics {
  const height =
    typeof outerHeight === "number" && Number.isFinite(outerHeight)
      ? Math.max(0, outerHeight)
      : 0;
  const resolvedPadding = normalizeListPadding(padding);
  const contentTop = resolvedPadding.top;
  const contentBottom = Math.max(contentTop, height - resolvedPadding.bottom);
  return {
    outerHeight: height,
    contentTop,
    contentBottom,
    contentHeight: contentBottom - contentTop,
    outerContentTop: -contentTop,
    outerContentBottom: height - contentTop,
  };
}

export function resolveListLayoutOptions(
  options: ListLayoutOptions = {},
): ResolvedListLayoutOptions {
  return {
    anchorMode: options.anchorMode ?? "top",
    underflowAlign: options.underflowAlign ?? "top",
    padding: normalizeListPadding(options.padding),
  };
}

export function normalizeVisibleState(
  itemCount: number,
  state: VisibleListState,
  layout: ResolvedListLayoutOptions,
): NormalizedListState {
  if (itemCount <= 0) {
    return { position: 0, offset: 0 };
  }

  const position = state.position;
  const fallbackPosition = layout.anchorMode === "top" ? 0 : itemCount - 1;
  if (typeof position !== "number" || !Number.isFinite(position)) {
    return {
      position: fallbackPosition,
      offset: normalizeOffset(state.offset),
    };
  }

  return {
    position: clamp(Math.trunc(position), 0, itemCount - 1),
    offset: normalizeOffset(state.offset),
  };
}

export function resolveVisibleWindow<T, V>(
  items: readonly T[],
  state: VisibleListState,
  viewportHeight: number | ListViewportMetrics,
  resolveItem: (item: T, idx: number) => ResolvedItem<V>,
  layout: ResolvedListLayoutOptions,
): VisibleWindowResult<V> {
  const viewport =
    typeof viewportHeight === "number"
      ? resolveListViewport(viewportHeight, layout.padding)
      : viewportHeight;
  const contentHeight = viewport.contentHeight;
  const normalizedState = normalizeVisibleState(items.length, state, layout);
  const resolutionPath = new Set<number>();
  const readResolvedItem = (item: T, idx: number): ResolvedItem<V> => {
    resolutionPath.add(idx);
    return resolveItem(item, idx);
  };
  if (items.length === 0) {
    return {
      normalizedState,
      resolutionPath: [],
      window: { drawList: [], shift: 0 },
    };
  }

  if (layout.anchorMode === "top") {
    let { position, offset } = normalizedState;
    let drawLength = 0;

    if (offset > 0) {
      if (position === 0) {
        offset = 0;
      } else {
        for (let i = position - 1; i >= 0; i -= 1) {
          const { height } = readResolvedItem(items[i]!, i);
          position = i;
          offset -= height;
          if (offset <= 0) {
            break;
          }
        }
        if (position === 0 && offset > 0) {
          offset = 0;
        }
      }
    }

    let y = offset;
    const drawList: VisibleWindowEntry<V>[] = [];
    for (let i = position; i < items.length; i += 1) {
      const { value, height } = readResolvedItem(items[i]!, i);
      if (y + height > 0) {
        drawList.push({ idx: i, value, offset: y, height });
        drawLength += height;
      } else {
        offset += height;
        position = i + 1;
      }
      y += height;
      if (y >= contentHeight) {
        break;
      }
    }

    let shift = 0;
    if (y < contentHeight) {
      const hasDeferredTrailingBoundarySlot =
        drawList.length > 0 &&
        drawList.at(-1)?.idx === items.length - 1 &&
        !(drawList.at(-1)?.height! > Number.EPSILON);
      if (hasDeferredTrailingBoundarySlot) {
        return finalizeVisibleWindowResult(
          items.length,
          viewport,
          layout,
          { position, offset },
          Array.from(resolutionPath),
          extendVisibleWindowToOuterBounds(
            items,
            { drawList, shift },
            viewport,
            readResolvedItem,
          ),
        );
      }
      if (position === 0 && drawLength < contentHeight) {
        shift = -offset;
        offset = 0;
      } else {
        shift = contentHeight - y;
        y = offset += shift;
        let lastIdx = -1;
        for (let i = position - 1; i >= 0; i -= 1) {
          const { value, height } = readResolvedItem(items[i]!, i);
          drawLength += height;
          y -= height;
          drawList.push({ idx: i, value, offset: y - shift, height });
          lastIdx = i;
          if (y < 0) {
            break;
          }
        }
        if (lastIdx === 0 && drawLength < contentHeight) {
          shift =
            drawList.at(-1)?.offset == null ? 0 : -drawList.at(-1)!.offset;
          position = 0;
          offset = 0;
        }
      }
    }

    return finalizeVisibleWindowResult(
      items.length,
      viewport,
      layout,
      { position, offset },
      Array.from(resolutionPath),
      extendVisibleWindowToOuterBounds(
        items,
        { drawList, shift },
        viewport,
        readResolvedItem,
      ),
    );
  }

  let { position, offset } = normalizedState;
  let drawLength = 0;

  if (offset < 0) {
    if (position === items.length - 1) {
      offset = 0;
    } else {
      for (let i = position + 1; i < items.length; i += 1) {
        const { height } = readResolvedItem(items[i]!, i);
        position = i;
        offset += height;
        if (offset > 0) {
          break;
        }
      }
    }
  }

  let y = contentHeight + offset;
  const drawList: VisibleWindowEntry<V>[] = [];
  for (let i = position; i >= 0; i -= 1) {
    const { value, height } = readResolvedItem(items[i]!, i);
    y -= height;
    if (y <= contentHeight) {
      drawList.push({ idx: i, value, offset: y, height });
      drawLength += height;
    } else {
      offset -= height;
      position = i - 1;
    }
    if (y < 0) {
      break;
    }
  }

  let shift = 0;
  if (y > 0) {
    shift = -y;
    if (drawLength < contentHeight) {
      y = drawLength;
      for (let i = position + 1; i < items.length; i += 1) {
        const { value, height } = readResolvedItem(items[i]!, i);
        drawList.push({ idx: i, value, offset: y - shift, height });
        y = drawLength += height;
        if (height > Number.EPSILON) {
          position = i;
        }
        if (y >= contentHeight) {
          break;
        }
      }
      offset = drawLength < contentHeight ? 0 : drawLength - contentHeight;
    } else {
      offset = drawLength - contentHeight;
    }
  }

  return finalizeVisibleWindowResult(
    items.length,
    viewport,
    layout,
    { position, offset },
    Array.from(resolutionPath),
    extendVisibleWindowToOuterBounds(
      items,
      { drawList, shift },
      viewport,
      readResolvedItem,
    ),
  );
}

function finalizeVisibleWindowResult<T>(
  itemCount: number,
  viewport: ListViewportMetrics,
  layout: ResolvedListLayoutOptions,
  normalizedState: NormalizedListState,
  resolutionPath: number[],
  window: VisibleWindow<T>,
): VisibleWindowResult<T> {
  const viewportHeight = viewport.contentHeight;
  if (window.drawList.length !== itemCount || itemCount <= 0) {
    return {
      normalizedState,
      resolutionPath,
      window,
    };
  }

  let minIndex = Number.POSITIVE_INFINITY;
  let maxIndex = Number.NEGATIVE_INFINITY;
  let minOffset = Number.POSITIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;
  let hasDeferredSlots = false;
  for (const entry of window.drawList) {
    if (!(entry.height > Number.EPSILON)) {
      hasDeferredSlots = true;
    } else {
      minOffset = Math.min(minOffset, entry.offset);
      maxBottom = Math.max(maxBottom, entry.offset + entry.height);
    }
    minIndex = Math.min(minIndex, entry.idx);
    maxIndex = Math.max(maxIndex, entry.idx);
  }

  if (!Number.isFinite(minOffset) || !Number.isFinite(maxBottom)) {
    return {
      normalizedState,
      resolutionPath,
      window,
    };
  }

  const contentHeight = maxBottom - minOffset;
  if (
    minIndex !== 0 ||
    maxIndex !== itemCount - 1 ||
    !(contentHeight < viewportHeight - Number.EPSILON)
  ) {
    return {
      normalizedState,
      resolutionPath,
      window,
    };
  }

  const desiredTop =
    layout.underflowAlign === "bottom" ? viewportHeight - contentHeight : 0;
  const canonicalState = hasDeferredSlots
    ? normalizedState
    : layout.anchorMode === "top"
      ? { position: 0, offset: 0 }
      : { position: itemCount - 1, offset: 0 };
  return {
    normalizedState: canonicalState,
    resolutionPath,
    window: {
      drawList: window.drawList,
      shift: desiredTop - minOffset,
    },
  };
}

function extendVisibleWindowToOuterBounds<T, V>(
  items: readonly T[],
  window: VisibleWindow<V>,
  viewport: ListViewportMetrics,
  resolveItem: (item: T, idx: number) => ResolvedItem<V>,
): VisibleWindow<V> {
  if (window.drawList.length === 0 || items.length === 0) {
    return window;
  }

  const drawList = [...window.drawList];
  const existingIndices = new Set(drawList.map((entry) => entry.idx));
  let topEntry = drawList[0]!;
  let bottomEntry = drawList[0]!;
  for (const entry of drawList) {
    if (entry.offset < topEntry.offset) {
      topEntry = entry;
    }
    if (entry.offset + entry.height > bottomEntry.offset + bottomEntry.height) {
      bottomEntry = entry;
    }
  }

  let topIdx = topEntry.idx;
  let topY = topEntry.offset + window.shift;
  while (topIdx > 0) {
    const prevIdx = topIdx - 1;
    if (existingIndices.has(prevIdx)) {
      const existing = drawList.find((entry) => entry.idx === prevIdx);
      topIdx = prevIdx;
      if (existing != null) {
        topY = existing.offset + window.shift;
      }
      continue;
    }
    const { value, height } = resolveItem(items[prevIdx]!, prevIdx);
    const prevY = topY - height;
    if (prevY + height <= viewport.outerContentTop) {
      break;
    }
    drawList.push({
      idx: prevIdx,
      value,
      offset: prevY - window.shift,
      height,
    });
    existingIndices.add(prevIdx);
    topIdx = prevIdx;
    topY = prevY;
  }

  let bottomIdx = bottomEntry.idx;
  let bottomY = bottomEntry.offset + window.shift + bottomEntry.height;
  while (bottomIdx < items.length - 1) {
    const nextIdx = bottomIdx + 1;
    if (existingIndices.has(nextIdx)) {
      const existing = drawList.find((entry) => entry.idx === nextIdx);
      bottomIdx = nextIdx;
      if (existing != null) {
        bottomY = Math.max(
          bottomY,
          existing.offset + window.shift + existing.height,
        );
      }
      continue;
    }
    const { value, height } = resolveItem(items[nextIdx]!, nextIdx);
    if (bottomY >= viewport.outerContentBottom) {
      break;
    }
    drawList.push({
      idx: nextIdx,
      value,
      offset: bottomY - window.shift,
      height,
    });
    existingIndices.add(nextIdx);
    bottomIdx = nextIdx;
    bottomY += height;
  }

  return {
    drawList,
    shift: window.shift,
  };
}
