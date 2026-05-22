declare module "dom-to-image-more" {
  interface Options {
    width?: number;
    height?: number;
    style?: Partial<CSSStyleDeclaration>;
    bgcolor?: string;
    quality?: number;
    scale?: number;
    imagePlaceholder?: string;
    cacheBust?: boolean;
    filter?: (node: Node) => boolean;
  }

  function toPng(node: HTMLElement, options?: Options): Promise<string>;
  function toJpeg(node: HTMLElement, options?: Options): Promise<string>;
  function toSvg(node: HTMLElement, options?: Options): Promise<string>;
  function toBlob(node: HTMLElement, options?: Options): Promise<Blob>;
  function toCanvas(node: HTMLElement, options?: Options): Promise<HTMLCanvasElement>;
  function toPixelData(node: HTMLElement, options?: Options): Promise<Uint8ClampedArray>;

  export { toPng, toJpeg, toSvg, toBlob, toCanvas, toPixelData };
  export default { toPng, toJpeg, toSvg, toBlob, toCanvas, toPixelData };
}
