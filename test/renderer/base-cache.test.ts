import { describe, expect, test } from "bun:test";

import { Fixed, Flex, Place } from "../../src/nodes";
import { BaseRenderer } from "../../src/renderer";
import { registerNodeParent, unregisterNodeParent } from "../../src/internal/node-registry";
import type { Box, Context, HitTest, LayoutConstraints, Node } from "../../src/types";
import { createTextGraphics } from "../helpers/graphics";

type C = CanvasRenderingContext2D;

function createMutableGraphics(width: number): C {
  const canvas = { clientWidth: width, clientHeight: 100 };
  return { canvas, textRendering: "auto", clearRect() {}, save() {}, restore() {} } as unknown as C;
}

function createConstraintAwareNode(measureFn: (constraints: LayoutConstraints | undefined) => Box): Node<C> {
  return {
    measure(ctx: Context<C>): Box {
      return measureFn(ctx.constraints);
    },
    draw(_ctx: Context<C>, _x: number, _y: number): boolean {
      return false;
    },
    hittest(_ctx: Context<C>, _test: HitTest): boolean {
      return false;
    },
  };
}

describe("BaseRenderer cache", () => {
  test("different constraints produce independent cache entries", () => {
    let calls = 0;
    const node = createConstraintAwareNode((constraints) => {
      calls += 1;
      return { width: constraints?.maxWidth ?? 320, height: 40 };
    });

    const renderer = new BaseRenderer(createMutableGraphics(320), {});

    const box200 = renderer.measureNode(node, { maxWidth: 200 });
    const box100 = renderer.measureNode(node, { maxWidth: 100 });
    expect(box200.width).toBe(200);
    expect(box100.width).toBe(100);
    expect(calls).toBe(2);

    const box200b = renderer.measureNode(node, { maxWidth: 200 });
    const box100b = renderer.measureNode(node, { maxWidth: 100 });
    expect(box200b.width).toBe(200);
    expect(box100b.width).toBe(100);
    expect(calls).toBe(2);
  });

  test("unconstrained and constrained measurements are cached separately", () => {
    let calls = 0;
    const node = createConstraintAwareNode((constraints) => {
      calls += 1;
      return { width: constraints?.maxWidth ?? 320, height: 40 };
    });

    const renderer = new BaseRenderer(createMutableGraphics(320), {});

    const boxUnconstrained = renderer.measureNode(node);
    const boxConstrained = renderer.measureNode(node, { maxWidth: 200 });
    expect(boxUnconstrained.width).toBe(320);
    expect(boxConstrained.width).toBe(200);
    expect(calls).toBe(2);

    renderer.measureNode(node);
    renderer.measureNode(node, { maxWidth: 200 });
    expect(calls).toBe(2);
  });

  test("invalidateNode clears all constraint variants for the node", () => {
    let calls = 0;
    const node = createConstraintAwareNode((constraints) => {
      calls += 1;
      return { width: constraints?.maxWidth ?? 320, height: 40 };
    });

    const renderer = new BaseRenderer(createMutableGraphics(320), {});
    renderer.measureNode(node, { maxWidth: 200 });
    renderer.measureNode(node, { maxWidth: 100 });
    expect(calls).toBe(2);

    renderer.invalidateNode(node);

    renderer.measureNode(node, { maxWidth: 200 });
    renderer.measureNode(node, { maxWidth: 100 });
    expect(calls).toBe(4);
  });

  test("invalidateNode also invalidates ancestor caches for all constraint variants", () => {
    let childCalls = 0;
    let parentCalls = 0;

    const child = createConstraintAwareNode((constraints) => {
      childCalls += 1;
      return { width: constraints?.maxWidth ?? 100, height: 20 };
    });

    const parent = createConstraintAwareNode((_constraints) => {
      parentCalls += 1;
      return { width: 200, height: 40 };
    });

    registerNodeParent(child, parent);
    try {
      const renderer = new BaseRenderer(createMutableGraphics(320), {});
      renderer.measureNode(parent, { maxWidth: 300 });
      renderer.measureNode(parent, { maxWidth: 200 });
      renderer.measureNode(child, { maxWidth: 100 });
      expect(parentCalls).toBe(2);
      expect(childCalls).toBe(1);

      renderer.invalidateNode(child);

      renderer.measureNode(parent, { maxWidth: 300 });
      renderer.measureNode(parent, { maxWidth: 200 });
      expect(parentCalls).toBe(4);
    } finally {
      unregisterNodeParent(child);
    }
  });

  test("invalidateNode follows the current ownership chain after replacing a wrapper child", () => {
    function createMutableNode(initialWidth: number): {
      node: Node<C>;
      setWidth: (width: number) => void;
    } {
      let width = initialWidth;
      return {
        setWidth(nextWidth) {
          width = nextWidth;
        },
        node: {
          measure(): Box {
            return { width, height: 20 };
          },
          draw(): boolean {
            return false;
          },
          hittest(): boolean {
            return false;
          },
        },
      };
    }

    const first = createMutableNode(20);
    const second = createMutableNode(40);
    const wrapper = new Place<C>(first.node, { align: "start", expand: false });
    const renderer = new BaseRenderer(createTextGraphics(), {});

    expect(renderer.measureNode(wrapper).width).toBe(20);

    wrapper.inner = second.node;
    second.setWidth(60);
    expect(renderer.measureNode(wrapper).width).toBe(60);

    first.setWidth(100);
    renderer.invalidateNode(first.node);
    expect(renderer.measureNode(wrapper).width).toBe(60);

    second.setWidth(80);
    renderer.invalidateNode(second.node);
    expect(renderer.measureNode(wrapper).width).toBe(80);
  });

  test("Flex copies constructor children so external array mutation cannot alter the tree", () => {
    const source = [new Fixed<C>(10, 10)];
    const flex = new Flex<C>(source, {
      direction: "row",
      gap: 5,
      mainAxisSize: "fit-content",
    });
    const renderer = new BaseRenderer(createTextGraphics(), {});

    expect(flex.children).toHaveLength(1);
    expect(renderer.measureNode(flex).width).toBe(10);

    source.push(new Fixed<C>(20, 10));

    expect(flex.children).toHaveLength(1);
    expect(renderer.measureNode(flex).width).toBe(10);
  });

  test("replaceChildren refreshes ownership and cached layout automatically", () => {
    function createMutableNode(initialWidth: number): {
      node: Node<C>;
      setWidth: (width: number) => void;
    } {
      let width = initialWidth;
      return {
        setWidth(nextWidth) {
          width = nextWidth;
        },
        node: {
          measure(): Box {
            return { width, height: 20 };
          },
          draw(): boolean {
            return false;
          },
          hittest(): boolean {
            return false;
          },
        },
      };
    }

    const first = createMutableNode(20);
    const second = createMutableNode(40);
    const flex = new Flex<C>([first.node], {
      direction: "row",
      mainAxisSize: "fit-content",
    });
    const renderer = new BaseRenderer(createTextGraphics(), {});

    expect(renderer.measureNode(flex).width).toBe(20);

    flex.replaceChildren([second.node]);
    second.setWidth(60);
    expect(renderer.measureNode(flex).width).toBe(60);

    expect(() => new Place<C>(first.node, { align: "start" })).not.toThrow();
    expect(() => new Place<C>(second.node, { align: "start" })).toThrow(
      "A node can only be attached to one parent. Shared nodes are not supported.",
    );

    second.setWidth(80);
    renderer.invalidateNode(second.node);
    expect(renderer.measureNode(flex).width).toBe(80);
  });

  test("canvas width change clears all constraint variants", () => {
    let calls = 0;
    const node = createConstraintAwareNode((constraints) => {
      calls += 1;
      return { width: constraints?.maxWidth ?? 320, height: 40 };
    });

    const graphics = createMutableGraphics(320);
    const renderer = new BaseRenderer(graphics, {});

    renderer.measureNode(node, { maxWidth: 200 });
    renderer.measureNode(node, { maxWidth: 100 });
    expect(calls).toBe(2);

    (graphics.canvas as unknown as { clientWidth: number }).clientWidth = 480;

    renderer.measureNode(node, { maxWidth: 200 });
    renderer.measureNode(node, { maxWidth: 100 });
    expect(calls).toBe(4);
  });

  test("cache inner map does not grow beyond MAX_CONSTRAINT_VARIANTS", () => {
    let calls = 0;
    const node = createConstraintAwareNode((constraints) => {
      calls += 1;
      return { width: constraints?.maxWidth ?? 320, height: 40 };
    });

    const renderer = new BaseRenderer(createMutableGraphics(320), {});

    const N = 100;
    for (let w = 1; w <= N; w += 1) {
      const box = renderer.measureNode(node, { maxWidth: w });
      expect(box.width).toBe(w);
    }
    expect(calls).toBe(N);

    const callsBefore = calls;
    for (let w = N - 7; w <= N; w += 1) {
      renderer.measureNode(node, { maxWidth: w });
    }
    expect(calls).toBe(callsBefore);

    renderer.measureNode(node, { maxWidth: 1 });
    expect(calls).toBe(callsBefore + 1);
  });
});
