import type { Context } from "../../src/types";
import { ensureMockOffscreenCanvas } from "./graphics";

type C = CanvasRenderingContext2D;

ensureMockOffscreenCanvas();

export type RecordedDraw = {
  text: string;
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  textAlign: CanvasTextAlign;
  x: number;
  y: number;
};

export function createMeasuredContext(font: string): Context<C> {
  return {
    graphics: {
      font,
      measureText(text: string) {
        return {
          width: text.length * 8,
          fontBoundingBoxAscent: 8,
          fontBoundingBoxDescent: 2,
        } as TextMetrics;
      },
    },
  } as Context<C>;
}

export function createRecordingGraphics(recordedTexts: string[]): C {
  return {
    canvas: {
      clientWidth: 320,
      clientHeight: 100,
    },
    fillStyle: "#000",
    font: "16px sans-serif",
    textAlign: "left",
    textRendering: "auto",
    clearRect() {},
    fillText(text: string) {
      recordedTexts.push(text);
    },
    measureText(text: string) {
      return {
        width: text.length * 8,
        fontBoundingBoxAscent: 8,
        fontBoundingBoxDescent: 2,
      } as TextMetrics;
    },
    save() {},
    restore() {},
  } as unknown as C;
}

export function createRichRecordingGraphics(recordedDraws: RecordedDraw[]): C {
  const graphics = {
    canvas: {
      clientWidth: 320,
      clientHeight: 100,
    },
    fillStyle: "#000",
    font: "16px sans-serif",
    textAlign: "left" as CanvasTextAlign,
    textRendering: "auto",
    clearRect() {},
    fillText(text: string, x = 0, y = 0) {
      recordedDraws.push({
        text,
        font: graphics.font,
        fillStyle: graphics.fillStyle,
        textAlign: graphics.textAlign,
        x,
        y,
      });
    },
    measureText(text: string) {
      return {
        width: text.length * 8,
        fontBoundingBoxAscent: 8,
        fontBoundingBoxDescent: 2,
      } as TextMetrics;
    },
    save() {},
    restore() {},
  };
  return graphics as unknown as C;
}
