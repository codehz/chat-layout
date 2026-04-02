# chat-layout

Canvas-based chat and timeline layout primitives with a v2 flex-style layout model.

The current recommended APIs are:

- `Flex` for row/column layout
- `FlexItem` for explicit `grow`
- `Place` for single-child horizontal placement
- `Text` / `MultilineText` `alignment` for text content alignment
- `ChatRenderer` plus `ListState` for virtualized chat rendering

**Layout Model**
`Flex` and `Place` split layout concerns more clearly than the older API:

- Use `new Flex(children, { direction: "row" | "column" })` for main-axis layout.
- Use `new FlexItem(child, { grow: 1 })` when a child should consume remaining space.
- Use `new Place(child, { align: "start" | "center" | "end" })` when a single child should fill available width and then be placed left/center/right.
- Use `justifyContent`, `alignItems`, and `alignSelf` for container/item placement.
- Keep text alignment on `Text` / `MultilineText` via `alignment: "left" | "center" | "right"`.

**Example**
This is the recommended chat bubble shape used by [example/chat.ts](./example/chat.ts):

```ts
const renderItem = memoRenderItem((item: ChatItem): Node<C> => {
  const senderLine = new Flex<C>(
    [avatarDot, senderLabel],
    {
      direction: "row",
      gap: 4,
      expandMain: false,
      reverse: item.sender === "A",
    },
  );

  const content = new RoundedBox(
    new MultilineText(item.content, {
      lineHeight: 20,
      font: "16px system-ui",
      style: "black",
      alignment: "left",
    }),
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

  return new Place(
    new PaddingBox(
      new Flex<C>(
        [
          avatar,
          new FlexItem(body, { grow: 1 }),
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
- wrapped message bubbles that respect available width

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
