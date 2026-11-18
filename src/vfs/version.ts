import { buildInfoVersion, isCascInstall } from "./casc";
import type { PickedInstall } from "../assets/opfs";
import { t } from "../i18n";
import { flavor, type GameFlavor } from "../data/flavor";

// Which Warcraft III an install has to be, and why the answer is not "any of them".
//
// **Every player must be running the same game DATA.** A match's units, abilities, costs and
// timings are read out of each machine's own install (that is the whole asset-compatible
// design), so two players on different patches are two players playing different games: the
// authority resolves an order against ITS Footman and the client draws the one in its own SLKs.
// Nothing in the wire protocol can catch that — `PROTOCOL_VERSION` says the two CLIENTS agree,
// which is a different question and answered in a different place (src/net/protocol.ts).
//
// So the version is a gate rather than a note, and it is checked on EVERY launch and not only
// when the folder is first picked: the desktop app remembers a folder and reads it again next
// time (src/assets/nativeInstall.ts), and a player can patch Warcraft III between one launch and
// the next without touching Warcraft Open at all.
//
// **The gate checks the version PREFIX**, not an exact patch: SD wants a `1.3` install (1.30.4,
// 1.31.1, … — the pre-Reforged client line this engine reads), and HD wants a `3.` install (the
// remastered line). Pre-1.30 builds are MPQ ones, which have no `.build.info` and are therefore
// refused by the content-store check below. Balance drift inside a line is a question for the
// match/replay, not for the folder gate.

/** The build Warcraft Open plays by default. Used as the downgrade target and in player-facing
 *  messages; MUST equal `REQUIRED_VERSION` in electron/install.mjs. */
export const REQUIRED_VERSION = "1.30.4";

/** Version prefixes the install gate accepts: `1.3` is the classic line this engine reads
 *  (1.30.4, 1.31.1, …), `3.` the Reforged line. Prefixes, not exact builds — the patch number
 *  inside a line is not the gate's question. MUST equal `ACCEPTED_VERSION_PREFIXES` in
 *  electron/install.mjs, which asks the same question of the folder dialog before the answer
 *  can be remembered. */
export const ACCEPTED_VERSION_PREFIXES: readonly string[] = ["1.3", "3."];

const [SD_VERSION_PREFIX, HD_VERSION_PREFIX] = ACCEPTED_VERSION_PREFIXES;

/** Builds the mount turns BACK into REQUIRED_VERSION, and so plays as it: the Internet Archive's
 *  1.31.1, which "Download game files" falls back on (src/assets/downloadInstall.ts). Its store
 *  is laid out differently (vfs/casc.ts `legacyRootName`) and its game data is put back to
 *  1.30.4's (src/vfs/downgrade.ts), so every player still plays the same game. MUST equal
 *  `DOWNGRADE_VERSIONS` in electron/install.mjs; `pnpm app:test` compares them. */
export const DOWNGRADE_VERSIONS: readonly string[] = ["1.31.1"];

/**
 * HD 的参考构建（启动器用它的有无来决定 HD 入口开不开，版本提示里也拿它举例）。
 * 校验本身只看前缀 `3.`，不钉补丁——Reforged 各补丁同属一条数据线。
 */
export const HD_REQUIRED_VERSION = "3.0.1";

/** What to say about a folder that is the wrong build. One sentence, naming BOTH versions, so
 *  the player can see what they have as well as what is wanted. Shared by the load gate and by
 *  the desktop app's remembered-folder check, which reach the same conclusion by different
 *  routes and must not word it differently. */
export const wrongVersionMessage = (version: string | null): string =>
  version
    ? t("gate.wrongVersion", { version, required: REQUIRED_VERSION })
    : t("gate.unknownVersion", { required: REQUIRED_VERSION });

export interface VersionVerdict {
  ok: boolean;
  /** What the install says it is, when it says anything at all. */
  version: string | null;
  /** Empty when `ok`. Shown to the player verbatim, so it names both versions. */
  message: string;
}

/** Can the CLASSIC data line play this build? Only `1.3x` (1.30.4, 1.31.1, …): 1.31.1 is turned
 *  back into 1.30.4 by the mount, and older 1.2x builds are MPQ ones the content store refuses
 *  before this is asked. 3.x is Reforged and belongs to HD (see versionVerdict). */
export const isSdVersion = (version: string | null): boolean =>
  !!version && version.startsWith(SD_VERSION_PREFIX);

/** Check a picked folder before it is mounted. `f` is the flavor the launcher chose. */
export function checkVersion(install: PickedInstall, f: GameFlavor = flavor()): VersionVerdict {
  if (!isCascInstall(install.casc) && ![...install.files.keys()].some((k) => k.toLowerCase().endsWith(".mpq"))) {
    // Neither a content store nor an archive: not an old Warcraft III, not a Warcraft III at all
    // (or one whose data has gone). "Older than 1.30.4" would send the player to patch a folder
    // that has nothing in it to patch.
    return {
      ok: false,
      version: null,
      message: t("gate.noGameData", { required: REQUIRED_VERSION }),
    };
  }
  if (!isCascInstall(install.casc)) {
    // No content store: this is an MPQ-era folder, i.e. older than 1.30 by construction. Said
    // that way round because "no .build.info" means nothing to a player.
    return {
      ok: false,
      version: null,
      message: t("gate.oldVersion", { required: REQUIRED_VERSION }),
    };
  }
  return versionVerdict(buildInfoVersion(install.casc.buildInfo), f);
}

/**
 * The same answer as `checkVersion`, from a version string alone — for the places that already
 * know a folder's build and only need the wording: the launcher's two front-page lines, which
 * describe a REMEMBERED folder before anything is mounted, one line per flavor.
 *
 * Its words must stay the ones `checkVersion` hands out, or the launcher would say a folder is
 * fine and the mount then refuse it.
 */
export function versionVerdict(version: string | null, f: GameFlavor = flavor()): VersionVerdict {
  if (f === "hd") {
    // HD 走 Reforged 数据线：只看 `3.` 前缀（3.0.1 / 3.0.2 …），不钉补丁；未设置参考构建时
    // 一律拒绝（HD 入口在启动器里灰着）。
    if (!HD_REQUIRED_VERSION) return { ok: false, version, message: t("gate.hdUnavailable") };
    if (!version || !version.startsWith(HD_VERSION_PREFIX)) {
      return {
        ok: false,
        version,
        message: t("gate.hdWrongVersion", { version: version ?? "?", required: "3.x" }),
      };
    }
    return { ok: true, version, message: "" };
  }
  if (isSdVersion(version)) return { ok: true, version, message: "" };
  return { ok: false, version, message: wrongVersionMessage(version) };
}
