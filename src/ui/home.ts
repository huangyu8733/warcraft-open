import { bindHotkeys, createGlueButton, createPanel, type GlueButton } from "@warcraft-open/ui/dom";
import { currentLocale, t } from "../i18n";
import { createLanguagePicker } from "../i18n/switch";
import { downloadedMapKey, safeMapName } from "../assets/downloadedMaps";
import {
  deleteDownloadedMap, downloadedMapExists, isDesktopApp, listDownloadedMaps, loadNativeInstall,
  pickNativeInstall, quitNative, rememberedInstall, saveMapToDownload,
  checkUpdate, downloadUpdate, installUpdate, onUpdateState,
  type DownloadedMap, type InstalledFolder,
} from "../assets/nativeInstall";
import { DEFAULT_PROFILE } from "../vfs/profiles";
import type { DataSource } from "../vfs/types";
import { loadProfile } from "../vfs/loader";
import {
  pickInstall, readInstallDir, rememberInstallHandle, rememberedInstallHandle, requestPersistence,
  type DirHandle, type PickedInstall,
} from "../assets/opfs";
import { HD_REQUIRED_VERSION, versionVerdict } from "../vfs/version";
import { buildInfoVersion } from "../vfs/casc";
import { flavor, type GameFlavor } from "../data/flavor";
import { SITE, siteUrl } from "../data/site";
import { dismissBootSplash, mountBootSplash, type BootSplash } from "./bootSplash";
import { createGestureHelp } from "./gestureHelp";
import { createFullscreenToggle } from "./fullscreen";

/** A mounted install, as the launcher hands it to the game (main.ts `mountInstall`). */
export interface GateLoad {
  vfs: DataSource;
  mounted: string[];
  missing: string[];
  fileCount: number;
  /** The install's `Maps\` folder — what the Custom Game screen lists (issue #61). */
  maps: Map<string, File>;
  /** Which game files this is, as a replay's header names it (vfs/loader.ts). */
  flavour: string;
  /** The install's exact build, for an HD room's `gameVersion` (vfs/loader.ts). */
  gameVersion: string | null;
}

// The launcher's front page — the desktop app's and the browser build's alike: the same shell as
// the site (top bar, side nav, hero, footer), with three views of its own — Launch, Maps and
// About. They are PAGES, not sections stacked under the hero: the launch screen is the game's
// front door, and the shelves live behind the nav. There is deliberately no "download the game"
// block: a shipped app already is the game, and /play/ is reached from the site's download page.
//
// The map page reads the site's public map API and saves straight into the install's
// `Maps\Download\`, through the shell (`ow3native.saveMap`). A map service that is down or not
// configured only empties that page; starting the game never waits for it.

/** A public asset's URL. The page may be served from a subpath (the website's /play/), so the
 *  build's base — not a bare "/" — is what the artwork hangs off. */
const asset = (path: string): string => `${import.meta.env.BASE_URL}${path}`;

export interface Home {
  dispose(): void;
}

interface SiteMap {
  slug: string;
  name: string;
  description: string;
  coverUrl: string | null;
  fileSize: number | null;
  version: string | null;
  author: string | null;
  players: string | null;
  flavors: string[];
  category: string;
  updatedAt: string;
  fileName: string;
  downloadUrl: string | null;
}

const siteLocale = (): string => (currentLocale() === "zhCN" ? "zh" : "en");

/** The two data lines the launcher can boot (src/data/flavor.ts), in the order they are shown. */
const LINES = ["sd", "hd"] as const;

/**
 * The launcher page and the game page are the same page; `?play=` says which one this is.
 *
 * A launch takes THIS window over — no second window, in either build. The line the page booted
 * on starts in place; the other line reloads the window onto its own play page (`?flavor=`),
 * which starts loading on its own.
 */
const PLAY_PARAM = "play";

