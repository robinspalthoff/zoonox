// jscanify ist eine reine JS-Library (CommonJS) ohne mitgelieferte Typen.
// Wir nutzen nur `highlightPaper` und `extractPaper` — minimaler Shim reicht.
declare module "jscanify/client" {
  interface HighlightOptions {
    color?: string;
    thickness?: number;
  }
  class Jscanify {
    highlightPaper(
      image: HTMLImageElement | HTMLCanvasElement,
      options?: HighlightOptions,
    ): HTMLCanvasElement;
    extractPaper(
      image: HTMLImageElement | HTMLCanvasElement,
      resultWidth: number,
      resultHeight: number,
      cornerPoints?: {
        topLeftCorner: { x: number; y: number };
        topRightCorner: { x: number; y: number };
        bottomLeftCorner: { x: number; y: number };
        bottomRightCorner: { x: number; y: number };
      },
    ): HTMLCanvasElement | null;
  }
  export default Jscanify;
}
