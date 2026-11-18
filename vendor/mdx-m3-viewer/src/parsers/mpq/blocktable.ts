import MpqCrypto from './crypto';
import MpqBlock from './block';
import { BLOCK_TABLE_KEY } from './constants';

/**
 * A block table.
 */
export default class BlockTable {
  c: MpqCrypto;
  entries: MpqBlock[];

  constructor(c: MpqCrypto) {
    this.c = c;
    this.entries = [];
  }

  add(buffer: ArrayBuffer): MpqBlock {
    const block = new MpqBlock();

    block.normalSize = buffer.byteLength;

    this.entries.push(block);

    return block;
  }

  clear(): void {
    this.entries.length = 0;
  }

  addEmpties(howMany: number): void {
    for (let i = 0; i < howMany; i++) {
      this.entries.push(new MpqBlock());
    }
  }

  /** OpenWar3: `count` blocks, of which `bytes` may hold fewer; the rest are blank (no
   *  FILE_EXISTS), so nothing is ever opened out of them. See MpqHashTable.load. */
  load(bytes: Uint8Array, count = Math.floor(bytes.byteLength / 16)): void {
    const held = Math.min(count, Math.floor(bytes.byteLength / 16));
    const uint32array = new Uint32Array(this.c.decryptBlock(bytes.slice(0, held * 16), BLOCK_TABLE_KEY).buffer);
    let offset = 0;

    // Clear the table and add the needed empties.
    this.clear();
    this.addEmpties(count);

    for (let i = 0; i < held; i++) {
      this.entries[i].load(uint32array.subarray(offset, offset + 4));

      offset += 4;
    }
  }

  save(bytes: Uint8Array): void {
    const uint32array = new Uint32Array(this.entries.length * 4);
    let offset = 0;

    for (const block of this.entries) {
      block.save(uint32array.subarray(offset, offset + 4));

      offset += 4;
    }

    const uint8array = new Uint8Array(uint32array.buffer);

    this.c.encryptBlock(uint8array, BLOCK_TABLE_KEY);

    bytes.set(uint8array);
  }
}
