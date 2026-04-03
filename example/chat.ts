import {
  ChatRenderer,
  Flex,
  FlexItem,
  Fixed,
  ListState,
  MultilineText,
  PaddingBox,
  Place,
  Text,
  Wrapper,
  memoRenderItem,
  type Context,
  type DynValue,
  type HitTest,
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

type ChatItem = {
  sender: string;
  content: string;
  reply?: {
    sender: string;
    content: string;
  };
};

let currentHover: ChatItem | undefined;

class HoverDetector extends Wrapper<C> {
  constructor(
    inner: Node<C>,
    readonly item: ChatItem,
  ) {
    super(inner);
  }

  hittest(_ctx: Context<C>, _test: HitTest): boolean {
    currentHover = this.item;
    return true;
  }
}

const renderItem = memoRenderItem((item: ChatItem): Node<C> => {
  const senderLine = new Flex<C>(
    [
      new HoverDetector(
        new Circle(15, {
          fill: "blue",
        }),
        item,
      ),
      new RoundedBox(
        new Text(item.sender, {
          lineHeight: 15,
          font: "12px system-ui",
          style: "black",
        }),
        {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          radii: 2,
          fill: () => (currentHover === item ? "red" : "transparent"),
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
      style: "black",
      align: "start",
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
              style: () => (currentHover === item ? "#4d4d4d" : "#666"),
            }),
            new MultilineText(item.reply.content, {
              lineHeight: 16,
              font: "13px system-ui",
              style: () => (currentHover === item ? "#222" : "#444"),
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
          fill: () => (currentHover === item ? "#c2c2c2" : "#e2e2e2"),
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
    fill: () => (currentHover === item ? "#aaa" : "#ccc"),
  });

  const body = new Flex<C>([senderLine, content], {
    direction: "column",
    gap: 4,
    alignItems: item.sender === "A" ? "end" : "start",
  });

  const alignedBody = new Place<C>(body, {
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

  return new Place(padded, {
    align: item.sender === "A" ? "end" : "start",
  });
});

const list = new ListState<ChatItem>([
  {
    sender: "A",
    content:
      "hello world chat layout message render bubble timeline virtualized canvas",
  },
  {
    sender: "B",
    content: "aaaa",
    reply: {
      sender: "A",
      content: "hello world chat layout message render",
    },
  },
  { sender: "B", content: "aaaabbb" },
  { sender: "B", content: "测试中文" },
  { sender: "B", content: "测试aa中文aaa" },
  {
    sender: "A",
    content: randomText(8),
    reply: {
      sender: "B",
      content: "测试aa中文aaa",
    },
  },
  { sender: "B", content: randomText(5) },
]);
const renderer = new ChatRenderer(ctx, {
  renderItem,
  list,
});

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

function randomText(words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i += 1) {
    out.push(sampleWords[Math.floor(Math.random() * sampleWords.length)]);
  }
  return out.join(" ");
}

button("unshift", () => {
  list.unshift({
    sender: Math.random() < 0.5 ? "A" : "B",
    content: randomText(10 + Math.floor(200 * Math.random())),
  });
});

button("push", () => {
  list.push({
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
