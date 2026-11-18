import { DdsImage, FOURCC_DXT1, FOURCC_DXT3, FOURCC_DXT5, FOURCC_ATI2 } from '../../../parsers/dds/image';
import { HandlerResourceData } from '../../handlerresource';
import Texture from '../../texture';

/**
 * A DDS texture handler.
 */
export default class DdsTexture extends Texture {
  constructor(bufferOrImage: ArrayBuffer | DdsImage, resourceData: HandlerResourceData) {
    super(resourceData);

    let image;

    if (bufferOrImage instanceof DdsImage) {
      image = bufferOrImage;
    } else {
      image = new DdsImage();

      image.load(bufferOrImage);
    }

    const viewer = this.viewer;
    const gl = viewer.gl;
    const webgl = viewer.webgl;
    const compressedTextures = <WEBGL_compressed_texture_s3tc>webgl.extensions['WEBGL_compressed_texture_s3tc'];
    const rgtc = <{ COMPRESSED_RED_GREEN_RGTC2_EXT: number } | undefined>webgl.extensions['EXT_texture_compression_rgtc'];
    const format = image.format;
    let internalFormat = 0;

    if (compressedTextures) {
      if (format === FOURCC_DXT1) {
        internalFormat = compressedTextures.COMPRESSED_RGB_S3TC_DXT1_EXT;
      } else if (format === FOURCC_DXT3) {
        internalFormat = compressedTextures.COMPRESSED_RGBA_S3TC_DXT3_EXT;
      } else if (format === FOURCC_DXT5) {
        internalFormat = compressedTextures.COMPRESSED_RGBA_S3TC_DXT5_EXT;
      }
    }

    // OpenWar3: BC5/ATI2 is the Reforged normal-map format. The shader reads .xy only and
    // rebuilds z, which is exactly what RGTC2 stores. Without this branch the data is
    // decoded and uploaded as LUMINANCE_ALPHA, which samples as (L, L, L, A) -- so .xy
    // becomes (R, R) and the green channel is lost, besides the CPU cost.
    if (format === FOURCC_ATI2 && rgtc) {
      internalFormat = rgtc.COMPRESSED_RED_GREEN_RGTC2_EXT;
    }

    const id = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, id);

    const mipmaps = image.mipmaps();

    // OpenWar3: Options -> Video -> Texture Quality. DDS used to ignore `textureMipDrop`
    // entirely, so a Reforged match uploaded every 1024/2048 skin at full size no matter
    // the setting. The levels below the dropped one are already in the file, which makes
    // this free on both CPU and memory (each level skipped is a quarter of the texels).
    // HD only: `.dds` is the HD art path, but a classic map can import one, and classic
    // must render exactly as before. Wide images are atlases; they keep their chain for
    // the same reason BLP does (see handlers/blp/texture.ts).
    const ow3 = globalThis.__OW3_VIDEO__;
    const reforged = (<{ isReforged?: boolean }><unknown>viewer).isReforged === true;
    const atlas = image.width > image.height;
    const drop = reforged && !atlas
      ? Math.max(0, Math.min(ow3 && typeof ow3.textureMipDrop === 'number' ? ow3.textureMipDrop : 0, mipmaps - 1))
      : 0;

    this.width = image.mipmapWidths[drop];
    this.height = image.mipmapHeights[drop];
    this.webglResource = id;

    // DXT1 and ATI2 pixels are two bytes.
    // This generally doesn't matter, however, when having 1x2 or 2x1 mipmaps, it does.
    // Therefore set the proper alignment if needed.
    if (format === FOURCC_DXT1 || format === FOURCC_ATI2) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    }

    for (let i = drop; i < mipmaps; i++) {
      // Let the GPU handle the compressed data if it supports it.
      // Otherwise, decode the data on the client.
      const { width, height, data } = image.getMipmap(i, internalFormat !== 0);
      const level = i - drop;

      if (internalFormat) {
        gl.compressedTexImage2D(gl.TEXTURE_2D, level, internalFormat, width, height, 0, data);
      } else if (format === FOURCC_DXT1) {
        gl.texImage2D(gl.TEXTURE_2D, level, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      } else if (format === FOURCC_DXT3) {
        gl.texImage2D(gl.TEXTURE_2D, level, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      } else if (format === FOURCC_DXT5) {
        gl.texImage2D(gl.TEXTURE_2D, level, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, level, gl.LUMINANCE_ALPHA, width, height, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, data);
      }
    }

    // Restore the alignment to the default, in case it changed.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    if (mipmaps - drop > 1) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
  }
}
