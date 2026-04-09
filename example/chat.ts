import {
  ChatRenderer,
  Flex,
  FlexItem,
  Fixed,
  ListState,
  MultilineText,
  PaddingBox,
  Place,
  ShrinkWrap,
  Text,
  Wrapper,
  memoRenderItem,
  type Context,
  type DynValue,
  type HitTest,
  type InlineSpan,
  type Node,
  type RenderFeedback,
} from "..";

const sampleWords = [
  "hello",
  "world",
  "chat",
  "layout",
  "message",
  "render",
  "bubble",
  "timeline",
  "virtualized",
  "canvas",
  "stream",
  "session",
  "update",
  "typing",
  "history",
];

type C = CanvasRenderingContext2D;

class RoundedBox extends PaddingBox<C> {
  readonly radii: number | DOMPointInit | (number | DOMPointInit)[];
  readonly stroke: DynValue<C, string | undefined>;
  readonly fill: DynValue<C, string | undefined>;

  constructor(
    inner: Node<C>,
    {
      radii,
      stroke,
      fill,
      ...options
    }: {
      top?: number;
      bottom?: number;
      left?: number;
      right?: number;
      stroke?: DynValue<C, string | undefined>;
      fill?: DynValue<C, string | undefined>;
      radii: number | DOMPointInit | (number | DOMPointInit)[];
    },
  ) {
    super(inner, options);
    this.radii = radii;
    this.stroke = stroke;
    this.fill = fill;
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    // Reuse the current layout constraints so the background matches wrapped text.
    const { width, height } = ctx.measureNode(this, ctx.constraints);
    ctx.with((g) => {
      const fill =
        this.fill == null ? undefined : ctx.resolveDynValue(this.fill);
      const stroke =
        this.stroke == null ? undefined : ctx.resolveDynValue(this.stroke);
      g.beginPath();
      g.roundRect(x, y, width, height, this.radii);
      if (fill != null) {
        g.fillStyle = fill;
      }
      if (stroke != null) {
        g.strokeStyle = stroke;
      }
      if (fill != null) {
        g.fill();
      }
      if (stroke != null) {
        g.stroke();
      }
    });
    return super.draw(ctx, x, y);
  }
}

class Circle extends Fixed<C> {
  constructor(
    readonly size: number,
    readonly options: {
      fill: DynValue<C, string>;
    },
  ) {
    super(size, size);
  }

  draw(ctx: Context<C>, x: number, y: number): boolean {
    ctx.with((g) => {
      g.fillStyle = ctx.resolveDynValue(this.options.fill);
      g.beginPath();
      const radius = this.size / 2;
      g.arc(x + radius, y + radius, radius, 0, 2 * Math.PI, false);
      g.fill();
    });
    return false;
  }
}

function button(text: string, action: () => void): void {
  const btn = document.body.appendChild(document.createElement("button"));
  btn.textContent = text;
  btn.onclick = action;
}

const canvas = document.body.appendChild(document.createElement("canvas"));
canvas.width = canvas.clientWidth * devicePixelRatio;
canvas.height = canvas.clientHeight * devicePixelRatio;

const context = canvas.getContext("2d");
if (context == null) {
  throw new Error("Failed to initial canvas");
}
const ctx: C = context;
ctx.scale(devicePixelRatio, devicePixelRatio);

type ReplyPreview = {
  sender: string;
  content: string | InlineSpan<C>[];
};

type BaseChatItem = {
  id: number;
  sender: string;
};

type MessageItem = BaseChatItem & {
  kind: "message";
  content: string | InlineSpan<C>[];
  reply?: ReplyPreview;
};

type RevokedItem = BaseChatItem & {
  kind: "revoked";
  original: MessageItem;
};

type ChatItem = MessageItem | RevokedItem;

const richTextMessage: InlineSpan<C>[] = [
  { text: "现在这个 chat example 可以直接展示 " },
  { text: "rich text", font: "700 16px system-ui", color: "#0f766e" },
  { text: " 了，支持 " },
  { text: "颜色", color: "#2563eb" },
  { text: "、" },
  { text: "粗体", font: "700 16px system-ui", color: "#b91c1c" },
  { text: "，以及 " },
  { text: "inline code", font: "15px ui-monospace, SFMono-Regular, Consolas, monospace", color: "#7c3aed" },
  { text: " 这样的片段混排。" },
];

