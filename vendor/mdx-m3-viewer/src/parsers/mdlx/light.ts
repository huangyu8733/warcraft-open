import BinaryStream from '../../common/binarystream';
import TokenStream from './tokenstream';
import GenericObject, { Flags } from './genericobject';

export const enum LightType {
  None = -1,
  Omnidirectional = 0,
  Directional = 1,
  Ambient = 2,
}

export default class Light extends GenericObject {
  type = LightType.None;
  attenuation = new Float32Array(2);
  color = new Float32Array(3);
  intensity = 0;
  ambientColor = new Float32Array(3);
  ambientIntensity = 0;

  constructor() {
    // 0x200 is not one of the named node flags above; it is only the default this parser has
    // always given a light, and readMdx replaces it with the file's own flags. Cast so the
    // literal is accepted as `Flags` (the enum has no matching member).
    super(0x200 as Flags);
  }

  override readMdx(stream: BinaryStream, version = 0): void {
    const start = stream.index;
    const size = stream.readUint32();

    // OpenWar3: the light's records start with the generic block's own byte length, before the
    // name — and every shipped MDX writes it, not just Reforged ones. Classic 1.30.4 models are
    // v800 chunked files, and their LITE chunk is [size=144][genericSize=96]"Omni06"…; gating
    // this read on version >= 1600 made the reader take 96 as the name's first word, run the
    // 80-byte name off by four bytes, and every later tag came out garbage — "Unknown animation
    // tag at offset …" — so the classic menu models failed to load and their lights' parentIds
    // were junk. The field also says WHERE the animations live, which is not the same in every
    // file:
    //   · 96 (the bare generic header — GoldMine, the classic menus): name/ids, the 44-byte
    //     static block, then the animation tracks.
    //   · larger (Blizzard's portrait models, e.g. TownHall_Portrait): the generic block also
    //     carries its animations, and the static block comes AFTER them. Reading the static
    //     block first there ran 72 bytes into the key data and the portrait failed to load
    //     (a black bust in the console).
    // A file that really has no such field starts its name right here, so its first word is
    // ASCII text (a huge number, or zero for an empty name) — never a value in [96, size].
    let genericSize = 0;
    const maybeGenericSize = stream.readUint32();

    if (maybeGenericSize >= 96 && maybeGenericSize <= size) {
      genericSize = maybeGenericSize;
    } else {
      stream.index -= 4;
    }

    this.name = stream.read(80);
    this.objectId = stream.readInt32();
    this.parentId = stream.readInt32();
    this.flags = stream.readUint32();

    const animationsFirst = genericSize > 96;

    if (animationsFirst) {
      this.readAnimations(stream, genericSize - 96);
    }

    this.type = stream.readUint32();
    stream.readFloat32Array(this.attenuation);
    stream.readFloat32Array(this.color);
    this.intensity = stream.readFloat32();
    stream.readFloat32Array(this.ambientColor);
    this.ambientIntensity = stream.readFloat32();

    // OpenWar3: Reforged lights write a 28-byte tail the writer leaves uninitialised.
    if (version >= 1600 && size - (stream.index - start) >= 28) {
      stream.skip(28);
    }

    // The generic block's own size only bounds ITS animations (KGRT etc.), never the light's:
    // a classic v800 light carries KGRT inside the node and then KLAC/KLBC/… AFTER the static
    // fields. Those used to be skipped whenever the node came first, so the caller read KLAC's
    // bytes as the next object's tag and the model failed with "Unknown animation tag".
    // Counting to the object's inclusive size is the only bound that holds for both layouts
    // (and readAnimations rewinds on a non-tag, so a short/generous bound is safe).
    const remaining = start + size - stream.index;

    if (remaining > 0) {
      this.readAnimations(stream, remaining);
    }
  }

  override writeMdx(stream: BinaryStream): void {
    stream.writeUint32(this.getByteLength());

    super.writeMdx(stream);

    stream.writeUint32(this.type);
    stream.writeFloat32Array(this.attenuation);
    stream.writeFloat32Array(this.color);
    stream.writeFloat32(this.intensity);
    stream.writeFloat32Array(this.ambientColor);
    stream.writeFloat32(this.ambientIntensity);

    this.writeNonGenericAnimationChunks(stream);
  }

  readMdl(stream: TokenStream): void {
    for (const token of super.readGenericBlock(stream)) {
      if (token === 'Omnidirectional') {
        this.type = LightType.Omnidirectional;
      } else if (token === 'Directional') {
        this.type = LightType.Directional;
      } else if (token === 'Ambient') {
        this.type = LightType.Ambient;
      } else if (token === 'static AttenuationStart') {
        this.attenuation[0] = stream.readFloat();
      } else if (token === 'AttenuationStart') {
        this.readAnimation(stream, 'KLAS');
      } else if (token === 'static AttenuationEnd') {
        this.attenuation[1] = stream.readFloat();
      } else if (token === 'AttenuationEnd') {
        this.readAnimation(stream, 'KLAE');
      } else if (token === 'static Intensity') {
        this.intensity = stream.readFloat();
      } else if (token === 'Intensity') {
        this.readAnimation(stream, 'KLAI');
      } else if (token === 'static Color') {
        stream.readColor(this.color);
      } else if (token === 'Color') {
        this.readAnimation(stream, 'KLAC');
      } else if (token === 'static AmbIntensity') {
        this.ambientIntensity = stream.readFloat();
      } else if (token === 'AmbIntensity') {
        this.readAnimation(stream, 'KLBI');
      } else if (token === 'static AmbColor') {
        stream.readColor(this.ambientColor);
      } else if (token === 'AmbColor') {
        this.readAnimation(stream, 'KLBC');
      } else if (token === 'Visibility') {
        this.readAnimation(stream, 'KLAV');
      } else {
        throw new Error(`Unknown token in Light: "${token}"`);
      }
    }
  }

  writeMdl(stream: TokenStream): void {
    stream.startObjectBlock('Light', this.name);
    this.writeGenericHeader(stream);

    if (this.type === LightType.Omnidirectional) {
      stream.writeFlag('Omnidirectional');
    } else if (this.type === LightType.Directional) {
      stream.writeFlag('Directional');
    } else if (this.type === LightType.Ambient) {
      stream.writeFlag('Ambient');
    }

    if (!this.writeAnimation(stream, 'KLAS')) {
      stream.writeNumberAttrib('static AttenuationStart', this.attenuation[0]);
    }

    if (!this.writeAnimation(stream, 'KLAE')) {
      stream.writeNumberAttrib('static AttenuationEnd', this.attenuation[1]);
    }

    if (!this.writeAnimation(stream, 'KLAI')) {
      stream.writeNumberAttrib('static Intensity', this.intensity);
    }

    if (!this.writeAnimation(stream, 'KLAC')) {
      stream.writeColor('static Color', this.color);
    }

    if (!this.writeAnimation(stream, 'KLBI')) {
      stream.writeNumberAttrib('static AmbIntensity', this.ambientIntensity);
    }

    if (!this.writeAnimation(stream, 'KLBC')) {
      stream.writeColor('static AmbColor', this.ambientColor);
    }

    this.writeAnimation(stream, 'KLAV');

    this.writeGenericAnimations(stream);
    stream.endBlock();
  }

  override getByteLength(): number {
    return 48 + super.getByteLength();
  }
}

