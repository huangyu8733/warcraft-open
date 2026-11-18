import Texture from '../texture';
import ClientBuffer from './clientbuffer';
import ClientDataTexture from './clientdatatexture';
import DataTexture from './datatexture';
import Shader from './shader';

/**
 * A small WebGL utility class.
 * Makes it easier to generate shaders, textures, etc.
 */
export default class WebGL {
  gl: WebGLRenderingContext;
  currentShader: Shader | null = null;
  emptyTexture: WebGLTexture;
  extensions: {[key: string]: unknown } = {};
  /**
   * OpenWar3: was this context created as WebGL 2?
   *
   * The Reforged client asks for one (`src/render/glContext.ts` publishes `__OW3_GL2__` from
   * the flavour; `?gl=1` forces WebGL 1). The classic client always asks for WebGL 1, so every
   * branch on this flag is inert for it. `gl` keeps the WebGL 1 type: WebGL 2 is a superset of
   * the calls the viewer makes, and the three extensions it dropped are shimmed below.
   */
  isWebGL2 = false;
  /**
   * OpenWar3: the wrap values last written to each texture object.
   *
   * `bindTextureAndWrap` is called six times per HD material and used to issue two
   * `texParameteri` calls every time. Wrap is state of the TEXTURE OBJECT, not of the
   * texture unit, so an unchanged pair can be skipped even though the texture is bound
   * to a different unit. Kept here rather than on the texture so every caller benefits
   * without a new API. `setTextureMode` clears it: that is the one other writer, and
   * it binds a texture the caller owns.
   */
  private wrapCache = new Map<WebGLTexture, { s: number, t: number }>();

  constructor(canvas: HTMLCanvasElement, options: WebGLContextAttributes = { alpha: false }) {
    let gl: WebGLRenderingContext | null = null;
    const flags = <{ __OW3_GL2__?: boolean }><unknown>globalThis;

    // The Reforged client asks first, and falls back rather than showing a black canvas:
    // a driver without WebGL 2 is exactly the case this branch exists for.
    if (flags.__OW3_GL2__ === true) {
      gl = <WebGLRenderingContext | null><unknown>canvas.getContext('webgl2', options);

      if (!gl) {
        console.warn('WebGL: WebGL 2 is unavailable here — falling back to WebGL 1.');
        flags.__OW3_GL2__ = false;
      }
    }

    if (!gl) {
      gl = canvas.getContext('webgl', options);

      if (!gl) {
        gl = <WebGLRenderingContext | null>canvas.getContext('experimental-webgl', options);
      }
    }

    if (!gl) {
      throw new Error('WebGL: Failed to create a WebGL context!');
    }

    this.isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

    const twoByTwo = new Uint8ClampedArray(16).fill(255);

    const emptyTexture = <WebGLTexture>gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, emptyTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, twoByTwo);

