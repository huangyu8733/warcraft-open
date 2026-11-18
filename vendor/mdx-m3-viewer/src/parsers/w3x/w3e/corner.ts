import BinaryStream from '../../../common/binarystream';

/**
 * A tile corner.
 */
export default class Corner {
  groundHeight = 0;
  waterHeight = 0;
  mapEdge = 0;
  ramp = 0;
  blight = 0;
  water = 0;
  boundary = 0;
  groundTexture = 0;
  cliffVariation = 0;
  groundVariation = 0;
  cliffTexture = 0;
  layerHeight = 0;

  load(stream: BinaryStream, version: number): void {
    this.groundHeight = (stream.readInt16() - 8192) / 512;

    const waterAndEdge = stream.readInt16();

    this.waterHeight = ((waterAndEdge & 0x3FFF) - 8192) / 512;
    this.mapEdge = waterAndEdge & 0x4000;

    // OpenWar3 fix (docs/map-compatibility.md): a w3e v12 corner is EIGHT bytes, not seven.
    // Reforged lifted the 16-tileset limit, so the ground texture widened from 4 bits to 6
    // and the four flags moved up with it into a uint16 — Test of Faith Reborn names 42
    // ground tilesets, which is an exact fit for 6 bits and could not be written at all in
    // v11. Derived from the bytes (the two spare bits of the low byte carry the two RARE
    // flags: 1377 ramp corners and 52 blight corners of 66049) and confirmed against
    // HiveWE's src/base/terrain.ixx, which reads exactly this and writes v12 by default.
    // The four booleans below must come out IDENTICAL on a v11 map — nothing throws if
    // they do not, the terrain is simply wrong.
    if (version >= 12) {
      const textureAndFlags = stream.readUint16();

      this.ramp = textureAndFlags & 0b0001000000;
      this.blight = textureAndFlags & 0b0010000000;
      this.water = textureAndFlags & 0b0100000000;
      this.boundary = textureAndFlags & 0b1000000000;

      this.groundTexture = textureAndFlags & 0b0000111111;
    } else {
      const textureAndFlags = stream.readUint8();

      this.ramp = textureAndFlags & 0b00010000;
      this.blight = textureAndFlags & 0b00100000;
      this.water = textureAndFlags & 0b01000000;
      this.boundary = textureAndFlags & 0b10000000;

      this.groundTexture = textureAndFlags & 0b00001111;
    }

    const variation = stream.readUint8();

    this.cliffVariation = (variation & 0b11100000) >>> 5;
    this.groundVariation = variation & 0b00011111;

    const cliffTextureAndLayer = stream.readUint8();

    this.cliffTexture = (cliffTextureAndLayer & 0b11110000) >>> 4;
    this.layerHeight = cliffTextureAndLayer & 0b00001111;
  }

  save(stream: BinaryStream, version: number): void {
    stream.writeInt16(this.groundHeight * 512 + 8192);
    stream.writeInt16(this.waterHeight * 512 + 8192 + this.mapEdge << 14);

    // OpenWar3: mirror of load — v12 packs texture (6 bits) and flags into a uint16.
    if (version >= 12) {
      stream.writeUint16((this.ramp ? 0b0001000000 : 0) | (this.blight ? 0b0010000000 : 0)
        | (this.water ? 0b0100000000 : 0) | (this.boundary ? 0b1000000000 : 0)
        | (this.groundTexture & 0b111111));
    } else {
      stream.writeUint8((this.ramp << 4) | (this.blight << 5) | (this.water << 6) | (this.boundary << 7) | this.groundTexture);
    }

    stream.writeUint8((this.cliffVariation << 5) | this.groundVariation);
    stream.writeUint8((this.cliffTexture << 4) + this.layerHeight);
  }
}
