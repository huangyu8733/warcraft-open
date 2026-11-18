// Adaptive (dynamic) Huffman decompression for MPQ sectors, following the
// Faller-Gallager-Knuth (FGK) variant. Faithful port of StormLib's huff.cpp
// (Ladislav Zezula, MIT-licensed — not Blizzard/GPL, so legal to port per
// CLAUDE.md). WC3 stores every WAV as Huffman(+ADPCM); the stock mdx-m3-viewer
// 5.12.0 throws "compression type 'huffman' not supported", muting ALL
// Frozen-Throne audio (War3x/War3xLocal). Only the DECOMPRESS path is ported;
// the QuickLinks speed cache is omitted (pure decode-speed optimisation — the
// plain root-walk produces identical output). The 9 byte-weight distribution
// tables below are extracted verbatim from huff.cpp's DataDistribution_* arrays.

const DATA_TYPE_SPARSE = 0x00;
const HUFF_DECOMPRESS_ERROR = 0x1FF;

// 9 weight tables x 256 bytes, packed as hex (indexed by DataType 0..8).
const PACKED = '0a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000025416160d0c08060506050603040403050e0b141313090b0605040302030202020d070906060403020403030303030202090604040404030203020202020302040803040709050303030302020203020203020202020202020201010102010202060a0808060704030404020204020303040307070906040303020102020202020a0202030202010102020206030502030201010101010101010101020301010102010101010101020404040709080c02010101010101010101010101020101030401020405010101010101010201010104010101010102010101010101010101020101010101010103010101010101010201010101010102020101020202064b0000000000000000000327000023000000000000000000000000000000000000ff0101010101010102020101060e10040608050404030302020303010102010101040204020202010104010102030302030103060401010101010102010201010129071612400a0a112501031710262a100123232f10060702090101010101000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ff0b07050b020202060202010402010309010101030401010201010102010101050101010d0101010101010101010101020101030101010101010102010101010a0402010603020101010101030101010502030403030302010101020102030301030101020501010403050103010303020104030a06010101010101010101010202010a0205010102070217010501010e010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010106020104050101020101010102010101010101010101010101010101010101010101010101010101070101020101010102010101010101010201010101010111fffb989a848563643e3e222213131817000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000fff19d9e9a9b9a9793938c8e868880827c7c7273696b5f6055564a4b404137372f2f272721211b1c1717131310100d0d0b0b0909080807070605050404041918000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c3cbf541ff7bf7210000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000bfccf240fd7cf72200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007a46000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c3d9ef3df97ce91efdabf12cfc5bfe17000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000bdd9ec3df57de81dfbaef02cfb5cff18000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000706c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000bac5da33e36dd818e594da23df4ad110eeafe42cea5ade15f487e921f643fc120000000000000000000000000000000000000000000000000000000000000000b0c7d833e36bd618e795d823db49d011e9b2e22be85cdd15f187e720f744ff1300000000000000000000000000000000000000000000000000000000000000005f9e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

const DataDistributions: Uint8Array[] = [];

for (let t = 0; t < 9; t++) {
  const a = new Uint8Array(256);

  for (let i = 0; i < 256; i++) a[i] = parseInt(PACKED.substr((t * 256 + i) * 2, 2), 16);

  DataDistributions.push(a);
}

// LSB-first bit input stream (mirrors StormLib's TInputStream).
class BitInputStream {
  buf: Uint8Array;
  pos = 0;
  bitBuffer = 0;
  bitCount = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  get1Bit(): number {
    if (this.bitCount === 0) {
      if (this.pos >= this.buf.length) return -1;

      this.bitBuffer = this.buf[this.pos++];
      this.bitCount = 8;
    }

    const v = this.bitBuffer & 1;

    this.bitBuffer >>>= 1;
    this.bitCount--;

    return v;
  }

  get8Bits(): number {
    if (this.bitCount < 8) {
      if (this.pos >= this.buf.length) return -1;

      this.bitBuffer |= this.buf[this.pos++] << this.bitCount;
      this.bitCount += 8;
    }

    const v = this.bitBuffer & 0xFF;

    this.bitBuffer >>>= 8;
    this.bitCount -= 8;

    return v;
  }
}

interface HuffItem {
  value: number;
  weight: number;
  parent: HuffItem | null;
  childLo: HuffItem | null;
  next: HuffItem | null;
  prev: HuffItem | null;
}

// A doubly-linked, weight-sorted list of tree items with a sentinel head.
// head.next = highest-weight item (tree root); head.prev = lowest-weight item.
// From an item, .next -> lower weight, .prev -> higher weight. childLo is the
// lower-weight child; the higher-weight child is childLo.prev.
class HuffTree {
  head: HuffItem;
  itemsByByte: (HuffItem | null)[];

  constructor() {
    this.head = { value: -1, weight: 0, parent: null, childLo: null, next: null, prev: null };
    this.head.next = this.head;
    this.head.prev = this.head;
    this.itemsByByte = new Array(0x102).fill(null);
  }

  linkTwoItems(p1: HuffItem, p2: HuffItem): void { // insert p2 right after p1
    p2.next = p1.next;
    p2.prev = <HuffItem>p1.next!.prev;
    p1.next!.prev = p2;
    p1.next = p2;
  }

  removeItem(it: HuffItem): void {
    if (it.next !== null) {
      it.prev!.next = it.next;
      it.next.prev = it.prev;
      it.next = it.prev = null;
    }
  }

