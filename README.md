# chat-layout

Canvas-based layout primitives for chat and timeline UIs.

The current v2-style APIs are:

- `Flex`: row/column layout
- `FlexItem`: explicit `grow` / `shrink` / `alignSelf`
- `Place`: place a single child at `start` / `center` / `end`
- `MultilineText`: text layout with logical `align` or physical `physicalAlign`
- `ChatRenderer` + `ListState`: virtualized chat rendering
- `memoRenderItem` / `memoRenderItemBy`: item render memoization

## Quick example

Use `Flex` to build structure, `FlexItem` to control resize behavior, and `Place` to align the final bubble:

```ts
const bubble = new RoundedBox(
  new MultilineText(item.content, {
    lineHeight: 20,
    font: "16px system-ui",
    color: "black",
    align: "start",
  }),
  { top: 6, bottom: 6, left: 10, right: 10, radii: 8, fill: "#ccc" },
);

const row = new Flex(
  [
    avatar,
    new FlexItem(bubble, { grow: 1, shrink: 1 }),
  ],
  { direction: "row", gap: 4, reverse: item.sender === "A" },
);

return new Place(row, {
  align: item.sender === "A" ? "end" : "start",
});
```

See [example/chat.ts](./example/chat.ts) for a full chat example.

## Layout notes

- `Flex` handles the main axis only. It shrink-wraps on the cross axis unless you opt into stretch behavior.
- `maxWidth` / `maxHeight` limit measurement, but do not automatically make children fill the cross axis.
- Use `alignItems: "stretch"` or `alignSelf: "stretch"` when a child should fill the computed cross size.
- `Place` is the simplest way to align a single bubble left, center, or right.
- `MultilineText.align` uses logical values: `start`, `center`, `end`.
- `MultilineText.physicalAlign` uses physical values: `left`, `center`, `right`.
- `Text` and `MultilineText` default to `whiteSpace: "normal"`, matching pretext and CSS-style collapsible whitespace.
- Use `whiteSpace: "pre-wrap"` when blank lines, hard breaks, or edge spaces must stay visible.
- `Text` and `MultilineText` default to `overflowWrap: "break-word"`, which preserves compatibility-first min-content sizing for shrink layouts.
- Use `overflowWrap: "anywhere"` when long unspaced strings should contribute grapheme-level breakpoints to min-content sizing.
- `Text` supports `overflow: "ellipsis"` with `ellipsisPosition: "start" | "end" | "middle"` when measured under a finite `maxWidth`.
- `MultilineText` supports `overflow: "ellipsis"` together with `maxLines`; values below `1` are treated as `1`.

## Text ellipsis

Single-line `Text` can ellipsize at the start, end, or middle when a finite width constraint is present:

```ts
const title = new Text("Extremely long thread title that should not blow out the row", {
  lineHeight: 20,
  font: "16px system-ui",
  color: "#111",
  overflow: "ellipsis",
  ellipsisPosition: "middle",
});
```

Multi-line `MultilineText` can cap the visible line count and convert the last visible line to an end ellipsis:

```ts
const preview = new MultilineText(reply.content, {
  lineHeight: 16,
  font: "13px system-ui",
  color: "#444",
  align: "start",
  overflowWrap: "anywhere",
  overflow: "ellipsis",
  maxLines: 2,
});
```

Notes:

- Ellipsis is only inserted when the node is measured under a finite `maxWidth` and content actually overflows that constraint.
- `MultilineText` only supports end ellipsis on the last visible line; start/middle ellipsis are intentionally single-line only.
- `maxLines` defaults to unlimited, and values below `1` are clamped to `1`.
- `overflowWrap: "break-word"` keeps the current min-content behavior; `overflowWrap: "anywhere"` lets long unspaced strings shrink inside flex layouts such as chat bubbles.
- Current `measureMinContent()` behavior stays compatibility-first: ellipsis affects constrained measurement/drawing, but does not lower the min-content shrink floor by itself.

## Shrink behavior

- `FlexItemOptions.shrink` defaults to `0`, so old layouts keep their previous behavior unless you opt in.
- Shrink only applies when there is a finite main-axis constraint and total content size overflows it.
- Overflow is redistributed by `shrink * basis`; today `basis` is internal-only and always `"auto"`.
- Custom nodes can implement `measureMinContent()` for better shrink results.
- Known limitation: column shrink with `MultilineText` does not clip drawing by itself.

## Migration notes

- Use `memoRenderItemBy(keyOf, renderItem)` when list items are primitives.
- `FlexItem` exposes `grow`, `shrink`, and `alignSelf`; `basis` is no longer public.
- `MultilineText` now uses `align` / `physicalAlign` instead of `alignment`.
- `ListState.position` uses `undefined` for the renderer default anchor.
- Use `list.resetScroll()` or `list.setAnchor(index, offset)` instead of assigning `Number.NaN`.

## Development

Install dependencies:

```bash
bun install
```

Type-check:

```bash
bun run typecheck
```

Build distributable files:

```bash
bun run dist
```

Build the chat example:

```bash
bun run example
```