const richReplyPreview: InlineSpan<C>[] = [
  { text: "回复预览里也能用 " },
  { text: "rich text", font: "700 13px system-ui", color: "#0f766e" },
  { text: "，比如 " },
  { text: "关键词高亮", color: "#2563eb" },
  { text: " 和 " },
  { text: "code()", font: "12px ui-monospace, SFMono-Regular, Consolas, monospace", color: "#7c3aed" },
  {
    text: "，超长内容仍然会按原来的两行省略规则收起，不需要额外处理。",
  },
];

let currentHover: ChatItem | undefined;
const REPLACE_ANIMATION_DURATION = 320;

function revokeMessage(item: MessageItem): RevokedItem {
  return {
    id: item.id,
    sender: item.sender,
    kind: "revoked",
    original: item,
  };
}

class ItemDetector extends Wrapper<C> {
  constructor(
    inner: Node<C>,
    readonly item: ChatItem,
  ) {
    super(inner);
  }

  hittest(_ctx: Context<C>, test: HitTest): boolean {
    currentHover = this.item;
    if (test.type === "click") {
      const index = list.items.indexOf(this.item);
      if (index < 0) {
        return true;
      }
      const nextItem = this.item.kind === "revoked" ? this.item.original : revokeMessage(this.item);
      currentHover = nextItem;
      list.replace(index, nextItem, {
        duration: REPLACE_ANIMATION_DURATION,
      });
    }
    return true;
  }
}

