import {
  AlignBox,
  ChatRenderer,
  Fixed,
  HStack,
  ListState,
  MultilineText,
  PaddingBox,
  Text,
  VStack,
  Wrapper,
  memoRenderItem,
  type Context,
  type DynValue,
  type HitTest,
  type Node,
  type RenderFeedback,
} from "..";

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
    const { width, height } = ctx.measureNode(this);
    ctx.with((g) => {
      const fill = this.fill == null ? undefined : ctx.resolveDynValue(this.fill);
      const stroke = this.stroke == null ? undefined : ctx.resolveDynValue(this.stroke);
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
  const senderLine = new HStack<C>(
    [
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
      new HoverDetector(
        new Circle(15, {
          fill: "blue",
        }),
        item,
      ),
    ],
    { gap: 4 },
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
      fill: () => (currentHover === item ? "#aaa" : "#ccc"),
    },
  );

  const row = new HStack<C>(
    [
      new Circle(32, { fill: "red" }),
      new VStack<C>([senderLine, content]),
      new Fixed(32, 0),
    ],
    {
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

  return new AlignBox(padded, {
    alignment: item.sender === "A" ? "right" : "left",
  });
});

const list = new ListState<ChatItem>();
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

function randomText(words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i += 1) {
    out.push(sampleWords[Math.floor(Math.random() * sampleWords.length)]);
  }
  return out.join(" ");
}

list.pushAll([
  { sender: "A", content: randomText(20) },
  { sender: "B", content: "aaaa" },
  { sender: "B", content: "aaaabbb" },
  { sender: "B", content: "测试中文" },
  { sender: "B", content: "测试aa中文aaa" },
  { sender: "B", content: randomText(5) },
]);

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

button("jump latest (no anim)", () => {
  renderer.jumpTo(list.items.length - 1, {
    animated: false,
  });
});
