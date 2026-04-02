import { describe, expect, test } from "bun:test";

import { MultilineText } from "../../src/nodes";
import { ChatRenderer, DebugRenderer, ListState, memoRenderItem } from "../../src/renderer";
import { createTextGraphics, ensureMockOffscreenCanvas, withOffscreenMeasureCounter } from "../helpers/graphics";
import { ConstraintTestRenderer, createTextNode } from "../helpers/renderer-fixtures";

type C = CanvasRenderingContext2D;

ensureMockOffscreenCanvas();

describe("text layout cache", () => {
  test("repeated draws of the same Text node reuse cached layout work", () => {
    let graphicsMeasures = 0;
    const renderer = new DebugRenderer(createTextGraphics(80, 100, () => {
      graphicsMeasures += 1;
    }), {});
    const node = createTextNode("alpha beta gamma delta epsilon zeta eta theta");

    withOffscreenMeasureCounter((offscreen) => {
      renderer.draw(node);
      const warmGraphicsMeasures = graphicsMeasures;
      const warmOffscreenMeasures = offscreen.count;

      expect(warmGraphicsMeasures).toBeGreaterThan(0);
      expect(warmOffscreenMeasures).toBeGreaterThan(0);

      renderer.draw(node);

      expect(graphicsMeasures).toBe(warmGraphicsMeasures);
      expect(offscreen.count).toBe(warmOffscreenMeasures);
    });
  });

  test("repeated renders of the same visible MultilineText node reuse cached layout work", () => {
    let graphicsMeasures = 0;
    const list = new ListState([{ text: "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron" }]);
    const renderer = new ChatRenderer(createTextGraphics(80, 100, () => {
      graphicsMeasures += 1;
    }), {
      list,
      renderItem: memoRenderItem<C, { text: string }>((item) => new MultilineText(item.text, {
        align: "start",
        lineHeight: 20,
        font: "16px sans-serif",
        style: "#000",
      })),
    });

    withOffscreenMeasureCounter((offscreen) => {
      renderer.render();
      const warmGraphicsMeasures = graphicsMeasures;
      const warmOffscreenMeasures = offscreen.count;

      expect(warmGraphicsMeasures).toBeGreaterThan(0);
      expect(warmOffscreenMeasures).toBeGreaterThan(0);

      renderer.render();

      expect(graphicsMeasures).toBe(warmGraphicsMeasures);
      expect(offscreen.count).toBe(warmOffscreenMeasures);
    });
  });

  test("different maxWidth values create distinct text layout cache entries", () => {
    let graphicsMeasures = 0;
    const renderer = new ConstraintTestRenderer(createTextGraphics(320, 100, () => {
      graphicsMeasures += 1;
    }), {});
    const node = new MultilineText<C>("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron", {
      align: "start",
      lineHeight: 20,
      font: "16px sans-serif",
      style: "#000",
    });

    withOffscreenMeasureCounter((offscreen) => {
      renderer.drawNode(node, { maxWidth: 200 });
      const afterWideGraphicsMeasures = graphicsMeasures;

      renderer.drawNode(node, { maxWidth: 60 });
      expect(graphicsMeasures).toBeGreaterThan(afterWideGraphicsMeasures);

      const cachedGraphicsMeasures = graphicsMeasures;
      const cachedOffscreenMeasures = offscreen.count;

      renderer.drawNode(node, { maxWidth: 200 });
      renderer.drawNode(node, { maxWidth: 60 });

      expect(graphicsMeasures).toBe(cachedGraphicsMeasures);
      expect(offscreen.count).toBe(cachedOffscreenMeasures);
    });
  });

  test("invalidateNode clears cached text layout artifacts", () => {
    let graphicsMeasures = 0;
    const renderer = new ConstraintTestRenderer(createTextGraphics(320, 100, () => {
      graphicsMeasures += 1;
    }), {});
    const node = new MultilineText<C>("alpha beta gamma delta epsilon zeta eta theta", {
      align: "start",
      lineHeight: 20,
      font: "16px sans-serif",
      style: "#000",
    });

    withOffscreenMeasureCounter((offscreen) => {
      renderer.drawNode(node, { maxWidth: 60 });
      const warmGraphicsMeasures = graphicsMeasures;
      const warmOffscreenMeasures = offscreen.count;

      renderer.drawNode(node, { maxWidth: 60 });
      expect(graphicsMeasures).toBe(warmGraphicsMeasures);
      expect(offscreen.count).toBe(warmOffscreenMeasures);

      renderer.invalidateNode(node);
      renderer.drawNode(node, { maxWidth: 60 });

      expect(graphicsMeasures).toBeGreaterThan(warmGraphicsMeasures);
      expect(offscreen.count).toBeGreaterThanOrEqual(warmOffscreenMeasures);
    });
  });

  test("viewport width changes clear cached text layout artifacts", () => {
    let graphicsMeasures = 0;
    const graphics = createTextGraphics(160, 100, () => {
      graphicsMeasures += 1;
    });
    const renderer = new DebugRenderer(graphics, {});
    const node = new MultilineText<C>("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron", {
      align: "start",
      lineHeight: 20,
      font: "16px sans-serif",
      style: "#000",
    });

    withOffscreenMeasureCounter((offscreen) => {
      renderer.draw(node);
      const warmGraphicsMeasures = graphicsMeasures;
      const warmOffscreenMeasures = offscreen.count;

      renderer.draw(node);
      expect(graphicsMeasures).toBe(warmGraphicsMeasures);
      expect(offscreen.count).toBe(warmOffscreenMeasures);

      (graphics.canvas as unknown as { clientWidth: number }).clientWidth = 100;
      renderer.draw(node);

      expect(graphicsMeasures).toBeGreaterThan(warmGraphicsMeasures);
      expect(offscreen.count).toBeGreaterThanOrEqual(warmOffscreenMeasures);
    });
  });
});
