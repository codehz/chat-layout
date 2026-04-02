import { describe, expect, test } from "bun:test";

import { memoRenderItem, memoRenderItemBy } from "../../src/renderer";
import type { Node } from "../../src/types";
import { createNode } from "../helpers/renderer-fixtures";

type C = CanvasRenderingContext2D;

// @ts-expect-error memoRenderItem now requires object items; use memoRenderItemBy for primitive keys.
const _primitiveMemoContract = memoRenderItem<C, number>((item) => createNode(item));
void _primitiveMemoContract;

describe("memoized render items", () => {
  test("memoRenderItemBy supports primitive keys with explicit reset", () => {
    let renders = 0;
    const renderItem = memoRenderItemBy<C, number, number>(
      (item) => item,
      (item) => {
        renders += 1;
        return createNode(item);
      },
    );

    const first = renderItem(1);
    const second = renderItem(1);
    const third = renderItem(2);

    expect(first).toBe(second);
    expect(third).not.toBe(first);
    expect(renders).toBe(2);

    expect(renderItem.resetKey(1)).toBe(true);
    const fourth = renderItem(1);
    expect(fourth).not.toBe(first);
    expect(renders).toBe(3);
  });

  test("memoRenderItem throws a clear runtime error for primitive items", () => {
    const renderItem = memoRenderItem<C, { value: number }>((item) => createNode(item.value));
    const unsafe = renderItem as unknown as (item: number) => Node<C>;

    expect(() => unsafe(1)).toThrow(
      "memoRenderItem() only supports object items. Use memoRenderItemBy() for primitive keys.",
    );
  });
});
