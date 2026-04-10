export type ListAnchorMode = "top" | "bottom";

export type ListUnderflowAlign = "top";

export interface ListLayoutOptions {
  anchorMode?: ListAnchorMode;
  underflowAlign?: ListUnderflowAlign;
}

export interface ResolvedListLayoutOptions {
  anchorMode: ListAnchorMode;
  underflowAlign: ListUnderflowAlign;
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

export function resolveListLayoutOptions(
  options: ListLayoutOptions = {},
): ResolvedListLayoutOptions {
  return {
    anchorMode: options.anchorMode ?? "top",
    underflowAlign: options.underflowAlign ?? "top",
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
  viewportHeight: number,
  resolveItem: (item: T, idx: number) => ResolvedItem<V>,
  layout: ResolvedListLayoutOptions,
): VisibleWindowResult<V> {
  const normalizedState = normalizeVisibleState(items.length, state, layout);
  if (items.length === 0) {
    return {
      normalizedState,
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
          const { height } = resolveItem(items[i]!, i);
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
      const { value, height } = resolveItem(items[i]!, i);
      if (y + height > 0) {
        drawList.push({ idx: i, value, offset: y, height });
        drawLength += height;
      } else {
        offset += height;
        position = i + 1;
      }
      y += height;
      if (y >= viewportHeight) {
        break;
      }
    }

    let shift = 0;
    if (y < viewportHeight) {
      if (position === 0 && drawLength < viewportHeight) {
        shift = -offset;
        offset = 0;
      } else {
        shift = viewportHeight - y;
        y = offset += shift;
        let lastIdx = -1;
        for (let i = position - 1; i >= 0; i -= 1) {
          const { value, height } = resolveItem(items[i]!, i);
          drawLength += height;
          y -= height;
          drawList.push({ idx: i, value, offset: y - shift, height });
          lastIdx = i;
          if (y < 0) {
            break;
          }
        }
        if (lastIdx === 0 && drawLength < viewportHeight) {
          shift =
            drawList.at(-1)?.offset == null ? 0 : -drawList.at(-1)!.offset;
          position = 0;
          offset = 0;
        }
      }
    }

    return {
      normalizedState: { position, offset },
      window: { drawList, shift },
    };
  }

  let { position, offset } = normalizedState;
  let drawLength = 0;

  if (offset < 0) {
    if (position === items.length - 1) {
      offset = 0;
    } else {
      for (let i = position + 1; i < items.length; i += 1) {
        const { height } = resolveItem(items[i]!, i);
        position = i;
        offset += height;
        if (offset > 0) {
          break;
        }
      }
    }
  }

  let y = viewportHeight + offset;
  const drawList: VisibleWindowEntry<V>[] = [];
  for (let i = position; i >= 0; i -= 1) {
    const { value, height } = resolveItem(items[i]!, i);
    y -= height;
    if (y <= viewportHeight) {
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
    if (drawLength < viewportHeight) {
      y = drawLength;
      for (let i = position + 1; i < items.length; i += 1) {
        const { value, height } = resolveItem(items[i]!, i);
        drawList.push({ idx: i, value, offset: y - shift, height });
        y = drawLength += height;
        position = i;
        if (y >= viewportHeight) {
          break;
        }
      }
      offset = drawLength < viewportHeight ? 0 : drawLength - viewportHeight;
    } else {
      offset = drawLength - viewportHeight;
    }
  }

  return {
    normalizedState: { position, offset },
    window: { drawList, shift },
  };
}
