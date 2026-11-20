/**
 * The site this build reads maps from — one home for a rule that was duplicated.
 *
 * A packaged build may set `VITE_WARCRAFT_OPEN_SITE_URL`; a page served BY the site (the browser
 * build, and the Android app, which wraps the hosted `/play/`) reads its own origin; the desktop's
 * own server answers on loopback, so its origin says nothing about the site and the public one is
 * used instead (the same fallback game/replayUpload.ts takes); a dev server falls back to the local
 * site so the shelf works out of the box.
 *
 * The launcher's shelf (ui/home.ts) and the map list's download dialog (ui/mapSites.ts) both need
 * it now, and two copies of this rule would be one copy that forgets a case.
 */
export const SITE = (
  (import.meta.env.VITE_WARCRAFT_OPEN_SITE_URL as string | undefined) ??
  (import.meta.env.DEV
    ? "http://localhost:3000"
    : servedBySite() ? location.origin : "https://warcraft.hhkj.me")
).replace(/\/+$/, "");

/**
 * A link from the site's API, on the site's own origin. The API builds its download links from the
 * origin the app server believes it is on — behind the site's proxy that is the app itself
 * (`http://localhost:3000`), which no player can reach — so a link on another origin is moved onto
 * ours, same path.
 */
export function siteUrl(link: string): string {
  if (!link || !SITE) return link;
  try {
    const parsed = new URL(link, SITE);
    const base = new URL(SITE);
    return parsed.origin === base.origin ? link : `${SITE}${parsed.pathname}${parsed.search}`;
  } catch {
    return link;
  }
}

/** The page came over HTTP from somewhere other than the desktop shell's loopback server. */
function servedBySite(): boolean {
  if (location.protocol !== "http:" && location.protocol !== "https:") return false;
  return !["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname);
}
