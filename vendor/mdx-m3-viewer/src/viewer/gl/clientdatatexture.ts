/**
 * A data texture.
 */
export default class ClientDataTexture {
  gl: WebGLRenderingContext;
  texture: WebGLTexture;
  width = 0;
  height = 0;
  arrayBuffer = new ArrayBuffer(0);
  byteView: Uint8Array | null = null;
  floatView: Float32Array | null = null;

  constructor(gl: WebGLRenderingContext, width = 1, height = 1) {
    this.gl = gl;
    this.texture = <WebGLTexture>gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

    this.reserve(width, height);
  }

  reserve(width: number, height: number): void {
    if (this.width < width || this.height < height) {
      const gl = this.gl;

      this.width = Math.max(this.width, width);
      this.height = Math.max(this.height, height);

      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      // OpenWar3: WebGL 2 rejects unsized `RGBA` with type `FLOAT`; the sized format is core
      // there and samples identically.
      gl.texImage2D(gl.TEXTURE_2D, 0, this.internalFormat(), this.width, this.height, 0, gl.RGBA, gl.FLOAT, null);

      this.arrayBuffer = new ArrayBuffer(this.width * this.height * 16);
      this.byteView = new Uint8Array(this.arrayBuffer);
      this.floatView = new Float32Array(this.arrayBuffer);
    }
  }

  /** OpenWar3: WebGL 2 is stricter about both halves of this texture — the unsized `RGBA`
   *  internal format is rejected with type `FLOAT`, and `texSubImage2D` requires a real
   *  `Float32Array` view rather than any view over the same bytes (WebGL 1 ignores the view
   *  type). Both are asked here so the two halves cannot disagree. */
  private get isWebGL2(): boolean {
    const gl = this.gl;

    return typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  }

  private internalFormat(): number {
    return this.isWebGL2 ? (<WebGL2RenderingContext><unknown>this.gl).RGBA32F : this.gl.RGBA;
  }

  bindAndUpdate(width = this.width, height = this.height): void {
    const gl = this.gl;

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.FLOAT, this.isWebGL2 ? this.floatView : this.byteView);
  }
}
