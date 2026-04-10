import type { ControlledState } from "./base-types";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function sameState(
  state: ControlledState,
  position: number | undefined,
  offset: number,
): boolean {
  return Object.is(state.position, position) && Object.is(state.offset, offset);
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

export function getNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}
