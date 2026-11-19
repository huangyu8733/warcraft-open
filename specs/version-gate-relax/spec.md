# 放开安装版本闸门：经典版任意 1.x（含 MPQ），重制版 2.0 及以上

> **后续修订（2026-11-19）**：1.2x 的 MPQ 文件夹实测载入条走完后黑屏——挂载成功，但 1.30.4 的
> 菜单/表读不出它缺的资源。用户决定收紧：**经典版最低 1.30**。`checkVersion()` 与
> `versionVerdict()` 对无 `.build.info` 的 MPQ 文件夹改回拒绝（`gate.sdTooOld`），
> `electron/install.mjs` 的 `looksLikeInstall()` 同步拒绝并在选文件夹时弹窗说明。
> 1.30.4 / 1.31.1 的 CASC 经典线不受影响；下文第 1、2 节的 MPQ 目标与实测记录保留为历史决策。

> **再次修订（2026-11-19）**：HD 线由「2.0 及以上」收紧为「3.0 及以上」。2.x 是上一代重制版美术
> （只有 `_HD.w3mod`，3.0 的 Definitive Edition 才有 `_DE.w3mod`），且本机只实测过 3.0.1。
> `HD_VERSION_PREFIXES` / `ACCEPTED_VERSION_PREFIXES` 与 `electron/install.mjs` 同步去掉 `2.`，
> `HD_REQUIRED_VERSION` 改为 `"3.0"`；`src/vfs/loader.ts` 里 2.x 的 `de → hd` 美术回退随之删除。
> 经典版最低 1.30 的修订仍按上一段执行。

## 1. 目标

| 版本线 | 现状 | 目标 |
| --- | --- | --- |
| 经典版 SD | 只认 CASC 的 `1.3`（1.30.4 / 1.31.1 / 1.32） | 任意经典版：`1.3` 的 CASC，以及 1.2x 的 MPQ 文件夹（1.27 / 1.28 …） |
| 重制版 HD | 只认 `3.`（3.0.1 …） | `2.` 与 `3.`（2.0 及以上） |

用户原话：「经典版应该不用限制为 1.30 吧，是经典版就行吧，例如 1.27，1.28 等等，重制版只要是 2.0 以上都可以吧。你检查一下代码，是不是可以放开」。

## 2. 代码核查结论（已确认）

1. **MPQ 挂载链完整**：`src/vfs/loader.ts` 的 MPQ 分支（`MpqDataSource` + `LayeredDataSource` + `EditionDataSource` + `DerivedArtDataSource`，`flavour: "mpq"`，`gameVersion: null`）已实现；`src/vfs/mpq.ts` 是完整 MPQ 读取器；`src/vfs/profiles.ts` 的 TFT 清单为 `war3.mpq / war3x.mpq / war3xlocal.mpq / war3patch.mpq`。
2. **唯一拦点是版本闸门**：`src/vfs/version.ts` `checkVersion()` 对「无 CASC 但有 `.mpq`」直接返回 `gate.oldVersion`，永远拒绝 MPQ 文件夹。
3. **HD 只认 `3.`**：`versionVerdict()` 的 HD 分支用 `version.startsWith("3.")`。
4. **HD 2.x 缺 `_DE.w3mod`**：`hdArt()` 默认 `"de"`；2.x 只有 `_HD.w3mod`，直接挂 `_DE` 会缺美术。
5. **桌面端另有一道同样的闸**：`electron/install.mjs` `looksLikeInstall()` 要求 `Data/` + `.build.info`，MPQ 文件夹在选文件夹时就被拒；但 `enumerateInstall()` / `serveInstall()` / `src/assets/nativeInstall.ts` 的 MPQ 传输链（`manifest.casc === null` 时按 `archives` 取文件）已经可用。
6. **一致性约束**：`tools/electron-server-test.mjs` 逐项比对 TS 与 `electron/install.mjs` 的 `REQUIRED_VERSION / DOWNGRADE_VERSIONS / ACCEPTED_VERSION_PREFIXES`；`tools/flavor-test.mjs` 钉死 `HD_REQUIRED_VERSION === "3.0.1"`。
7. **本机可实测 MPQ**：`/Users/huangyu/rrrr/war3`（war3.mpq / War3Patch.mpq / War3x.mpq / War3xLocal.mpq，1.2x 客户端）。本机没有 2.x 安装，HD 2.x 只能做代码层回退验证。

## 3. 改动方案（逐文件）

### 3.1 `src/vfs/version.ts`

- 常量改为：
  ```ts
  export const REQUIRED_VERSION = "1.30.4"; // 不变：默认对局 / 降级目标 / 文案示例
  export const ACCEPTED_VERSION_PREFIXES: readonly string[] = ["1.3", "2.", "3."];
  const SD_VERSION_PREFIX = "1.3";
  const HD_VERSION_PREFIXES: readonly string[] = ["2.", "3."];
  export const HD_REQUIRED_VERSION = "2.0"; // 由「3.0.1 参考构建」改为「2.0 下限」
  ```
- 新增 `isHdVersion(version)`（前缀数组任一命中）。
- `checkVersion()`：
  - 既无 CASC 又无 `.mpq` → `gate.noGameData`（保持）。
  - **无 CASC 但有 `war3.mpq`**（大小写不敏感，允许带路径前缀）：
    - SD → `{ ok: true, version: null, message: "" }`（MPQ = 经典版，本就没有 `.build.info`）。
    - HD → 拒绝，`gate.hdWrongVersion`，`required: HD_REQUIRED_VERSION`。
  - 有 CASC → `versionVerdict(...)`。
  - 删除原 MPQ 必拒分支与 `gate.oldVersion` 调用。
