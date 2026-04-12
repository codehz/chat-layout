import { clamp } from "./virtualized-animation";
import type { NormalizedListState, ResolvedListLayoutOptions } from "./solver";

export type JumpBlock = "start" | "center" | "end";

type ReadItemHeight = (index: number) => number;

export function clampItemIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) {
    return 0;
  }
  return clamp(
    Number.isFinite(index) ? Math.trunc(index) : 0,
    0,
    itemCount - 1,
  );
}

export function readAnchorFromState(
  itemCount: number,
  state: NormalizedListState,
  anchorMode: ResolvedListLayoutOptions["anchorMode"],
  readItemHeight: ReadItemHeight,
): number {
  if (itemCount <= 0) {
    return 0;
  }

  const height = readItemHeight(state.position);
  if (anchorMode === "top") {
    return height > 0 ? state.position - state.offset / height : state.position;
  }
  return height > 0
    ? state.position + 1 - state.offset / height
    : state.position + 1;
}

export function applyAnchorToState(
  itemCount: number,
  anchor: number,
  anchorMode: ResolvedListLayoutOptions["anchorMode"],
  readItemHeight: ReadItemHeight,
): NormalizedListState | undefined {
  if (itemCount <= 0) {
    return undefined;
  }

  const clampedAnchor = clamp(anchor, 0, itemCount);
  if (anchorMode === "top") {
    const position = clamp(Math.floor(clampedAnchor), 0, itemCount - 1);
    const height = readItemHeight(position);
    const offset = height > 0 ? -(clampedAnchor - position) * height : 0;
    return {
      position,
      offset: Object.is(offset, -0) ? 0 : offset,
    };
  }

  const position = clamp(Math.ceil(clampedAnchor) - 1, 0, itemCount - 1);
  const height = readItemHeight(position);
  const offset = height > 0 ? (position + 1 - clampedAnchor) * height : 0;
  return {
    position,
    offset: Object.is(offset, -0) ? 0 : offset,
  };
}

export function getAnchorAtOffset(
  itemCount: number,
  index: number,
  offset: number,
  readItemHeight: ReadItemHeight,
): number {
  if (itemCount <= 0) {
    return 0;
  }

  let currentIndex = clampItemIndex(index, itemCount);
  let remaining = Number.isFinite(offset) ? offset : 0;
  while (true) {
    if (remaining < 0) {
      if (currentIndex === 0) {
        return 0;
      }
      currentIndex -= 1;
      const height = readItemHeight(currentIndex);
      if (height > 0) {
        remaining += height;
      }
      continue;
    }

    const height = readItemHeight(currentIndex);
    if (height > 0) {
      if (remaining <= height) {
        return currentIndex + remaining / height;
      }
      remaining -= height;
    } else if (remaining === 0) {
      return currentIndex;
    }

    if (currentIndex === itemCount - 1) {
      return itemCount;
    }
    currentIndex += 1;
  }
}

export function getTargetAnchorForItem(
  itemCount: number,
  index: number,
  block: JumpBlock,
  anchorMode: ResolvedListLayoutOptions["anchorMode"],
  viewportHeight: number,
  readItemHeight: ReadItemHeight,
): number {
  if (itemCount <= 0) {
    return 0;
  }

  const targetIndex = clampItemIndex(index, itemCount);
  const height = readItemHeight(targetIndex);
  if (anchorMode === "top") {
    switch (block) {
      case "start":
        return getAnchorAtOffset(itemCount, targetIndex, 0, readItemHeight);
      case "center":
        return getAnchorAtOffset(
          itemCount,
          targetIndex,
          height / 2 - viewportHeight / 2,
          readItemHeight,
        );
      case "end":
        return getAnchorAtOffset(
          itemCount,
          targetIndex,
          height - viewportHeight,
          readItemHeight,
        );
    }
  }

  switch (block) {
    case "start":
      return getAnchorAtOffset(
        itemCount,
        targetIndex,
        viewportHeight,
        readItemHeight,
      );
    case "center":
      return getAnchorAtOffset(
        itemCount,
        targetIndex,
        height / 2 + viewportHeight / 2,
        readItemHeight,
      );
    case "end":
      return getAnchorAtOffset(itemCount, targetIndex, height, readItemHeight);
  }
}
