# chat-layout

Canvas-based layout primitives for chat and timeline UIs.

The current v2-style APIs are:

- `Flex`: row/column layout
- `FlexItem`: explicit `grow` / `shrink` / `alignSelf`
- `Place`: place a single child at `start` / `center` / `end`
- `ShrinkWrap`: search the narrowest width that keeps the current height stable
- `MultilineText`: text layout with logical `align` or physical `physicalAlign`
- `ListRenderer` + `ListState`: virtualized chat or timeline rendering
- `memoRenderItem` / `memoRenderItemBy`: item render memoization

## Quick example

Use `Flex` to build structure, `FlexItem` to control resize behavior, `ShrinkWrap` to keep the bubble as narrow as possible without adding lines, and `Place` to align the final bubble:

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

const body = new ShrinkWrap(
  new Flex([senderLine, bubble], {
    direction: "column",
    gap: 4,
    alignItems: item.sender === "A" ? "end" : "start",
  }),
);

const row = new Flex(
  [
    avatar,
    new FlexItem(
      new Place(body, {
        align: item.sender === "A" ? "end" : "start",
      }),
      { grow: 1, shrink: 1 },
    ),
  ],
  { direction: "row", gap: 4, reverse: item.sender === "A" },
);

return row;
```

See [example/chat.ts](./example/chat.ts) for a full chat example.

## List insert animation

`pushAll()` and `unshiftAll()` can opt into short-list insertion animations. They only animate when the previous rendered frame still had spare space below the last item; otherwise they fall back to the normal hard cut:

```ts
list.pushAll([nextMessage], {
  distance: 24, // duration defaults to 220ms when animation options are present
});

list.unshiftAll([olderMessage], {
  duration: 220,
});
```

To make chat-style inserts automatically follow the latest visible edge, pass `autoFollow: true`. When the corresponding auto-follow latch is armed, the insert behaves like a conditional `jumpToTop()` / `jumpToBottom()` after the items are inserted:

```ts
list.pushAll([nextMessage], {
  autoFollow: true,
  duration: 220,
});
```

## Layout notes

- `Flex` handles the main axis only. It shrink-wraps on the cross axis unless you opt into stretch behavior.
- `maxWidth` / `maxHeight` limit measurement, but do not automatically make children fill the cross axis.
- Use `alignItems: "stretch"` or `alignSelf: "stretch"` when a child should fill the computed cross size.
- `Place` is the simplest way to align a single bubble left, center, or right.
- `ShrinkWrap` is useful when a bubble sits inside a growable slot but should still collapse to the narrowest width that preserves its current line count.
- `MultilineText.align` uses logical values: `start`, `center`, `end`.
- `MultilineText.physicalAlign` uses physical values: `left`, `center`, `right`.
- `Text` and `MultilineText` default to `whiteSpace: "normal"`, using the library's canvas-first collapsible whitespace behavior.
- Use `whiteSpace: "pre-wrap"` when blank lines, hard breaks, or edge spaces must stay visible.
- `Text` and `MultilineText` default to `overflowWrap: "break-word"`, which preserves compatibility-first min-content sizing for shrink layouts.
- Use `overflowWrap: "anywhere"` when long unspaced strings should contribute grapheme-level breakpoints to min-content sizing.
- `Text` supports `overflow: "ellipsis"` with `ellipsisPosition: "start" | "end" | "middle"` when measured under a finite `maxWidth`.
- `Text` and `MultilineText` both accept either a plain string or `InlineSpan[]` for mixed inline styles.
- `MultilineText` supports `overflow: "ellipsis"` together with `maxLines`; values below `1` are treated as `1`.

## Text ellipsis

Single-line `Text` can ellipsize at the start, end, or middle when a finite width constraint is present:

```ts
const title = new Text(
  [
    { text: "Extremely long " },
    { text: "thread title", font: "700 16px system-ui", color: "#0f766e" },
    { text: " that should not blow out the row" },
  ],
  {
    lineHeight: 20,
    font: "16px system-ui",
    color: "#111",
    overflow: "ellipsis",
    ellipsisPosition: "middle",
  },
);
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

## Text justification

`MultilineText` supports two-end justification (justify) as a draw-phase decoration. It does not affect measurement or layout:

```ts
const justified = new MultilineText(paragraph, {
  lineHeight: 20,
  font: "16px system-ui",
  color: "#111",
  align: "start",
  justify: true, // or "inter-word" | "inter-character"
  justifyLastLine: false, // default: last line uses normal alignment
  justifyGapThreshold: 2.0, // max gap ratio before fallback
});
```

Notes:

- `justify: true` is equivalent to `"inter-word"` mode, which expands spaces between words via `ctx.wordSpacing`.
- `"inter-character"` mode distributes extra space after every character via `ctx.letterSpacing`.
- Requires browser support for `CanvasRenderingContext2D.wordSpacing` / `letterSpacing`. When unsupported, justify is silently disabled.
- Lines that exceed `justifyGapThreshold`, have no expandable gaps, or are the last line (unless `justifyLastLine: true`) fall back to `align` / `physicalAlign`.
- `overflow: "ellipsis"` truncated lines are never justified.
- `measure()` and `measureMinContent()` are not affected by justify options.
- Works with both plain text and `InlineSpan[]` rich text.

## Shrink behavior

- `FlexItemOptions.shrink` defaults to `0`, so old layouts keep their previous behavior unless you opt in.
- Shrink only applies when there is a finite main-axis constraint and total content size overflows it.
- Overflow is redistributed by `shrink * basis`; today `basis` is internal-only and always `"auto"`.
- Custom nodes can implement `measureMinContent()` for better shrink results.
- `ShrinkWrap` complements flex shrink: it keeps probing narrower `maxWidth` values until the child would become taller, then uses the last safe width as the final layout.
- Known limitation: column shrink with `MultilineText` does not clip drawing by itself.

## Migration notes

- Use `memoRenderItemBy(keyOf, renderItem)` when list items are primitives.
- `memoRenderItemBy()` now uses a bounded LRU cache by default; pass `{ maxEntries: Infinity }` to keep the old unbounded behavior explicitly.
- `FlexItem` exposes `grow`, `shrink`, and `alignSelf`; `basis` is no longer public.
- `MultilineText` now uses `align` / `physicalAlign` instead of `alignment`.
- `ListState.position` uses `undefined` for the renderer default anchor.
- Use `list.applyScroll(delta)` for relative scrolling, or renderer `jumpTo()` / `jumpToTop()` / `jumpToBottom()` for absolute navigation.

## Development

Install dependencies:

```bash
bun install
```

Type-check:

```bash
bun run typecheck
```

Run tests:

```bash
bun run test
```

Run tests with coverage:

```bash
bun run test:coverage
```

Run the local verification bundle:

```bash
bun run check
```

Build distributable files:

```bash
bun run dist
```

Build the chat example:

```bash
bun run example
```

文本性能观测基线见 `docs/text-performance.md`。
