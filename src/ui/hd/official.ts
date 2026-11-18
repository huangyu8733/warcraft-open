import type { WebUiAssets } from "./assets";
import cssText from "./official.css?raw";
import customGameText from "./customGame.css?raw";
import loadingScreenText from "./loadingScreen.css?raw";
import scoreScreenText from "./scoreScreen.css?raw";

/** The front end's sheet plus the Custom Game flow and loading screen's copy of 3.0's rules. */
const SHEET = `${cssText}\n${customGameText}\n${loadingScreenText}\n${scoreScreenText}`;

/**
 * Install 3.0's own glue stylesheet (`official.css`) with every `url()` pointing at the mounted
 * install.
 *
 * The sheet is copied verbatim from `WebUI\GlueManager.js`, so its `url()`s are paths the game's
 * C++ host serves over HTTP (`BaseFrames/war3_metal_frame_4k.png`, …). There is no such host
 * here: the archives only hand us bytes, so each referenced file is read once, turned into a
 * blob URL and substituted before the sheet is inserted. Blob URLs live for the page's lifetime,
 * and the sheet is inserted once, so this is a one-off per session.
 *
 * A file the install does not ship is replaced with a transparent pixel rather than left as a
 * 404 path — a missing ornament should leave a gap, not a broken-image hairline in a panel.
 */

const STYLE_ID = "hd-official-style";

/** 1x1 transparent GIF, for an asset the install doesn't carry. */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

let pending: Promise<void> | null = null;

/** Inject the sheet once, then resolve. Safe to call from every HD screen. */
export function loadOfficialStyle(assets: WebUiAssets): Promise<void> {
  if (document.getElementById(STYLE_ID)) return Promise.resolve();
  if (pending) return pending;
  pending = (async () => {
    const paths = new Set<string>();
    for (const m of SHEET.matchAll(URL_RE)) {
      const path = m[2].trim();
      if (/^(data:|blob:|https?:|\/|#)/i.test(path)) continue;
      paths.add(path);
    }
    const resolved = new Map<string, string>();
    await Promise.all(
      [...paths].map(async (path) => {
        const url = await assets.url(`WebUI\\${path.replace(/\//g, "\\")}`);
        resolved.set(path, url ?? BLANK);
      }),
    );
    const sheet = SHEET.replace(URL_RE, (whole, _quote: string, raw: string) => {
      const path = raw.trim();
      const url = resolved.get(path);
      return url ? `url("${url}")` : whole;
    });
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = sheet;
    document.head.appendChild(style);
  })().catch((err) => {
    pending = null;
    throw err;
  });
  return pending;
}
