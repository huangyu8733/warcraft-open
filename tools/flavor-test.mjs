// The launcher's SD / HD split, checked without Electron (P0-6 / P0-7).
//
// The renderer half is covered by `tsc` (the `GameFlavor` type); what can be wrong silently is
// the SHELL's memory — a flavor reading the other line's folder, or an upgrade losing the classic
// install. Those are pure functions in electron/install.mjs, so they are tested here.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FLAVORS, installPathFromSettings, installPathKey, installPathPatch, isAcceptedInstallVersion,
  normalizeFlavor,
} from "../electron/install.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;
const ok = (name, cond, detail = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? `   ${detail}` : ""}`);
  if (!cond) failed++;
};

console.log("the two lines");
ok("SD and HD only", FLAVORS.join(",") === "sd,hd");
ok("anything unknown is SD", normalizeFlavor(undefined) === "sd" && normalizeFlavor("HD") === "sd" && normalizeFlavor("2.0.4") === "sd");

console.log("each line remembers its own folder");
ok("HD has its own key", installPathKey("hd") === "installPathHd" && installPathKey("sd") === "installPath");
ok("an old settings file keeps the classic install", installPathFromSettings({ installPath: "C:\\wc3" }, "sd") === "C:\\wc3");
ok("HD never reads the classic folder", installPathFromSettings({ installPath: "C:\\wc3" }, "hd") === null);
ok("HD reads what HD remembered", installPathFromSettings({ installPath: "C:\\wc3", installPathHd: "D:\\wc3r" }, "hd") === "D:\\wc3r");
ok("both can be remembered at once",
  installPathFromSettings({ installPath: "C:\\wc3", installPathHd: "D:\\wc3r" }, "sd") === "C:\\wc3"
  && installPathFromSettings({ installPath: "C:\\wc3", installPathHd: "D:\\wc3r" }, "hd") === "D:\\wc3r");

console.log("a write touches one line only");
const hdPatch = installPathPatch("hd", "D:\\wc3r");
ok("remembering HD writes only installPathHd", Object.keys(hdPatch).join(",") === "installPathHd" && hdPatch.installPathHd === "D:\\wc3r");
const sdForget = installPathPatch("sd", null);
ok("forgetting SD writes null, not a removal of HD", Object.keys(sdForget).join(",") === "installPath" && sdForget.installPath === null);

// P2 proved the Reforged data line and pinned the patch (SD-HD开发进度.md P2-5). A blank
// constant would mean the HD entry is still closed, which is no longer the case.
const version = readFileSync(join(root, "src/vfs/version.ts"), "utf8");
const pinned = /export const HD_REQUIRED_VERSION = "([^"]*)";/.exec(version);
ok("P2 pinned the Reforged patch", pinned?.[1] === "3.0.1", pinned?.[1] ?? "missing");
ok("the folder picker accepts the Reforged line", isAcceptedInstallVersion("3.0.1.24371"));
ok("…and still refuses a line nobody has", !isAcceptedInstallVersion("4.0.0"));

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("flavor: ok");
