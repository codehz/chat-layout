import type {
  Box,
  ChildLayoutResult,
  FlexLayoutResult,
  LayoutConstraints,
  LayoutRect,
} from "./types";

/**
 * 创建 LayoutRect 的辅助函数
 */
export function createRect(
  x: number,
  y: number,
  width: number,
  height: number,
): LayoutRect {
  return { x, y, width, height };
}

/**
 * 合并多个 rect 得到包含所有 rect 的最小外接矩形
 */
export function mergeRects(rects: LayoutRect[]): LayoutRect {
  if (rects.length === 0) {
    return createRect(0, 0, 0, 0);
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  return createRect(minX, minY, maxX - minX, maxY - minY);
}

/**
 * 从子节点布局结果计算容器的 contentBox
 */
export function computeContentBox<C extends CanvasRenderingContext2D>(
  children: ChildLayoutResult<C>[],
): LayoutRect {
  return mergeRects(children.map((child) => child.contentBox));
}

/**
 * 根据约束和实际内容计算最终的 containerBox
 */
export function computeContainerBox(
  contentBox: LayoutRect,
  constraints?: LayoutConstraints,
): LayoutRect {
  let width = contentBox.width;
  let height = contentBox.height;

  if (constraints?.minWidth != null) {
    width = Math.max(width, constraints.minWidth);
  }
  if (constraints?.maxWidth != null) {
    width = Math.min(width, constraints.maxWidth);
  }
  if (constraints?.minHeight != null) {
    height = Math.max(height, constraints.minHeight);
  }
  if (constraints?.maxHeight != null) {
    height = Math.min(height, constraints.maxHeight);
  }

  return createRect(contentBox.x, contentBox.y, width, height);
}

/**
 * 将 Box 转换为 LayoutRect（位置为 0,0）
 */
export function boxToRect(box: Box): LayoutRect {
  return createRect(0, 0, box.width, box.height);
}

/**
 * 检查点是否在 rect 内
 */
export function pointInRect(x: number, y: number, rect: LayoutRect): boolean {
  return (
    x >= rect.x &&
    x < rect.x + rect.width &&
    y >= rect.y &&
    y < rect.y + rect.height
  );
}

/**
 * 平移 rect 的位置
 */
export function offsetRect(
  rect: LayoutRect,
  dx: number,
  dy: number,
): LayoutRect {
  return createRect(rect.x + dx, rect.y + dy, rect.width, rect.height);
}

/**
 * 读取单子节点布局结果中的唯一 child。
 */
export function getSingleChildLayout<C extends CanvasRenderingContext2D>(
  layout: FlexLayoutResult<C>,
): ChildLayoutResult<C> | undefined {
  return layout.children[0];
}

/**
 * 在布局结果中按指定盒模型查找命中的 child，并返回局部坐标。
 */
export function findChildAtPoint<C extends CanvasRenderingContext2D>(
  children: ChildLayoutResult<C>[],
  x: number,
  y: number,
  box: "rect" | "contentBox" = "contentBox",
):
  | {
      child: ChildLayoutResult<C>;
      localX: number;
      localY: number;
    }
  | undefined {
  for (let i = children.length - 1; i >= 0; i -= 1) {
    const child = children[i]!;
    const target = box === "rect" ? child.rect : child.contentBox;
    if (!pointInRect(x, y, target)) {
      continue;
    }
    return {
      child,
      localX: x - target.x,
      localY: y - target.y,
    };
  }
  return undefined;
}
