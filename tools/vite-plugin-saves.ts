import { join, resolve } from "node:path";
import type { Plugin } from "vite";
// The same store the desktop shell writes through (electron/saveStore.mjs).
import { createSaveStore } from "../electron/saveStore.mjs";

/**
 * Dev: the SAVED GAMES folder (issue #159, src/game/save/saveFile.ts) — the repo's own `.saves/`
 * (gitignored). A build has no endpoint (`apply: "serve"`); a shipped game keeps its saves
 * through the desktop shell (electron/main.mjs, `ow3native.saves`).
 *
 * The two data lines get their own folder — `.saves/sd/`, `.saves/hd/` — because their sims run
 * on different installs. `.saves/` itself is the pre-split folder: its files are still listed and
 * read for a line (the page tells the line from each save's header) and deleted from there when
 * the panel deletes them, but nothing is written into it any more.
 *
 *   POST /saves/<line>/write?name=N   <bytes>   → { name }   writes N.o3s
 *   GET  /saves/<line>/list                     → [{ name, size, mtime }]
 *   GET  /saves/<line>/file?name=N              → <bytes>
 *   GET  /saves/<line>/exists?name=N            → { ok }
 *   POST /saves/<line>/delete?name=N            → { ok }     deletes N
 */
export function saves(): Plugin {
  return {
    name: "openwar3-saves",
    apply: "serve",
    configureServer(server) {
      const root = resolve(server.config.root ?? process.cwd());
      const warn = (msg: string): void => server.config.logger.warn(`[saves] ${msg}`);
      const store = (line: string) => createSaveStore(join(root, ".saves", line), { warn });
      const stores: Record<string, ReturnType<typeof store>> = { sd: store("sd"), hd: store("hd") };
      /** The pre-split folder — read for both lines, never written. */
      const legacy = createSaveStore(join(root, ".saves"), { warn });
      /** One line's listing: its folder first, then its own files still in the old folder
       *  (same name → the line's copy wins), newest first. */
      const list = (s: ReturnType<typeof store>): ReturnType<typeof legacy.list> => {
        const byName = new Map<string, ReturnType<typeof legacy.list>[number]>();
        for (const info of s.list()) byName.set(info.name, info);
        for (const info of legacy.list()) if (!byName.has(info.name)) byName.set(info.name, info);
        return [...byName.values()].sort((a, b) => b.mtime - a.mtime);
      };
      server.middlewares.use("/saves", (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://x");
        const parts = url.pathname.split("/").filter(Boolean);
        const line = parts[0] === "sd" || parts[0] === "hd" ? parts.shift() : null;
        const s = line ? stores[line] : legacy;
        const route = `/${parts.join("/")}`;
        const name = url.searchParams.get("name") ?? "";
        const json = (code: number, out: unknown): void => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(out));
        };
        if (req.method === "GET" && route === "/list") return json(200, line ? list(s) : s.list());
        if (req.method === "GET" && route === "/exists") return json(200, { ok: s.exists(name) || (line ? legacy.exists(name) : false) });
        if (req.method === "GET" && route === "/file") {
          const bytes = s.read(name) ?? (line ? legacy.read(name) : null);
          if (!bytes) return json(404, { error: "no such save" });
          res.setHeader("content-type", "application/octet-stream");
          return res.end(bytes);
        }
        if (req.method === "POST" && route === "/delete") {
          // Both places: a file of this line's may still be in the pre-split folder.
          const inLine = s.remove(name);
          const inLegacy = line ? legacy.remove(name) : false;
          return json(200, { ok: inLine || inLegacy });
        }
        if (req.method === "POST" && route === "/write") {
          const chunks: Buffer[] = [];
          let size = 0;
          req.on("data", (c: Buffer) => {
            size += c.length;
            if (size > 256 * 1024 * 1024) req.destroy();
            else chunks.push(c);
          });
          req.on("end", () => {
            const written = s.write(name, Buffer.concat(chunks));
            server.config.logger.info(`[saves] .saves/${line ? `${line}/` : ""}${written} (${size} bytes)`);
            json(written ? 200 : 400, { name: written });
          });
          return;
        }
        return next();
      });
    },
  };
}
