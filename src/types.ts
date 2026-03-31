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

export type Alignment = "left" | "center" | "right";

export interface Context<C extends CanvasRenderingContext2D> {
  graphics: C;

  remainingWidth: number;
  alignment: Alignment;
  reverse: boolean;

  measureNode(node: Node<C>): Box;
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
  readonly flex: boolean;
}
