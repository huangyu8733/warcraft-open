import { DdsImage } from '../../../parsers/dds/image';
import isDds from '../../../parsers/dds/isformat';
import ModelViewer from '../../viewer';
import Texture from './texture';

export default {
  load(viewer: ModelViewer): void {
    const webgl = viewer.webgl;

    // Optionally used when decoding mipmaps.
    if (!webgl.ensureExtension('WEBGL_compressed_texture_s3tc')) {
      console.warn('DDS: No compressed textures support! This might reduce performance.');
    }

    // OpenWar3: Reforged normal maps are ATI2/BC5 — a two-channel compressed format.
    // Uploading it as RGTC2 keeps a 2048² normal map out of the CPU decoder and halves
    // its memory. Optional: without the extension the texture falls back to the existing
    // LUMINANCE_ALPHA upload (see texture.ts).
    webgl.ensureExtension('EXT_texture_compression_rgtc');
  },
  isValidSource(object: unknown): boolean {
    if (object instanceof DdsImage) {
      return true;
    }

    return isDds(object);
  },
  resource: Texture,
};
