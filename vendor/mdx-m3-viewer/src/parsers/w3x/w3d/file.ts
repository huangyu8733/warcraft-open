import BinaryStream from "../../../common/binarystream";
import ModificationTable from "../w3u/modificationtable";

/**
 * war3map.w3d - the doodad modification file.
 *
 * Also used for war3map.w3a (abilities), and war3map.w3q (upgrades).
 */
export default class War3MapW3d {
  version = 0;
  originalTable = new ModificationTable();
  customTable = new ModificationTable();
  // OpenWar3: which of the two layouts `load` found (see there); `save` writes it back.
  useOptionalInts = true;

  load(bufferOrStream: ArrayBuffer | Uint8Array | BinaryStream): void {
    let stream;

    if (bufferOrStream instanceof BinaryStream) {
      stream = bufferOrStream;
    } else {
      stream = new BinaryStream(bufferOrStream);
    }

    this.version = stream.readInt32();

    // OpenWar3 fix: the optional level/data-pointer pair is NOT fixed per file type.
    // This class is used for w3a (abilities), w3q (upgrades) AND w3d (doodads), and the
    // caller hardcodes `true` for all three. That holds for w3a and w3q, but NOT for w3d:
    // across all 100 maps bundled with 1.27a, every w3a (43/43) and every w3q (15/15)
    // carries the pair, while of the 44 w3d files only 12 do — the Bonus campaign's
    // (OrcX02*, OrcX03a/b, the last maps Blizzard authored). The other 32, every earlier
    // campaign chapter included, write the compact form and blew up here with
    // "unknown variable type", taking the whole map load with them: Terror of the Tides
    // could not start at all.
    // So the layout is DETECTED, not assumed — parse with the pair, and if that throws or
    // fails to consume the file exactly, re-parse without it. Exactly one of the two
    // consumes each of the 44 files (never both, never neither), so the test is decisive.
    const start = stream.index;

    try {
      this.originalTable.load(stream, true, this.version);
      this.customTable.load(stream, true, this.version);

      if (stream.remaining === 0) {
        this.useOptionalInts = true;

        return;
      }
    } catch (e) {
      // fall through to the compact layout
    }

    stream.seek(start);
    this.originalTable = new ModificationTable();
    this.customTable = new ModificationTable();
    this.originalTable.load(stream, false, this.version);
    this.customTable.load(stream, false, this.version);
    this.useOptionalInts = false;
  }

  save(): Uint8Array {
    const stream = new BinaryStream(new ArrayBuffer(this.getByteLength()));

    stream.writeInt32(this.version);
    this.originalTable.save(stream, this.useOptionalInts, this.version);
    this.customTable.save(stream, this.useOptionalInts, this.version);

    return stream.uint8array;
  }

  getByteLength(): number {
    return (
      4 +
      this.originalTable.getByteLength(this.useOptionalInts, this.version) +
      this.customTable.getByteLength(this.useOptionalInts, this.version)
    );
  }
}
