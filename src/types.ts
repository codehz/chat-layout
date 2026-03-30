export type DynValue<C extends CanvasRenderingContext2D, T> = T extends Function
  ? never
  : T | ((context: C) => T);

export interface RendererOptions {}

export interface RenderFeedback {
  minIdx: number;
  maxIdx: number;
  min: number;
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
