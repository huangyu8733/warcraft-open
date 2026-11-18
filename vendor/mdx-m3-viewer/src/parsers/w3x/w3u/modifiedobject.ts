import BinaryStream from "../../../common/binarystream";
import Modification from "./modification";

/**
 * A modified object.
 */
export default class ModifiedObject {
  oldId = "\0\0\0\0";
  newId = "\0\0\0\0";
  modifications: Modification[] = [];
  // OpenWar3: one entry per v3 modification set (see load); empty below v3.
  setFlags: number[] = [];

  load(
    stream: BinaryStream,
    useOptionalInts: boolean,
    version: number
  ): void {
    this.oldId = stream.readBinary(4);
    this.newId = stream.readBinary(4);

    // OpenWar3 fix (docs/map-compatibility.md): object data format version 3 (Reforged)
    // wraps the modification list in SETS — `setCount`, then `setFlags` + `modCount` per
    // set, where a set is the HD/SD skin variation an SD-only client never has to choose
    // between. Verified byte-exact on all six object files of three 1.36/2.0 maps: every
    // file is consumed to its last byte, `setCount` is always 1 and `setFlags` always 0.
    // Read as one flat list (what every consumer wants); the flags are kept so `save`
    // writes back the layout it read.
    const setCount = version >= 3 ? stream.readInt32() : 1;

    this.setFlags = [];

    for (let set = 0; set < setCount; set++) {
      if (version >= 3) {
        this.setFlags.push(stream.readInt32());
      }

      for (let i = 0, l = stream.readUint32(); i < l; i++) {
        const modification = new Modification();

        modification.load(stream, useOptionalInts);

        this.modifications.push(modification);
      }
    }
  }

  save(
    stream: BinaryStream,
    useOptionalInts: boolean,
    version: number
  ): void {
    if (this.oldId !== "\0\0\0\0") {
      stream.writeBinary(this.oldId);
    } else {
      stream.writeUint32(0);
    }

    if (this.newId !== "\0\0\0\0") {
      stream.writeBinary(this.newId);
    } else {
      stream.writeUint32(0);
    }

    // OpenWar3: v3 writes the set layer back (see load). A flat list becomes ONE set,
    // which is what every file in the corpus is.
    if (version >= 3) {
      stream.writeInt32(1);
      stream.writeInt32(this.setFlags.length ? this.setFlags[0] : 0);
    }

    stream.writeUint32(this.modifications.length);

    for (const modification of this.modifications) {
      modification.save(stream, useOptionalInts);
    }
  }

  getByteLength(useOptionalInts: boolean, version: number): number {
    let size = version >= 3 ? 20 : 12;

    for (const modification of this.modifications) {
      size += modification.getByteLength(useOptionalInts);
    }

    return size;
  }
}
