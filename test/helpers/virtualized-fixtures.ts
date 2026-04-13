import type {
  ListAnchorMode,
  ListPadding,
  ListUnderflowAlign,
} from "../../src/renderer";
import { ListRenderer, ListState, memoRenderItem } from "../../src/renderer";
import type { Box, Context, HitTest, Node } from "../../src/types";
import { createGraphics, mockPerformanceNow } from "./graphics";
export {
  createFeedback,
  expectFiniteFeedback,
  expectNaNFeedback,
} from "./renderer-fixtures";

type C = CanvasRenderingContext2D;

export type VirtualizedProbeItem = {
  id: string;
  height: number;
  innerAlpha?: number;
  hit?: boolean;
};

export type DrawProbe = {
  id: string;
  alpha: number;
  y: number;
};

export function createListRenderer<T extends {}>(
  viewportHeight: number,
  options: {
    anchorMode: ListAnchorMode;
    underflowAlign?: ListUnderflowAlign;
    padding?: ListPadding;
    list: ListState<T>;
    renderItem: (item: T) => Node<C>;
  },
): ListRenderer<C, T> {
  return new ListRenderer(createGraphics(viewportHeight), options);
}

export function readDrawY(draws: DrawProbe[], id: string): number | undefined {
  return draws.find((draw) => draw.id === id)?.y;
}

export function createTrackedItemNode(
  item: VirtualizedProbeItem,
  draws: DrawProbe[],
  hits: string[],
): Node<C> {
  return {
    measure(_ctx: Context<C>): Box {
      return { width: 320, height: item.height };
    },
    draw(ctx: Context<C>, _x: number, y: number): boolean {
      ctx.with((graphics) => {
        graphics.globalAlpha *= item.innerAlpha ?? 1;
        draws.push({
          id: item.id,
          alpha: graphics.globalAlpha,
          y,
        });
      });
      return false;
    },
    hittest(_ctx: Context<C>, _test: HitTest): boolean {
      hits.push(item.id);
      return item.hit ?? true;
    },
  };
}

export function createTrackedRenderer<T extends VirtualizedProbeItem>(
  anchorMode: ListAnchorMode,
  items: T[],
  draws: DrawProbe[],
  hits: string[] = [],
  viewportHeight = 120,
  underflowAlign: ListUnderflowAlign = "top",
  padding?: ListPadding,
): { list: ListState<T>; renderer: ListRenderer<C, T> } {
  const list = new ListState<T>(items);
  const renderItem = memoRenderItem<C, T>((item) =>
    createTrackedItemNode(item, draws, hits),
  );
  return {
    list,
    renderer: createListRenderer(viewportHeight, {
      anchorMode,
      underflowAlign,
      padding,
      list,
      renderItem,
    }),
  };
}

export function createTopTrackedRenderer<T extends VirtualizedProbeItem>(
  items: T[],
  draws: DrawProbe[],
  hits: string[] = [],
  viewportHeight = 120,
  underflowAlign: ListUnderflowAlign = "top",
  padding?: ListPadding,
): { list: ListState<T>; renderer: ListRenderer<C, T> } {
  return createTrackedRenderer(
    "top",
    items,
    draws,
    hits,
    viewportHeight,
    underflowAlign,
    padding,
  );
}

export function createBottomTrackedRenderer<T extends VirtualizedProbeItem>(
  items: T[],
  draws: DrawProbe[],
  hits: string[] = [],
  viewportHeight = 120,
  underflowAlign: ListUnderflowAlign = "top",
  padding?: ListPadding,
): { list: ListState<T>; renderer: ListRenderer<C, T> } {
  return createTrackedRenderer(
    "bottom",
    items,
    draws,
    hits,
    viewportHeight,
    underflowAlign,
    padding,
  );
}

export function withMockedNow<T>(now: { current: number }, run: () => T): T {
  const restoreNow = mockPerformanceNow(now);
  try {
    return run();
  } finally {
    restoreNow();
  }
}
