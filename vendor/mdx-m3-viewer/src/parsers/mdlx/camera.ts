import BinaryStream from '../../common/binarystream';
import TokenStream from './tokenstream';
import AnimatedObject from './animatedobject';

/**
 * A camera.
 */
export default class Camera extends AnimatedObject {
  name = '';
  position = new Float32Array(3);
  fieldOfView = 0;
  farClippingPlane = 0;
  nearClippingPlane = 0;
  targetPosition = new Float32Array(3);

  readMdx(stream: BinaryStream, version: number): void {
    // OpenWar3: in MDX 1800 (Warcraft III 2.0 / Reforged 3.0) the camera's size field has
    // a flag packed into its top byte (0x03 in every 3.0 camera; the low 24 bits are the
    // length). Unmasked, the length is 16-64 MB and the animation reader runs off the end.
    let size = stream.readUint32();

    if (version >= 1800) {
      size &= 0xffffff;
    }

    this.name = stream.read(80);
    stream.readFloat32Array(this.position);
    this.fieldOfView = stream.readFloat32();
    this.farClippingPlane = stream.readFloat32();
    this.nearClippingPlane = stream.readFloat32();
    stream.readFloat32Array(this.targetPosition);

    this.readAnimations(stream, size - 120);
  }

  writeMdx(stream: BinaryStream): void {
    stream.writeUint32(this.getByteLength());
    stream.skip(80 - stream.write(this.name));
    stream.writeFloat32Array(this.position);
    stream.writeFloat32(this.fieldOfView);
    stream.writeFloat32(this.farClippingPlane);
    stream.writeFloat32(this.nearClippingPlane);
    stream.writeFloat32Array(this.targetPosition);

    this.writeAnimations(stream);
  }

  readMdl(stream: TokenStream): void {
    this.name = stream.read();

    for (let token of stream.readBlock()) {
      if (token === 'Position') {
        stream.readVector(this.position);
      } else if (token === 'Translation') {
        this.readAnimation(stream, 'KCTR');
      } else if (token === 'Rotation') {
        this.readAnimation(stream, 'KCRL');
      } else if (token === 'FieldOfView') {
        this.fieldOfView = stream.readFloat();
      } else if (token === 'FarClip') {
        this.farClippingPlane = stream.readFloat();
      } else if (token === 'NearClip') {
        this.nearClippingPlane = stream.readFloat();
      } else if (token === 'Target') {
        for (token of stream.readBlock()) {
          if (token === 'Position') {
            stream.readVector(this.targetPosition);
          } else if (token === 'Translation') {
            this.readAnimation(stream, 'KTTR');
          } else {
            throw new Error(`Unknown token in Camera ${this.name}'s Target: "${token}"`);
          }
        }
      } else {
        throw new Error(`Unknown token in Camera ${this.name}: "${token}"`);
      }
    }
  }

  writeMdl(stream: TokenStream): void {
    stream.startObjectBlock('Camera', this.name);

    stream.writeVectorAttrib('Position', this.position);
    this.writeAnimation(stream, 'KCTR');
    this.writeAnimation(stream, 'KCRL');
    stream.writeNumberAttrib('FieldOfView', this.fieldOfView);
    stream.writeNumberAttrib('FarClip', this.farClippingPlane);
    stream.writeNumberAttrib('NearClip', this.nearClippingPlane);

    stream.startBlock('Target');
    stream.writeVectorAttrib('Position', this.targetPosition);
    this.writeAnimation(stream, 'KTTR');
    stream.endBlock();

    stream.endBlock();
  }

  override getByteLength(): number {
    return 120 + super.getByteLength();
  }
}
