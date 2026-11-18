import { isPowerOfTwo } from '../../../common/math';
import { BlpImage } from '../../../parsers/blp/image';
import { HandlerResourceData } from '../../handlerresource';
import Texture from '../../texture';

/**
 * A BLP texure handler.
 */
export default class BlpTexture extends Texture {
  constructor(bufferOrImage: ArrayBuffer | BlpImage, resourceData: HandlerResourceData) {
    super(resourceData);

    let image;

    if (bufferOrImage instanceof BlpImage) {
      image = bufferOrImage;
    } else {
      image = new BlpImage();

      image.load(bufferOrImage);
    }

    const viewer = this.viewer;
    const gl = viewer.gl;

    const id = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, id);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const isPOT = isPowerOfTwo(image.width) && isPowerOfTwo(image.height);

    if (!isPOT) {
      // Required for NPOT textures.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    const mipmaps = image.mipmaps();

    // OpenWar3: Options -> Video -> Texture Quality (src/render/videoQuality.ts, VideoBridge).
    // `textureMipDrop` levels are taken off the TOP of the chain, so Medium uploads the
    // half-size mip as level 0 and Low the quarter-size one. This is the one downscale a
    // mipmapped BLP gives away free: the levels below are already in the file, so the large
    // one is never decoded and never uploaded -- load time and CPU as well as texture memory
    // (a quarter-width texture is a sixteenth of the bytes). Read through a global because
    // this is vendored code our own modules cannot be imported into.
    //
    // …with one exemption, and it is visible the moment it is missing. A terrain TILESET is
    // an ATLAS -- an "extended" tileset is four variations side by side in one image, which
    // is exactly what the ground shader's `u_extended` test (width > height) is asking. An
    // atlas has no padding between its cells, so each mip level down blends further across
    // their borders, and the coarse levels a drop promotes to level 0 paint a dark seam
    // around every terrain tile on the map. Wide images keep their full chain for that
    // reason; the bulk of the memory is in the hundreds of unit and doodad skins anyway,
    // and those are square.
    const ow3 = globalThis.__OW3_VIDEO__;
    const atlas = image.width > image.height;
    const drop = atlas ? 0 : Math.max(0, Math.min(ow3 && typeof ow3.textureMipDrop === 'number' ? ow3.textureMipDrop : 0, mipmaps - 1));

    // If there is one mipmap, or fake mipmaps, or it's an NPOT image, use just the first mipmap. Otherwise load all of them.
    if (mipmaps === 1 || image.fakeMipmaps() || !isPOT) {
      // Nothing to drop here: there is no chain to climb down, and re-sampling the single
      // level on the CPU would cost more than the upload it saves.
      const imageData = image.getMipmap(0);

      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageData);

      this.width = image.width;
      this.height = image.height;
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

      let width = image.width;
      let height = image.height;

      for (let i = 0; i < drop; i++) {
        width = Math.ceil(width / 2);
        height = Math.ceil(height / 2);
      }

      // The dropped level becomes level 0, so these are the size of the texture that now
      // EXISTS. Everything reading them wants that: the ground shader's "is this tileset
      // extended" test is a width-vs-height ratio, which whole halvings preserve.
      this.width = width;
      this.height = height;

      for (let i = drop; i < mipmaps; i++) {
        const imageData = image.getMipmap(i);

        // Don't use the image data dimensions directly.
        // Some JPG mipmaps out there have wrong sizes.
        // For example the last two mipmaps being 2x1, which messes with GL.
        gl.texImage2D(gl.TEXTURE_2D, i - drop, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imageData.data);

        width = Math.ceil(width / 2);
        height = Math.ceil(height / 2);
      }
    }

    this.webglResource = id;
  }
}