    this.gl = gl;
    this.emptyTexture = emptyTexture;
  }

  /**
   * Ensures that an extension is available.
   * 
   * If it is, it will be added to `extensions`.
   *
   * OpenWar3: on WebGL 2, three of the names this viewer asks for are CORE there and
   * `getExtension` returns null for them — instanced arrays, vertex array objects and float
   * textures. `coreExtension` hands back the same shape on top of the core calls, so the
   * handlers that read `webgl.extensions[...]` do not need to know which context they are on.
   */
  ensureExtension(name: string): boolean {
    if (this.extensions[name] !== undefined) {
      return true;
    }

    const ext = this.gl.getExtension(name) || this.coreExtension(name);

    if (ext) {
      this.extensions[name] = ext;

      return true;
    }

    return false;
  }

  /**
   * OpenWar3: WebGL 1 shaped stand-ins for the extensions WebGL 2 made core.
   *
   * Only called when `getExtension` found nothing, and only answers on a WebGL 2 context.
   */
  private coreExtension(name: string): unknown | null {
    if (!this.isWebGL2) {
      return null;
    }

    const gl = this.gl as unknown as WebGL2RenderingContext;

    switch (name) {
      // Float textures are core in WebGL 2 (sized internal formats, see DataTexture).
      // Presence is all any caller reads; linear filtering still needs its own extension,
      // and nothing here filters a float texture.
      case 'OES_texture_float':
        return {};
      case 'ANGLE_instanced_arrays':
        return {
          drawArraysInstancedANGLE: (mode: number, first: number, count: number, primcount: number): void => {
            gl.drawArraysInstanced(mode, first, count, primcount);
          },
          drawElementsInstancedANGLE: (mode: number, count: number, type: number, offset: number, primcount: number): void => {
            gl.drawElementsInstanced(mode, count, type, offset, primcount);
          },
          vertexAttribDivisorANGLE: (index: number, divisor: number): void => {
            gl.vertexAttribDivisor(index, divisor);
          },
        };
      case 'OES_vertex_array_object':
        return {
          createVertexArrayOES: (): WebGLVertexArrayObject | null => gl.createVertexArray(),
          bindVertexArrayOES: (vao: WebGLVertexArrayObject | null): void => gl.bindVertexArray(vao),
          deleteVertexArrayOES: (vao: WebGLVertexArrayObject | null): void => gl.deleteVertexArray(vao),
          isVertexArrayOES: (vao: WebGLVertexArrayObject | null): boolean => gl.isVertexArray(vao),
        };
      default:
        return null;
    }
  }

  createShader(vertexSource: string, fragmentSource: string): Shader {
    const gl = this.gl;

    const vertex = <WebGLShader>gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertex, vertexSource);
    gl.compileShader(vertex);

    const fragment = <WebGLShader>gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragment, fragmentSource);
    gl.compileShader(fragment);

    const program = <WebGLProgram>gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      let log = 'Shader failed to link:';

      const vertexLog = gl.getShaderInfoLog(vertex);
      if (vertexLog && vertexLog.length) {
        log += ` Vertex shader: ${vertexLog}`;
      }

      const fragmentLog = gl.getShaderInfoLog(fragment);
      if (fragmentLog && fragmentLog.length) {
        log += ` Fragment shader: ${fragmentLog}`;
      }

      throw new Error(log);
    }

    return new Shader(this, program);
  }

  /**
   * Enables all vertex attribs between [start, end], including start and discluding end.
   */
  enableVertexAttribs(start: number, end: number): void {
    const gl = this.gl;

    for (let i = start; i < end; i++) {
      gl.enableVertexAttribArray(i);
    }
  }

  /**
   * Disables all vertex attribs between [start, end], including start and discluding end.
   */
  disableVertexAttribs(start: number, end: number): void {
    const gl = this.gl;

    for (let i = start; i < end; i++) {
      gl.disableVertexAttribArray(i);
    }
  }

  /**
   * Use a shader program.
   */
  useShader(shader: Shader): void {
    if (shader && shader !== this.currentShader) {
      let oldAttribs = 0;
      const newAttribs = shader.attribsCount;

      if (this.currentShader) {
        oldAttribs = this.currentShader.attribsCount;
      }

      this.gl.useProgram(shader.program);

      if (newAttribs > oldAttribs) {
        this.enableVertexAttribs(oldAttribs, newAttribs);
      } else if (newAttribs < oldAttribs) {
        this.disableVertexAttribs(newAttribs, oldAttribs);
      }

      this.currentShader = shader;
    }
  }

  /**
   * Bind a texture.
   * 
   * If the given texture is invalid, a 2x2 black texture will be bound instead.
   */
  bindTexture(texture: Texture | undefined | null, unit: number): void {
    const gl = this.gl;

    gl.activeTexture(gl.TEXTURE0 + unit);

    if (texture) {
      gl.bindTexture(gl.TEXTURE_2D, texture.webglResource);
    } else {
      // Bind an empty texture in case an invalid one was given, to avoid WebGL errors.
      gl.bindTexture(gl.TEXTURE_2D, this.emptyTexture);
    }
  }

  bindTextureAndWrap(texture: Texture | undefined | null, unit: number, wrapS: number, wrapT: number): void {
    const gl = this.gl;

    gl.activeTexture(gl.TEXTURE0 + unit);

    let resource: WebGLTexture | null;

    if (texture) {
      resource = texture.webglResource;
      gl.bindTexture(gl.TEXTURE_2D, resource);
    } else {
      // Bind an empty texture in case an invalid one was given, to avoid WebGL errors.
      resource = this.emptyTexture;
      gl.bindTexture(gl.TEXTURE_2D, resource);
    }

    if (!resource) {
      return;
    }

    const cached = this.wrapCache.get(resource);

    if (cached && cached.s === wrapS && cached.t === wrapT) {
      return;
    }

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
    this.wrapCache.set(resource, { s: wrapS, t: wrapT });
  }

  /**
   * Set the texture wrap and filter values.
   */
  setTextureMode(wrapS: number, wrapT: number, magFilter: number, minFilter: number): void {
    const gl = this.gl;

    // The texture currently bound here is not necessarily one `bindTextureAndWrap`
    // knows about, and its wrap is being overwritten — drop what the cache believes.
    this.wrapCache.clear();

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  }

  /**
   * A shortcut for `new ClientBuffer(gl, size)`.
   */
  createClientBuffer(size = 4): ClientBuffer {
    return new ClientBuffer(this.gl, size);
  }

  /**
   * A shortcut for `new DataTexture(gl, channels, width, height)`.
   */
  createDataTexture(channels = 4, width = 1, height = 1): DataTexture {
    return new DataTexture(this.gl, channels, width, height);
  }

  /**
   * A shortcut for `new ClientDataTexture(gl, width, height)`.
   */
  createClientDataTexture(width = 1, height = 1): ClientDataTexture {
    return new ClientDataTexture(this.gl, width, height);
  }
}
