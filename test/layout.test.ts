import { describe, expect, test } from "bun:test";

import {
  boxToRect,
  computeContainerBox,
  computeContentBox,
  createRect,
  findChildAtPoint,
  getSingleChildLayout,
  mergeRects,
  offsetRect,
  pointInRect,
} from "../src/layout";
import type {
  Box,
  ChildLayoutResult,
  FlexLayoutResult,
  Node,
} from "../src/types";

type C = CanvasRenderingContext2D;

const dummyNode: Node<C> = {
  measure(): Box {
    return { width: 1, height: 1 };
  },
  draw(): boolean {
    return false;
  },
  hittest(): boolean {
    return false;
  },
};

function child(
  rect: ReturnType<typeof createRect>,
  contentBox = rect,
): ChildLayoutResult<C> {
  return {
    node: dummyNode,
    rect,
    contentBox,
  };
}

describe("layout helpers", () => {
  test("mergeRects returns the zero rect for empty input", () => {
    expect(mergeRects([])).toEqual(createRect(0, 0, 0, 0));
  });

  test("computeContainerBox clamps width and height against min and max constraints", () => {
    expect(
      computeContainerBox(createRect(1, 2, 10, 20), {
        minWidth: 12,
        maxWidth: 8,
        minHeight: 25,
        maxHeight: 15,
      }),
    ).toEqual(createRect(1, 2, 8, 15));
  });

  test("pointInRect excludes the right and bottom edges", () => {
    const rect = createRect(0, 0, 10, 10);
    expect(pointInRect(9.999, 9.999, rect)).toBe(true);
    expect(pointInRect(10, 5, rect)).toBe(false);
    expect(pointInRect(5, 10, rect)).toBe(false);
  });

  test("findChildAtPoint distinguishes rect and contentBox hit zones", () => {
    const children = [
      child(createRect(0, 0, 20, 20), createRect(2, 2, 8, 8)),
      child(createRect(5, 5, 20, 20), createRect(7, 7, 8, 8)),
    ];

    expect(findChildAtPoint(children, 16, 16)).toBeUndefined();
    expect(findChildAtPoint(children, 16, 16, "rect")).toMatchObject({
      child: children[1],
      localX: 11,
      localY: 11,
    });
    expect(findChildAtPoint(children, 7.5, 7.5)).toMatchObject({
      child: children[1],
      localX: 0.5,
      localY: 0.5,
    });
  });

  test("findChildAtPoint hits later children first when boxes overlap", () => {
    const first = child(createRect(0, 0, 20, 20));
    const second = child(createRect(5, 5, 20, 20));

    expect(findChildAtPoint([first, second], 10, 10)).toMatchObject({
      child: second,
    });
  });

  test("boxToRect, offsetRect, computeContentBox, and getSingleChildLayout preserve geometry", () => {
    const onlyChild = child(createRect(4, 6, 10, 12), createRect(5, 8, 6, 7));
    const layout: FlexLayoutResult<C> = {
      containerBox: createRect(0, 0, 0, 0),
      contentBox: createRect(0, 0, 0, 0),
      children: [onlyChild],
    };

    expect(boxToRect({ width: 3, height: 4 })).toEqual(createRect(0, 0, 3, 4));
    expect(offsetRect(createRect(1, 2, 3, 4), 5, -2)).toEqual(
      createRect(6, 0, 3, 4),
    );
    expect(computeContentBox(layout.children)).toEqual(onlyChild.contentBox);
    expect(getSingleChildLayout(layout)).toBe(onlyChild);
  });
});
