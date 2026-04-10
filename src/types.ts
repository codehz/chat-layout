/**
 * A value that can be provided directly or derived lazily from the active canvas context.
 */
export type DynValue<C extends CanvasRenderingContext2D, T> = T extends Function
  ? never
  : T | ((context: C) => T);

/**
 * Base renderer configuration.
 */
export interface RendererOptions {}

/**
 * Describes which items are currently visible after a render pass.
 */
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

/**
 * The main axis direction used by flex containers.
 */
export type Axis = "row" | "column";

/**
 * Distribution modes for free space along the main axis.
 */
export type MainAxisAlignment =
  | "start"
  | "center"
  | "end"
  | "space-between"
  | "space-around"
  | "space-evenly";

/**
 * Alignment modes along the cross axis.
 */
export type CrossAxisAlignment = "start" | "center" | "end" | "stretch";

/**
 * Controls whether a flex container fills the available main-axis size or shrink-wraps its content.
 */
export type MainAxisSize = "fill" | "fit-content";

/**
 * Logical inline alignment.
 */
export type TextAlign = "start" | "center" | "end";

/**
 * Physical inline alignment.
 */
export type PhysicalTextAlign = "left" | "center" | "right";

/**
 * Whitespace handling mode for text measurement and layout.
 */
export type TextWhiteSpaceMode = "normal" | "pre-wrap";

/**
 * Text overflow behavior when content exceeds a finite width constraint.
 */
export type TextOverflowMode = "clip" | "ellipsis";

/**
 * Word breaking mode used by the internal canvas text layout engine.
 */
export type TextWordBreakMode = "normal" | "keep-all";

/**
 * Controls whether soft wrap opportunities affect min-content sizing.
 */
export type TextOverflowWrapMode = "break-word" | "anywhere";

/**
 * Placement of the ellipsis glyph for single-line text.
 */
export type TextEllipsisPosition = "start" | "end" | "middle";

/**
 * Shared text styling options for text nodes.
 */
export interface TextStyleOptions<C extends CanvasRenderingContext2D> {
  /** Height of each rendered line in CSS pixels. */
  lineHeight: number;
  /** Canvas font string used for measurement and drawing. */
  font: string;
  /** Color or resolver used when drawing the text. */
  color: DynValue<C, string>;
  /** Default: normal; uses canvas-first CSS-style collapsible whitespace behavior. */
  whiteSpace?: TextWhiteSpaceMode;
  /** Default: normal; use keep-all for CJK-friendly line breaking. */
  wordBreak?: TextWordBreakMode;
  /** Default: break-word; use anywhere when min-content should honor grapheme break opportunities. */
  overflowWrap?: TextOverflowWrapMode;
}

/**
 * A span-like inline text fragment used by rich text nodes.
 */
export interface InlineSpan<C extends CanvasRenderingContext2D> {
  /** Source text contained in this inline fragment. */
  text: string;
  /** Canvas font string override for this fragment. Falls back to the node-level font. */
  font?: string;
  /** Color override for this fragment. Falls back to the node-level color. */
  color?: DynValue<C, string>;
  /** Optional break hint for atomic inline spans. */
  break?: "normal" | "never";
  /** Optional extra occupied width appended after the span's rendered text. */
  extraWidth?: number;
}

/**
 * Two-end justification mode for multi-line text.
 * `"inter-word"` expands only collapsible spaces.
 * `"inter-character"` is script-aware and may combine `wordSpacing` with `letterSpacing`.
 */
export type TextJustifyMode = "inter-word" | "inter-character";

/**
 * Options controlling two-end justification behavior.
 */
export interface TextJustifyOptions {
  /**
   * Enable two-end justification. Default: false.
   * `true` uses "inter-word" mode.
   * `"inter-character"` may combine `wordSpacing` and `letterSpacing` internally.
   */
  justify?: boolean | TextJustifyMode;

  /**
   * Whether to justify the last line as well. Default: false.
   */
  justifyLastLine?: boolean;

  /**
   * Maximum ratio of a single gap relative to the average word/char width.
   * Lines exceeding this threshold fall back to normal alignment.
   * Default: 2.0. Set to Infinity to disable.
   */
  justifyGapThreshold?: number;
}

/**
 * Options for multi-line text nodes.
 */
