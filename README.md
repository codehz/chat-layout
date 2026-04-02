# chat-layout

Canvas-based chat and timeline layout primitives with a v2 flex-style layout model.

The current recommended APIs are:

- `Flex` for row/column layout
- `FlexItem` for explicit `grow`
- `Place` for single-child horizontal placement
- `MultilineText` `align` / `physicalAlign` for text content alignment
- `ChatRenderer` plus `ListState` for virtualized chat rendering
- `memoRenderItem` for object items, or `memoRenderItemBy` when your stable key is primitive / explicit

**Layout Model**
`Flex` and `Place` split layout concerns more clearly than the older API:

- Use `new Flex(children, { direction: "row" | "column" })` for main-axis layout.
- Use `new FlexItem(child, { grow: 1 })` when a child should consume remaining space.
- `Flex` shrink-wraps on the cross axis by default; `maxWidth` / `maxHeight` act as measurement caps rather than implicit fill signals.
- Use `alignItems` / `alignSelf: "stretch"` when a specific child should fill the container's computed cross axis.
- Use `new Place(child, { align: "start" | "center" | "end" })` when a single child should fill available width and then be placed left/center/right.
- Use `justifyContent`, `alignItems`, and `alignSelf` for container/item placement.
- Use `align: "start" | "center" | "end"` on `MultilineText` for logical alignment that matches `Place.align`.
- Use `physicalAlign: "left" | "center" | "right"` on `MultilineText` only when you explicitly want physical left/right semantics.
- `Text` / `MultilineText` preserve blank lines and edge whitespace by default; opt into cleanup with `whitespace: "trim-and-collapse"`.

**Example**
This is the recommended chat bubble shape used by [example/chat.ts](./example/chat.ts):

```ts
type ChatItem = {
  sender: string;
  content: string;
  reply?: {
    sender: string;
    content: string;
  };
};

const renderItem = memoRenderItem((item: ChatItem): Node<C> => {
  const senderLine = new Flex<C>(
    [avatarDot, senderLabel],
    {
      direction: "row",
      gap: 4,
      mainAxisSize: "fit-content",
      reverse: item.sender === "A",
    },
  );

  const messageText = new FlexItem(
    new MultilineText(item.content, {
      lineHeight: 20,
      font: "16px system-ui",
      style: "black",
      align: "start",
    }),
    { alignSelf: "start" },
  );

  const bubbleChildren: Node<C>[] = [];
  if (item.reply != null) {
    bubbleChildren.push(
      new FlexItem(
        new RoundedBox(
          new Flex<C>(
            [
              new Text(item.reply.sender, {
                lineHeight: 14,
                font: "11px system-ui",
                style: "#666",
              }),
              new MultilineText(item.reply.content, {
                lineHeight: 16,
                font: "13px system-ui",
                style: "#444",
                align: "start",
              }),
            ],
            {
              direction: "column",
              gap: 2,
              alignItems: "start",
            },
          ),
          {
            top: 5,
            bottom: 5,
            left: 8,
            right: 8,
            radii: 6,
            fill: "#e2e2e2",
          },
        ),
        { alignSelf: "stretch" },
      ),
    );
  }
  bubbleChildren.push(messageText);

  const bubbleColumn = new Flex<C>(bubbleChildren, {
    direction: "column",
    gap: 6,
    // The bubble itself stays intrinsic on the cross axis.
    // Only the reply preview stretches to the bubble width.
    alignItems: "start",
  });

  const content = new RoundedBox(
    bubbleColumn,
    {
      top: 6,
      bottom: 6,
      left: 10,
      right: 10,
      radii: 8,
      fill: "#ccc",
    },
  );

  const body = new Flex<C>([senderLine, content], {
    direction: "column",
    alignItems: item.sender === "A" ? "end" : "start",
  });

  const alignedBody = new Place<C>(body, {
    align: item.sender === "A" ? "end" : "start",
  });

  return new Place(
    new PaddingBox(
      new Flex<C>(
        [
          avatar,
          new FlexItem(alignedBody, { grow: 1 }),
          new Fixed(32, 0),
        ],
        {
          direction: "row",
          gap: 4,
          reverse: item.sender === "A",
        },
      ),
      {
        top: 4,
        bottom: 4,
        left: 4,
        right: 4,
      },
    ),
    {
      align: item.sender === "A" ? "end" : "start",
    },
  );
});
```

That combination gives you:

- explicit row/column structure
- explicit grow behavior through `FlexItem`
- left/right chat placement through `Place`
- wrapped message bubbles that respect available width without becoming full-width by default
- nested reply previews that use item-level cross-axis `stretch` to fill the bubble width

In other words: a finite `maxWidth` / `maxHeight` limits measurement, but does not force the `Flex` container to fill the cross axis. If you want a child to fill the computed bubble width, mark that child with `alignSelf: "stretch"` (or inherit `alignItems: "stretch"` from the parent).

## API notes

- `memoRenderItem()` now only accepts object items. If your list item is a primitive or you want to memoize by an explicit id, use `memoRenderItemBy(keyOf, renderItem)`.
- `FlexItemOptions` intentionally exposes only the implemented item-level controls: `grow` and `alignSelf`. The previously documented `shrink` / `basis` fields were removed because they were never implemented.
- `ListState.position` now uses `undefined` as the explicit “use renderer default anchor” state. Use `list.setAnchor(position, offset)` to opt into a concrete anchor.
- `ListState` can be seeded with `new ListState(items)` and reset with `list.reset(nextItems)`.
- `MultilineText` prefers logical `align`; the legacy `alignment` field is kept only as a migration alias.

### Migration notes

- Before:
  - `memoRenderItem((item: number) => ...)`
- After:
  - `memoRenderItemBy((item: number) => item, (item) => ...)`
- Before:
  - `new FlexItem(node, { grow: 1, shrink: 1, basis: 100 })`
- After:
  - `new FlexItem(node, { grow: 1 })`
  - unsupported sizing semantics should be modeled explicitly in node measurement/layout instead of `shrink` / `basis`
- Before:
  - `new MultilineText(text, { alignment: "left" })`
- After:
  - `new MultilineText(text, { align: "start" })`
  - or `new MultilineText(text, { physicalAlign: "left" })` when physical left/right semantics are required
- Before:
  - `list.position = Number.NaN`
- After:
  - `list.resetScroll()`
  - or `list.setAnchor(index, offset)` for an explicit anchor

**Development**
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
