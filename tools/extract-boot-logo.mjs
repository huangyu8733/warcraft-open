// Dev-only: pull the Reforged wordmarks out of the developer's own CASC into
// `public/boot/webui/` for the `?dev` boot splash (src/dev/bootSplash.ts). Those files are
// git-ignored — the project ships no Blizzard art — and the splash falls back to its text
// wordmark when they are absent, so a fresh clone still boots.
//
// Usage: node tools/extract-boot-logo.mjs ["/path/to/Warcraft III"]

import { open, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "vite";

if (!globalThis.localStorage) {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}
const ROOT = process.argv[2] ?? "/Users/huangyu/rrrr/Warcraft III";
globalThis.location = { search: "?flavor=hd&hdArt=de" };

const server = await createServer({
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
const casc = await server.ssrLoadModule("/src/vfs/casc.ts");

const info = casc.parseBuildInfo(await readFile(join(ROOT, ".build.info"), "utf8"));
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
  { buildInfo: await readFile(join(ROOT, ".build.info"), "utf8"), config: new Map([[buildKey, configText]]), idx, data },
  () => {},
  { graphics: "de", lazyArt: true },
);

const out = "/Users/huangyu/魔兽/开源魔兽争霸/public/boot/webui";
await mkdir(out, { recursive: true });
const files = [
  "WebUI\\Common\\reforged-logo.png",
  "WebUI\\Common\\reforged-logo-zhCN.png",
  "WebUI\\Common\\tft_reforged-logo.png",
  "WebUI\\Common\\tft_reforged-logo-zhCN.png",
  "WebUI\\Common\\fk_reforged-logo.png",
  "WebUI\\Common\\fk_reforged-logo-zhCN.png",
  // 3.0's own loading rail (the boot splash's bar): border, fill, and end caps.
  "WebUI\\LoadingScreen\\Loading-BarBorder_4k.png",
  "WebUI\\LoadingScreen\\loading-bar-4k.png",
  "WebUI\\LoadingScreen\\loadingscreen-bar-endcap_4k.png",
  "WebUI\\LoadingScreen\\loadingscreen-fill-flat.png",
];
for (const p of files) {
  if (!vfs.exists(p)) {
    console.log("missing", p);
    continue;
  }
  const bytes = await vfs.read(p);
  const name = p.split("\\").pop();
  await writeFile(join(out, name), bytes);
  console.log("wrote", name, bytes.length);
}
process.exit(0);
