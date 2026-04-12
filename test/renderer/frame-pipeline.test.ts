import { describe, expect, test } from "bun:test";

import { VirtualizedRenderer } from "../../src/renderer/virtualized/base";
import type { VirtualizedResolvedItem } from "../../src/renderer/virtualized/base-types";
import {
  normalizeVisibleState,
  type NormalizedListState,
  type ResolvedListLayoutOptions,
  type VisibleListState,
  type VisibleWindowResult,
} from "../../src/renderer/virtualized/solver";
import { ListState } from "../../src/renderer/list-state";
import { createGraphics } from "../helpers/graphics";
import { createHitNode } from "../helpers/renderer-fixtures";

type C = CanvasRenderingContext2D;

class PipelineProbeRenderer extends VirtualizedRenderer<C, number> {
  readonly calls = {
    resolve: 0,
    capture: 0,
    prune: 0,
  };
  shouldPrune = true;
  readonly #layout: ResolvedListLayoutOptions = {
    anchorMode: "top",
    underflowAlign: "top",
    padding: { top: 0, bottom: 0 },
  };

  protected _getLayoutOptions(): ResolvedListLayoutOptions {
    return this.#layout;
  }

  protected _normalizeListState(state: VisibleListState): NormalizedListState {
    return normalizeVisibleState(this.items.length, state, this.#layout);
  }

  protected _resolveVisibleWindowForState(
    state: VisibleListState,
    now: number,
  ): VisibleWindowResult<VirtualizedResolvedItem> {
    void now;
    this.calls.resolve += 1;
    const normalizedState = this._normalizeListState(state);
    const drawList = this.items.map((item, idx) => {
      const resolved = this._resolveItem(item, idx, now);
      return {
        idx,
        value: resolved.value,
        offset: idx * 20,
        height: 20,
      };
    });
    return {
      normalizedState,
      resolutionPath: this.items.map((_, idx) => idx),
      window: {
        drawList,
        shift: 0,
      },
    };
  }

  protected _readAnchor(
    state: NormalizedListState,
    _readItemHeight: (index: number) => number,
  ): number {
    return state.position;
  }

  protected _applyAnchor(anchor: number): void {
    this._commitListState({
      position: Math.max(
        0,
        Math.min(this.items.length - 1, Math.trunc(anchor)),
      ),
      offset: 0,
    });
  }

  protected _getDefaultJumpBlock(): "start" {
    return "start";
  }

  protected _getTargetAnchor(index: number): number {
    return index;
  }

  protected _captureVisibleItemSnapshot(
    solution: VisibleWindowResult<unknown>,
    extraShift = 0,
  ): void {
    this.calls.capture += 1;
    super._captureVisibleItemSnapshot(solution, extraShift);
  }

  protected _pruneTransitionAnimations(
    _window?: unknown,
    _now?: number,
  ): boolean {
    this.calls.prune += 1;
    if (!this.shouldPrune) {
      return false;
    }
    this.shouldPrune = false;
    return true;
  }
}

function createRenderer(): PipelineProbeRenderer {
  const hits: Array<{ x: number; y: number }> = [];
  const list = new ListState<number>([0, 1]);
  return new PipelineProbeRenderer(createGraphics(100), {
    list,
    renderItem: () => createHitNode(20, hits),
  });
}

describe("frame pipeline", () => {
  test("render and hittest both rerun the shared frame session after prune requests a settle pass", () => {
    const renderRenderer = createRenderer();
    renderRenderer.render();
    expect(renderRenderer.calls).toEqual({
      resolve: 2,
      capture: 2,
      prune: 1,
    });

    const hittestRenderer = createRenderer();
    expect(hittestRenderer.hittest({ x: 10, y: 10, type: "click" })).toBe(true);
    expect(hittestRenderer.calls).toEqual({
      resolve: 2,
      capture: 2,
      prune: 1,
    });
  });
});
