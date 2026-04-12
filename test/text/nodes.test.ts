import { describe, expect, test } from "bun:test";

import { MultilineText, Text } from "../../src/nodes";
import type { InlineSpan } from "../../src/types";
import { ConstraintTestRenderer } from "../helpers/renderer-fixtures";
import {
  createRecordingGraphics,
  createRichRecordingGraphics,
  type RecordedDraw,
} from "../helpers/text-fixtures";

type C = CanvasRenderingContext2D;

describe("text nodes", () => {
  test("Text nodes draw the ellipsized single-line layout", () => {
    const recordedTexts: string[] = [];
    const renderer = new ConstraintTestRenderer(
      createRecordingGraphics(recordedTexts),
      {},
    );
    const node = new Text<C>("alphabet", {
      lineHeight: 20,
      font: "16px text-node-ellipsis",
      color: "#000",
      overflow: "ellipsis",
      ellipsisPosition: "middle",
    });

    expect(renderer.measureNode(node, { maxWidth: 40 })).toEqual({
      width: 40,
      height: 20,
    });
    renderer.drawNode(node, { maxWidth: 40 });

    expect(recordedTexts).toEqual(["al…et"]);
  });

  test("Text nodes honor anywhere min-content sizing for continuous strings", () => {
    const renderer = new ConstraintTestRenderer(
      createRecordingGraphics([]),
      {},
    );
    const node = new Text<C>("abcdefghij", {
      lineHeight: 20,
      font: "16px text-node-anywhere",
      color: "#000",
      overflowWrap: "anywhere",
    });

    expect(renderer.measureMinContentNode(node)).toEqual({
      width: 8,
      height: 20,
    });
  });

  test("MultilineText nodes measure and draw the same truncated layout", () => {
    const recordedTexts: string[] = [];
    const renderer = new ConstraintTestRenderer(
      createRecordingGraphics(recordedTexts),
      {},
    );
    const node = new MultilineText<C>("abcdefghijklmno", {
      lineHeight: 20,
      font: "16px multiline-node-ellipsis",
      color: "#000",
      align: "start",
      overflow: "ellipsis",
      maxLines: 2,
    });

    expect(renderer.measureNode(node, { maxWidth: 40 })).toEqual({
      width: 40,
      height: 40,
    });
    renderer.drawNode(node, { maxWidth: 40 });

    expect(recordedTexts).toEqual(["abcde", "fghi…"]);
  });

  test("MultilineText nodes preserve spaces with pre-wrap under constrained layout", () => {
    const recordedTexts: string[] = [];
    const renderer = new ConstraintTestRenderer(
      createRecordingGraphics(recordedTexts),
      {},
    );
    const node = new MultilineText<C>("hello world\n  foo bar baz", {
      lineHeight: 20,
      font: "16px multiline-node-pre-wrap",
      color: "#000",
      align: "start",
      whiteSpace: "pre-wrap",
    });

    expect(renderer.measureNode(node, { maxWidth: 40 })).toEqual({
      width: 48,
      height: 100,
    });
    renderer.drawNode(node, { maxWidth: 40 });

    expect(recordedTexts).toEqual(["hello ", "world", "  foo ", "bar ", "baz"]);
  });

  test("MultilineText nodes honor anywhere min-content sizing for continuous strings", () => {
    const renderer = new ConstraintTestRenderer(
      createRecordingGraphics([]),
      {},
    );
    const node = new MultilineText<C>("abcdefghij", {
      lineHeight: 20,
      font: "16px multiline-node-anywhere",
      color: "#000",
      align: "start",
      overflowWrap: "anywhere",
    });

    expect(renderer.measureMinContentNode(node)).toEqual({
      width: 8,
      height: 200,
    });
  });

  test("MultilineText nodes draw rich spans with per-fragment font and color", () => {
    const recordedDraws: RecordedDraw[] = [];
    const renderer = new ConstraintTestRenderer(
      createRichRecordingGraphics(recordedDraws),
      {},
    );
    const node = new MultilineText<C>(
      [
        { text: "hello ", color: "#111" },
        { text: "world", font: "600 16px rich-node-bold", color: "#f00" },
        { text: " again", color: "#222" },
      ] satisfies InlineSpan<C>[],
      {
        lineHeight: 20,
        font: "16px rich-node",
        color: "#000",
        align: "start",
      },
    );

    expect(renderer.measureNode(node, { maxWidth: 48 })).toEqual({
      width: 40,
      height: 60,
    });
    renderer.drawNode(node, { maxWidth: 48 });

    expect(recordedDraws.map((draw) => draw.text)).toEqual([
      "hello",
      "world",
      "again",
    ]);
    expect(recordedDraws[0]).toMatchObject({
      font: "16px rich-node",
      fillStyle: "#111",
      textAlign: "left",
    });
    expect(recordedDraws[1]).toMatchObject({
      font: "600 16px rich-node-bold",
      fillStyle: "#f00",
      textAlign: "left",
    });
    expect(recordedDraws[2]).toMatchObject({
      font: "16px rich-node",
      fillStyle: "#222",
      textAlign: "left",
    });
  });
});
