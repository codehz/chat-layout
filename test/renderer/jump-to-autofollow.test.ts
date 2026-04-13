import { describe, expect, test } from "bun:test";

import { ListState } from "../../src/renderer";
import { writeInternalListScrollState } from "../../src/renderer/list-state";
import type { RenderFeedback } from "../../src/types";
import { mockPerformanceNow } from "../helpers/graphics";
import { createNode } from "../helpers/renderer-fixtures";
import {
  createFeedback,
  createListRenderer as createRenderer,
} from "../helpers/virtualized-fixtures";

describe("jumpTo auto-follow", () => {
  test("jumpToBottom arms bottom auto-follow before the first render", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      renderer.jumpToBottom({ duration: 200 });
      list.pushAll([30], {
        duration: 200,
        autoFollow: true,
      });

      const feedbacks: RenderFeedback[] = [];
      for (const time of [0, 100, 200, 300]) {
        now.current = time;
        const feedback = createFeedback();
        renderer.render(feedback);
        feedbacks.push({ ...feedback });
      }

      const expectedHeights = [...heights, 30];
      const expectedList = new ListState<number>();
      expectedList.pushAll(expectedHeights);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpToBottom({ animated: false });
      expectedRenderer.render();

      expect(feedbacks[0]?.canAutoFollowBottom).toBe(true);
      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("jumpToTop arms top auto-follow before the first render", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      renderer.jumpToTop({ duration: 200 });
      list.unshiftAll([30], {
        duration: 200,
        autoFollow: true,
      });

      const feedbacks: RenderFeedback[] = [];
      for (const time of [0, 100, 200, 300]) {
        now.current = time;
        const feedback = createFeedback();
        renderer.render(feedback);
        feedbacks.push({ ...feedback });
      }

      const expectedHeights = [30, ...heights];
      const expectedList = new ListState<number>();
      expectedList.pushAll(expectedHeights);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpToTop({ animated: false });
      expectedRenderer.render();

      expect(feedbacks[0]?.canAutoFollowTop).toBe(true);
      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("plain jumpTo does not pre-arm boundary auto-follow during the animation", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      renderer.jumpTo(heights.length - 1, {
        duration: 200,
        block: "end",
      });
      list.pushAll([30], {
        duration: 200,
        autoFollow: true,
      });

      const feedback = createFeedback();
      now.current = 0;
      renderer.render(feedback);

      expect(feedback.canAutoFollowBottom).toBe(false);
      expect(list.position).toBe(0);
      expect(list.offset).toBe(0);
    } finally {
      restoreNow();
    }
  });

  test("plain jumpTo enables boundary auto-follow after settling at the boundary", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      renderer.jumpTo(heights.length - 1, {
        duration: 200,
        block: "end",
      });

      const feedbacks: RenderFeedback[] = [];
      for (const time of [0, 100, 200]) {
        now.current = time;
        const feedback = createFeedback();
        renderer.render(feedback);
        feedbacks.push({ ...feedback });
      }

      expect(feedbacks[0]?.canAutoFollowBottom).toBe(false);
      expect(feedbacks.at(-1)?.canAutoFollowBottom).toBe(true);

      list.pushAll([20], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [200, 300, 400]) {
        now.current = time;
        renderer.render();
      }

      const expectedAfterFollowList = new ListState<number>();
      expectedAfterFollowList.pushAll([...heights, 20]);
      const expectedAfterFollowRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list: expectedAfterFollowList,
        renderItem: (height) => createNode(height),
      });
      expectedAfterFollowRenderer.jumpToBottom({ animated: false });
      expectedAfterFollowRenderer.render();

      expect(list.position).toBe(expectedAfterFollowList.position);
      expect(list.offset).toBeCloseTo(expectedAfterFollowList.offset);
    } finally {
      restoreNow();
    }
  });

  test("pushAll auto-follows the end boundary when pinned there", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.jumpTo(heights.length - 1, {
        animated: false,
        block: "end",
      });
      renderer.render();

      list.pushAll([50], {
        duration: 200,
        autoFollow: true,
      });

      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      const expectedHeights = [...heights, 50];
      const expectedList = new ListState<number>();
      expectedList.pushAll(expectedHeights);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpTo(expectedHeights.length - 1, {
        animated: false,
        block: "end",
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("unshiftAll auto-follows the start boundary when pinned there", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.jumpTo(0, {
        animated: false,
        block: "start",
      });
      renderer.render();

      list.unshiftAll([30], {
        duration: 200,
        autoFollow: true,
      });

      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      const expectedHeights = [30, ...heights];
      const expectedList = new ListState<number>();
      expectedList.pushAll(expectedHeights);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpTo(0, {
        animated: false,
        block: "start",
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("fully visible short lists can auto-follow both insertion edges", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 120;
      const heights = [20, 20];

      const pushList = new ListState<number>();
      pushList.pushAll(heights);
      const pushRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list: pushList,
        renderItem: (height) => createNode(height),
      });
      pushRenderer.render();
      pushList.pushAll([30], {
        autoFollow: true,
      });
      for (const time of [0, 110, 220]) {
        now.current = time;
        pushRenderer.render();
      }
      const expectedPushList = new ListState<number>();
      expectedPushList.pushAll([...heights, 30]);
      const expectedPushRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list: expectedPushList,
        renderItem: (height) => createNode(height),
      });
      expectedPushRenderer.jumpTo(2, {
        animated: false,
        block: "end",
      });
      expectedPushRenderer.render();
      expect(pushList.position).toBe(expectedPushList.position);
      expect(pushList.offset).toBeCloseTo(expectedPushList.offset);

      now.current = 0;
      const unshiftList = new ListState<number>();
      unshiftList.pushAll(heights);
      const unshiftRenderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list: unshiftList,
        renderItem: (height) => createNode(height),
      });
      unshiftRenderer.render();
      unshiftList.unshiftAll([30], {
        autoFollow: true,
      });
      for (const time of [0, 110, 220]) {
        now.current = time;
        unshiftRenderer.render();
      }
      const expectedUnshiftList = new ListState<number>();
      expectedUnshiftList.pushAll([30, ...heights]);
      const expectedUnshiftRenderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list: expectedUnshiftList,
        renderItem: (height) => createNode(height),
      });
      expectedUnshiftRenderer.jumpTo(0, {
        animated: false,
        block: "start",
      });
      expectedUnshiftRenderer.render();
      expect(unshiftList.position).toBe(expectedUnshiftList.position);
      expect(unshiftList.offset).toBeCloseTo(expectedUnshiftList.offset);
    } finally {
      restoreNow();
    }
  });

  test("pushAll does not auto-follow when the viewport is away from the end boundary", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const list = new ListState<number>();
      list.pushAll([40, 40, 40]);
      const renderer = createRenderer(100, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      list.pushAll([50], {
        duration: 200,
        autoFollow: true,
      });

      now.current = 0;
      expect(renderer.render()).toBe(false);
      expect(list.position).toBe(0);
      expect(list.offset).toBe(0);
    } finally {
      restoreNow();
    }
  });

  test("same-direction follow inserts retarget to the latest boundary item", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      list.pushAll([30], {
        duration: 200,
        autoFollow: true,
      });

      now.current = 100;
      expect(renderer.render()).toBe(true);

      list.pushAll([20], {
        duration: 200,
        autoFollow: true,
      });

      now.current = 200;
      expect(renderer.render()).toBe(true);

      now.current = 300;
      expect(renderer.render()).toBe(false);

      const expectedHeights = [...heights, 30, 20];
      const expectedList = new ListState<number>();
      expectedList.pushAll(expectedHeights);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpTo(expectedHeights.length - 1, {
        animated: false,
        block: "end",
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("pushAll keeps auto-following after a settled boundary follow", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.jumpTo(heights.length - 1, {
        animated: false,
        block: "end",
      });
      renderer.render();

      list.pushAll([30], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      list.pushAll([20], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [200, 300, 400]) {
        now.current = time;
        renderer.render();
      }

      const expectedHeights = [...heights, 30, 20];
      const expectedList = new ListState<number>();
      expectedList.pushAll(expectedHeights);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpTo(expectedHeights.length - 1, {
        animated: false,
        block: "end",
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("unshiftAll keeps auto-following after a settled boundary follow", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.jumpTo(0, {
        animated: false,
        block: "start",
      });
      renderer.render();

      list.unshiftAll([30], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      list.unshiftAll([20], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [200, 300, 400]) {
        now.current = time;
        renderer.render();
      }

      const expectedHeights = [20, 30, ...heights];
      const expectedList = new ListState<number>();
      expectedList.pushAll(expectedHeights);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpTo(0, {
        animated: false,
        block: "start",
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("padded containers keep unshift auto-follow latched after a settled follow", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 160;
      const padding = { top: 32, bottom: 28 };
      const heights = [41.125, 23.5, 57.375, 28.25];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        padding,
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.jumpTo(0, {
        animated: false,
        block: "start",
      });
      renderer.render();

      list.unshiftAll([19.875], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      const settledFeedback = createFeedback();
      now.current = 200;
      renderer.render(settledFeedback);
      expect(settledFeedback.canAutoFollowTop).toBe(true);

      list.unshiftAll([27.625], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [200, 300, 400]) {
        now.current = time;
        renderer.render();
      }

      const expectedHeights = [27.625, 19.875, ...heights];
      const expectedList = new ListState<number>();
      expectedList.pushAll(expectedHeights);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        padding,
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpTo(0, {
        animated: false,
        block: "start",
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("padded containers keep push auto-follow latched after a settled follow", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 168;
      const padding = { top: 24, bottom: 31 };
      const heights = [26.75, 44.125, 31.5, 52.875];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        padding,
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.jumpTo(heights.length - 1, {
        animated: false,
        block: "end",
      });
      renderer.render();

      list.pushAll([18.625], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      const settledFeedback = createFeedback();
      now.current = 200;
      renderer.render(settledFeedback);
      expect(settledFeedback.canAutoFollowBottom).toBe(true);

      list.pushAll([29.375], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [200, 300, 400]) {
        now.current = time;
        renderer.render();
      }

      const expectedHeights = [...heights, 18.625, 29.375];
      const expectedList = new ListState<number>();
      expectedList.pushAll(expectedHeights);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        padding,
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpTo(expectedHeights.length - 1, {
        animated: false,
        block: "end",
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("manual scroll resets the settled auto-follow latch", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.jumpTo(heights.length - 1, {
        animated: false,
        block: "end",
      });
      renderer.render();

      list.pushAll([30], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      list.applyScroll(-10);
      const expectedPosition = list.position;
      const expectedOffset = list.offset;

      list.pushAll([20], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [200, 300, 400]) {
        now.current = time;
        renderer.render();
      }

      const expectedList = new ListState<number>();
      expectedList.pushAll([...heights, 30, 20]);
      writeInternalListScrollState(expectedList, {
        position: expectedPosition,
        offset: expectedOffset,
      });
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("manual scroll before a new frame resets the settled unshift auto-follow latch", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.jumpTo(0, {
        animated: false,
        block: "start",
      });
      renderer.render();

      list.unshiftAll([30], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      list.applyScroll(-10);
      renderer.render();
      const expectedPosition = list.position;
      const expectedOffset = list.offset;

      list.unshiftAll([20], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [200, 300, 400]) {
        now.current = time;
        renderer.render();
      }

      const expectedList = new ListState<number>();
      expectedList.pushAll([20, 30, ...heights]);
      writeInternalListScrollState(expectedList, {
        position: expectedPosition == null ? undefined : expectedPosition + 1,
        offset: expectedOffset,
      });
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "bottom",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("non-boundary jumpTo keeps the settled auto-follow latch until a recompute trigger", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const viewportHeight = 100;
      const heights = [40, 40, 40];
      const list = new ListState<number>();
      list.pushAll(heights);
      const renderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.jumpTo(heights.length - 1, {
        animated: false,
        block: "end",
      });
      renderer.render();

      list.pushAll([30], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [0, 100, 200]) {
        now.current = time;
        renderer.render();
      }

      renderer.jumpTo(1, {
        animated: false,
      });
      const jumpedFeedback = createFeedback();
      renderer.render(jumpedFeedback);
      expect(jumpedFeedback.canAutoFollowBottom).toBe(true);

      list.pushAll([20], {
        duration: 200,
        autoFollow: true,
      });
      for (const time of [200, 300, 400]) {
        now.current = time;
        renderer.render();
      }

      const expectedList = new ListState<number>();
      expectedList.pushAll([...heights, 30, 20]);
      const expectedRenderer = createRenderer(viewportHeight, {
        anchorMode: "top",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });
      expectedRenderer.jumpToBottom({
        animated: false,
      });
      expectedRenderer.render();

      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });

  test("manual scroll cancels an in-flight auto-follow jump", () => {
    const now = { current: 0 };
    const restoreNow = mockPerformanceNow(now);
    try {
      const list = new ListState<number>();
      list.pushAll([40, 40, 40]);
      const renderer = createRenderer(100, {
        anchorMode: "bottom",
        list,
        renderItem: (height) => createNode(height),
      });

      renderer.render();
      list.pushAll([30], {
        duration: 200,
        autoFollow: true,
      });

      now.current = 100;
      expect(renderer.render()).toBe(true);

      list.applyScroll(5);
      const expectedPosition = list.position;
      const expectedOffset = list.offset;

      const expectedList = new ListState<number>();
      expectedList.pushAll([40, 40, 40, 30]);
      writeInternalListScrollState(expectedList, {
        position: expectedPosition,
        offset: expectedOffset,
      });
      const expectedRenderer = createRenderer(100, {
        anchorMode: "bottom",
        list: expectedList,
        renderItem: (height) => createNode(height),
      });

      now.current = 200;
      expect(renderer.render()).toBe(false);
      expectedRenderer.render();
      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);

      now.current = 300;
      renderer.render();
      expect(list.position).toBe(expectedList.position);
      expect(list.offset).toBeCloseTo(expectedList.offset);
    } finally {
      restoreNow();
    }
  });
});
