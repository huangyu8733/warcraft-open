// Dev-only: pull the CLASSIC (SD) boot art out of the developer's own 1.30 install into
// `public/boot/classic/` for the classic launch screen (src/ui/bootSplash.ts). Those files are
// git-ignored — the project ships no Blizzard art — and the splash falls back to its drawn
// wordmark and CSS rail when they are absent, so a fresh clone still boots.
//
// The 1.30 install is a CASC store just like 3.0's, so this reuses the engine's own reader.
// Classic art is BLP1, which mdx-m3-viewer already decodes (src/assets/blp.ts); the PNGs are
// written here so the splash can use them with plain CSS.
//
// Usage: node tools/extract-boot-classic.mjs ["/path/to/Warcraft III 1.30"]

import { open, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { createServer } from "vite";

if (!globalThis.localStorage) {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}
// BlpImage.getMipmap allocates an ImageData; Node has none, so give it a minimal one.
if (!globalThis.ImageData) {
  globalThis.ImageData = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  };
}

const ROOT = process.argv[2] ?? "/Users/huangyu/魔兽/开源魔兽争霸/Warcraft III zhCN";
globalThis.location = { search: "?flavor=sd" };

const server = await createServer({
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
const casc = await server.ssrLoadModule("/src/vfs/casc.ts");
const { BlpImage } = createRequire(import.meta.url)(
  "mdx-m3-viewer/dist/cjs/parsers/blp/image",
);

const buildInfo = await readFile(join(ROOT, ".build.info"), "utf8");
const info = casc.parseBuildInfo(buildInfo);
const buildKey = (info.get("Build Key") ?? "").toLowerCase();
const configText = await readFile(
  join(ROOT, "Data/config", buildKey.slice(0, 2), buildKey.slice(2, 4), buildKey),
  "utf8",
);
const dataDir = join(ROOT, "Data/data");
const idx = new Map();
for (const name of await readdir(dataDir)) {
  if (/^[0-9a-f]{10}\.idx$/i.test(name)) idx.set(name, new Uint8Array(await readFile(join(dataDir, name))));
}
const data = new Map();
for (const name of await readdir(dataDir)) {
  const m = /^data\.(\d+)$/.exec(name);
  if (!m) continue;
  const h = await open(join(dataDir, name), "r");
  const { size } = await h.stat();
  data.set(Number(m[1]), {
    size,
    slice: async (start, end) => {
      const buf = Buffer.alloc(end - start);
      const { bytesRead } = await h.read(buf, 0, end - start, start);
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
    },
  });
}
const vfs = await casc.CascDataSource.open(
  { buildInfo, config: new Map([[buildKey, configText]]), idx, data },
  () => {},
  { graphics: "sd", lazyArt: true },
);

// ── PNG writer (RGBA, no filters) ───────────────────────────────────────────
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, body) => {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "latin1");
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
};
const png = ({ width, height, data }) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

// Classic launch faces: the RoC/TFT wordmark, the loading rail (border/fill/trough/glow), and
// the loading screen's decorative corners.
const files = [
  "UI\\Glues\\MainMenu\\WarCraftIIILogo\\WarcraftIII-logo-alpha.blp",
  "UI\\Glues\\MainMenu\\WarCraftIIILogo_exp\\War3xLogo.blp",
  "UI\\Glues\\Loading\\LoadBar\\Loading-BarBorder.blp",
  "UI\\Glues\\Loading\\LoadBar\\Loading-BarFill.blp",
  "UI\\Glues\\Loading\\LoadBar\\Loading-BarBackground.blp",
  "UI\\Glues\\Loading\\LoadBar\\Loading-BarGlass.blp",
  "UI\\Glues\\Loading\\LoadBar\\Loading-BarGlow.blp",
  "UI\\Glues\\Loading\\Load-Generic\\Generic-Loading-TopLeft.blp",
  "UI\\Glues\\Loading\\Load-Generic\\Generic-Loading-TopRight.blp",
  "UI\\Glues\\Loading\\Load-Generic\\Generic-Loading-BotLeft.blp",
  "UI\\Glues\\Loading\\Load-Generic\\Generic-Loading-BotRight.blp",
  "UI\\Glues\\Loading\\Multiplayer\\Loading-TopLeft.blp",
  "UI\\Glues\\Loading\\Multiplayer\\Loading-BotLeft.blp",
  "UI\\Widgets\\Glues\\Loading-NameBackground.blp",
];

const out = "/Users/huangyu/魔兽/开源魔兽争霸/public/boot/classic";
await mkdir(out, { recursive: true });
/** Decoded art, by file name — the loading screen's four corners are stitched below. */
const decoded = new Map();
for (const p of files) {
  if (!vfs.exists(p)) {
    console.log("missing", p);
    continue;
  }
  const bytes = await vfs.read(p);
  try {
    const image = new BlpImage();
    image.load(bytes);
    const mip = image.getMipmap(0);
    const name = p.split("\\").pop().replace(/\.blp$/i, ".png").replace(/[^\w.-]+/g, "-");
    decoded.set(name, mip);
    const encoded = png({ width: mip.width, height: mip.height, data: mip.data });
    await writeFile(join(out, name), encoded);
    console.log("wrote", name, `${mip.width}x${mip.height}`, encoded.length);
  } catch (err) {
    console.log("failed", p, String(err));
  }
}

// The classic loading screen IS these four corners: 512x512 above, 512x256 below, stitched into
// one 1024x768 parchment (4:3) that the splash shows whole, letterboxed on a wide window — the
// classic client's own framing.
const corners = {
  tl: decoded.get("Generic-Loading-TopLeft.png"),
  tr: decoded.get("Generic-Loading-TopRight.png"),
  bl: decoded.get("Generic-Loading-BotLeft.png"),
  br: decoded.get("Generic-Loading-BotRight.png"),
};
if (corners.tl && corners.tr && corners.bl && corners.br) {
  const W = 1024;
  const H = 768;
  const sheet = new Uint8ClampedArray(W * H * 4);
  const blit = (mip, ox, oy) => {
    for (let y = 0; y < mip.height; y++) {
      const src = y * mip.width * 4;
      sheet.set(mip.data.subarray(src, src + mip.width * 4), ((oy + y) * W + ox) * 4);
    }
  };
  blit(corners.tl, 0, 0);
  blit(corners.tr, 512, 0);
  blit(corners.bl, 0, 512);
  blit(corners.br, 512, 512);
  const encoded = png({ width: W, height: H, data: sheet });
  await writeFile(join(out, "classic-loading-bg.png"), encoded);
  console.log("wrote classic-loading-bg.png 1024x768", encoded.length);
}
process.exit(0);