const renderItem = memoRenderItem((item: ChatItem): Node<C> => {
  if (item.kind === "revoked") {
    return new ItemDetector(
      new Place(
        new PaddingBox(
          new RoundedBox(
            new Text(`${item.sender}已撤回一条消息`, {
              lineHeight: 18,
              font: "14px system-ui",
              color: () => (currentHover?.id === item.id ? "#525252" : "#666"),
              overflow: "ellipsis",
            }),
            {
              top: 10,
              bottom: 10,
              left: 12,
              right: 12,
              radii: 999,
              fill: () => (currentHover?.id === item.id ? "#d9d9d9" : "#ececec"),
              stroke: () => (currentHover?.id === item.id ? "#bcbcbc" : "#d3d3d3"),
            },
          ),
          {
            top: 8,
            bottom: 8,
            left: 4,
            right: 4,
          },
        ),
        {
          align: item.sender === "A" ? "end" : "start",
        },
      ),
      item,
    );
  }

  const senderLine = new Flex<C>(
    [
      new Circle(15, {
        fill: "blue",
      }),
      new RoundedBox(
        new Text(item.sender, {
          lineHeight: 15,
          font: "12px system-ui",
          color: "black",
        }),
        {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          radii: 2,
          fill: () => (currentHover?.id === item.id ? "red" : "transparent"),
        },
      ),
    ],
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
      color: "black",
      align: "start",
      overflowWrap: "anywhere",
    }),
    { alignSelf: "start" },
  );

  const bubbleChildren: Node<C>[] = [];
  if (item.reply != null) {
    const replyPreview = new FlexItem(
      new RoundedBox(
        new Flex<C>(
          [
            new Text(item.reply.sender, {
              lineHeight: 14,
              font: "11px system-ui",
              color: () => (currentHover?.id === item.id ? "#4d4d4d" : "#666"),
            }),
            new MultilineText(item.reply.content, {
              lineHeight: 16,
              font: "13px system-ui",
              color: () => (currentHover?.id === item.id ? "#222" : "#444"),
              align: "start",
              overflow: "ellipsis",
              overflowWrap: "anywhere",
              maxLines: 2,
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
          fill: () => (currentHover?.id === item.id ? "#c2c2c2" : "#e2e2e2"),
        },
      ),
      { alignSelf: "stretch" },
    );
    bubbleChildren.push(replyPreview);
  }
  bubbleChildren.push(messageText);

  const bubbleColumn = new Flex<C>(bubbleChildren, {
    direction: "column",
    gap: 6,
    // The bubble itself shrink-wraps on the cross axis; only the reply preview stretches.
    alignItems: "start",
  });

  const content = new RoundedBox(bubbleColumn, {
    top: 6,
    bottom: 6,
    left: 10,
    right: 10,
    radii: 8,
    fill: () => (currentHover?.id === item.id ? "#aaa" : "#ccc"),
  });

  const body = new Flex<C>([senderLine, content], {
    direction: "column",
    gap: 4,
    alignItems: item.sender === "A" ? "end" : "start",
  });

  const shrinkWrappedBody = new ShrinkWrap<C>(body);

  const alignedBody = new Place<C>(shrinkWrappedBody, {
    align: item.sender === "A" ? "end" : "start",
  });

  const row = new Flex<C>(
    [
      new Circle(32, { fill: "red" }),
      // Opt into shrink so narrow viewports wrap the bubble body instead of overflowing the row.
      new FlexItem(alignedBody, { grow: 1, shrink: 1 }),
      new Fixed(32, 0),
    ],
    {
      direction: "row",
      gap: 4,
      reverse: item.sender === "A",
    },
  );

  const padded = new PaddingBox(row, {
    top: 4,
    bottom: 4,
    left: 4,
    right: 4,
  });

  return new ItemDetector(
    new Place(padded, {
      align: item.sender === "A" ? "end" : "start",
    }),
    item,
  );
});

const list = new ListState<ChatItem>([
  {
    id: 1,
    kind: "message",
    sender: "A",
    content:
      "hello world chat layout message render bubble timeline virtualized canvas",
  },
  {
    id: 2,
    kind: "message",
    sender: "B",
    content: richTextMessage,
    reply: {
      sender: "A",
      content: "hello world chat layout message render",
    },
  },
  { id: 3, kind: "message", sender: "B", content: "aaaabbb" },
  { id: 4, kind: "message", sender: "B", content: "测试中文" },
  {
    id: 5,
    kind: "message",
    sender: "A",
    content:
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  },
  { id: 6, kind: "message", sender: "B", content: "测试aa中文aaa" },
  {
    id: 7,
    kind: "message",
    sender: "A",
    content: randomText(8),
    reply: {
      sender: "B",
      content:
        "测试aa中文aaa hello world chat layout message render bubble timeline virtualized canvas stream session update typing history",
    },
  },
  {
    id: 8,
    kind: "message",
    sender: "B",
    content: "这里是一条会展示回复预览省略效果的消息。",
    reply: {
      sender: "A",
      content: richReplyPreview,
    },
  },
  { id: 9, kind: "message", sender: "B", content: randomText(5) },
]);
const renderer = new ChatRenderer(ctx, {
  renderItem,
  list,
});
let nextMessageId = list.items.length + 1;

function drawFrame(): void {
  const feedback: RenderFeedback = {
    minIdx: Number.NaN,
    maxIdx: Number.NaN,
    min: Number.NaN,
    max: Number.NaN,
  };
  renderer.render(feedback);

  ctx.save();
  ctx.textBaseline = "top";
  ctx.font = "12px system-ui";
  ctx.fillStyle = "black";
  ctx.strokeStyle = "white";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  const text = JSON.stringify(feedback);
  ctx.strokeText(text, 10, 10);
  ctx.fillText(text, 10, 10);
  ctx.restore();

  requestAnimationFrame(drawFrame);
}

requestAnimationFrame(drawFrame);

canvas.addEventListener("wheel", (e) => {
  list.applyScroll(-e.deltaY);
});

canvas.addEventListener("pointermove", (e) => {
  const { top, left } = canvas.getBoundingClientRect();
  const result = renderer.hittest({
    x: e.clientX - left,
    y: e.clientY - top,
    type: "hover",
  });
  if (!result) {
    currentHover = undefined;
  }
});

canvas.addEventListener("pointerleave", () => {
  currentHover = undefined;
});

canvas.addEventListener("click", (e) => {
  const { top, left } = canvas.getBoundingClientRect();
  const result = renderer.hittest({
    x: e.clientX - left,
    y: e.clientY - top,
    type: "click",
  });
  if (!result) {
    currentHover = undefined;
  }
});

function randomText(words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i += 1) {
    out.push(sampleWords[Math.floor(Math.random() * sampleWords.length)]);
  }
  return out.join(" ");
}

button("unshift", () => {
  list.unshift({
    id: nextMessageId++,
    kind: "message",
    sender: Math.random() < 0.5 ? "A" : "B",
    content: randomText(10 + Math.floor(200 * Math.random())),
  });
});

button("push", () => {
  list.push({
    id: nextMessageId++,
    kind: "message",
    sender: Math.random() < 0.5 ? "A" : "B",
    content: randomText(10 + Math.floor(200 * Math.random())),
  });
});

button("jump middle", () => {
  renderer.jumpTo(Math.floor(list.items.length / 2));
});

button("jump middle (center)", () => {
  renderer.jumpTo(Math.floor(list.items.length / 2), {
    block: "center",
  });
});

button("jump latest (no anim)", () => {
  renderer.jumpTo(list.items.length - 1, {
    animated: false,
  });
});

button("revoke first", () => {
  const item = list.items.find((entry): entry is MessageItem => entry.kind === "message");
  if (item == null) {
    return;
  }
  const index = list.items.indexOf(item);
  list.replace(index, revokeMessage(item), {
    duration: REPLACE_ANIMATION_DURATION,
  });
});
