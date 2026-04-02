export type DynValue<C extends CanvasRenderingContext2D, T> = T extends Function
  ? never
  : T | ((context: C) => T);

export interface RendererOptions {}

export interface RenderFeedback {
  /** Smallest visible item index that contributes a positive visible height. */
  minIdx: number;
  /** Largest visible item index that contributes a positive visible height. */
  maxIdx: number;
  /** Smallest visible continuous item position, expressed in item coordinates rather than pixels. */
  min: number;
  /** Largest visible continuous item position, expressed in item coordinates rather than pixels. */
  max: number;
}

// v2 Flex Layout types
export type Axis = "row" | "column";

export type MainAxisAlignment =
  | "start"
  | "center"
  | "end"
  | "space-between"
  | "space-around"
  | "space-evenly";

export type CrossAxisAlignment = "start" | "center" | "end" | "stretch";
export type MainAxisSize = "fill" | "fit-content";

export type TextAlign = "start" | "center" | "end";
export type PhysicalTextAlign = "left" | "center" | "right";
export type TextWhitespaceMode = "preserve" | "trim-and-collapse";

export interface TextStyleOptions<C extends CanvasRenderingContext2D> {
  lineHeight: number;
  font: string;
  style: DynValue<C, string>;
  /** Default: preserve input whitespace, including blank lines and edge spaces. */
  whitespace?: TextWhitespaceMode;
}

export interface MultilineTextOptions<C extends CanvasRenderingContext2D> extends TextStyleOptions<C> {
  /** Logical alignment that matches `Place.align`. */
  align?: TextAlign;
  /** Explicit physical alignment when left/right semantics are required. */
  physicalAlign?: PhysicalTextAlign;
  /** @deprecated Use `align` or `physicalAlign` instead. */
  alignment?: PhysicalTextAlign;
}

export interface TextOptions<C extends CanvasRenderingContext2D> extends TextStyleOptions<C> {}

export interface LayoutConstraints {
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

export interface FlexItemOptions {
  grow?: number;
  alignSelf?: CrossAxisAlignment | "auto";
}

export interface FlexContainerOptions {
  direction?: Axis;
  gap?: number;
  justifyContent?: MainAxisAlignment;
  alignItems?: CrossAxisAlignment;
  reverse?: boolean;
  mainAxisSize?: MainAxisSize;
}

export interface Context<C extends CanvasRenderingContext2D> {
  graphics: C;

  /** v2: 显式布局约束 */
  constraints?: LayoutConstraints;

  measureNode(node: Node<C>, constraints?: LayoutConstraints): Box;
  invalidateNode(node: Node<C>): void;
  resolveDynValue<T>(value: DynValue<C, T>): T;
  with<T>(this: Context<C>, cb: (g: C) => T): T;
}

export interface Box {
  width: number;
  height: number;
}

export interface HitTest {
  x: number;
  y: number;
  type: "click" | "auxclick" | "hover";
}

export interface Node<C extends CanvasRenderingContext2D> {
  measure(ctx: Context<C>): Box;
  draw(ctx: Context<C>, x: number, y: number): boolean;
  hittest(ctx: Context<C>, test: HitTest): boolean;
}

// v2: 统一布局结果结构
export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChildLayoutResult<C extends CanvasRenderingContext2D> {
  node: Node<C>;
  rect: LayoutRect;
  contentBox: LayoutRect;
  constraints?: LayoutConstraints;
}

export interface FlexLayoutResult<C extends CanvasRenderingContext2D> {
  containerBox: LayoutRect;
  contentBox: LayoutRect;
  children: ChildLayoutResult<C>[];
  constraints?: LayoutConstraints;
}
