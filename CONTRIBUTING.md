# 为 Warcraft Open 做贡献

感谢你愿意帮忙。Warcraft Open 用 TypeScript 重建 **Warcraft III: The Frozen Throne 1.30.4**
引擎，每一次改动的目标都是**尽可能接近原版游戏** —— 它的行为、时序、布局、命名与手感。

本页是新人的指南。[`CLAUDE.md`](CLAUDE.md) 是长篇常驻规范（为编码智能体而写，但其中每条规则
同样适用于人），而 `docs/` 文件夹为每个子系统保存一篇深入文档 —— 动那个区域之前先读对应的一篇。

## 环境准备

你需要：

- **Node.js 24**（开发机、桌面应用的 Electron 与 `@types/node` 都以这个版本为目标）。
- **pnpm 10.33.1** —— 确切版本钉在 `package.json`（`packageManager`）里，所以最简单的办法是
  `corepack enable`，让它挑对的那个。
- 一份 **Warcraft III: The Frozen Throne 1.30.4** 安装 —— 只用于运行游戏与依赖数据的测试
  （见[下文](#哪些检查需要-warcraft-iii-安装)）。大量工作（文档、工具、中继服务器、
  桌面外壳、许多模拟测试）完全不需要它。

```bash
pnpm install
pnpm dev     # http://localhost:5173 — point it at your Warcraft III folder when asked
```

`pnpm build` 会做类型检查并构建；`pnpm app` 在构建后运行桌面应用。

### 你的游戏数据

对于无头工具与测试，把你的安装放在（或软链到）仓库根目录的 **`Warcraft III/`** —— 整个
文件夹都在 gitignore 中 —— 并解包一次它的可读数据：

```bash
pnpm data:extract
```

它会把 `Warcraft III/ExtractedData/`（`.slk`、`.txt`、`.j`、`.fdf`……）写出来，当你需要知道
游戏真正做了什么时可以去 grep。`pnpm data:extract --wc3-dir <path>` 会读取别处的安装。

## 法律边界

Warcraft Open 分发**零暴雪资源或代码**。游戏文件在运行时从玩家**自己的**安装读取，绝不提交、
上传或打包。

- 永远不要提交 `Warcraft III/` 中的任何东西 —— 没有模型、贴图、音效、地图、`.slk`/`.txt`
  表、`common.j`/`Blizzard.j`，或从中复制的文本。
- `docs/reverse-engineering/` 中的逆向笔记只记录**行为与命名**。绝不要提取暴雪的二进制或
  反编译代码。
- GPL 参考项目（Warsmash、AMAI……）只用于*研究*，绝不用于复制代码或数字 —— Warcraft Open
  是 MIT。

## 打开拉取请求之前

运行这些 —— 它们不需要游戏安装：

```bash
pnpm typecheck   # tsc over the app and the Node/tooling config
pnpm cycles      # fails on any import cycle
pnpm relay:test  # multiplayer relay server + loopback
pnpm app:test    # desktop shell's local server + LAN beacon
```

并且，如果你有安装并已运行 `pnpm data:extract`：

```bash
pnpm sim:test    # simulation, AI, rendering helpers, data overlays
pnpm jass:test   # the JASS / Lua trigger runtime
```

运行覆盖你所改内容的套件；如果你动过 `src/data/gameplayConstants.ts`，还要运行
`pnpm data:verify`。

### 哪些检查需要 Warcraft III 安装

| 检查 | 需要安装吗？ |
| --- | --- |
| `pnpm typecheck`, `pnpm cycles`, `pnpm build` | 不需要 |
| `pnpm relay:test`, `pnpm app:test` | 不需要 |
| `pnpm sim:test` | **需要** —— 它的许多测试读取真实的表、模型与地图 |
| `pnpm jass:test` | **需要** —— 测试会运行安装目录自己的 `common.j` / `Blizzard.j` |
| `pnpm data:verify`, `pnpm casc:test`, `pnpm campaign:test`, `pnpm map:compat:test`, `pnpm patches:check` | **需要** |

一个需要游戏数据却找不到它的测试会以 ``Run `pnpm data:extract` first …``（退出码 2）停下，
而不是抛栈。`sim:test` 与 `jass:test` 是 `&&` 链，所以在没有安装时会停在第一个这样的测试处。
你仍然可以单独运行任何测试：编译一次（`sim-*`/`ai-*` 测试用
`tsc -p tools/tsconfig.sim.json`，`jass-*` 测试用 `tsc -p tools/tsconfig.jass.json`），
然后 `node tools/<name>-test.cjs`。

如果你无法运行某个套件，在 PR 里说明就好 —— 这没问题。

## 值得提前知道的约定

- **匹配原版游戏，并注明来源。** 不要猜一个机制，也不要发明一个数值。安装目录里游戏自己的
  数据是基准事实；然后是 [`docs/REFERENCES.md`](docs/REFERENCES.md)；再然后是 Hive Workshop
  帖子与经典 battle.net 基础页面。把来源写在常量或行为旁边的注释里 —— 代码库到处都这样做，
  所以匹配它的风格。
- **玩法常量只住在一个地方：**
  [`src/data/gameplayConstants.ts`](src/data/gameplayConstants.ts)，放在游戏确切的文件
  键下（`MISC_GAME.GuardDistance`、`MELEE.MELEE_STARTING_GOLD_V1`）。永远不要在用处把这样
  的值重新输入成字面量，也永远不要手工抄写游戏派生的东西（伤害表、经验曲线）。
- **封闭的 SLK 域是枚举**，不是字符串 —— [`src/data/enums.ts`](src/data/enums.ts) 中的
  `AttackType`、`ArmorType`、`MoveType`…… 在 SLK 边界解析一次，然后让编译器携带它。
- **优先使用真实资源。** 如果 Warcraft III 有某个模型、贴图、图标或音效，就使用它在安装
  目录中的真实路径，而不是画一个占位。
- **永远不要编辑安装目录的 UI 文件。** 2003 年的 UI 没有框架的控件放进
  [`src/overrides/`](src/overrides/)。
- **修引擎，而不是修地图。** 如果一张自定义地图表现异常，修它使用的机制，而不是给那张地图
  做特例。
- 注释解释*为什么*（以及哪个 WC3 来源这么说）；匹配你周围代码的密度。

各部分的位置：模拟在 `src/sim/`，游戏胶水在 `src/game/`，渲染与命令卡在 `src/render/`，
HUD 在 `src/ui/`，数据表在 `src/data/`，音频在 `src/audio/`，AI 在 `src/ai/`，虚拟文件系统
（CASC/MPQ）在 `src/vfs/`。

## 截图

对于任何视觉改动 —— 渲染、HUD、摄像机、特效、地形、菜单 —— 截图（前后对比，如果能拍）是
**可选的，但非常受欢迎**。`(2)EchoIsles.w3x` 是常用的测试地图：安装目录在 `Warcraft III/`
（或 `OPENWAR3_INSTALL` 指向它）时，`http://localhost:5173/?dev&map=EchoIsles` 会跳过菜单，
直接在对局中启动。

## 报告 bug 与请求功能

使用 issue 模板。对一个 bug 来说，最有用的信息是**地图**、**步骤**、你**期望**什么相对于实际
**发生了什么**，以及一张截图 —— 外加它来自桌面应用还是浏览器，以及哪个版本
（Reign of Chaos / The Frozen Throne）。
