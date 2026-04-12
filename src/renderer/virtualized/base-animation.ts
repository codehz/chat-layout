import type { ControlledState, JumpPath, JumpPathSegment } from "./base-types";

const CONTROLLED_STATE_OFFSET_EPSILON = 1e-9;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function sameState(
  state: ControlledState,
  position: number | undefined,
  offset: number,
): boolean {
  if (!Object.is(state.position, position)) {
    return false;
  }
  if (Object.is(state.offset, offset)) {
    return true;
  }
  if (!Number.isFinite(state.offset) || !Number.isFinite(offset)) {
    return false;
  }
  return Math.abs(state.offset - offset) <= CONTROLLED_STATE_OFFSET_EPSILON;
}

function resolveJumpSegmentIndex(
  anchor: number,
  direction: -1 | 1,
  itemCount: number,
): number | undefined {
  if (itemCount <= 0) {
    return undefined;
  }

  if (direction > 0) {
    if (anchor >= itemCount) {
      return undefined;
    }
    return clamp(Math.floor(anchor), 0, itemCount - 1);
  }

  if (anchor <= 0) {
    return undefined;
  }
  return clamp(Math.ceil(anchor) - 1, 0, itemCount - 1);
}

export function buildJumpPath(
  itemCount: number,
  readItemHeight: (index: number) => number,
  startAnchor: number,
  targetAnchor: number,
): JumpPath {
  const clampedStartAnchor = clamp(startAnchor, 0, itemCount);
  const clampedTargetAnchor = clamp(targetAnchor, 0, itemCount);
  if (
    itemCount <= 0 ||
    !Number.isFinite(clampedStartAnchor) ||
    !Number.isFinite(clampedTargetAnchor) ||
    Math.abs(clampedTargetAnchor - clampedStartAnchor) <= Number.EPSILON
  ) {
    return {
      startAnchor: clampedStartAnchor,
      targetAnchor: clampedTargetAnchor,
      totalDistance: 0,
      segments: [],
    };
  }

  const direction: -1 | 1 = clampedTargetAnchor > clampedStartAnchor ? 1 : -1;
  const segments: JumpPathSegment[] = [];
  let cursor = clampedStartAnchor;
  let totalDistance = 0;

  while (
    direction > 0 ? cursor < clampedTargetAnchor : cursor > clampedTargetAnchor
  ) {
    const index = resolveJumpSegmentIndex(cursor, direction, itemCount);
    if (index == null) {
      break;
    }

    const nextCursor =
      direction > 0
        ? Math.min(clampedTargetAnchor, index + 1)
        : Math.max(clampedTargetAnchor, index);
    if (Math.abs(nextCursor - cursor) <= Number.EPSILON) {
      cursor = nextCursor;
      continue;
    }

    const height = readItemHeight(index);
    const distance = height > 0 ? Math.abs(nextCursor - cursor) * height : 0;
    if (distance > 0) {
      segments.push({
        anchorStart: cursor,
        anchorEnd: nextCursor,
        distanceStart: totalDistance,
        distanceEnd: totalDistance + distance,
      });
      totalDistance += distance;
    }
    cursor = nextCursor;
  }

  return {
    startAnchor: clampedStartAnchor,
    targetAnchor: clampedTargetAnchor,
    totalDistance,
    segments,
  };
}

export function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

export function getProgress(
  startTime: number,
  duration: number,
  now: number,
): number {
  if (!(duration > 0)) {
    return 1;
  }
  return clamp((now - startTime) / duration, 0, 1);
}

export function interpolate(
  from: number,
  to: number,
  startTime: number,
  duration: number,
  now: number,
): number {
  const progress = getProgress(startTime, duration, now);
  const eased = progress >= 1 ? 1 : smoothstep(progress);
  return from + (to - from) * eased;
}

export function getAnchorAtDistance(path: JumpPath, distance: number): number {
  if (!(path.totalDistance > 0) || path.segments.length === 0) {
    return path.targetAnchor;
  }

  const clampedDistance = clamp(distance, 0, path.totalDistance);
  if (clampedDistance <= 0) {
    return path.startAnchor;
  }
  if (clampedDistance >= path.totalDistance) {
    return path.targetAnchor;
  }

  for (const segment of path.segments) {
    if (clampedDistance >= segment.distanceEnd) {
      continue;
    }

    const span = segment.distanceEnd - segment.distanceStart;
    if (!(span > 0)) {
      continue;
    }
    const ratio = (clampedDistance - segment.distanceStart) / span;
    return (
      segment.anchorStart + (segment.anchorEnd - segment.anchorStart) * ratio
    );
  }

  return path.targetAnchor;
}

export function getNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}
