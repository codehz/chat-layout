import { describe, expect, test } from "bun:test";

import { ListState, TimelineRenderer, memoRenderItem } from "../../src/renderer";
import type { Box, Context, HitTest, Node } from "../../src/types";
import { createGraphics, mockPerformanceNow } from "../helpers/graphics";

type C = CanvasRenderingContext2D;

type Item = {
  id: string;
  height: number;
};

function createProbeNode(item: Item, draws: string[]): Node<C> {
  return {
    measure(_ctx: Context<C>): Box {
      return { width: 320, height: item.height };
    },
    draw(_ctx: Context<C>, _x: number, _y: number): boolean {
      draws.push(item.id);
      return false;
    },
    hittest(_ctx: Context<C>, _test: HitTest): boolean {
      return false;
    },
  };
}

describe("ListState weak subscriptions", () => {
  test("TimelineRenderer still responds to update, push, set, and reset changes", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const draws: string[] = [];
      const oldItem = { id: "old", height: 20 };
      const list = new ListState<Item>([
        oldItem,
        { id: "tail", height: 10 },
      ]);
      const renderer = new TimelineRenderer(createGraphics(120), {
        list,
        renderItem: memoRenderItem<C, Item>((item) => createProbeNode(item, draws)),
      });

      list.update(oldItem, { id: "new", height: 30 }, { duration: 100 });
      now.current = 50;
      renderer.render();
      expect(draws).toEqual(["old", "new", "tail"]);

      draws.length = 0;
      list.push({ id: "pushed", height: 15 });
      renderer.render();
      expect(draws).toEqual(["old", "new", "tail", "pushed"]);

      draws.length = 0;
      list.items = [{ id: "set", height: 25 }];
      renderer.render();
      expect(draws).toEqual(["set"]);

      draws.length = 0;
      list.update(list.items[0]!, { id: "set-next", height: 35 }, { duration: 100 });
      now.current = 75;
      renderer.render();
      expect(draws).toEqual(["set", "set-next"]);

      draws.length = 0;
      list.reset([{ id: "reset", height: 18 }]);
      renderer.render();
      expect(draws).toEqual(["reset"]);
    } finally {
      restoreNow();
    }
  });
});