export interface MultilineTextOptions<C extends CanvasRenderingContext2D>
  extends TextStyleOptions<C>, TextJustifyOptions {
  /** Logical alignment that matches `Place.align`. */
  align?: TextAlign;
  /** Explicit physical alignment when left/right semantics are required. */
  physicalAlign?: PhysicalTextAlign;
  /** Default: clip hidden overflow; `ellipsis` only applies when `maxLines` truncates visible lines. */
  overflow?: TextOverflowMode;
  /** Maximum visible line count. Values below `1` are clamped to `1`. */
  maxLines?: number;
}

/**
 * Options for single-line text nodes.
 */
export interface TextOptions<
  C extends CanvasRenderingContext2D,
> extends TextStyleOptions<C> {
  /** Default: clip overflow to the constrained first line. */
  overflow?: TextOverflowMode;
  /** Default: place the ellipsis at the end of the visible text. */
  ellipsisPosition?: TextEllipsisPosition;
}

/**
 * Optional layout bounds passed down during measurement and drawing.
 */
export interface LayoutConstraints {
  /** Minimum width the node should occupy. */
  minWidth?: number;
  /** Maximum width the node may occupy. */
  maxWidth?: number;
  /** Minimum height the node should occupy. */
  minHeight?: number;
  /** Maximum height the node may occupy. */
  maxHeight?: number;
}

/**
 * Per-child flex behavior overrides.
 */
export interface FlexItemOptions {
  /** Share of positive free space assigned to this item. */
  grow?: number;
  /** Compatibility-first default: 0 (opt-in shrink). */
  shrink?: number;
  /** Cross-axis alignment override for this item. */
  alignSelf?: CrossAxisAlignment | "auto";
}

/**
 * Configuration for a flex container node.
 */
export interface FlexContainerOptions {
  /** Main axis direction. Defaults to `"row"`. */
  direction?: Axis;
  /** Gap inserted between adjacent items. */
  gap?: number;
  /** Main-axis distribution of free space. */
  justifyContent?: MainAxisAlignment;
  /** Default cross-axis alignment for children. */
  alignItems?: CrossAxisAlignment;
  /** Whether children should be laid out in reverse order. */
  reverse?: boolean;
  /** Whether the container fills or shrink-wraps the main axis. */
  mainAxisSize?: MainAxisSize;
}

/**
 * Runtime services exposed to every node during layout, drawing, and hit-testing.
 */
export interface Context<C extends CanvasRenderingContext2D> {
  /** The backing canvas rendering context. */
  graphics: C;

  /** Active layout constraints for the current call stack. */
  constraints?: LayoutConstraints;

  /** Measures another node under optional constraints. */
  measureNode(node: Node<C>, constraints?: LayoutConstraints): Box;
  /** Invalidates cached measurements for a node and its ancestors. */
  invalidateNode(node: Node<C>): void;
  /** Resolves a dynamic value against the current graphics context. */
  resolveDynValue<T>(value: DynValue<C, T>): T;
  /** Saves the canvas state for the callback and restores it afterwards. */
  with<T>(this: Context<C>, cb: (g: C) => T): T;
}

/**
 * Width and height pair in CSS pixels.
 */
export interface Box {
  width: number;
  height: number;
}

/**
 * Pointer test input routed through the node tree.
 */
export interface HitTest {
  x: number;
  y: number;
  type: "click" | "auxclick" | "hover";
}

/**
 * Fundamental layout node contract.
 */
export interface Node<C extends CanvasRenderingContext2D> {
  /** Measure the node under the current layout constraints. */
  measure(ctx: Context<C>): Box;
  /** Optional intrinsic lower bound used by flex-shrink saturation. */
  measureMinContent?(ctx: Context<C>): Box;
  draw(ctx: Context<C>, x: number, y: number): boolean;
  hittest(ctx: Context<C>, test: HitTest): boolean;
}

/**
 * Rectangular region in local coordinates.
 */
export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Stored layout data for a single child node.
 */
export interface ChildLayoutResult<C extends CanvasRenderingContext2D> {
  node: Node<C>;
  rect: LayoutRect;
  contentBox: LayoutRect;
  constraints?: LayoutConstraints;
}

/**
 * Cached layout data for a container and its children.
 */
export interface FlexLayoutResult<C extends CanvasRenderingContext2D> {
  containerBox: LayoutRect;
  contentBox: LayoutRect;
  children: ChildLayoutResult<C>[];
  constraints?: LayoutConstraints;
}
