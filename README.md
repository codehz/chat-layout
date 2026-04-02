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
      alignment: "left",
    }),
    { alignSelf: "start" },
  );

  const replyPreview = item.reply == null
    ? undefined
    : new RoundedBox(
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
              alignment: "left",
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
      );

  const content = new RoundedBox(
    new Flex<C>(
      replyPreview == null ? [messageText] : [replyPreview, messageText],
      {
        direction: "column",
        gap: 6,
        alignItems: item.reply == null ? "start" : "stretch",
      },
    ),
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
- nested reply previews that use cross-axis `stretch` to fill the bubble width

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
