import { describe, expect, test } from "bun:test";

import { MultilineText, Text } from "../../src/nodes";
import type { InlineSpan, MultilineTextOptions, TextOptions } from "../../src/types";
import { ChatRenderer, DebugRenderer, ListState, memoRenderItem } from "../../src/renderer";
import { createTextGraphics, ensureMockOffscreenCanvas, withOffscreenMeasureCounter } from "../helpers/graphics";
import { ConstraintTestRenderer } from "../helpers/renderer-fixtures";

type C = CanvasRenderingContext2D;

ensureMockOffscreenCanvas();

function createSingleLineNode(text: string, font: string, options: Partial<TextOptions<C>> = {}): Text<C> {
  return new Text(text, {
    lineHeight: 20,
    font,
    color: "#000",
    ...options,
  });
}

function createMultilineNode(text: string, font: string, options: Partial<MultilineTextOptions<C>> = {}): MultilineText<C> {
  return new MultilineText(text, {
    align: "start",
    lineHeight: 20,
    font,
    color: "#000",
    ...options,
  });
}

describe("text layout cache", () => {
  test("repeated draws of the same Text node reuse cached layout work", () => {
    let graphicsMeasures = 0;
    const renderer = new DebugRenderer(createTextGraphics(80, 100, () => {
      graphicsMeasures += 1;
    }), {});
    const node = createSingleLineNode(
      "alpha beta gamma delta epsilon zeta eta theta text-cache-repeat-single",
      "16px cache-test-single-repeat",
    );

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

  test("repeated draws of the same rich Text node reuse cached layout work", () => {
    let graphicsMeasures = 0;
    const renderer = new ConstraintTestRenderer(createTextGraphics(320, 100, () => {
      graphicsMeasures += 1;
    }), {});
    const spans: InlineSpan<C>[] = [
      { text: "alpha " },
      { text: "beta", font: "700 16px cache-test-rich-single", color: "#0369a1" },
      { text: " gamma delta epsilon" },
    ];
    const node = new Text(spans, {
      lineHeight: 20,
      font: "16px cache-test-rich-single",
      color: "#000",
      overflow: "ellipsis",
      ellipsisPosition: "middle",
    });

    withOffscreenMeasureCounter((offscreen) => {
      renderer.drawNode(node, { maxWidth: 72 });
      const warmGraphicsMeasures = graphicsMeasures;
      const warmOffscreenMeasures = offscreen.count;

      expect(warmGraphicsMeasures).toBeGreaterThan(0);
      expect(warmOffscreenMeasures).toBeGreaterThan(0);

      renderer.drawNode(node, { maxWidth: 72 });

      expect(graphicsMeasures).toBe(warmGraphicsMeasures);
      expect(offscreen.count).toBe(warmOffscreenMeasures);
    });
  });

  test("repeated renders of the same visible MultilineText node reuse cached layout work", () => {
    let graphicsMeasures = 0;
    const list = new ListState([{ text: "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron text-cache-chat-repeat" }]);
    const renderer = new ChatRenderer(createTextGraphics(80, 100, () => {
      graphicsMeasures += 1;
    }), {
      list,
      renderItem: memoRenderItem<C, { text: string }>((item) => new MultilineText(item.text, {
        align: "start",
        lineHeight: 20,
        font: "16px cache-test-chat-repeat",
        color: "#000",
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

  test("different maxWidth values rerun layout but reuse prepared text", () => {
    let graphicsMeasures = 0;
    const renderer = new ConstraintTestRenderer(createTextGraphics(320, 100, () => {
      graphicsMeasures += 1;
    }), {});
    const node = createMultilineNode(
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron text-cache-width-reuse",
      "16px cache-test-width-reuse",
    );

    withOffscreenMeasureCounter((offscreen) => {
      renderer.drawNode(node, { maxWidth: 200 });
      const wideOffscreenMeasures = offscreen.count;

      renderer.drawNode(node, { maxWidth: 60 });
      expect(offscreen.count).toBe(wideOffscreenMeasures);

      const cachedGraphicsMeasures = graphicsMeasures;
      const cachedOffscreenMeasures = offscreen.count;

      renderer.drawNode(node, { maxWidth: 200 });
      renderer.drawNode(node, { maxWidth: 60 });

      expect(graphicsMeasures).toBe(cachedGraphicsMeasures);
      expect(offscreen.count).toBe(cachedOffscreenMeasures);
    });
  });

  test("different nodes with the same text and font share prepared text work", () => {
    let graphicsMeasures = 0;
    const renderer = new ConstraintTestRenderer(createTextGraphics(320, 100, () => {
      graphicsMeasures += 1;
    }), {});
    const text = "alpha beta gamma delta epsilon zeta eta theta text-cache-cross-node";
    const font = "16px cache-test-cross-node";
    const first = createMultilineNode(text, font);
    const second = createMultilineNode(text, font);

    withOffscreenMeasureCounter((offscreen) => {
      renderer.drawNode(first, { maxWidth: 60 });
      const firstOffscreenMeasures = offscreen.count;

      renderer.drawNode(second, { maxWidth: 60 });

      expect(graphicsMeasures).toBeGreaterThan(0);
      expect(offscreen.count).toBe(firstOffscreenMeasures);
    });
  });

  test("invalidateNode keeps prepared text warm for subsequent measure and draw", () => {
    let graphicsMeasures = 0;
    const renderer = new ConstraintTestRenderer(createTextGraphics(320, 100, () => {
      graphicsMeasures += 1;
    }), {});
    const node = createMultilineNode(
      "alpha beta gamma delta epsilon zeta eta theta text-cache-invalidate",
      "16px cache-test-invalidate",
    );

    withOffscreenMeasureCounter((offscreen) => {
      renderer.drawNode(node, { maxWidth: 60 });
      const warmOffscreenMeasures = offscreen.count;

      renderer.invalidateNode(node);
      renderer.measureNode(node, { maxWidth: 60 });
      renderer.drawNode(node, { maxWidth: 60 });

      expect(graphicsMeasures).toBeGreaterThan(0);
      expect(offscreen.count).toBe(warmOffscreenMeasures);
    });
  });

  test("viewport width changes keep prepared text cache warm", () => {
    let graphicsMeasures = 0;
    const graphics = createTextGraphics(160, 100, () => {
      graphicsMeasures += 1;
    });
    const renderer = new DebugRenderer(graphics, {});
    const node = createMultilineNode(
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron text-cache-viewport",
      "16px cache-test-viewport",
    );

    withOffscreenMeasureCounter((offscreen) => {
      renderer.draw(node);
      const warmGraphicsMeasures = graphicsMeasures;
      const warmOffscreenMeasures = offscreen.count;

      renderer.draw(node);
      expect(graphicsMeasures).toBe(warmGraphicsMeasures);
      expect(offscreen.count).toBe(warmOffscreenMeasures);

      (graphics.canvas as unknown as { clientWidth: number }).clientWidth = 100;
      renderer.draw(node);

      expect(graphicsMeasures).toBe(warmGraphicsMeasures);
      expect(offscreen.count).toBe(warmOffscreenMeasures);
    });
  });

  test("min-content measurement uses separate cache keys from constrained layout", () => {
    let graphicsMeasures = 0;
    const renderer = new ConstraintTestRenderer(createTextGraphics(320, 100, () => {
      graphicsMeasures += 1;
    }), {});
    const node = createMultilineNode(
      "alpha beta gamma",
      "16px cache-test-min-content-separation",
    );

    withOffscreenMeasureCounter((offscreen) => {
      const minContent = renderer.measureMinContentNode(node);
      const afterMinContentGraphics = graphicsMeasures;
      const afterMinContentOffscreen = offscreen.count;

      const constrained = renderer.measureNode(node, { maxWidth: 96 });

      expect(minContent).toEqual({ width: 40, height: 60 });
      expect(constrained).toEqual({ width: 80, height: 40 });
      expect(graphicsMeasures).toBe(afterMinContentGraphics);
      expect(offscreen.count).toBe(afterMinContentOffscreen);
    });
  });

  test("ellipsized multiline nodes reuse prepared text across maxWidth changes", () => {
    let graphicsMeasures = 0;
    const renderer = new ConstraintTestRenderer(createTextGraphics(320, 100, () => {
      graphicsMeasures += 1;
    }), {});
    const node = createMultilineNode(
      "alpha beta gamma delta epsilon zeta eta theta ellipsis-cache-width-reuse",
      "16px cache-test-ellipsis-width-reuse",
      { overflow: "ellipsis", maxLines: 2 },
    );

    withOffscreenMeasureCounter((offscreen) => {
      renderer.drawNode(node, { maxWidth: 96 });
      const warmOffscreenMeasures = offscreen.count;

      renderer.drawNode(node, { maxWidth: 56 });

      expect(offscreen.count).toBe(warmOffscreenMeasures);

      const cachedGraphicsMeasures = graphicsMeasures;
      const cachedOffscreenMeasures = offscreen.count;

      renderer.drawNode(node, { maxWidth: 96 });
      renderer.drawNode(node, { maxWidth: 56 });

      expect(graphicsMeasures).toBe(cachedGraphicsMeasures);
      expect(offscreen.count).toBe(cachedOffscreenMeasures);
    });
  });

  test("same text with different ellipsis positions shares prepared text work", () => {
    let graphicsMeasures = 0;
    const renderer = new ConstraintTestRenderer(createTextGraphics(320, 100, () => {
      graphicsMeasures += 1;
    }), {});
    const text = "alpha beta gamma delta epsilon ellipsis-cache-cross-position";
    const font = "16px cache-test-cross-position";
    const startNode = createSingleLineNode(text, font, { overflow: "ellipsis", ellipsisPosition: "start" });
    const middleNode = createSingleLineNode(text, font, { overflow: "ellipsis", ellipsisPosition: "middle" });

    withOffscreenMeasureCounter((offscreen) => {
      renderer.drawNode(startNode, { maxWidth: 96 });
      const warmOffscreenMeasures = offscreen.count;

      renderer.drawNode(middleNode, { maxWidth: 96 });

      expect(graphicsMeasures).toBeGreaterThan(0);
      expect(offscreen.count).toBe(warmOffscreenMeasures);
    });
  });

  test("same text with different whiteSpace modes keep separate prepared text entries", () => {
    let graphicsMeasures = 0;
    const renderer = new ConstraintTestRenderer(createTextGraphics(320, 100, () => {
      graphicsMeasures += 1;
    }), {});
    const text = "  alpha  \n\n beta ";
    const font = "16px cache-test-white-space-mode";
    const normalNode = createMultilineNode(text, font, { whiteSpace: "normal" });
    const preWrapNode = createMultilineNode(text, font, { whiteSpace: "pre-wrap" });

    withOffscreenMeasureCounter((offscreen) => {
      renderer.drawNode(normalNode, { maxWidth: 80 });
      const normalGraphicsMeasures = graphicsMeasures;
      const normalOffscreenMeasures = offscreen.count;

      expect(normalOffscreenMeasures).toBeGreaterThan(0);

      renderer.drawNode(preWrapNode, { maxWidth: 80 });

      expect(graphicsMeasures).toBeGreaterThanOrEqual(normalGraphicsMeasures);
      expect(offscreen.count).toBeGreaterThan(normalOffscreenMeasures);
    });
  });
});