- `versionVerdict(version, f, mpq = false)`：
  - HD 分支改用 `isHdVersion()`；`required` 占位改为 `HD_REQUIRED_VERSION`（`"2.0"`）。
  - SD 分支：`isSdVersion(version)` → ok；`mpq && version === null` → ok；其余仍 `wrongVersionMessage`。
- 顶部注释同步改写（说明 SD 两代存储、HD 2.x 起）。

### 3.2 `src/vfs/loader.ts`

- 把 `const version = buildInfoVersion(install.casc.buildInfo);` 移到 `CascDataSource.open(...)` **之前**。
- HD 美术回退：
  ```ts
  const artSet = hd ? (version?.startsWith("2.") && hdArt() === "de" ? "hd" : hdArt()) : undefined;
  const casc = await CascDataSource.open(install.casc, onProgress, hd ? { graphics: artSet, lazyArt: true } : undefined);
  ```
  （2.x 没有 `_DE.w3mod`，把默认 `de` 退到 `hd`；用户显式选 `sd`/`hd` 时不动。）
- MPQ 分支不动（已可用）。

### 3.3 `electron/install.mjs`

- `ACCEPTED_VERSION_PREFIXES = ["1.3", "2.", "3."]`（与 TS 完全一致）。
- 新增 `MPQ_BASE = /(^|\\)war3\.mpq$/i`；`looksLikeInstall(root, flavor = "sd")`：
  - `flavor === "hd"`：要求 `Data/` + `.build.info`，且版本命中 `2.` / `3.`。
  - `flavor === "sd"`：CASC 命中 `1.3` **或** 文件夹里有 `war3.mpq`。
- `isAcceptedInstallVersion` 保持「任一前缀」语义（`tools/flavor-test.mjs` 依赖）。
- 注释同步：说明 MPQ 文件夹属于经典版。

### 3.4 调用点

- `electron/main.mjs`：
  - `currentInstall()`：`valid: !!path && looksLikeInstall(path, f)`，并新增 `mpq: !!path && !existsSync(join(path, ".build.info")) && <有 war3.mpq>`（供启动器判定）。
  - `ow3:install-pick`：`looksLikeInstall(picked, target)`。
  - `ow3:install-download`：`looksLikeInstall(folder, target)`。
- `electron/locate.mjs` 不传 flavor（默认 SD），行为不变。
- `src/ui/home.ts`：`versionVerdict(info.version, line, info.mpq)`（3 处调用全部补第三个参数）。

### 3.5 `src/i18n/index.ts`

- `gate.noGameData`：改为「没有 Data 文件夹或 war3.mpq」。
- 删除已无引用的 `gate.oldVersion`（中英各一条）。
- `gate.hdWrongVersion`：改为「HD 需要 {required} 及以上的重制版安装」（中英）。
- 其余 `gate.*` 不动。

### 3.6 测试

- `tools/flavor-test.mjs`：`HD_REQUIRED_VERSION` 钉死值改为 `"2.0"`；新增 `isAcceptedInstallVersion("2.0.3.22692") === true`。
- `tools/electron-server-test.mjs`：
  - `"2.x 被拒"` 断言改为 `"2.x 被接受"`。
  - 新增：带 `war3.mpq` 的临时文件夹 `looksLikeInstall(tmp, "sd") === true`、`looksLikeInstall(tmp, "hd") === false`。
  - `"4.0.0.1 被拒"` 保留。
- `tools/gesture-flavor-test.cjs`、`cycles` 无需改动。

## 4. 明确不做

- 不改 `REQUIRED_VERSION`（1.30.4 仍是对局默认与降级目标）。
- 不新增 1.2x 的平衡性补丁/降级数据（1.27/1.28 与 1.30.4 的数据差异由玩家自担，与现有 MPQ 分支一致）。
- 不改 Android `MainActivity.java`（同样的 `looksLikeInstall`），本次只覆盖 Web 与桌面端；如需一致另起任务。
- 不做 2.x 美术模块的完整适配（只做 `de → hd` 回退），本机无 2.x 安装可实测。

## 5. 验证

1. `npx tsc --noEmit`
2. `npm run gesture:test`、`npm run cycles`
3. `node tools/flavor-test.mjs`
4. `node tools/electron-server-test.mjs`（需先 `npm run build`；无 dist 时跳过该步并记录）
5. MPQ 实测：`WARCRAFT_OPEN_INSTALL=/Users/huangyu/rrrr/war3 npx vite --port 5175 --strictPort`，浏览器开 `?dev=1&flavor=sd&map=BootyBay`，确认进入对局、单位/地图正常渲染。
6. HD 3.0.1 回归：现有安装跑一局，确认 `de` 美术不变（防止回退逻辑误伤）。
7. 通过后 `npm run build:web` 并部署；线上校验入口与资源 200。

## 6. 风险

- 2.x CASC 的 root/存档布局若与 3.0 有差异，`CascDataSource.open` 可能失败；本机无法实测，属于「代码允许、未经实机验证」。
- MPQ 安装的 `gameVersion: null` 会影响依赖版本的对局匹配；这是既有 MPQ 路径的既有行为，本次不放宽也不新增限制。