function formatBytes(value: number | null): string {
  if (!value || value <= 0) return "";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

export function mountHome(root: HTMLElement, onLoaded: (load: GateLoad) => void): Home {
  const abort = new AbortController();
  const native = isDesktopApp();
  let busy = false;
  /** A Launch press is in flight (it may be waiting on the folder dialog): a second press would
   *  open a second window for the same line. */
  let launching = false;
  /** The line this WINDOW booted on — `data/*` has already parsed its tables against it, so it
   *  never changes. The other line is another window, not a rebuild. */
  const running = flavor();
  /** What each line's folder is, as the shell remembers it — one per line, never shared: SD and
   *  HD keep separate settings keys (electron/install.mjs `installPathKey`). */
  const installs: Record<GameFlavor, InstalledFolder> = {
    sd: { path: null, valid: false, present: false, version: null },
    hd: { path: null, valid: false, present: false, version: null },
  };
  /** Browser: the folders earlier visits picked, one per line. Their grants do not survive a
   *  reload, so they are kept only to hand to a Launch press — a press is what may ask again.
   *  Keyed by line because the two rows are two installs: picking a Reforged folder must never
   *  take the classic one away (or answer for it). */
  const browserHandles: Record<GameFlavor, DirHandle | null> = { sd: null, hd: null };
  /** Browser: the folder a line has already mounted in this page. Pressing Play again reuses it
   *  rather than putting the picker up a second time. */
  const browserInstalls: Record<GameFlavor, PickedInstall | null> = { sd: null, hd: null };
  /** What the map page last read, so a detail route can be opened without another request. */
  let loadedMaps: SiteMap[] = [];
  /** Maps already kept in the install's `Maps\Download\`, by slug — the shelf's "downloaded". */
  const downloaded = new Set<string>();
  const cardViews = new Map<string, { badge: HTMLElement; button: GlueButton }>();
  let detailSlug: string | null = null;
  let detailButton: GlueButton | null = null;
  let detailBadge: HTMLElement | null = null;

  const page = document.createElement("div");
  page.className = "home";

  const shell = document.createElement("div");
  shell.className = "home-shell";

  // ── Top bar ───────────────────────────────────────────────────────────────
  const topbar = document.createElement("header");
  topbar.className = "home-topbar";
  const brand = document.createElement("a");
  brand.className = "home-brand";
  brand.href = "#/";
  const brandLogo = document.createElement("img");
  brandLogo.src = asset("brand-logo.png");
  brandLogo.alt = t("app.title");
  brandLogo.draggable = false;
  brand.append(brandLogo);

  const navItems: Array<{ href: string; key: "home.navHome" | "home.navMaps" | "home.navAbout"; view: View }> = [
    { href: "#/", key: "home.navHome", view: "home" },
    { href: "#/maps", key: "home.navMaps", view: "maps" },
    { href: "#/about", key: "home.navAbout", view: "about" },
  ];

  const topnav = document.createElement("nav");
  topnav.className = "home-topnav";
  const topLinks: HTMLAnchorElement[] = [];
  for (const item of navItems) {
    const a = document.createElement("a");
    a.href = item.href;
    a.textContent = t(item.key);
    topnav.append(a);
    topLinks.push(a);
  }

  const topActions = document.createElement("div");
  topActions.className = "home-topbar-actions";
  topActions.append(createLanguagePicker());
  // 浏览器里首页顶栏也带一颗全屏开关；桌面应用由外壳管窗口，工厂会返回 null。
  const fullscreen = createFullscreenToggle("home-fullscreen");
  if (fullscreen) topActions.append(fullscreen.element);
  // A browser tab is the only place a swipe can leave the page (back / forward), so only the
  // browser build carries the way to turn it off.
  if (!native) topActions.append(createGestureHelp());
  topbar.append(brand, topnav, topActions);

  // ── Body: side nav + content ──────────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "home-body";

  const side = document.createElement("aside");
  side.className = "home-sidenav";
  const sideList = document.createElement("ul");
  const sideLinks: HTMLAnchorElement[] = [];
  for (const item of navItems) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = item.href;
    a.textContent = t(item.key);
    li.append(a);
    sideList.append(li);
    sideLinks.push(a);
  }
  side.append(sideList);

  // Sign-in, pinned to the bottom of the same rail and wearing the same clothes as its links.
  const sideLogin = document.createElement("button");
  sideLogin.type = "button";
  sideLogin.className = "home-sidenav-login";
  sideLogin.textContent = t("home.login");
  side.append(sideLogin);

  const main = document.createElement("main");
  main.className = "home-main";

  // ── Launch page (hero only) ───────────────────────────────────────────────
  const hero = document.createElement("section");
  hero.className = "home-hero";
  const heroBg = document.createElement("div");
  heroBg.className = "home-hero-bg";
  heroBg.setAttribute("aria-hidden", "true");
  const heroBgImg = document.createElement("img");
  heroBgImg.src = asset("demoscreens/launcher-hero.avif");
  heroBgImg.alt = "";
  heroBgImg.draggable = false;
  heroBg.append(heroBgImg);

  const heroContent = document.createElement("div");
  heroContent.className = "home-hero-content";
  const kicker = document.createElement("p");
  kicker.className = "home-hero-kicker";
  kicker.textContent = t("home.kicker");
  const logo = document.createElement("img");
  logo.className = "home-hero-logo";
  logo.src = asset("hero-logo.avif");
  logo.alt = t("app.title");
  logo.draggable = false;
  const tagline = document.createElement("p");
  tagline.className = "home-hero-tagline";
  tagline.textContent = t("home.tagline");
  const lede = document.createElement("p");
  lede.className = "home-hero-lede";
  lede.textContent = t("home.lede");

  // ── The two lines, each with its own Launch and its own folder ────────────
  // SD and HD are separate data lines with separate remembered folders AND separate windows:
  // neither row is "the current one", and pressing either opens a game window of that line
  // (ow3:open-game) while this launcher stays put. Both may run at the same time.
  const lineName = (line: GameFlavor): string => t(line === "hd" ? "flavor.hd" : "flavor.sd");
  const editions = document.createElement("div");
  editions.className = "home-editions";
  interface LineRow {
    root: HTMLElement;
    state: HTMLElement;
    play: GlueButton;
    change: GlueButton;
  }
  const rows = {} as Record<GameFlavor, LineRow>;
  /** `HD_REQUIRED_VERSION` blanked = no Reforged data line in this build: the row is shown but
   *  dead, exactly as the load gate's own SD/HD pair is (ui/gate.ts). */
  const hdOpen = HD_REQUIRED_VERSION.length > 0;

  for (const line of LINES) {
    const box = document.createElement("div");
    box.className = "home-edition";
    if (line === "hd" && !hdOpen) box.classList.add("is-locked");
    box.dataset.line = line;

    const info = document.createElement("div");
    info.className = "home-edition-info";
    const head = document.createElement("div");
    head.className = "home-edition-head";
    const name = document.createElement("span");
    name.className = "home-edition-name";
    name.textContent = lineName(line);
    head.append(name);
    const state = document.createElement("p");
    state.className = "home-edition-state";
    info.append(head, state);

    const buttons = document.createElement("div");
    buttons.className = "home-edition-actions";
    // Two Launch buttons would answer the same letter, so the classic line keeps P and the
    // Reforged one takes H — the first letter of its own name in both languages' spelling.
    const play = createGlueButton({
      label: t("home.play"),
      hotkey: line === "sd" ? "P" : "H",
      bordered: true,
    });
    const change = createGlueButton({ label: t("home.changeFolder") });
    // The captions are identical on both rows; the accessible name says which line it acts on.
    play.button.setAttribute("aria-label", `${t("home.play")} · ${lineName(line)}`);
    change.button.setAttribute("aria-label", `${t("home.changeFolder")} · ${lineName(line)}`);
    if (line === "hd" && !hdOpen) {
      play.setDisabled(true);
      change.setDisabled(true);
      box.title = t("flavor.hdLocked");
    }
    buttons.append(play.root, change.root);

    box.append(info, buttons);
    editions.append(box);
    rows[line] = { root: box, state, play, change };
  }

  const status = document.createElement("p");
  status.className = "home-status";

  heroContent.append(kicker, logo, tagline, lede, editions, status);
  hero.append(heroBg, heroContent);

  // ── Maps page ─────────────────────────────────────────────────────────────
  const mapsView = document.createElement("section");
  mapsView.className = "home-page";
  const mapsHead = document.createElement("div");
  mapsHead.className = "home-section-head";
  const mapsTitle = document.createElement("h1");
  mapsTitle.textContent = t("home.maps");
  mapsHead.append(mapsTitle);

  // Two shelves behind one page: the library (what the site offers) and what this install
  // already keeps in `Maps\Download\`.
  const mapsTabs = document.createElement("div");
  mapsTabs.className = "home-map-tabs";
  const libraryTab = document.createElement("button");
  libraryTab.type = "button";
  libraryTab.className = "home-map-tab is-active";
  libraryTab.textContent = t("home.library");
  const installedTab = document.createElement("button");
  installedTab.type = "button";
  installedTab.className = "home-map-tab";
  installedTab.textContent = t("home.installed");
  mapsTabs.append(libraryTab, installedTab);

  // The search box sits beside the tabs, with its button on the right; the box stays visible.
  const search = document.createElement("input");
  search.type = "search";
  search.className = "home-map-search";
  search.placeholder = t("home.searchPlaceholder");
  search.setAttribute("aria-label", t("home.search"));
  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "home-map-search-btn";
  searchBtn.textContent = t("home.search");
  const searchGroup = document.createElement("div");
  searchGroup.className = "home-map-search-group";
  searchGroup.append(search, searchBtn);
  const mapsHeadRow = document.createElement("div");
  mapsHeadRow.className = "home-map-head";
  mapsHeadRow.append(mapsTabs, searchGroup);

  const libraryPane = document.createElement("div");
  libraryPane.className = "home-map-pane";
  const toolbar = document.createElement("div");
  toolbar.className = "home-map-toolbar";
  const chips = document.createElement("div");
  chips.className = "home-map-chips";
  toolbar.append(chips);
  const mapsBody = document.createElement("div");
  mapsBody.className = "home-map-grid";
  libraryPane.append(toolbar, mapsBody);

  const installedPane = document.createElement("div");
  installedPane.className = "home-map-pane";
  const installedBody = document.createElement("div");
  installedBody.className = "home-installed";
  installedPane.append(installedBody);
  installedPane.hidden = true;

  mapsView.append(mapsHead, mapsHeadRow, libraryPane, installedPane);

  // ── About page ────────────────────────────────────────────────────────────
  const aboutView = document.createElement("section");
  aboutView.className = "home-page";
  const aboutTitle = document.createElement("h1");
  aboutTitle.textContent = t("home.about");
  const aboutText = document.createElement("p");
  aboutText.className = "home-page-text";
  aboutText.textContent = t("home.aboutText");

  // 与 README、网站联系页共用同一份信息：站点 / GitHub / QQ 群 / 作者 QQ。
  // 用公网地址而不是 SITE：开发版与桌面版的 SITE 指向本机或自身，这里要的是对外入口。
  const PUBLIC_SITE = "https://warcraft.hhkj.me";
  const GITHUB = "https://github.com/huangyu8733/warcraft-open";
  const aboutLinks = document.createElement("dl");
  aboutLinks.className = "home-meta-list home-about-links";
  const aboutRow = (label: string, value: string, href?: string): void => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = value;
      dd.appendChild(a);
    } else {
      dd.textContent = value;
    }
    aboutLinks.append(dt, dd);
  };
  aboutRow(t("home.aboutSite"), PUBLIC_SITE, PUBLIC_SITE);
  aboutRow(t("home.aboutGithub"), GITHUB, GITHUB);
  aboutRow(t("home.aboutQqGroup"), "567744625");
  aboutRow(t("home.aboutAuthorQq"), "360268423");

  const aboutFeatures = document.createElement("section");
  aboutFeatures.className = "home-about-block";
  const aboutFeaturesTitle = document.createElement("h2");
  aboutFeaturesTitle.textContent = t("home.aboutFeatures");
  const aboutFeatureList = document.createElement("ul");
  aboutFeatureList.className = "home-about-list";
  for (const line of [
    t("home.aboutF1"),
    t("home.aboutF2"),
    t("home.aboutF3"),
    t("home.aboutF4"),
    t("home.aboutF5"),
  ]) {
    const item = document.createElement("li");
    item.textContent = line;
    aboutFeatureList.appendChild(item);
  }
  aboutFeatures.append(aboutFeaturesTitle, aboutFeatureList);

  // 赞赏：二维码在网站上（聊天工具里贴图容易被压缩），这里只给入口。
  const aboutDonate = document.createElement("section");
  aboutDonate.className = "home-about-block";
  const aboutDonateTitle = document.createElement("h2");
  aboutDonateTitle.textContent = t("home.aboutDonate");
  const aboutDonateText = document.createElement("p");
  aboutDonateText.className = "home-page-text";
  aboutDonateText.textContent = t("home.aboutDonateText");
  const aboutDonateLink = document.createElement("a");
  aboutDonateLink.className = "home-about-link";
  aboutDonateLink.href = `${PUBLIC_SITE}/${siteLocale()}/contact`;
  aboutDonateLink.target = "_blank";
  aboutDonateLink.rel = "noopener noreferrer";
  aboutDonateLink.textContent = t("home.aboutDonateLink");
  aboutDonate.append(aboutDonateTitle, aboutDonateText, aboutDonateLink);

  const aboutLegal = document.createElement("section");
  aboutLegal.className = "home-about-block";
  const aboutLegalTitle = document.createElement("h2");
  aboutLegalTitle.textContent = t("home.aboutDisclaimer");
  const aboutLegalText = document.createElement("p");
  aboutLegalText.className = "home-page-text home-page-muted";
  aboutLegalText.textContent = `${t("home.aboutDisclaimerText")}\n${t("home.aboutLicense")}`;
  aboutLegal.append(aboutLegalTitle, aboutLegalText);

  aboutView.append(aboutTitle, aboutText, aboutLinks, aboutFeatures, aboutDonate, aboutLegal);

  // ── Map detail page (#/maps/<slug>) — the site's detail, with a launcher download ──
  const detailView = document.createElement("section");
  detailView.className = "home-page";
  const back = document.createElement("a");
  back.className = "home-back";
  back.href = "#/maps";
  back.textContent = t("home.back");
  const detailGrid = document.createElement("div");
  detailGrid.className = "home-detail";
  const detailCover = document.createElement("div");
  detailCover.className = "home-detail-cover";
  const detailIntro = document.createElement("div");
  detailIntro.className = "home-detail-intro";
  const detailTitle = document.createElement("h1");
  const detailTitleRow = document.createElement("div");
  detailTitleRow.className = "home-detail-title";
  detailBadge = document.createElement("span");
  detailBadge.className = "home-downloaded-badge";
  detailBadge.textContent = t("home.downloadedBadge");
  detailBadge.hidden = true;
  detailTitleRow.append(detailTitle, detailBadge);
  const detailMeta = document.createElement("dl");
  detailMeta.className = "home-meta-list";
  const detailActions = document.createElement("div");
  detailActions.className = "home-detail-actions";
  detailIntro.append(detailTitleRow, detailMeta, detailActions);
  detailGrid.append(detailCover, detailIntro);

  const detailBody = createPanel("section", "home-detail-body");
  const detailBodyTitle = document.createElement("h2");
  detailBodyTitle.textContent = t("home.mapDetail");
  const detailDesc = document.createElement("p");
  detailDesc.className = "home-detail-desc";
  detailBody.append(detailBodyTitle, detailDesc);

  detailView.append(back, detailGrid, detailBody);

  main.append(hero, mapsView, aboutView, detailView);
  body.append(side, main);

  shell.append(topbar, body);
  page.append(shell);
  root.append(page);
  const unbindHotkeys = bindHotkeys(page);

  // A line that belongs to no single page: map downloads report here from the shelf and the
  // detail page alike, where the hero's own status line is not on screen.
  const toast = document.createElement("div");
  toast.className = "home-toast";
  toast.hidden = true;
  page.append(toast);
  let toastTimer = 0;
  const showToast = (text: string, error = true): void => {
    toast.textContent = text;
    toast.classList.toggle("is-error", error);
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 5000);
  };

  // The launch page's exit, bottom right. Sign-in sits at the foot of the left rail instead.
  // Exit is the shell's — macOS keeps an app alive with no windows, so closing the window is not
  // the same as quitting it.
  sideLogin.onclick = (): void => showToast(t("home.comingSoon"), false);
  const corner = document.createElement("div");
  corner.className = "home-corner";
  const quitBtn = createGlueButton({ label: t("home.quitApp"), size: "md", bordered: true });
  quitBtn.button.onclick = (): void => quitNative();

  // Online upgrade: read the site's manifest, then download and install only if the player says
  // so, twice (once to fetch, once to restart). Browser builds have no updater of their own.
  const updateBtn = createGlueButton({ label: t("home.checkUpdate"), size: "md", bordered: true });
  let updateBusy = false;
  const resetUpdate = (): void => {
    updateBusy = false;
    updateBtn.button.textContent = t("home.checkUpdate");
  };
  const runUpdate = async (): Promise<void> => {
    if (updateBusy) return;
    if (!isDesktopApp()) {
      showToast(t("home.updateDesktopOnly"), false);
      return;
    }
    updateBusy = true;
    updateBtn.button.textContent = t("home.updateChecking");
    const found = await checkUpdate();
    if (!found) {
      resetUpdate();
      showToast(t("home.updateDesktopOnly"), false);
      return;
    }
    if (found.phase === "none") {
      resetUpdate();
      showToast(t("home.updateLatest"), false);
      return;
    }
    if (found.phase === "error") {
      resetUpdate();
      showToast(t("home.updateFailed", { error: found.error ?? "" }));
      return;
    }
    if (found.phase !== "available" || !found.version) {
      resetUpdate();
      return;
    }
    if (!window.confirm(t("home.updateFound", { version: found.version }))) {
      resetUpdate();
      return;
    }
    const stop = onUpdateState((state) => {
      if (state.phase === "downloading") {
        updateBtn.button.textContent = `${state.percent}%`;
      } else if (state.phase === "ready") {
        stop();
        resetUpdate();
        const question = found.mode === "web" ? t("home.updateWebReady") : t("home.updateReady", { version: found.version ?? "" });
        if (window.confirm(question)) installUpdate();
      } else if (state.phase === "error") {
        stop();
        resetUpdate();
        showToast(t("home.updateFailed", { error: state.error ?? "" }));
      }
    });
    downloadUpdate();
  };
  updateBtn.button.onclick = (): void => void runUpdate();

  corner.append(updateBtn.root, quitBtn.root);
  if (!native) {
    // Both are the shell's: a page cannot update itself, and it cannot quit an app it is not.
    updateBtn.root.hidden = true;
    quitBtn.root.hidden = true;
  }
  page.append(corner);

  /** What a remembered browser folder holds, as last READ: its own name and the version off its
   *  `.build.info`. The handle itself cannot be read again without a fresh grant, so without this
   *  the row could only say "a folder is remembered" rather than what is in it. Keyed by the
   *  line and the language, like the handle it describes (both are one pick, i18n/switch.ts). */
  const INSTALL_INFO_KEY = "warcraft-open.installInfo";
  const installInfoKey = (line: GameFlavor): string =>
    `${INSTALL_INFO_KEY}:${line}:${currentLocale()}`;
  const rememberedInstallInfo = (
    line: GameFlavor,
  ): { label: string; version: string | null } | null => {
    try {
      const raw = localStorage.getItem(installInfoKey(line));
      if (!raw) return null;
      const info = JSON.parse(raw) as { label?: unknown; version?: unknown };
      if (typeof info.label !== "string" || !info.label) return null;
      return { label: info.label, version: typeof info.version === "string" ? info.version : null };
    } catch {
      return null;
    }
  };
  const rememberInstallInfo = (line: GameFlavor, picked: PickedInstall): void => {
    if (!picked.label) return;
    try {
      localStorage.setItem(
        installInfoKey(line),
        JSON.stringify({
          label: picked.label,
          version: picked.casc ? buildInfoVersion(picked.casc.buildInfo) : null,
        }),
      );
    } catch {
      /* not remembered — the row keeps the "remembered" hint */
    }
  };

  // ── Install state ─────────────────────────────────────────────────────────
  /** The sentence under one line's name: where its folder is, or why it cannot be booted.
   *  A remembered folder's verdict is asked per line, because the SAME folder can be right for
   *  one and wrong for the other: 3.0.x is HD's, and SD refuses anything that is not 1.x. */
  const lineState = (line: GameFlavor): { text: string; error: boolean } => {
    if (line === "hd" && !hdOpen) return { text: t("flavor.hdLocked"), error: false };
    if (!native) {
      // The browser gets a HANDLE, not a path: the folder's own name is all there is to show,
      // and the version is in that folder's `.build.info` — the same file the mount reads.
      const picked = browserInstalls[line];
      if (picked) {
        const where = picked.label ?? "";
        const version = picked.casc ? buildInfoVersion(picked.casc.buildInfo) : null;
        if (!where) return { text: t("home.folderPicked"), error: false };
        return {
          text: version
            ? t("home.lineInstalled", { version, path: where })
            : t("home.folderAt", { path: where }),
          error: false,
        };
      }
      const handle = browserHandles[line];
      if (handle) {
        // A handle restored from IndexedDB cannot be read again without a fresh grant, so the
        // pick's own answer (name + build) is what the row shows until the next Launch asks.
        const memo = rememberedInstallInfo(line);
        if (memo && memo.label === handle.name) {
          return {
            text: memo.version
              ? t("home.lineInstalled", { version: memo.version, path: memo.label })
              : t("home.folderAt", { path: memo.label }),
            error: false,
          };
        }
        return { text: t("home.folderRemembered", { path: handle.name }), error: false };
      }
      return { text: t("home.folderNone"), error: false };
    }
    const info = installs[line];
    if (!info.path) return { text: t("home.folderNone"), error: false };
    if (!info.present) return { text: t("home.folderMissing", { path: info.path }), error: true };
    const verdict = versionVerdict(info.version, line, info.mpq);
    // The path is said even when the folder is refused: "wrong build" alone leaves the player
    // looking at two rows and no way to tell which folder either one means.
    if (!verdict.ok) return { text: t("home.folderIssue", { path: info.path, reason: verdict.message }), error: true };
    // `verdict.ok` implies a version — an MPQ-era folder is refused by the verdict above — so
    // this fallback only keeps the type honest.
    const version = info.version ?? t("flavor.sd");
    return { text: t("home.lineInstalled", { version, path: info.path }), error: false };
  };

  const paintInstall = (): void => {
    for (const line of LINES) {
      const { text, error } = lineState(line);
      rows[line].state.textContent = text;
      rows[line].state.classList.toggle("is-error", error);
    }
  };

  const setStatus = (text: string, error = false): void => {
    status.textContent = text;
    status.classList.toggle("is-error", error);
  };

  const refreshInstall = async (): Promise<void> => {
    if (!native) {
      for (const line of LINES) browserHandles[line] = await rememberedInstallHandle(line);
      // The single un-lined handle predates per-line memory; it can only ever have served the
      // line this page booted on, so it is adopted there once and re-filed under that line —
      // with the memo that goes with it, so the row keeps naming the install it did before.
      if (!browserHandles[running]) {
        const legacy = await rememberedInstallHandle();
        if (legacy) {
          browserHandles[running] = legacy;
          void rememberInstallHandle(legacy, running);
          try {
            const oldKey = `${INSTALL_INFO_KEY}:${currentLocale()}`;
            const raw = localStorage.getItem(oldKey);
            const info = raw ? (JSON.parse(raw) as { label?: unknown }) : null;
            if (raw && info?.label === legacy.name && !localStorage.getItem(installInfoKey(running))) {
              localStorage.setItem(installInfoKey(running), raw);
            }
          } catch {
            /* no memo to carry over */
          }
        }
      }
      paintInstall();
      downloaded.clear();
      for (const map of loadedMaps) applyDownloadState(map);
      void refreshDownloaded();
      return;
    }
    for (const line of LINES) installs[line] = await rememberedInstall(line);
    paintInstall();
    // A different folder has different maps in its `Maps\Download\`: forget the old answers and
    // ask again for whatever the shelf is showing.
    downloaded.clear();
    for (const map of loadedMaps) applyDownloadState(map);
    void refreshDownloaded();
  };

  /** Which button is working right now: the pressed Launch, or the pressed Change Folder. */
  let busyAction: { line: GameFlavor; kind: "play" | "folder" } | null = null;

  /** A ring over the button that is working, so a second press reads as "already doing it"
   *  instead of a dead button (a folder picker or a mount can take a while). */
  const setSpinner = (btn: GlueButton, on: boolean): void => {
    let spin = btn.button.querySelector<HTMLElement>(".home-btn-spinner");
    if (on && !spin) {
      spin = document.createElement("span");
      spin.className = "home-btn-spinner";
      spin.setAttribute("aria-hidden", "true");
      btn.button.append(spin);
    }
    if (spin) spin.hidden = !on;
    btn.button.classList.toggle("is-loading", on);
    btn.button.setAttribute("aria-busy", on ? "true" : "false");
  };

  /** Lock both rows (one launch at a time) and spin the button the player pressed. Without an
   *  `act` the spinner already showing is kept — the inner start helpers lock without knowing
   *  which row was pressed. */
  const setBusy = (on: boolean, act?: { line: GameFlavor; kind: "play" | "folder" }): void => {
    busy = on;
    if (!on) busyAction = null;
    else if (act) busyAction = act;
    for (const line of LINES) {
      const locked = line === "hd" && !hdOpen;
      setSpinner(rows[line].play, !!busyAction && busyAction.line === line && busyAction.kind === "play");
      setSpinner(rows[line].change, !!busyAction && busyAction.line === line && busyAction.kind === "folder");
      rows[line].play.setDisabled(on || locked);
      rows[line].change.setDisabled(on || locked);
    }
  };

  /** The whole screen, taken as the game is ENTERED — and only ever entered.
   *
   *  It is asked for AFTER the folder is resolved, never before: the folder picker and the folder
   *  permission prompt both belong to the press that starts the game, and a fullscreen request
   *  ahead of them spends it — the page went fullscreen, the dialog closed it again, and the next
   *  press looked like a toggle. There is no toggle here: nothing on this path ever EXITS
   *  fullscreen (leaving is Esc's, or Alt+Enter's — ui/fullscreen.ts).
   *
   *  If the dialog took the activation with it and the request is refused, the screen is taken on
   *  the player's NEXT press instead — the first click inside the game. */
  const enterPlayFullscreen = (): void => {
    if (native || document.fullscreenElement) return;
    const ask = async (): Promise<boolean> => {
      try {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
        return true;
      } catch {
        return false; // no fullscreen here (an iPhone), or the press's activation is spent
      }
    };
    void ask().then((taken) => {
      if (taken || document.fullscreenElement) return;
      const retry = (): void => {
        window.removeEventListener("pointerdown", retry, true);
        if (!document.fullscreenElement) void ask();
      };
      window.addEventListener("pointerdown", retry, { capture: true, once: true });
    });
  };

  /** What the bar says. The loader's own words are English — they are the same lines a developer
   *  reads in the console — so a Chinese page keeps to its own phase word rather than wearing two
   *  languages at once. */
  const phaseCaption = (message?: string): string =>
    currentLocale() === "zhCN" ? t("boot.mounting") : message || t("boot.mounting");

  /** The launch's progress screen (ui/bootSplash.ts), fed by the mount's own narration.
   *
   *  A 3.0 store takes minutes to mount, and the launcher's hero is the wrong thing to stare at
   *  while it happens — so the press hands the screen over entirely, exactly as the `?dev` boot
   *  does. The loader's fraction is used when it has one and the bar simply holds when it does
   *  not; only the caption moves, so a phase without a number never reads as a stall. */
  const openSplash = (): { splash: BootSplash; report: (message?: string, fraction?: number) => void } => {
    const splash = mountBootSplash();
    let shown = 0.02;
    return {
      splash,
      report: (message, fraction) => {
        shown = Math.max(shown, Math.min(1, fraction ?? shown));
        splash.progress(shown, phaseCaption(message));
      },
    };
  };

  /** Browser: make sure `line` has a folder this page may mount, asking for one when the press
   *  that got us here can still open the picker (that gesture is the only door). False when the
   *  player cancelled or would not grant the folder. */
  const ensureBrowserFolder = async (line: GameFlavor): Promise<boolean> => {
    if (browserInstalls[line]) return true;
    const remembered = browserHandles[line];
    if (remembered) {
      const allowed = (await remembered.requestPermission?.({ mode: "read" })) ?? "granted";
      if (allowed === "granted") {
        browserInstalls[line] = await readInstallDir(remembered);
        rememberInstallInfo(line, browserInstalls[line]);
        paintInstall();
        return true;
      }
    }
    const picked = await pickInstall(line);
    if (!picked) return false;
    browserInstalls[line] = picked;
    rememberInstallInfo(line, picked);
    browserHandles[line] = await rememberedInstallHandle(line);
    paintInstall();
    return true;
  };

  /** The browser's door: the folder is asked for HERE, by the press that also starts the game —
   *  a page may only open the folder picker from a gesture. The mount itself is the gate's: the
   *  same profile, the same progress narration. */
  const startBrowser = async (line: GameFlavor): Promise<void> => {
    setBusy(true);
    setStatus("");
    try {
      if (!(await ensureBrowserFolder(line))) {
        setBusy(false);
        setStatus(t("gate.noFolder"), true);
        return;
      }
      const picked = browserInstalls[line];
      if (!picked) {
        setBusy(false);
        setStatus(t("gate.noFolder"), true);
        return;
      }
      // The screen is handed over only once the folder is settled: the picker is the browser's
      // own dialog and has to be over anything the page put up.
      const { splash, report } = openSplash();
      // Browser only: the desktop app reads the folder off disk and has no quota to be evicted
      // from, which is the other half of why the export is native.
      await requestPersistence();
      const load = await loadProfile(picked, DEFAULT_PROFILE, (message, fraction) => {
        report(message || t("boot.mounting"), fraction);
      });
      splash.progress(1, t("boot.starting"));
      // Let the full bar be READ before the menu build holds the main thread.
      await new Promise((r) => setTimeout(r, 600));
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
      // The game is mounted and about to be shown: this is the screen to take.
      enterPlayFullscreen();
      onLoaded(load); // `showMenu` takes the progress screen down once the menu stands
    } catch (err) {
      dismissBootSplash();
      setBusy(false);
      setStatus(t("home.loadFailed", { error: (err as Error).message }), true);
    }
  };

  /** Is this line's remembered folder one the mount would take? Asked before mounting so the
   *  answer is the row's own words — `valid` from the shell only says the folder exists and is
   *  SOME accepted build, which is not the same question per line. */
  const usable = (line: GameFlavor): boolean => {
    const info = installs[line];
    return !!info.path && info.present && versionVerdict(info.version, line, info.mpq).ok;
  };

  /** Make sure `line` has a folder the mount would take, asking for one when it has none (or the
   *  one it has is the other line's). False when the player cancelled or the answer will not do —
   *  in which case the row already says why. */
  const ensureInstall = async (line: GameFlavor): Promise<boolean> => {
    if (usable(line)) return true;
    const picked = await pickNativeInstall(line);
    if (!picked) {
      setStatus(t("gate.noWar3Folder"), true);
      return false;
    }
    await refreshInstall();
    if (usable(line)) return true;
    const info = installs[line];
    setStatus(
      info.present
        ? t("home.folderIssue", { path: info.path ?? picked, reason: versionVerdict(info.version, line, info.mpq).message })
        : t("home.folderMissing", { path: info.path ?? picked }),
      true,
    );
    return false;
  };

  /** THIS page becomes the game. Used by a game window (desktop) and by a browser tab; the
   *  launcher's own buttons do not take this route on the desktop — they open a window, so the
   *  launcher survives the launch. */
  const startInThisPage = async (line: GameFlavor): Promise<void> => {
    if (!native) {
      await startBrowser(line);
      return;
    }
    if (!(await ensureInstall(line))) return;

    setBusy(true);
    setStatus("");
    const { splash, report } = openSplash();
    try {
      const load = await loadProfile(await loadNativeInstall(), DEFAULT_PROFILE, (message, fraction) => {
        report(message || t("boot.mounting"), fraction);
      });
      splash.progress(1, t("boot.starting"));
      // Let the full bar be READ before the menu build holds the main thread.
      await new Promise((r) => setTimeout(r, 600));
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
      onLoaded(load); // `showMenu` takes the progress screen down once the menu stands
    } catch (err) {
      dismissBootSplash();
      setBusy(false);
      setStatus(t("home.loadFailed", { error: (err as Error).message }), true);
    }
  };

  /** The address a game window / tab loads: this page, one line, in play mode. */
  const playUrl = (line: GameFlavor): string => {
    const url = new URL(location.href);
    url.searchParams.set("flavor", line);
    url.searchParams.set(PLAY_PARAM, "1");
    url.hash = "";
    return url.toString();
  };
  /** A page opened to play (a game window, or a browser tab the launcher opened). It differs
   *  from the launcher in exactly one way: its Launch press starts the game HERE, because it is
   *  already the game's own page. */
  const isGamePage = new URLSearchParams(location.search).has(PLAY_PARAM);

  /** A Launch press.
   *
   *  Both builds start the game in THIS page — no window is opened beside the launcher. The
   *  press settles the folder (only a gesture may open the picker) and then starts here. The one
   *  exception is the OTHER data line, whose tables this page did not parse: a line switch is a
   *  reload with `?flavor=`, so the same window navigates to that line's play page (the grant
   *  already carried over through IndexedDB in the browser, and through the shell's settings in
   *  the app).
   */
  const launch = async (line: GameFlavor): Promise<void> => {
    if (busy || launching) return;
    if (line === "hd" && !hdOpen) return;
    // A browser Launch checks that this line HAS a folder before it starts: with none there is
    // nothing the game could mount. The rows already say which line has one; a missing one is
    // answered here, on the page.
    if (!native && !browserInstalls[line] && !browserHandles[line]) {
      setStatus(t("gate.noWar3Folder"), true);
      return;
    }
    // One press, one launch: a double-click on the same row would otherwise start two. The
    // pressed button starts spinning HERE — before the folder picker or the mount, both of which
    // can hold the page for a while.
    launching = true;
    setBusy(true, { line, kind: "play" });
    try {
      if (native) {
        if (!(await ensureInstall(line))) return;
        if (line === running) {
          await startInThisPage(line);
          return;
        }
        // The other line's tables were never parsed into this page; the same window reloads
        // onto that line's play page, which starts on its own.
        location.assign(playUrl(line));
        return;
      }
      // Browser: settle the folder with this press, then take THIS page over — never a new tab.
      if (!(await ensureBrowserFolder(line))) {
        setStatus(t("gate.noFolder"), true);
        return;
      }
      if (line === running) {
        await startInThisPage(line);
        return;
      }
      location.assign(playUrl(line));
    } finally {
      launching = false;
      setBusy(false);
    }
  };

  /** Change ONE line's folder. The shell keeps them apart (`installPath` / `installPathHd`), so
   *  picking a Reforged folder here cannot take the classic one away. Locked and spinning while
   *  the picker is open, so a second press cannot open a second one. */
  const changeFolder = async (line: GameFlavor): Promise<void> => {
    if (busy || launching) return;
    setBusy(true, { line, kind: "folder" });
    try {
      if (!native) {
        const picked = await pickInstall(line);
        if (!picked) return;
        browserInstalls[line] = picked;
        rememberInstallInfo(line, picked);
        browserHandles[line] = await rememberedInstallHandle(line);
        paintInstall();
        setStatus(picked.label ? t("home.folderChanged", { path: picked.label }) : t("home.folderChangedBrowser"));
        return;
      }
      const picked = await pickNativeInstall(line);
      if (!picked) return;
      installs[line] = await rememberedInstall(line);
      paintInstall();
      const info = installs[line];
      const verdict = versionVerdict(info.version, line, info.mpq);
      if (info.present && verdict.ok) setStatus(t("home.folderChanged", { path: info.path ?? picked }));
      else setStatus(t("home.folderIssue", { path: info.path ?? picked, reason: verdict.message }), true);
    } finally {
      setBusy(false);
    }
  };

  for (const line of LINES) {
    rows[line].play.button.onclick = (): void => void launch(line);
    rows[line].change.button.onclick = (): void => void changeFolder(line);
  }

  // ── Map shelf ─────────────────────────────────────────────────────────────
  const message = (text: string, retry = false): void => {
    mapsBody.replaceChildren();
    const box = document.createElement("p");
    box.className = "home-empty";
    box.textContent = text;
    if (retry) {
      const again = document.createElement("button");
      again.type = "button";
      again.className = "home-empty-retry";
      again.textContent = t("home.mapsRetry");
      again.onclick = (): void => void loadMaps();
      box.append(" ", again);
    }
    mapsBody.append(box);
  };

  /** Paint one map's "already downloaded" state wherever it is on screen: its shelf card and,
   *  when it is the open detail page, that page's badge and button wording. */
  const applyDownloadState = (map: SiteMap): void => {
    const is = downloaded.has(map.slug);
    const view = cardViews.get(map.slug);
    if (view) {
      view.badge.hidden = !is;
      if (!view.button.button.disabled) view.button.setLabel(is ? t("home.redownload") : t("home.download"));
    }
    if (detailSlug === map.slug) {
      if (detailBadge) detailBadge.hidden = !is;
      if (detailButton && !detailButton.button.disabled) {
        detailButton.setLabel(is ? t("home.redownload") : t("home.download"));
      }
    }
  };

  /** Ask the shell which of the shelf's maps are already in `Maps\Download\`. */
  const refreshDownloaded = async (): Promise<void> => {
    if (!native) {
      // The browser's answer is the mount's own walk of the picked folder: every `Maps\Download\`
      // entry it collected is a map this install already keeps.
      downloaded.clear();
      const kept = new Set<string>();
      for (const key of browserInstalls[running]?.files.keys() ?? []) {
        if (!key.toLowerCase().startsWith("maps\\download\\")) continue;
        const last = key.split("\\").pop();
        if (last) kept.add(last.toLowerCase());
      }
      for (const map of loadedMaps) {
        const name = safeMapName(map.fileName)?.toLowerCase();
        if (name && kept.has(name)) downloaded.add(map.slug);
        applyDownloadState(map);
      }
      return;
    }
    if (!installs[running].valid) return;
    await Promise.all(loadedMaps.map(async (map) => {
      const name = safeMapName(map.fileName);
      if (!name) return;
      if (await downloadedMapExists(name)) downloaded.add(map.slug);
      applyDownloadState(map);
    }));
  };

  /** Browser: keep the map in the picked folder's `Maps\Download\`, through the very folder handle
   *  the install was mounted from (File System Access) — the same place the desktop app writes.
   *  A folder read through `<input webkitdirectory>` has no writer, so there the file is handed to
   *  the browser's own downloads instead. */
  const browserKeepMap = async (map: SiteMap, btn: GlueButton): Promise<void> => {
    let folder = browserInstalls[running];
    const remembered = browserHandles[running];
    if (!folder && remembered) {
      // A remembered folder may be re-opened from this click, which is also the gesture that
      // lets the browser ask for write access.
      const allowed = (await remembered.requestPermission?.({ mode: "readwrite" })) ?? "granted";
      if (allowed === "granted") {
        folder = await readInstallDir(remembered);
        browserInstalls[running] = folder;
      }
    }
    if (!folder) {
      showToast(t("home.pickFirst"));
      return;
    }
    if (!map.downloadUrl) {
      showToast(t("home.mapNoFile", { name: map.name }));
      return;
    }
    const save = folder.saveMap;
    if (!save) {
      const link = document.createElement("a");
      link.href = siteUrl(map.downloadUrl);
      link.download = safeMapName(map.fileName) ?? "";
      document.body.append(link);
      link.click();
      link.remove();
      showToast(t("home.mapSavedToDownloads"), false);
      return;
    }
    btn.setDisabled(true);
    btn.setLabel(t("home.downloading"));
    try {
      // Ask while the click is still in hand: the fetch below can end long after the gesture.
      if (folder.askMapWrite && !(await folder.askMapWrite())) throw new Error(t("home.mapWriteRefused"));
      const res = await fetch(siteUrl(map.downloadUrl), { signal: abort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const name = safeMapName(map.fileName);
      if (!name) throw new Error(`unusable file name: ${map.fileName}`);
      await save(name, bytes);
      // The mount already walked the folder, so this session's Custom Game list is that same map:
      // add the file to it rather than making the player reload to see their new map.
      folder.files.set(downloadedMapKey(name), new File([bytes.slice()], name));
      const locale = currentLocale();
      try {
        const sidecar = await fetch(`${siteUrl(map.downloadUrl)}?lang=${locale}`, { signal: abort.signal });
        if (sidecar.ok) {
          const sidecarName = `${name}.${locale}.json`;
          const sidecarBytes = new Uint8Array(await sidecar.arrayBuffer());
          await save(sidecarName, sidecarBytes);
          folder.files.set(downloadedMapKey(sidecarName), new File([sidecarBytes.slice()], sidecarName));
        }
      } catch (err) {
        if (abort.signal.aborted) return;
        console.warn("[Warcraft Open] the map language file was not kept:", err);
      }
      btn.setDisabled(false);
      downloaded.add(map.slug);
      applyDownloadState(map);
    } catch (err) {
      if (abort.signal.aborted) return;
      btn.setDisabled(false);
      btn.setLabel(t("home.download"));
      showToast(t("home.mapFailed", { name: map.name, error: (err as Error).message }));
    }
  };

  const downloadMap = async (map: SiteMap, btn: GlueButton): Promise<void> => {
    if (!native) {
      await browserKeepMap(map, btn);
      return;
    }
    if (!installs[running].valid) {
      showToast(t("home.pickFirst"));
      return;
    }
    if (!map.downloadUrl) {
      showToast(t("home.mapNoFile", { name: map.name }));
      return;
    }
    btn.setDisabled(true);
    btn.setLabel(t("home.downloading"));
    try {
      const res = await fetch(siteUrl(map.downloadUrl), { signal: abort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const name = safeMapName(map.fileName);
      if (!name) throw new Error(`unusable file name: ${map.fileName}`);
      await saveMapToDownload(name, bytes);
      // The map's own dictionary, in the language this app is speaking. It sits beside the map
      // on OSS under the same name plus the locale; a map that has no file for this language
      // simply keeps its author's words, so a 404 here is normal and never fails the download.
      const locale = currentLocale();
      try {
        const sidecar = await fetch(`${siteUrl(map.downloadUrl)}?lang=${locale}`, { signal: abort.signal });
        if (sidecar.ok) {
          await saveMapToDownload(`${name}.${locale}.json`, new Uint8Array(await sidecar.arrayBuffer()));
        }
      } catch (err) {
        if (abort.signal.aborted) return;
        console.warn("[Warcraft Open] the map language file was not kept:", err);
      }
      // Re-enable it: the player can download again over the copy they have.
      btn.setDisabled(false);
      downloaded.add(map.slug);
      applyDownloadState(map);
    } catch (err) {
      if (abort.signal.aborted) return;
      btn.setDisabled(false);
      btn.setLabel(t("home.download"));
      showToast(t("home.mapFailed", { name: map.name, error: (err as Error).message }));
    }
  };

  // 支持版本：接口给数组；老版本接口没有该字段时按「两版都支持」处理。
  const flavorsOf = (map: SiteMap): string => {
    const list = map.flavors?.length ? map.flavors : ["sd", "hd"];
    const sd = list.includes("sd");
    const hd = list.includes("hd");
    if (sd && hd) return t("home.flavorBoth");
    return hd ? t("home.flavorHd") : t("home.flavorSd");
  };

  const card = (map: SiteMap): HTMLElement => {
    const el = createPanel("article", "home-map-card");

    const cover = document.createElement("div");
    cover.className = "home-map-card-cover";
    if (map.coverUrl) {
      const img = document.createElement("img");
      img.src = map.coverUrl;
      img.alt = "";
      img.loading = "lazy";
      img.draggable = false;
      cover.append(img);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "home-map-card-placeholder";
      placeholder.textContent = map.name.slice(0, 2);
      cover.append(placeholder);
    }
    const badge = document.createElement("span");
    badge.className = "home-downloaded-badge home-map-card-badge";
    badge.textContent = t("home.downloadedBadge");
    badge.hidden = !downloaded.has(map.slug);
    cover.append(badge);

    const bodyEl = document.createElement("div");
    bodyEl.className = "home-map-card-body";
    const title = document.createElement("h2");
    title.className = "home-map-card-title";
    title.textContent = map.name;
    bodyEl.append(title);

    if (map.description) {
      const desc = document.createElement("p");
      desc.className = "home-map-card-desc";
      desc.textContent = map.description;
      bodyEl.append(desc);
    }

    const meta = document.createElement("ul");
    meta.className = "home-map-card-meta";
    const facts = [flavorsOf(map), map.players, map.version, formatBytes(map.fileSize)].filter(
      (v): v is string => !!v,
    );
    for (const fact of facts) {
      const li = document.createElement("li");
      li.textContent = fact;
      meta.append(li);
    }
    if (facts.length) bodyEl.append(meta);

    const cardActions = document.createElement("div");
    cardActions.className = "home-map-card-actions";
    if (SITE) {
      const detail = document.createElement("button");
      detail.type = "button";
      detail.className = "home-text-link";
      detail.textContent = t("home.detail");
      // In the launcher, not the browser: the shelf's own detail page.
      detail.onclick = (): void => { location.hash = `#/maps/${map.slug}`; };
      cardActions.append(detail);
    }
    if (map.downloadUrl) {
      const dl = createGlueButton({
        label: downloaded.has(map.slug) ? t("home.redownload") : t("home.download"),
        size: "md", bordered: true,
      });
      dl.root.classList.add("home-map-card-download");
      dl.button.onclick = (): void => void downloadMap(map, dl);
      cardActions.append(dl.root);
      cardViews.set(map.slug, { badge, button: dl });
    } else {
      const none = document.createElement("span");
      none.className = "home-map-card-nofile";
      none.textContent = t("home.noFile");
      cardActions.append(none);
    }

    bodyEl.append(cardActions);
    el.append(cover, bodyEl);
    return el;
  };

  // Category chips and the search box work on what is already loaded: the shelf asks the site
  // once, then filters in place (60 maps at most), so typing never waits for a round trip.
  let filterQuery = "";
  let filterCategory = "";
  let filterFlavor = "";
  const chipButtons: HTMLButtonElement[] = [];
  const chipsSpec: Array<[string, string]> = [
    ["", t("home.allCategories")],
    ["moba", t("home.catMoba")],
    ["hero-defense", t("home.catHeroDefense")],
    ["rpg", t("home.catRpg")],
    ["campaign", t("home.catCampaign")],
    ["melee", t("home.catMelee")],
    ["other", t("home.catOther")],
  ];
  for (const [key, label] of chipsSpec) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `home-map-chip${key === "" ? " is-active" : ""}`;
    chip.textContent = label;
    chip.onclick = (): void => {
      filterCategory = key;
      for (const [i, button] of chipButtons.entries()) button.classList.toggle("is-active", chipsSpec[i][0] === key);
      renderShelf();
    };
    chipButtons.push(chip);
    chips.append(chip);
  }

  // 支持版本筛选：和分类一样在已加载的 60 张地图里就地过滤，不额外请求。
  const flavorChips = document.createElement("div");
  flavorChips.className = "home-map-chips home-map-chips--flavor";
  flavorChips.setAttribute("role", "group");
  flavorChips.setAttribute("aria-label", t("home.flavorsLabel"));
  const flavorChipButtons: HTMLButtonElement[] = [];
  const flavorSpec: Array<[string, string]> = [
    ["", t("home.allFlavors")],
    ["sd", t("home.flavorSd")],
    ["hd", t("home.flavorHd")],
  ];
  for (const [key, label] of flavorSpec) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `home-map-chip${key === "" ? " is-active" : ""}`;
    chip.textContent = label;
    chip.onclick = (): void => {
      filterFlavor = key;
      for (const [i, button] of flavorChipButtons.entries()) button.classList.toggle("is-active", flavorSpec[i][0] === key);
      renderShelf();
    };
    flavorChipButtons.push(chip);
    flavorChips.append(chip);
  }
  toolbar.append(flavorChips);
  searchBtn.addEventListener("click", (): void => {
    search.focus();
    search.select();
  });
  search.addEventListener("keydown", (event): void => {
    if (event.key === "Escape") search.blur();
  });
  search.addEventListener("input", (): void => {
    filterQuery = search.value;
    renderShelf();
  });

  /** Draw the shelf for the current search + category. */
  const renderShelf = (): void => {
    if (loadedMaps.length === 0) return;
    const needle = filterQuery.trim().toLowerCase();
    const visible = loadedMaps.filter((map) => {
      if (filterCategory && map.category !== filterCategory) return false;
      if (filterFlavor) {
        const flavors = map.flavors?.length ? map.flavors : ["sd", "hd"];
        if (!flavors.includes(filterFlavor)) return false;
      }
      if (!needle) return true;
      return [map.name, map.description, map.author ?? ""]
        .some((text) => text.toLowerCase().includes(needle));
    });
    cardViews.clear();
    if (visible.length === 0) {
      message(t("home.noResults"));
      return;
    }
    mapsBody.replaceChildren(...visible.map(card));
  };

  const loadMaps = async (): Promise<void> => {
    if (!SITE) {
      message(t("home.mapsUnconfigured"));
      return;
    }
    message(t("home.mapsLoading"));
    try {
      const res = await fetch(`${SITE}/api/public/maps?locale=${siteLocale()}&limit=60`, { signal: abort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { maps?: SiteMap[] };
      const maps = Array.isArray(data.maps) ? data.maps : [];
      if (maps.length === 0) {
        message(t("home.mapsEmpty"));
        return;
      }
      loadedMaps = maps;
      renderShelf();
      route(); // a detail hash opened before the shelf answered can now resolve
      void refreshDownloaded();
    } catch (err) {
      if (abort.signal.aborted) return;
      console.warn("[Warcraft Open] the map library is unavailable:", err);
      message(t("home.mapsFailed"), true);
    }
  };

  // ── Detail page content ───────────────────────────────────────────────────
  const formatDate = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString(currentLocale() === "zhCN" ? "zh-CN" : "en", {
      year: "numeric", month: "short", day: "numeric",
    });
  };

  const metaRow = (label: string, value: string): HTMLElement => {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    row.append(dt, dd);
    return row;
  };

  // ── Installed shelf (`Maps\Download\`) ─────────────────────────────────────
  const installedEmpty = (text: string): HTMLElement => {
    const box = document.createElement("p");
    box.className = "home-empty";
    box.textContent = text;
    return box;
  };

  const installedRow = (file: DownloadedMap): HTMLElement => {
    const row = document.createElement("div");
    row.className = "home-installed-row";
    const text = document.createElement("div");
    text.className = "home-installed-text";
    const name = document.createElement("span");
    name.className = "home-installed-name";
    name.textContent = file.name;
    const meta = document.createElement("span");
    meta.className = "home-installed-meta";
    meta.textContent = [formatBytes(file.size), formatDate(file.updatedAt)]
      .filter((part) => !!part).join(" · ");
    text.append(name, meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "home-installed-delete";
    remove.textContent = t("home.delete");
    remove.onclick = async (): Promise<void> => {
      if (!window.confirm(t("home.deleteConfirm", { name: file.name }))) return;
      remove.disabled = true;
      try {
        await deleteDownloadedMap(file.name);
        showToast(t("home.mapDeleted", { name: file.name }));
        // That map is gone from the folder, so its "downloaded" badge goes with it — and the
        // others may have been installed from another copy, so ask again rather than assume.
        downloaded.clear();
        for (const map of loadedMaps) applyDownloadState(map);
        void refreshDownloaded();
        await refreshInstalled();
      } catch (err) {
        remove.disabled = false;
        showToast(t("home.deleteFailed", { error: (err as Error).message }));
      }
    };
    // Deleting means removing a file from the disk, which is the shell's; the browser's row just
    // reports what the folder holds.
    row.append(text, ...(native ? [remove] : []));
    return row;
  };

  const refreshInstalled = async (): Promise<void> => {
    if (!native) {
      // The same walk the mount made — `Maps\Download\` as the picked folder gave it to us.
      const mounted = browserInstalls[running];
      if (!mounted) {
        installedBody.replaceChildren(installedEmpty(t("home.pickFirst")));
        return;
      }
      const kept: DownloadedMap[] = [];
      for (const [key, file] of mounted.files) {
        if (!key.toLowerCase().startsWith("maps\\download\\")) continue;
        const name = key.split("\\").pop();
        if (!name || !/\.(w3m|w3x)$/i.test(name)) continue;
        kept.push({ name, size: file.size, updatedAt: new Date(file.lastModified).toISOString() });
      }
      installedBody.replaceChildren(
        ...(kept.length === 0 ? [installedEmpty(t("home.noInstalled"))] : kept.map(installedRow)),
      );
      return;
    }
    if (!installs[running].valid) {
      installedBody.replaceChildren(installedEmpty(t("home.pickFirst")));
      return;
    }
    installedBody.replaceChildren(installedEmpty(t("home.mapsLoading")));
    const files = await listDownloadedMaps();
    installedBody.replaceChildren(
      ...(files.length === 0
        ? [installedEmpty(t("home.noInstalled"))]
        : files.map(installedRow)),
    );
  };

  /** One page, two shelves: the library the site offers, and this install's own maps. */
  const showShelf = (installed: boolean): void => {
    libraryPane.hidden = installed;
    installedPane.hidden = !installed;
    libraryTab.classList.toggle("is-active", !installed);
    installedTab.classList.toggle("is-active", installed);
    if (installed) void refreshInstalled();
  };
  libraryTab.onclick = (): void => showShelf(false);
  installedTab.onclick = (): void => showShelf(true);

  const renderDetail = (map: SiteMap): void => {
    detailCover.replaceChildren();
    if (map.coverUrl) {
      const img = document.createElement("img");
      img.src = map.coverUrl;
      img.alt = map.name;
      img.draggable = false;
      detailCover.append(img);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "home-map-card-placeholder";
      placeholder.textContent = map.name.slice(0, 2);
      detailCover.append(placeholder);
    }

    detailTitle.textContent = map.name;
    detailSlug = map.slug;
    if (detailBadge) detailBadge.hidden = !downloaded.has(map.slug);
    // The site's own order: author, players, version, size, then the update date.
    const rows: HTMLElement[] = [];
    if (map.author) rows.push(metaRow(t("home.author"), map.author));
    if (map.players) rows.push(metaRow(t("home.playersLabel"), map.players));
    if (map.version) rows.push(metaRow(t("home.versionLabel"), map.version));
    rows.push(metaRow(t("home.flavorsLabel"), flavorsOf(map)));
    if (map.fileSize) rows.push(metaRow(t("home.sizeLabel"), formatBytes(map.fileSize)));
    rows.push(metaRow(t("home.updatedLabel"), formatDate(map.updatedAt)));
    detailMeta.replaceChildren(...rows);

    detailActions.replaceChildren();
    detailButton = null;
    if (map.downloadUrl) {
      const dl = createGlueButton({
        label: downloaded.has(map.slug) ? t("home.redownload") : t("home.download"),
        sub: formatBytes(map.fileSize) || undefined, size: "lg", bordered: true,
      });
      dl.button.onclick = (): void => void downloadMap(map, dl);
      detailActions.append(dl.root);
      detailButton = dl;
    } else {
      const none = document.createElement("p");
      none.className = "home-map-card-nofile";
      none.textContent = t("home.noFile");
      detailActions.append(none);
    }

    detailDesc.textContent = map.description || t("home.noDescription");
  };

  // ── Routing: #/ (launch), #/maps, #/maps/<slug>, #/about — pages, not anchors ──
  type View = "home" | "maps" | "about" | "detail";
  const views: Record<View, HTMLElement> = { home: hero, maps: mapsView, about: aboutView, detail: detailView };
  const route = (): void => {
    const hash = location.hash.replace(/^#\/?/, "");
    let view: View = "home";
    if (hash === "maps") view = "maps";
    else if (hash === "about") view = "about";
    else if (hash.startsWith("maps/")) {
      const slug = decodeURIComponent(hash.slice("maps/".length));
      const map = loadedMaps.find((item) => item.slug === slug);
      if (map) {
        renderDetail(map);
        view = "detail";
      } else {
        view = "maps";
      }
    }
    for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
    corner.hidden = view !== "home";
    const navView = view === "detail" ? "maps" : view;
    for (const [i, a] of [...topLinks, ...sideLinks].entries()) {
      a.classList.toggle("is-active", navItems[i % navItems.length].view === navView);
    }
    page.scrollTop = 0;
  };
  window.addEventListener("hashchange", route);
  route();

  void refreshInstall().then(async () => {
    if (!isGamePage) return; // the launcher itself never enters a game
    if (native) {
      // A game window: the shell opened it for this line and autoplay is already allowed, so it
      // starts without a press. The launcher's own rows are untouched — they open windows.
      void startInThisPage(running);
      return;
    }
    // A browser tab opened to play. The launcher settled the folder BEFORE opening this tab, and
    // a handle's grant is per origin — so when it is still alive the tab starts on its own and
    // the player gets the progress screen rather than a second button to press. Only a grant that
    // has lapsed (a new browser session) needs the press, because asking needs a gesture.
    const handle = browserHandles[running];
    if (handle) {
      const allowed = (await handle.queryPermission?.({ mode: "read" })) ?? "granted";
      if (allowed === "granted") {
        browserInstalls[running] = await readInstallDir(handle);
        rememberInstallInfo(running, browserInstalls[running]);
        void startInThisPage(running);
        return;
      }
    }
    setStatus(t("home.playHere", { line: lineName(running) }));
  });
  void loadMaps();

  return {
    dispose: () => {
      abort.abort();
      unbindHotkeys();
      fullscreen?.dispose();
      window.removeEventListener("hashchange", route);
      page.remove();
    },
  };
}