  insertItem(it: HuffItem, insertAfter: boolean, insertPoint: HuffItem | null): void {
    this.removeItem(it);

    if (insertPoint === null) insertPoint = this.head;

    if (insertAfter) this.linkTwoItems(insertPoint, it);
    else this.linkTwoItems(<HuffItem>insertPoint.prev, it);
  }

  findHigherOrEqualItem(it: HuffItem | null, weight: number): HuffItem {
    if (it !== null) {
      while (it !== this.head) {
        if (it.weight >= weight) return it;

        it = <HuffItem>it.prev;
      }
    }

    return this.head;
  }

  createNewItem(value: number, weight: number, insertAfter: boolean): HuffItem {
    const it: HuffItem = { value, weight, parent: null, childLo: null, next: null, prev: null };

    this.insertItem(it, insertAfter, null);

    return it;
  }

  fixupItemPosByWeight(it: HuffItem, maxWeight: number): number {
    if (it.weight < maxWeight) {
      const higher = this.findHigherOrEqualItem(this.head.prev, it.weight);

      this.removeItem(it);
      this.linkTwoItems(higher, it);
    } else {
      maxWeight = it.weight;
    }

    return maxWeight;
  }

  buildTree(dataType: number): boolean {
    this.itemsByByte = new Array(0x102).fill(null);

    let maxWeight = 0;

    dataType = dataType & 0x0F;

    if (dataType >= DataDistributions.length) return false;

    const table = DataDistributions[dataType];

    for (let i = 0; i < 0x100; i++) {
      if (table[i] !== 0) {
        const it = this.createNewItem(i, table[i], true);

        this.itemsByByte[i] = it;
        maxWeight = this.fixupItemPosByWeight(it, maxWeight);
      }
    }

    this.itemsByByte[0x100] = this.createNewItem(0x100, 1, false);
    this.itemsByByte[0x101] = this.createNewItem(0x101, 1, false);

    let childLo = <HuffItem>this.head.prev;

    while (childLo !== this.head) {
      const childHi = <HuffItem>childLo.prev;

      if (childHi === this.head) break;

      const parent = this.createNewItem(0, childHi.weight + childLo.weight, true);

      childLo.parent = parent;
      childHi.parent = parent;
      parent.childLo = childLo;
      maxWeight = this.fixupItemPosByWeight(parent, maxWeight);
      childLo = <HuffItem>childHi.prev;
    }

    return true;
  }

  incWeightsAndRebalance(item: HuffItem | null): void {
    for (; item !== null; item = item.parent) {
      item.weight++;

      const higherItem = this.findHigherOrEqualItem(item.prev, item.weight);
      const childHi = <HuffItem>higherItem.next;

      if (childHi !== item) {
        this.removeItem(childHi);
        this.linkTwoItems(item, childHi);
        this.removeItem(item);
        this.linkTwoItems(higherItem, item);

        const childLo = (<HuffItem>childHi.parent).childLo;

        let parent = <HuffItem>item.parent;

        if (parent.childLo === item) parent.childLo = childHi;
        if (childLo === childHi) (<HuffItem>childHi.parent).childLo = item;

        parent = <HuffItem>item.parent;
        item.parent = childHi.parent;
        childHi.parent = parent;
      }
    }
  }

  insertNewBranchAndRebalance(value1: number, value2: number): boolean {
    const lastItem = <HuffItem>this.head.prev;
    const childHi = this.createNewItem(value1, lastItem.weight, false);

    childHi.parent = lastItem;
    this.itemsByByte[value1] = childHi;

    const childLo = this.createNewItem(value2, 0, false);

    childLo.parent = lastItem;
    lastItem.childLo = childLo;
    this.itemsByByte[value2] = childLo;
    this.incWeightsAndRebalance(childLo);

    return true;
  }

  decodeOneByte(is: BitInputStream): number {
    let item = <HuffItem>this.head.next; // root

    if (item === this.head) return HUFF_DECOMPRESS_ERROR;

    while (item.childLo !== null) {
      const bit = is.get1Bit();

      if (bit < 0) return HUFF_DECOMPRESS_ERROR;

      item = <HuffItem>(bit ? item.childLo.prev : item.childLo);
    }

    return item.value;
  }

  decompress(is: BitInputStream, outLength: number): Uint8Array | null {
    const out = new Uint8Array(outLength);

    let outPos = 0;
    const dataType = is.get8Bits();

    if (dataType < 0) return null;

    const isSparse = dataType === DATA_TYPE_SPARSE;

    if (!this.buildTree(dataType)) return null;

    let value: number;

    while ((value = this.decodeOneByte(is)) !== 0x100) {
      if (value === HUFF_DECOMPRESS_ERROR) return null;

      if (value === 0x101) { // NYT: a new, previously-unseen byte follows raw
        value = is.get8Bits();

        if (value < 0) return null;

        if (!this.insertNewBranchAndRebalance((<HuffItem>this.head.prev).value, value)) return null;

        if (!isSparse) this.incWeightsAndRebalance(this.itemsByByte[value]);
      }

      if (outPos >= outLength) break;

      out[outPos++] = value & 0xFF;

      if (isSparse) this.incWeightsAndRebalance(this.itemsByByte[value]);
    }

    return outPos === outLength ? out : out.subarray(0, outPos);
  }
}

// Decompress a Huffman-compressed MPQ sector body (mask byte already stripped).
// outLength = the sector's known decompressed size.
export default function decompressHuffman(bytes: Uint8Array, outLength: number): Uint8Array | null {
  const tree = new HuffTree();

  return tree.decompress(new BitInputStream(bytes), outLength);
}
