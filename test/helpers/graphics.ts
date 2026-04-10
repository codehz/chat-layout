type C = CanvasRenderingContext2D;

let observeOffscreenMeasureText: ((text: string) => void) | undefined;

class MockOffscreenCanvasRenderingContext2D {
  font = "16px sans-serif";

  measureText(text: string): TextMetrics {
    observeOffscreenMeasureText?.(text);
    return {
      width: text.length * 8,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 2,
    } as TextMetrics;
  }
}

class MockOffscreenCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  getContext(type: string): MockOffscreenCanvasRenderingContext2D | null {
    if (type !== "2d") {
      return null;
    }
    return new MockOffscreenCanvasRenderingContext2D();
  }
}

export function ensureMockOffscreenCanvas(): void {
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    configurable: true,
    writable: true,
    value: MockOffscreenCanvas,
  });
}

export function createGraphics(viewportHeight: number, viewportWidth = 320): C {
  const stateStack: { globalAlpha: number }[] = [];
  const graphics = {
    canvas: {
      clientWidth: viewportWidth,
      clientHeight: viewportHeight,
    },
    globalAlpha: 1,
    textRendering: "auto",
    clearRect() {},
    fillText() {},
    beginPath() {},
    rect() {},
    clip() {},
    measureText() {
      return {
        width: 0,
        fontBoundingBoxAscent: 8,
        fontBoundingBoxDescent: 2,
      } as TextMetrics;
    },
    save() {
      stateStack.push({ globalAlpha: graphics.globalAlpha });
    },
    restore() {
      const state = stateStack.pop();
      if (state != null) {
        graphics.globalAlpha = state.globalAlpha;
      }
    },
  };
  return graphics as unknown as C;
}

export function createTextGraphics(
  viewportWidth = 320,
  viewportHeight = 100,
  onMeasureText?: (text: string) => void,
): C {
  const stateStack: { globalAlpha: number }[] = [];
  const graphics = {
    canvas: {
      clientWidth: viewportWidth,
      clientHeight: viewportHeight,
    },
    fillStyle: "#000",
    font: "16px sans-serif",
    globalAlpha: 1,
    textAlign: "left",
    textRendering: "auto",
    clearRect() {},
    fillText() {},
    beginPath() {},
    rect() {},
    clip() {},
    measureText(text: string) {
      onMeasureText?.(text);
      return {
        width: text.length * 8,
        fontBoundingBoxAscent: 8,
        fontBoundingBoxDescent: 2,
      } as TextMetrics;
    },
    save() {
      stateStack.push({ globalAlpha: graphics.globalAlpha });
    },
    restore() {
      const state = stateStack.pop();
      if (state != null) {
        graphics.globalAlpha = state.globalAlpha;
      }
    },
  };
  return graphics as unknown as C;
}

export function withOffscreenMeasureCounter<T>(
  cb: (counter: { count: number }) => T,
): T {
  ensureMockOffscreenCanvas();
  const counter = { count: 0 };
  const previous = observeOffscreenMeasureText;
  observeOffscreenMeasureText = () => {
    counter.count += 1;
  };
  try {
    return cb(counter);
  } finally {
    observeOffscreenMeasureText = previous;
  }
}

export function mockPerformanceNow(now: { current: number }): () => void {
  const original = performance.now;
  Object.defineProperty(performance, "now", {
    configurable: true,
    value: () => now.current,
  });
  return () => {
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: original,
    });
  };
}
