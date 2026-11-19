// Text out of the player's install, decoded the way the install actually stores it.
//
// 1.30+ (CASC) keeps every locale's strings as UTF-8 — enUS is plain ASCII, which is why the
// old windows-1252-only decode read English correctly and turned a zhCN install into mojibake
// (`任务` → `ä»»åŠ¡`). The MPQ-era installs (1.27 and older) are genuinely 8-bit Windows-1252.
// Decoding UTF-8 when the bytes ARE valid UTF-8 and falling back to 1252 when they are not
// reads both without a version switch, and leaves ASCII bytes exactly as they were.
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const CP1252 = new TextDecoder("windows-1252");
const GBK = new TextDecoder("gb18030");
const CJK = /[\u3400-\u9fff]/g;
const ACCENT = /[\u00c0-\u00ff]/g;

export function decodeGameText(bytes: Uint8Array): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    return CP1252.decode(bytes);
  }
}

/**
 * Text a MAP authored — `war3map.wts`, `scripts\war3map.j`, `war3mapSkin.txt`. 1.30 saves these
 * as UTF-8, and most maps are, but plenty of Chinese maps (Castle Fight among them) were last
 * saved by an ANSI editor and keep the same characters in GBK. Neither reading the install uses
 * works there: strict UTF-8 throws on the first GBK pair, and 1252 turns the lot into
 * "åŸŽå ¡". So: UTF-8 when the bytes are UTF-8, GBK when the bytes behave like GBK Chinese, and
 * only then the install's 1252 reading (a genuinely Western single-byte map).
 *
 * TOLD APART BY GEOMETRY, not by "does GBK succeed": GBK covers almost any byte pair, so both
 * candidates always decode. A GBK pair becomes ONE ideograph, so the GBK reading of Chinese text
 * has about as many ideographs as the 1252 reading has accented Latin letters (each GBK byte one
 * of those); a real 1252 text has far fewer accents than that, and its GBK reading only picks up
 * an occasional accidental pair. Castle Fight's script: 33.5k ideographs vs 26.4k accents (GBK),
 * where a French map's script would sit near half.
 *
 * A FILE CAN MIX THE TWO: Castle Fight's script was re-saved by W3x2lni, which wrote its own
 * UTF-8 sections into an older GBK script. So the file-level vote only chooses the fallback for
 * a run of non-ASCII bytes: every such run is first tried as UTF-8, and only the runs that are
 * not get the GBK (or 1252) reading. ASCII — all of JASS's syntax — is left byte-for-byte.
 */
export function decodeMapText(bytes: Uint8Array): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    /* mixed or single-byte — decide per run below */
  }
  const gbk = GBK.decode(bytes);
  const cjk = (gbk.match(CJK) ?? []).length;
  const accents = (CP1252.decode(bytes).match(ACCENT) ?? []).length;
  const gbkFile = cjk >= 32 && cjk > accents * 0.8;
  const fallback = gbkFile ? GBK : CP1252;

  let out = "";
  let at = 0;
  while (at < bytes.length) {
    const start = at;
    const high = bytes[at] >= 0x80;
    while (at < bytes.length && (bytes[at] >= 0x80) === high) at++;
    const run = bytes.subarray(start, at);
    if (!high) {
      out += CP1252.decode(run);
      continue;
    }
    try {
      out += UTF8.decode(run);
    } catch {
      out += fallback.decode(run);
    }
  }
  return out;
}
