import { describe, expect, test } from "bun:test";

import type {
  DrawProbe,
  VirtualizedProbeItem,
} from "../helpers/virtualized-fixtures";
import {
  createTopTrackedRenderer,
  withMockedNow,
} from "../helpers/virtualized-fixtures";

type Item = VirtualizedProbeItem;

describe("ListState queued renderer updates", () => {
  test("ListRenderer drains queued update, delete, push, set, and reset changes on render", () => {
    const now = { current: 0 };
    withMockedNow(now, () => {
      const draws: string[] = [];
      const oldItem = { id: "old", height: 20 };
      const trackedDraws: DrawProbe[] = [];
      const { list, renderer } = createTopTrackedRenderer(
        [oldItem, { id: "tail", height: 10 }],
        trackedDraws,
      );

      list.update(oldItem, { id: "new", height: 30 }, { duration: 100 });
      now.current = 50;
      renderer.render();
      draws.push(...trackedDraws.map((draw) => draw.id));
      expect(draws).toEqual(["old", "new", "tail"]);

      draws.length = 0;
      trackedDraws.length = 0;
      list.delete(list.items[0]!, { duration: 100 });
      now.current = 150;
      renderer.render();
      draws.push(...trackedDraws.map((draw) => draw.id));
      expect(draws).toEqual(["tail"]);

      draws.length = 0;
      trackedDraws.length = 0;
      list.push({ id: "pushed", height: 15 });
      renderer.render();
      draws.push(...trackedDraws.map((draw) => draw.id));
      expect(draws).toEqual(["tail", "pushed"]);

      draws.length = 0;
      trackedDraws.length = 0;
      list.items = [{ id: "set", height: 25 }];
      renderer.render();
      draws.push(...trackedDraws.map((draw) => draw.id));
      expect(draws).toEqual(["set"]);

      draws.length = 0;
      trackedDraws.length = 0;
      list.update(
        list.items[0]!,
        { id: "set-next", height: 35 },
        { duration: 100 },
      );
      now.current = 200;
      renderer.render();
      draws.push(...trackedDraws.map((draw) => draw.id));
      expect(draws).toEqual(["set", "set-next"]);

      draws.length = 0;
      trackedDraws.length = 0;
      list.reset([{ id: "reset", height: 18 }]);
      renderer.render();
      draws.push(...trackedDraws.map((draw) => draw.id));
      expect(draws).toEqual(["reset"]);
    });
  });

  test("multiple queued changes are applied in order on the next render", () => {
    const now = { current: 0 };
    withMockedNow(now, () => {
      const draws: string[] = [];
      const trackedDraws: DrawProbe[] = [];
      const first = { id: "first", height: 20 };
      const second = { id: "second", height: 20 };
      const third = { id: "third", height: 20 };
      const { list, renderer } = createTopTrackedRenderer(
        [first],
        trackedDraws,
      );

      list.push(second);
      list.push(third);
      renderer.render();

      draws.push(...trackedDraws.map((draw) => draw.id));
      expect(draws).toEqual(["first", "second", "third"]);
      expect(list.items).toEqual([first, second, third]);
    });
  });
});
