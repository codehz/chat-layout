import {
  AlignBox,
  DebugRenderer,
  HStack,
  MultilineText,
  PaddingBox,
  Text,
  VStack,
  Wrapper,
  type Context,
  type DynValue,
  type HitTest,
  type Node,
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
      top: number;
      bottom: number;
      left: number;
      right: number;
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

const canvas = document.createElement("canvas");
document.body.appendChild(canvas);
canvas.width = canvas.clientWidth * devicePixelRatio;
canvas.height = canvas.clientHeight * devicePixelRatio;

const context = canvas.getContext("2d");
if (context == null) {
  throw new Error("Failed to initial canvas");
}
const ctx: C = context;
ctx.scale(devicePixelRatio, devicePixelRatio);

const renderer = new DebugRenderer(ctx, {});

let color = "green";

class ClickDetect extends Wrapper<C> {
  hittest(_ctx: Context<C>, _test: HitTest): boolean {
    color = "red";
    return true;
  }
}

const node = new RoundedBox(
  new VStack<C>(
    [
      new AlignBox(
        new MultilineText("测试居中".repeat(20), {
          lineHeight: 20,
          font: "400 16px monospace",
          alignment: "center",
          style: "black",
        }),
        { alignment: "center" },
      ),
      new AlignBox(
        new RoundedBox(
          new HStack<C>(
            [
              new ClickDetect(
                new RoundedBox(
                  new Text("测试3".repeat(2), {
                    lineHeight: 20,
                    font: "400 16px monospace",
                    style: () => color,
                  }),
                  {
                    left: 14,
                    right: 14,
                    bottom: 10,
                    top: 10,
                    fill: "#aaa",
                    radii: 8,
                  },
                ),
              ),
              new RoundedBox(
                new MultilineText("测试2".repeat(5), {
                  lineHeight: 16,
                  font: "400 12px monospace",
                  alignment: "center",
                  style: "black",
                }),
                {
                  left: 10,
                  right: 10,
                  bottom: 5,
                  top: 5,
                  fill: "#aaa",
                  radii: 8,
                },
              ),
            ],
            {
              reverse: true,
              gap: 10,
            },
          ),
          {
            left: 10,
            right: 10,
            bottom: 10,
            top: 10,
            fill: "#ddd",
            radii: 16,
          },
        ),
        { alignment: "center" },
      ),
      new AlignBox(
        new RoundedBox(
          new MultilineText("文本右对齐".repeat(10), {
            lineHeight: 20,
            font: "400 16px monospace",
            alignment: "right",
            style: "black",
          }),
          {
            left: 10,
            right: 10,
            bottom: 10,
            top: 10,
            fill: "#ccc",
            radii: 16,
          },
        ),
        { alignment: "center" },
      ),
    ],
    { gap: 10 },
  ),
  {
    left: 10,
    right: 10,
    bottom: 10,
    top: 10,
    fill: "#eee",
    radii: 20,
  },
);

console.log(renderer.measureNode(node));
renderer.draw(node);

function drawFrame(): void {
  renderer.draw(node);
  requestAnimationFrame(drawFrame);
}

requestAnimationFrame(drawFrame);

canvas.addEventListener("pointermove", (e) => {
  const { top, left } = canvas.getBoundingClientRect();
  const result = renderer.hittest(node, {
    x: e.clientX - left,
    y: e.clientY - top,
    type: "hover",
  });
  if (!result) {
    color = "green";
  }
});
