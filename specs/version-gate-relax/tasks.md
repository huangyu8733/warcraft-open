# 任务清单：放开安装版本闸门

- [x] T1 `src/vfs/version.ts`：前缀常量改为 `["1.3","2.","3."]`，拆出 `SD_VERSION_PREFIX` / `HD_VERSION_PREFIXES`，新增 `isHdVersion`，`HD_REQUIRED_VERSION = "2.0"`。
- [x] T2 `src/vfs/version.ts`：`checkVersion` 接受「有 `war3.mpq` 的 MPQ 文件夹」为 SD；HD 选到 MPQ 时给出 `gate.hdWrongVersion`；删除 `gate.oldVersion` 分支。
- [x] T3 `src/vfs/version.ts`：`versionVerdict` 增加 `mpq = false` 参数；HD 用前缀数组；SD 对 `mpq && version === null` 放行；同步文件头注释。
- [x] T4 `src/vfs/loader.ts`：`buildInfoVersion` 前移；HD 且 `2.x` 且 `hdArt() === "de"` 时以 `"hd"` 作为 `graphics`。
- [x] T5 `electron/install.mjs`：`ACCEPTED_VERSION_PREFIXES` 同步；`looksLikeInstall(root, flavor)` 支持 SD 的 MPQ 文件夹、HD 的 `2.`/`3.` CASC；注释同步。
- [x] T6 `electron/main.mjs`：`currentInstall` 传入 flavor 并新增 `mpq` 字段；`install-pick` / `install-download` 传入 target。
- [x] T7 `src/ui/home.ts`：三处 `versionVerdict` 调用补 `info.mpq`。
- [x] T8 `src/i18n/index.ts`：改 `gate.noGameData`、`gate.hdWrongVersion`，删除 `gate.oldVersion`（中英）。
- [x] T9 `tools/flavor-test.mjs` / `tools/electron-server-test.mjs`：更新钉死值与断言，补 2.x、MPQ 用例。
- [x] T10 验证：`tsc`、`gesture:test`、`cycles`、`flavor-test`、`electron-server-test`。
- [x] T11 MPQ 实测（`/Users/huangyu/rrrr/war3`，`?dev=1&flavor=sd&map=BootyBay`）与 HD 3.0.1 回归。
- [x] T12 构建并部署，线上校验（`index-DaqmPrNN.js` / `index-ChF2VfUD.css` 均 200）。
