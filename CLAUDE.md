# CLAUDE.md — Warcraft Open 工作指南

Warcraft Open 是一个浏览器优先、资源兼容的 **Warcraft III（TFT 1.30.4）** 引擎的
TypeScript 重写版本。范围见 [`README.md`](./README.md) 与
[`Warcraft-Open_PLAN.md`](./Warcraft-Open_PLAN.md)；本文件是在这里构建代码的长期规范。

## 最高原则：还原原版，并用我们的资料佐证

我们构建的一切都应**尽可能接近原版 Warcraft III** —— 行为、时序、布局、命名与手感。
不要猜 WC3 的机制，也不要凭空创造数值。在实现或调整任何玩法、UI、数据或资源行为之前，
**查阅我们的资料**，并注明你用了哪一份。

**我们的资料（针对某个问题，按此顺序阅读）：**

1. **`Warcraft III/` 里的真实游戏数据** —— 基准事实。当参考资料与游戏数据冲突时，以
   游戏数据为准（这是付出代价换来的规则；见 `docs/REFERENCES.md` 中的悬崖斜坡故事）。
   直接从安装目录读取 `.slk`/`.txt`/`.w3*` 数据、模型 `.mdx` 与资源路径。
   `pnpm data:extract` 会把可读的部分解包到 `Warcraft III/ExtractedData/`，方便你
   grep。
   - **[`docs/wc3-data-formats.md`](docs/wc3-data-formats.md)** —— 每一类数据所在的
     位置（归档、文件格式，以及目标标志、提示文本、名称、热键、图标、音效、地图所对
     应的确切表与字段）。
   - **[`docs/casc.md`](docs/casc.md)** —— 在改动 `src/vfs/`、安装目录选择器或解包器
     之前先读它。1.30.4 是 **CASC** 内容库，不是 MPQ：其中没有任何东西按名字寻址，战
     役地图不再是一个文件，六个 `common.j`/`Blizzard.j` 常量变成了引擎必须回答的
     native。
   - **1.31.1 会被接受，并且会被 DOWNGRADE（降级）**（docs/casc.md 的 "1.31.1" 一节）
     ："Download game files" 先尝试 1.30.4 安装包的 Drive zip，失败则回退到
     Internet Archive 上的 1.31.1 库（从其 RAR 中逐个成员抓取）。读取根目录时，它的
     `War3.w3mod` 树会被改回 1.30 的归档名（`legacyRootName`），其对象表在补丁链下被
     放回 1.30.4 的值（`src/vfs/downgrade.ts`）；措辞、美术与脚本仍保持 1.31 的，因
     为要恢复它们就意味着要分发暴雪的字节。
   - **归档拆分**（`src/vfs/casc.ts` 中的 `ARCHIVE_ORDER`，后者优先）：
     `Deprecated.mpq` = 旧自定义地图仍引用的美术；`War3.mpq` = 所有共享内容；
     `<locale>-War3Local.mpq` = 本地化文本、单位语音与战役地图。1.30 在放弃 MPQ 格式
     之后仍保留了 MPQ 的*名字*。遗留的 MPQ 时代安装仍可挂载，并按
     `war3 < war3x < war3xlocal < war3patch` 分层（`src/vfs/profiles.ts`），但
     1.30.4 才是我们的目标，也是开发者实际运行的版本。
   - **地形贴图集覆盖层**（`src/vfs/tileset.ts`；docs/casc.md）：一个地形贴图集是一
     个归档，而不是一个后缀。每个地形贴图集的悬崖面、水面帧、ubersplat 与重新着色的
     野怪皮肤都位于**同一个逻辑路径**（`ReplaceableTextures\Cliff\Cliff0.blp`），靠
     它们所在的嵌套归档来区分，在挂载中通过 `Z.mpq:<path>` 访问。`L` 没有对应项，因
     为不带前缀的默认值就是 Lordaeron Summer 的 —— 这也正是为什么 Echo Isles（标准测
     试地图）是唯一一张看起来正确的地图，而其他所有地形贴图集都画出了 Lordaeron 的悬
     崖。`Deprecated.mpq` 中那些 `<letter>_Cliff0.blp` 名字是一份更旧的、不同的副本，
     TFT 新增的五个地形贴图集全都缺失。
   - **TFT 音频（Huffman+ADPCM）：** WC3 把每个 WAV 都存成 **Huffman(+ADPCM)**。原版
     `mdx-m3-viewer` 会抛出 `compression type 'huffman' not supported`，导致每个资料
     片音效都静音。已在 `patches/mdx-m3-viewer@5.12.0.patch` 中修复（`huffman.js` 里
     的 Storm-Huffman 移植 + `file.js` 接线 + 一个 `adpcm.js` 符号性修复）。这是 MPQ
     扇区级编解码器，因此在 1.30.4 上它作用于地图归档，而不是内容库。
2. **[`docs/REFERENCES.md`](docs/REFERENCES.md)** —— 精选的参考项目与研究帖索引，附
   有每个来源的坑。从这里开始寻找某个主题的正确参考。
3. **[`docs/reverse-engineering/`](docs/reverse-engineering/)** —— 本地存档的引擎内
   部资料：
   - [`tinkerworx-repos.md`](docs/reverse-engineering/tinkerworx-repos.md) —— 逆向得
     到的**引擎类布局**（`CAgent`→ `CWidget`→ `CSelectable`→ `CUnit`，按命令生成的**
     技能对象** `attackAbility`/`moveAbility`/`heroAbility`/`buildAbility`/
     `inventoryAbility`，以及 `AbilityLevelData` 字段）。用它们来塑造我们的单位/技能
     /命令模型。
   - [`game-dll-thread.md`](docs/reverse-engineering/game-dll-thread.md) ——
     `Game.dll` 字符串转储：真实的类名/文件名（`CGameUI`、`frame`/`framedef`/`fdfile`
     这套 FDF UI 系统、`glue` 菜单）以及引擎读取的数据文件/资源名。用它来**命名并组织
     我们的子系统，以镜像原版**。
4. Hive Workshop 帖子与官方
   [经典 WC3 基础页面](https://classic.battle.net/war3/basics/)，用于那些不存在于任
   何文件格式中的机制（转向速率、索敌、维护费、集结等）。hiveworkshop 会对普通抓取器
   返回 403 —— 请用浏览器的 `User-Agent` 抓取（见 `docs/REFERENCES.md`）。

**使用资料时的规则：**
- **验证，不要盲信。** 参考资料只是假设 —— 在基于它们构建之前，先对照真实游戏数据或
  观察到的游戏行为确认格式/行为。
- **在代码旁注明来源。** 当一个常量或行为来自某个帖子/仓库/数据文件时，就在那里的注
  释里写明（代码库已经这样做了 —— 保持这种风格）。
- **优先使用真实资源。** 如果 WC3 有某个模型/贴图/图标/音效，就使用它在安装目录中的
  真实路径（资源解析器哲学：存在就用原版，否则用占位）。例子：学习技能按钮使用
  `ReplaceableTextures\CommandButtons\BTNSkillz.blp`（任何图标的
  `CommandButtonsDisabled\DIS*` 孪生图是"不可用"美术 —— 永远不要为一个可点击按钮去取
  它，也永远不要用 CSS 滤镜伪造它：孪生图是去饱和的，**并且不带金色按钮边框**，丢掉
  边框正是"你按不了它"这种感觉的主要来源。`DIS` + 基名，对 `BTN*` 和被动技能的
  `PASBTN*` 都一样）；法术 AoE 圆圈是
  `ReplaceableTextures\Selection\SpellAreaOfEffect*.blp`。
- **法律边界：** Warcraft Open 分发**零暴雪资源或代码**。逆向材料*只是行为与命名的文
  档*—— 绝不提取暴雪二进制、反编译代码或 GPL 参考代码（Warsmash：研究，不要抄）。资
  源只在运行时从用户自己的本地安装目录读取。

## 经典版（SD）与重制版（HD）是两条相互独立的线

引擎有两种 flavor：`flavor=sd`（经典版：读取 1.30.4 安装包，使用安装包自带的
FDF/HUD/原版美术，走 WebGL1）与 `flavor=hd`（重制版：读取 3.x 安装包，使用
`src/ui/hd/` 的重制界面与 HD 模型/贴图，走 WebGL2）。二者共用模拟与大部分引擎代码，
但数据、资源、界面和渲染路径必须相互独立。flavor 在每个进程里只确定一次（
`src/data/flavor.ts`），切换它必须整页重载 —— 不要指望在正在运行的会话里把两者"顺带"
拼在一起。

- **不得为了让 HD 工作而改变 SD 的既有行为。** 共享代码中凡有差异，必须按 flavor 显
  式分支或门控，SD 分支保持原状；HD 的默认值不能悄悄影响 SD。改共享代码时，要问的是
  "SD 现在的这一行为是否仍然一模一样"，而不是"HD 现在能不能跑"。
- **资源、对象与界面只能来自各自的安装。** HD 的资源/对象/界面只能从 HD 安装读取，SD
  只能从 SD 安装读取。SD→HD 只允许经 `src/render/assetSolver.ts` 的清单映射做逐资源
  回退；不得靠猜 `_HD` 后缀拼路径，也不得把全局 `reforged` 开关带入 SD 路径 —— 资源
  线由 flavor 决定，重制版地图自带的 HD 对象集（`war3mapSkin.w3u` 等）在 SD 下会被
  有意忽略，`solverParams.reforged` 始终为 false。
- **两套安装各自独立。** SD 需要 1.30.4（1.31.1 允许自动降级到 1.30.4），HD 需要 3.x；
  不要把同一目录当作另一种版本使用，也不要把本机路径写死进代码。版本门控在
  `src/vfs/version.ts`，每次启动都会检查，而不只是第一次选目录时检查。
- **验证要求。** 改动若触及共享层（`src/render/`、`src/ui/`、`src/game/`、`src/sim/`、
  `src/data/`），必须分别在 SD 与 HD 下启动并检查；两者使用各自独立的 dev server，
  避免安装门控互相冲突。只验证其中一条线，不算验证完成。
- **联机。** HD 对局要求所有玩家使用同一构建版本；不要假设 SD 与 HD 客户端可以混在一
  局里 —— 对局的单位、技能、花费与时序都读自各自的安装，版本不同就是两个不同的游戏。
- **HD 专属实现的位置。** 新增/修改 HD 专属实现时，优先放在 `src/ui/hd/` 等 HD 专属
  目录，避免把 HD 分支散落到 SD 的公共路径。

## 实践

- **Git 工作流：** 直接提交并推送到 `main` —— **不要**创建分支或开 PR，除非开发者明
  确要求。仍然只在改动完成并验证之后提交（`pnpm typecheck` / 按需在浏览器中验证）。
- **构建 / 检查：** `pnpm dev`（localhost:5173）、`pnpm build`（类型检查 + 构建）、
  `pnpm typecheck`。在认为改动完成之前先运行 `pnpm typecheck`。`pnpm data:verify` 会
  把 `src/data/gameplayConstants.ts` 与解包后的数据重新核对 —— 改过该文件后运行它（需
  要先 `pnpm data:extract`）。`pnpm casc:test` 会用本地安装目录检查 CASC 挂载本身。
- **用截图展示你的工作 —— 经常。** 任何视觉内容（渲染、HUD、摄像机、特效、地形、阴影、
  战争迷雾、UI）都必须在**真实运行的游戏**中预览，并把截图**发给开发者**，让他们能
  随时看到效果 —— 不要只是描述，也不要把截图留给自己。按 `live-browser-testing` 记忆
  里的方式实时驱动应用（临时 `?dev=` 自动挂载 + `agent-browser` 截图；
  `(2)EchoIsles.w3x` 是标准测试地图），并用 `SendUserFile` 交付图片。发**多张**截图
  —— 一张带框总览加紧凑特写（用 ffmpeg 裁剪/放大）、改数值时的前后对比，以及每次有意
  义的调整后的新截图 —— 而不是只发一张最终图。在整个任务过程中让开发者在视觉上保持同
  步，而不只是在结尾。
- **性能：** `pnpm dev:log` 会把每场对局记录到 `.logs/`（gitignored；普通 `pnpm dev`
  不记录任何东西）—— 帧时间、帧内耗时去向，以及一场对局可能增长的一切的普查。在调查"
  玩得越久越慢"之前先读 [`docs/perf-logging.md`](docs/perf-logging.md)，并从
  `pnpm perf:report` 开始而不是从 profiler 开始：报告已经区分了*某个阶段变贵了*、*有
  东西在累积*、*开销在我们的循环之外*。记录器两半都只在 dev server 里生效（
  `apply: "serve"` + `import.meta.env.DEV`），而且各阶段必须**划分**整帧 —— 嵌套两个
  `perfLog.begin` span 会让报告里的 `(unaccounted)` 行失去意义。这里长期存在的陷阱，
  是"把一个数据行当参数的热谓词"：一个技能的目标允许集是**常量**（在 SLK 边界归一化，
  且地图编辑会**替换**该数组），但 `targetAllowed` 与 `targsKindError` 每次调用都
  重建 `new Set(normalizeTargetFlags(…))` —— 在一个 287 单位的帧里约占 24%，比当时整
  个渲染器的开销还大。`targetFlagSet`（data/abilities.ts）对每个数组只归一化一次并保
  存在 WeakMap 中：**低性能模式 −23%，全画质 −26%**，结果精确，并可用
  `TargetFlagCache.enabled` 重新测量。
- **对局日志：** 在改动 [`src/game/matchLog.ts`](src/game/matchLog.ts)、
  [`electron/logStore.mjs`](electron/logStore.mjs) 或 Sim Speed 作弊之前，先读
  [`docs/match-log.md`](docs/match-log.md)。**每一场**对局 —— 包括正式版 —— 都会往
  `.logs/` 写一份可读的 `[mm:ss] P<n> …` 记录（`pnpm dev` 下是仓库里的，桌面应用里是
  `<userData>/.logs/`；纯网页构建不写任何东西）：出生、建造、升级、英雄等级与死亡（
  含击杀者）、研究、Computer+ 的模式/目标/建造变化、聊天、结果、每 30 游戏秒的
  STATUS 块，以及结束时的计分屏。它在构造上就是廉价的 —— 每游戏秒只 DIFF 一次世界，
  唯一的模拟钩子是 `SimWorld.deathObserver` —— 并且唯一的写入者（logStore）把单个文
  件限制在约 1 MB（滚动为 `.partN.log`），并清理 `.logs/` 中超过三天的所有内容。要大
  规模测试 Computer+，启动一场被观察的 AI 对局，并通过 dev 抽屉的 Cheats → **Sim
  Speed** 设定节奏（100–10 000 %，`setSpeedBoost`）；被加速的帧单步从不超过
  `BOOST_FRAME_MS`，然后读最新的 `.log`。
- **直连：** 在改动 [`src/net/directLink.ts`](src/net/directLink.ts) 或
  `matchLinkFrom` 之前，先读 [`docs/multiplayer.md`](docs/multiplayer.md) 的 "Direct
  links (WebRTC)"（直连）一节。对局中每个客户端向主机开**一条**有序、可靠的
  `RTCDataChannel`，中继只负责信令和兜住无法直连的流量 —— 不需要改服务器，也不需要提
  升协议版本。切换是**有序的**（中继上走一个 `cut` 标记；直连流量在它落地前被挂起），
  因为一条直连消息会超过一条中继消息，而主机会对命令计数。在快照仍携带一次性**事件**（特效、通知、被砍倒的树）时，不要让这条通道变成不可靠的。
- **掉线玩家：** 在改动 `peer-drop`/`drop`/`seat`/`abandon`、`LanLobby.onLost` 或
  `mapViewer.ts` 中的 `waitingFor` 之前，先读
  [`docs/multiplayer.md`](docs/multiplayer.md) 的 "A player who drops"（掉线玩家）一
  节。**主动**退出（Quit、Exit Program、关闭窗口或标签页）是一次 `leave`，立即生效；
  **连接丢失**会让所有人暂停 10 秒，对应 WC3 自己的 SuspendDialog（没有 Drop 按钮）。
  倒计时归零时，没有仍在作战的一方的玩家已经**离开**（1v1 结束），而团队玩家的席位会
  被中继**保留** 120 秒，并显示 "X has lost connection (Time to reconnect 87s...)"，
  主菜单则基于客户端保留的会话提供"Reconnect?"。
- **迷雾重建：** 在团队对局中，按席位进行的视野重建（`sim.fog`）是模拟中仅次于世界步
  进的最大子阶段，而 [`src/sim/vision.ts`](src/sim/vision.ts) 中的 `SightStamps` 正
  是它不再是最大子阶段的原因。一个视野的覆盖足迹是**地形**的事实，而不是"谁在看"的事
  实 —— 每个视点都拿到相同的高度场和每一棵被砍倒的树 —— 所以光线投射只做**一次**，再
  回放到每个视点自己的三层中，并以**单位**为键（每个单位一项；若用位置作键，单位每走
  64 个世界单位就会新建一项）—— 在其背后，再以(cell, sight)为键存入一个按占用格子数
  **设上限**的最近最少使用层，因为战斗中三分之二的投射都会重复另一个单位片刻前刚投射
  过的足迹。它会被倒下的树和视野半径的变化（昼夜是不同的 `R`，所以会自己换键）失效。
  它必须保持**精确** —— 迷雾决定了 AI 知道什么、客户端能看到什么，所以一个哪怕稍微错
  误的足迹既是不同步也是作弊；`tools/sim-vision-cache-test.cjs` 会逐格比较缓存网格与
  未缓存网格，包括跨一次伐木，而 `SightStamps.enabled` 可以关掉它，以便在真实对局中
  而不只是基准测试里测量这个结论。
- **地形剔除：** 在改动 [`src/render/terrainCull.ts`](src/render/terrainCull.ts) 或
  查看器补丁中的 `ow3Runs`/`ow3DrawCells` 片段之前，先读
  [`docs/terrain-culling.md`](docs/terrain-culling.md)。mdx-m3-viewer 每帧都会画**每
  一个**地形格，不管摄像机在看什么（Echo Isles 上有 12 288 个实例，其中 **704 个可见
  **）；每格缓冲区是行主序的，所以整个剔除就是在属性指针里的一个 OFFSET 加一个
  `(first, count)` 区段列表，每个可见格行一段。它刻意**保守**，并以**像素**为单位对
  照控制组测试 —— 两帧剔除后的画面本就已经不同（雨、待机动画、帧率读数），所以标准是
  "剔除 vs 不剔除的差异不超过 剔除 vs 剔除的差异"，`TerrainCull.enabled` 的存在就是
  为了做这个测量。在现代 GPU 上它大约只值 1%：帧在别处受 CPU 限制，而这项改动是为没
  有余量的机器做的 —— 不要把开发机上的数字当成重点。`holdRuns` 会冻结区段，让你能飞
  出去**看到**剔除效果。迷雾覆盖层与烘焙阴影层仍然扫过整张地图，也可以使用同样的区段；
  悬崖则需要逐实例包围盒。
- **视频选项：** 在改动 Video 面板、
  [`src/render/videoQuality.ts`](src/render/videoQuality.ts)或任何想让弱机器更省的东
  西之前，先读 [`docs/video-options.md`](docs/video-options.md)。这个面板是游戏自己
  的，所以它的形状不由我们决定：标签是**逐行**命名的（GlobalStrings 里没有通用的
  `LOW`/`HIGH`），`COLON_SHADOWS` 是 **"Unit Shadows"**，因此不会碰烘焙的
  `war3map.shd` 层，而随游戏发布的 FDF 把 Spell Detail 那一行注释掉了。文件里恰好只
  有**一个**数字是游戏的 —— 查看器自己的 `SETTING_PARTICLES_HIGH = 2` 让 MDX 作者写
  的速率成为游戏的 *Medium* —— 其他每一档都是**我们的**，并且标注了这一点。有两行刻
  意没有后端（Model Detail：MDX 没有 LOD 孪生体；Occlusion：我们不画 X 光剪影）。两个
  陷阱：地形贴图集是 ATLAS，所以丢掉它的 mip 会跨格渗色，在每块地砖周围画出接缝；
  Animation Quality 不能跳过**骨架**，因为模拟是通过写入单位实例来移动单位的，被跳过
  的实例就不动了。**RESOLUTION 是唯一改变"绘制多少像素"的档位**，因此也是弱 GPU 最在
  意的一档：它决定世界绘制缓冲区的大小，再由 CSS 缩放到舞台，所以摄像机在每一档看到的
  是同一个世界，而 DOM HUD 保持清晰（`GAME_WIDTH`/ `GAME_HEIGHT` 始终是**逻辑**帧）。
  每一档都按 16:9 命名并固定**高度**：舞台在 4:3 与 16:9 之间跟随窗口（绝不更宽 ——
  那会多给玩家一块地图），缓冲区采用舞台的宽高比，否则世界会被拉伸。在一个填充受限的
  帧上实测，它把帧时间减半（800×450 下 6.8 → 3.1 ms）；在 CPU 受限的帧上几乎没用，而
  这正是它面向谁的意义所在。**VERTICAL SYNC**（最后一行，我们的，默认开启）在桌面应
  用里是 Chromium 的**启动**开关，所以由**外壳**的 `settings.json` 拥有，点 OK 会提议
  **重启**游戏以应用它（Electron 里没有任何东西能在运行中的窗口上改它）；关掉后页面
  自行限制在 300 fps（`src/render/frameCap.ts`），而在浏览器标签页里该复选框是灰的。
  **4:3 MENUS**（我们的，默认关闭，与 Vertical Sync 共用一行）把 GLUE 界面、加载界面
  与计分屏装箱为黑底上的 4:3，这正是 1.30.4 自己在宽屏上对菜单所做的（在 Wine 下以
  1920×1080 核对过）；对局本身不受影响。`windowAspect()` 读取这个箱体，所以每个
  `widescreen()` 校正都会自动降回它的 4:3 值。**LOW PERFORMANCE MODE**（issue #161，
  Resolution 下面的那一行，也支持 `?lowperf`）是覆盖其下方各行的一个**总开关** ——
  `LOW_PERF_FORCED` —— 并且是在**应用时强制**，从不写入存储，这正是为什么取消勾选就
  能把玩家的七个值还给他们。Resolution 与 Gamma 刻意**不在**其中（像素与亮度是玩家的）
  ，两个界面都会把它拥有的行**置灰**，**并且**显示它强制成的档位（一个仍显示"High"
  的失效下拉框是在对玩家撒谎），而且按现状它只值几个百分点：它组合的是这个面板本来就
  有的档位，而 issue 真正要求的渲染器工作落在标志**之后**，这也正是为什么
  `VideoSettings.lowPerf` 被携带在它所强制的那几个档位旁边。那项工作的**第一**部分是
  **共享姿态缓存**（`VideoBridge.sharedPoses`，补丁 `mdx/modelinstance.js` 顶部的缓
  存）：经过剖析，MDX 的**节点遍历约占全部 CPU 的 41%**，而**绘制约占 7%**，所以再做
  第二个渲染器是瞄错了数字 —— 而且发现 317 个可见实例只持有**60**个不同的
  `(model, sequence, 1/30 s)` 姿态，于是姿态采样一次并重放（SightStamps 的教训在第二
  个地方）。被共享的是**局部**姿态，绝不是骨骼矩阵，因为这里的骨骼矩阵是世界空间的。
  决定成败的陷阱：** `forced` 意味着两件不同的事** —— 一次序列切换（重写每个局部）和
  一次移动（重新组合每个世界矩阵，轨道不动）—— 而既然值得共享的单位正是那些正在移动
  的单位，把它们折进一个标志就意味着永远没有东西可共享（`ow3PoseReset` 是第一种）。
  **第二**部分是共享**骨架**，大数字就在这里：根骨骼的父级是**实例**，所以把它挂到一
  个单位矩阵上（`ow3LocalPose`）就能在实例空间里组合姿态，整个桶再共享**一张**骨骼贴
  图，顶点着色器把每个身体自己的矩阵乘回去（`u_instance`）。**混合人类部队 2.1×，所
  有模型都符合条件时 3.1×**，259 个单位在 6× CPU 节流下。有三样东西仍属于实例、为它
  单独组合：作用于**世界**的节点（发射器、事件对象、附加模型 —— 每帧重新列出，因为一
  个增益模型会在运行时**父级绑定**到骨骼上）、点击射线的碰撞体（
  `src/render/modelCollision.ts`），以及模式切换的那一帧。一个 **BILLBOARD** 节点不
  能进入共享姿态 —— 它通过实例自己的旋转面向摄像机，放进去会在每个 Footman 的盾牌周
  围画出白色光晕 —— 所以这些**子树**按实例在世界空间重做再转换回去（
  `ow3FixBillboards`：一个 Footman 的 57 个节点里有 6 个，相对于把 69 个模型中的那 21
  个排除在外，值 16–29% 的帧时间）。一个拥有**自己时钟**的节点（一条全局序列 TRS 轨
  道，在实例的 `counter` 上采样）也按同样方式重做 —— 它过去会把整个模型排除在外，那
  是 Knight 的 214 个节点为了三个叶级挂件、以及 287 单位场景里全部骨架工作的 80%——
  现在只有 `dontInherit*` 仍会使模型不合格。**这里改动要按数值验证，绝不用像素** ——
  一场活着的对局的两帧本身就相差 6% 的像素，而这条路径有过的两个 bug 在截图里都看不
  出来：在同一段动画与同一帧上，比较 `instance.worldMatrix × local[i]` 与逐实例路径
  的 `nodes[i].worldMatrix`（它们一致到 ≤0.0011 个世界单位）。那两个 bug 是：
  `worldMatrices` 按**节点**顺序而 `sortedNodes` 按**层级**顺序；以及一个**作用于世
  界**的节点持有世界矩阵，会被下一个组合器捕获进共享姿态，除非它被重做（
  `ow3WorldWritten`，它必须包含那些只是**曾经**携带过东西的节点 —— 增益模型会被父级
  绑定到骨骼上，然后再被拿走）。`forced` 的洞见看起来在全画质下也应该划算 —— 一个移
  动单位会重新采样每个节点的每个通道，包括它的动画片段没提到的那些 —— 这一点被实现了，
  证明是**精确的**（19 个模型逐位一致），然后**又被撤掉了**，因为交错时它一文不值，
  而且正负号在两次运行之间会翻转：一个静默节点的采样是未命中或常量，而一次移动所强
  制的实例是**单位**，它们的动画片段会驱动大部分骨架。再次伸手之前先看
  docs/video-options.md。
- **Windows：** 在改动 NSIS include（
  [`packaging/windows-installer.nsh`](packaging/windows-installer.nsh)）、`win`/
  `nsis` 构建块或 [`electron/locate.mjs`](electron/locate.mjs) 之前，先读
  [`docs/windows.md`](docs/windows.md)。**一个**安装器同时携带 64 位与 32 位应用，这
  就是 Windows 构建被钉在 **Electron 43** 上的原因（`dist:win`/ `release:win` 中的
  `-c.electronVersion`）—— 44 不发布 `win32-ia32`。安装器询问 WARCRAFT III 文件夹并
  安装到 `<it>\Warcraft Open`，而 electron-builder 的卸载器是 `RMDir /r $INSTDIR`，
  所以 `$INSTDIR` 靠三道防护与游戏文件夹保持分离（目录页之后、静默安装的 `.onInit`
  中、以及卸载器中）—— 永远不要移除其中任何一道。
- **Linux 32 位：** 在改动 `electron/legacy/`、`tools/build-legacy-main.mjs` 或
  `linux32` 脚本之前，先读 [`docs/linux.md`](docs/linux.md)。Electron 在 **18.3.15**
  之后不再发布 `linux-ia32`，所以 i386 AppImage 就是那个 Electron（Chromium 100、
  Node 16）运行**同一个**外壳：`electron/legacy/compat.mjs` 在 `main.mjs` 前面补上缺
  口（`protocol.handle`、`Response`、`Readable.toWeb`、`crypto`），并且两者被打包成
  CommonJS 的 `electron/main-legacy.cjs`，因为 ES 模块主脚本需要 Electron 28。更新器
  不需要任何东西：32 位进程请求 `latest-linux-ia32.yml`，这正是 electron-builder 为
  该构建写出的。有一个陷阱**不是** API：Chromium 100 在菜单加载过程中留下 1–1.6 GB
  的 Oilpan 垃圾，32 位进程会因此死掉，所以遗留外壳在堆增长时请求一次回收（通过
  `webContents.debugger` 调用 `HeapProfiler.collectGarbage`）。
- **布局：** 模拟在 `src/sim/`（世界、寻路、`spells.ts`），游戏胶水在
  `src/game/rts.ts`，渲染 +命令卡在 `src/render/mapViewer.ts`，HUD DOM 在
  `src/ui/hud.ts`，数据表在 `src/data/`（单位、科技树、`abilities.ts`），音频在
  `src/audio/`，样式在 `src/style.css`。
- **UI 套件：** [`packages/ui`](packages/ui/README.md)（`@warcraft-open/ui`）是从零
  绘制的 glue 界面外观（glue 按钮、Human 面板、提示框、标题、加载条），落地页（
  `web/`，React 绑定）与游戏的加载门（`src/ui/gate.ts`，DOM 绑定）**两者**都由它构建，
  因为那个界面在任何 FrameDef 被读取之前就运行了。类名是 `ow3-*`，并且它不设置
  `cursor`。`web/` 把它当作硬链接的 `file:` 依赖：往套件里**新增**文件后，要在 `web/`
  里运行 `pnpm install`。
- **4:3 界面：** 在凭眼睛调整任何 glue 装饰、按钮宽度或 `nudgeX` 之前，先读
  [`src/ui/widescreen.ts`](src/ui/widescreen.ts)。每个 glue FDF 及其 3D 装饰都是按
  4:3 **制作**的，而填满更宽屏幕的那些校正（`panelStretchX`/`leftStretchX`/
  `logoStretchX`、`buttonWidthScale`、地图信息微调）是在 16:9 下测的 —— 4:3 屏幕没有
  这些额外宽度，所以每一项都以 16:9 表述，再通过 `widescreen()` 混合回文件自己的值。
  平铺应用时，右侧装饰会压到左侧面板上（issue #151）。对局舞台（`ui/stage.ts`）同样
  在 4:3 与 16:9 之间采用窗口的宽高比，而窄于 4:3 的窗口会把菜单和对局一起装箱。
- **版本（Editions）：** 在改动 [`src/data/edition.ts`](src/data/edition.ts)、
  [`src/vfs/edition.ts`](src/vfs/edition.ts)、一个 `_V0`/`_V1` war3skins 键，或两个
  游戏有分歧的常量之前，先读 [`docs/editions.md`](docs/editions.md)。主菜单的
  `EditionButton`（在 Single Player 旁边，佩戴着它要**去往**的版本徽记）以黑场切换
  Reign of Chaos ↔ The Frozen Throne。几乎整个 RoC 都已经是安装目录里的**数据**：它
  的对象表是 `Melee_V0\<same path>` 处的数据集，由 `EditionDataSource` 在安装入口处
  覆盖到活动路径之上，并在**每次**查找时被询问（所以一个活过切换的缓存必须在
  `onEditionChange` 上丢弃自己）。**这个数据集是 2×2，而不是一对**（
  `dataSetFolder()`）：版本是 edition，而**词**是地图**种类**，所以近战地图读活动表
  或 `Melee_V0\`，其他一切 —— 战役章节、场景、自定义地图 —— 读 `Custom_V1\` 或
  `Custom_V0\`。近战携带 1.29+的平衡补丁，而自定义冻结在每个游戏发布时的状态，这就是
  为什么一个 Grunt 在 Scourge of Lordaeron 里有 **680** 点生命，而在近战游戏里有 700
  （仅资料片的两套数据之间就有 70 个单位在生命值上不同）。种类是 w3i 的近战标志，由
  `startGame` 在解析任何表之前设置，并由 `exitToMenu` 放回近战；它的 glue 美术、音乐
  与战役文件是带版本 war3skins 键的 `_V0` 孪生项（`skinVersionSuffix()`，绝不用字面量
  `_V1`）；而 `VersionGet()` 回答这个切换，使 Blizzard.j 自己选择 750/200 与三英雄轮
  换。有两样东西**不是**数据，必须重述：`MiscGame.txt` 的行（Reign of Chaos 的副本是
  `MISC_GAME_V0`，**自定义**地图的是 `MISC_GAME_CUSTOM` —— 同样的 2×2，针对唯一一个被
  编译进代码的字面量置于覆盖层触及范围之外的文件；两者都由 `pnpm data:verify` 检查，
  它还会断言它漏掉的任何一行都不会悄悄产生差异。通过 `damageTable()`/`miscGame()` 读
  取它们，绝不要直接读 `MISC_GAME`），以及引擎的食物上限（90）。**这个切换的幅度正是
  它被测试的原因：** 两个游戏共享的 468 个单位中有 232 个改变了**护甲类型**（一个
  Footman 在 RoC 是 Medium，在 TFT 是 Heavy；一个 Raider 是 Light/0 对 Medium/1），而
  给它们评级的伤害表也随之变化 —— 读错数据集不会报错，只是每场战斗都是按另一个游戏平
  衡的（`tools/sim-edition-data-test.cjs` 把覆盖层、行与乘数一起钉住）。RoC 客户端只
  列出 `.w3m` 地图，也只列出 RoC 的 LAN 房间（`RoomInfo.edition`），而两个近战 AI 都
  会丢弃该版本科技树缺少的行，而不是去命名 TFT 的 id。
- **1.30.4 之后的补丁：** 在改动 [`src/patches/`](src/patches/README.md)、
  [`src/vfs/patch.ts`](src/vfs/patch.ts) 或 `tools/patch-*` 之前，先读
  [`docs/patches.md`](docs/patches.md)。暴雪在我们的 1.30.4 数据之后发布的每个平衡版
  本（1.31.0 → 2.0.4）都是 `src/patches/data/` 中**我们自己的**一个 JSON 文件，用游
  戏自己的术语书写（文件、行 id、列、值），而 `PatchDataSource` 会在版本覆盖层**之下**重写这些表 —— 所以只有 The Frozen Throne 的**活动近战**表会变动（暴雪在 1.30 之
  后从未重新平衡过自定义数据集或 RoC），每个读取者都在不知情的情况下得到打过补丁的游
  戏。`MISC_GAME` 是编译进代码的，所以 `miscGame()` 会向补丁链询问它的行。游戏**始终**处于最新版本；`setPatchLevel()`（`?dev&patch=1.32.10`）只为开发者回滚。补丁里没
  有暴雪文本 —— 提示框数字用玩家自己文件中的 `{"replace": …}` 修正，新对象的文字是我
  们的；我们为新对象准备的图标放在 `src/patches/art/`（`node tools/patch-art.mjs`）。
  **The Forsaken Paladin（3.0.0）不存在**（`DENIED_IDS`）。`pnpm patches:check` 证
  明某个版本可以应用；`node tools/patch-audit.mjs` 用真实构建的表来证明每个版本的**
  值** —— 暴雪的 CDN 只保留当前构建（每个 1.30–2.0.4 的配置都是 404），所以中间的**
  检查点**是社区副本，在 `tools/patch-checkpoints.mjs` 中按 commit 钉住（1.31.1
  …2.0.4；1.35/1.36 没有）。当说明与表冲突时，以表为准。
- **图标：** 在改动 [`src/vfs/derivedArt.ts`](src/vfs/derivedArt.ts)、`blpIcon` 或某
  个技能的 `Art` 之前，先读 [`docs/icons.md`](docs/icons.md)。一个图标首先来自安装目
  录，其次是我们自己绘制的美术（`src/patches/art/`），再次是在挂载时**派生**的 —— 缺
  失的 `PASBTN<X>` 就是 `BTN<X>` 把 4 像素斜面涂黑、再对后续八圈做阴影（一条实测曲线；
  与真实图标相差 3/255），缺失的 `DISPASBTN<X>` **就是** `DISBTN<X>` —— 最后是
  `BTNTemp.blp`，画出来的而不是空方块。一个 `Art` 可以按**等级**列出一个图标（
  `iconAt`），`rlev` 升级效果会推进它。
- **摄像机：** 在改动 `GAME_FOV`、缩放常量或某张地图的摄像机之前，先读
  [`docs/camera.md`](docs/camera.md)。数据携带的 FOV **字段**（70）**不是**游戏渲染
  所用的角度（**45°**，从真实客户端测得）—— 把它们混为一谈，每个距离的含义都会变，每
  张地图的摄像机都会坏。
- **法术特效：** 在添加或调试某个法术的美术之前，先读
  [`docs/spell-fx.md`](docs/spell-fx.md)。WC3 有**五种**表现机制（效果模型、增益美术、
  **闪电缎带**、ubersplat、音效），其中两种完全不播放模型 —— Chain Lightning 或
  Drain 没有可查找的 `Targetart`，而一个增益的美术挂在**增益行**上而不是技能上。找错
  机制就是标准的"这个法术没有美术"bug。一个 **CARRIER**（Cyclone 的 `[Bcyc]`、Impale
  的 `[BUim]`、Tornado 的 `[Btsp]`：一个带 `sprite,first` 挂点的 `Effectart`）是反过
  来的增益美术 —— 它站在地面上，持有者的**模型**骑在它的 `Sprite First Ref` 上，而单
  位、它的寻路与点击体积留在原地（`RtsController.setRide`）；它的落地与增益的时钟对
  齐（`CARRIER_CLIPS`：Cyclone 预播它的 Death 动画片段，Impale 按 Air Time 的速率播放
  它唯一的 Birth 动画片段）。
- **光照与阴影：** 在添加任何光或阴影相关的东西之前，先读
  [`docs/lighting.md`](docs/lighting.md)。**真实客户端是 Direct3D 固定功能管线**，
  Wine 可以记录它：逐顶点光照、1/(1+0.0005·d²)、无基础环境光、线性雾、加法混合绘制且
  不受雾影响。每个 glue 界面都在这条路径上（`scene.ffp`），而一个战役的雾就是它自己
  的 `BackgroundFog*`，分毫不差；对局还没有走这条路径。在凭眼睛拟合任何观感之前，先
  **追踪**该界面（配方在该文档里）。WC3 **没有实时阴影** —— 阴影要么是 blob 贴花，要
  么是烘焙的 `war3map.shd` 遮罩（每个地形**格** 16 字节，0 或 255，无文件头），要么
  什么都没有 —— 而 glue 界面由模型**自己的** `LITE` 全向光照亮，其尺寸是按摄像机位于
  340 单位外的立体模型设定的。它还有一个要花一小时才发现的陷阱：编辑 mdx-m3-viewer
  补丁后，要重启 dev server 并删除 `node_modules/.vite`，否则 Vite 会继续提供打补丁前
  的包，你的着色器改动毫无作用。一个**悬崖**或**斜坡**地块没有地面，所以它只属于悬崖
  着色器：雾幕与 `war3map.shd` 层会跳过它（它们的地面网格平面切开了岩石 —— 那些深色
  斜坡矩形与黑色悬崖楔形），地面光照取自**原始**地面高度（绝不是悬崖层），而网格与草
  地相接处的悬崖顶点采用草地的法线。
- **水面、海岸线与迷雾的淡出：** 在改动 `render/shoreline.ts`、`advanceWater` 或
  `FogOverlay.fade` 之前，先读 [`docs/lighting.md`](docs/lighting.md) 的最后两节。一
  帧水面覆盖 `Water.slk` 的 `cells`（2）个地形格，海岸的泡沫是引擎自己铺设的纯粒子模
  型（没有地图放置它们），而迷雾是**缓动**绘制向一张保持硬边的视野图。
- **暗夜精灵：** 在改动 Wisp、Ancients、Entangled Gold Mine 或 Moon Well 之前，先读
  [`docs/night-elf.md`](docs/night-elf.md)。整个种族玩的是一套不同的经济游戏，而且几
  乎都不是调参数值：一个 Wisp 会被 Ancient **消耗**（UnitBalance 的 `type` =
  "Ancient"），由 Moon Well 释放；它的木材在树里直接入账，完全没有往返；金币是一队五
  个人坐在建筑里，而不是一个队列；而 Ancient 是游戏里唯一一栋会拾起自己已盖章的占位
  并走路的建筑。
- **亡灵：** 在改动 blight、Acolyte、Haunted Gold Mine 或任何亡灵建筑的放置之前，先
  读 [`docs/undead.md`](docs/undead.md)。Blight 是**地形** —— 一张由建筑涂刷的网格（
  `Abgs` / `Abgl` 生长，`Abds`/`Abdl` 在其他**每个**种族的建筑上擦除，四者行结构相同，
  彼此只差一个 `Creates Blight` 布尔值）—— 而且它会**比产生它的东西活得更久**。
  `UnitBalance.requirePlace` = "blighted" 就是全部放置规则，并恰好点名需要它的十一个
  建筑。Acolyte 召唤后**走开**（建筑保留自己的时钟），从不搬运金币，并跪在 Haunted
  Gold Mine 周围 200 单位的 `Abgm` 圈里 —— 它的五人小队在挖金处领钱。
- **幻象：** 在改动 Mirror Image（`AOmi`）、Wand of Illusion（`AIil`）或任何复制单位
  的东西之前，先读 [`docs/illusions.md`](docs/illusions.md)。幻象的全部意义在于**敌
  人**分不清它与本体，所以每个破绽（蓝色滤镜、召唤计时器、头像）都以**本地视点**为门
  控，而它的无伤害规则在命中时执行 —— 不是通过修改它显示的内容。
- **物品：** 在改动物品、物品技能或 `useItem`/`applyPowerup`/`itemBonuses` 中的任何
  内容之前，先读 [`docs/items.md`](docs/items.md)。一个物品的行为**不在**物品里 ——
  它是 `abilList` 中的一个技能 id，而那一行拥有与英雄法术行相同的字段，所以它按基础
  `code` 派发。三个入口（按下、拾取、携带）共用一个派发器，因为游戏把同一个技能两个方
  向都发布：`AIha` 既是 Scroll of Healing，也是三个 Rune of Healing。效果触达谁来自
  它自己的 `Area1` —— Scroll of Regeneration 是**区域**，Healing Salve 是**单位**，
  Clarity Potion 是饮用者，三者同属一个 code —— 而**瞄准**根本不在表里，必须从物品的
  Ubertip 中读出来。而且一个**被携带**的技能就是技能：Talisman of Evasion 的那一行**
  就是** Demon Hunter 的 Evasion，所以物品栏必须对 `passiveLevelData` 与
  `applyAuras` 可见，否则十四个光环物品会对所有人广播却无人接收。**冷却**是两个字段，
  且都不是秒数：`cooldownID` 命名的是**一起**进入冷却的组（一个**名字**，不是技能
  —— 四个原版组不对应任何技能行，所以时长始终是按下技能自己的 `Cool1`），而
  `ignoreCD` 表示这次按下完全不消耗冷却。时钟属于**英雄**并比瓶子活得更久（
  `SimUnit.itemCooldowns`），这正是为什么在冷却中购买的药水到手时就在冷却，而递给另
  一个英雄则已就绪。一个**不可掉落**的物品（"cannot be removed from a Hero's
  inventory once it has been picked up"——`UI\TriggerStrings.txt` 在
  `SetItemDroppableBJ` 旁边的原话）在全部**四个**入口都会被拒绝，而不只是丢弃按钮：
  丢弃它、交给别人、卖掉它，以及非英雄携带者带着它死亡。它是一个按**物品**的标记（
  `SetItemDroppable`，以实体 id 为键），覆盖在类型自己的 `droppable` 列之上，恰好只有
  一件原版物品 —— `soul` —— 该列为空。
- **一个技能可以被瞄准谁**只有**一个**入口：`SimWorld.targetError`。它读取该行的
  `targs1`（`src/sim/targeting.ts`：种类 + 阵营），然后读取
  [`TARGET_RULES`](src/sim/targetRules.ts) —— 那些任何标志列表都无法表达的规则（法力
  池、亡灵分类、是否召唤、野怪等级上限），以基础 `code` 为键，每条都带有游戏自己的
  [Errors] 行。一个法术按钮、一个物品、一次自动施法、一个电脑和脚本下达的命令都会经
  过它，所以新增一种拒绝是那里的一条**规则**，绝不是某个调用者里的 `if (code === …)`
  （Control Magic 的"仅限召唤物"只对 Gloves 生效而对 Spell Breaker 不生效，就是这么
  来的）。一行如果没有 KIND 词就不限制种类：`[Aste] targs1 = notself` 允许建筑，而让
  Wand of Mana Stealing 不能对 Arcane Vault 使用的是它的法力规则 —— Moon Well 有法力
  池，所以仍然合法。
- **法球效果：** 在改动任何**攻击修正**之前，先读 [`docs/orbs.md`](docs/orbs.md) ——
  法球物品、箭矢类技能（Searing/Cold/Black/Incinerate）、Slow Poison、Envenomed
  Spears、Feedback、Frost Attack 或 Mask of Death。它们是同一条规则下的**一个**家族
  —— 一次攻击只能承载**一个**法球效果，按固定的优先级阶梯 —— 所以孤立地添加一个是必
  然错误的。有两样东西它**不**门控：固定伤害加成（一项携带属性，会叠加）和空中攻击（
  `DataE` = "Enabled Attack Index"，唤醒英雄沉睡的第二武器）。而一个法球的
  `Targetart` 不是命中特效：它是穿在携带者武器骨骼上的**循环**模型。
- **炮击：** 在改动攻城武器、`applyAreaSplash`、`minRange` 或任何设置导弹高度的东西
  之前，先读 [`docs/artillery.md`](docs/artillery.md)。一发炮弹沿**地面**飞行，可以
  从下面走出来；它的高度是武器的 `Missilearc`（投掷距离的**分数** —— Mortar Team 为
  0.35，Glaive Thrower 为 0.05 —— 在一个地方计算，`src/sim/missile.ts`，覆盖模拟飞行
  的每枚导弹 —— 攻击用单位槽位，法术用**技能**行自己的 `Missilearc` —— 以及客户端的
  显示副本）。爆发的 `splashTargs` 同时也是它的**阵营**，而攻城行没有命名任何阵营，
  所以一发炮弹会打到投掷者自己的部队（"Mortar Teams will damage your own units"，
  Liquipedia）；它杀死的东西会**爆裂**（没有尸体）。`minRange` 是单位**站**在其中的
  死区，绝不是后撤，而且只有远程槽位才有。Attack Ground（`attackground`，
  [CmdAttackGround] 3,1/G）向一个点开火，直到命令被替换。
- **战役：** 在改动战役界面、它的数据或章节开始路径之前，先读
  [`docs/campaigns.md`](docs/campaigns.md)。整个战役是**一个**文本文件（
  `UI\CampaignStrings_exp.txt`），它自我说明，其中有三行打破了显而易见的解析（引号内
  的逗号、第四个字段、一个"任务"其实是 `.mdl`）。这个界面也是唯一一个**没有面板装饰**
  的 glue 界面 —— 战役的 3D 背景就是界面本身。一个章节结束所用的 native 与近战对局不
  同：`CustomVictoryOkBJ`（Continue 按钮）会按 `bj_changeLevelMapName` 分支，所以近
  战地图通过 `EndGame` 退出，而章节通过 ** `ChangeLevel`** 退出，后者的全部职责就是
  播放该章节自己的 `SetNextLevelBJ` 所指名的地图。用一个空操作来回答它，正是
  Continue 什么都不做的原因。英雄在章节之间**携带**的是**游戏缓存**（`StoreUnit`/
  `RestoreUnit`），而缓存属于一个**档案** ——common.j 的原话，"stored in the current
  campaign profile dir" —— 所以在同一个安装上的两个玩家有两个战役，各有自己的等级与
  物品栏（[`src/data/gameCache.ts`](src/data/gameCache.ts)，每个档案一个 blob，好让
  profiles.ts 的精确键清理继续有效）。没有任何东西说明哪些字段会传递，所以这份清单是
  读战役**做了什么**得出的：英雄进度、逐格的物品栏（由 TFT 的储物箱证明 —— 一个一次
  性躯体存下来只为了它的物品），以及属性书收益作为**增量**；**不是**生命值（恢复的单
  位完整到达），**不是**升级新星（`applyStoredUnit` 把等级写下来而不是升到它 —— 属性
  本来就是从等级派生的）。未命中是一个受支持的答案：每个章节后面都有一条"创建默认英
  雄"的分支。失败有它自己的一对：**`RestartGame`** 重玩同一张地图并携带**当前**难度
  （Reduce Difficulty 就是那个按钮前面加一个 `SetGameDifficulty`），而 **
  `GetDefaultDifficulty`**是对局**开始时**的难度 —— 不实现它时它会回答索引 0，所以每
  次 Continue 都会悄悄把战役降到 Easy。
- **加载界面：** 在改动 `Loading.fdf`、`[LoadingScreens]` 表或对局开始路径之前，先读
  [`docs/loading-screens.md`](docs/loading-screens.md)。选择地图加载界面的 w3i 字段
  是解析器称为**`campaignBackground`** 的那个（副标题之后的整数根本不是加载界面），
  美术是 FDF 自己 0.8×0.6 盒子里的平面 2D 而不是 3D 场景，而加载条**自己填充** —— 它
  的裁剪从空动画到满，进度只是你把播放头停在哪里。它也是唯一一个以**拉伸**而非按高度
  缩放布局的界面（它是一张印了东西的图片），也是唯一必须住在 `#ui` **之外**的界面，
  因为对局会在进度条还在移动时把它重新装箱为 16:9 的游戏帧。
- **热键：** 在改动 [`src/data/hotkeys.ts`](src/data/hotkeys.ts)、
  [`src/data/customKeys.ts`](src/data/customKeys.ts) 或 HUD 的按键处理器之前，先读
  [`docs/hotkeys.md`](docs/hotkeys.md)。Options → Gameplay → "Hotkeys:" 有**三**档，
  其中只有两档是实现：**Grid** 是一种**键盘**方案（键是按钮在 4×3 命令卡上的**位置**——QWER/ASDF/ZXCV，口袋位在 T/Y·G/H·B/N —— 所以它读 `e.code`，绝不读 `.key`），而
  **Custom** 是一个**数据**覆盖层（玩家的 `CustomKeys.txt` 在 SLK 边界重写 `Hotkey`/
  `Tip`/ `Buttonpos` 列，然后命令卡像 Legacy 一样查找字母 —— 这就是为什么
  `gridHotkeys()` 对它返回 FALSE，而按键处理器从不提及它）。`CustomKeys.txt` 在安装
  目录里自我说明（`CustomKeyInfo.txt`、`CustomKeysSample.txt`），并且只能设置**十一
  个**字段，不能设置其他字段 —— 它可以重新绑定和改写措辞，但永远不能改变游戏。它是
  exe 旁边的**松散**文件，所以它搭载在 `PickedInstall.customKeys` 上，并由
  `loadProfile` 交出，那是所有三个安装入口都会经过的唯一函数。三个无声陷阱：
  mdx-m3-viewer 的 `IniFile` **只**按 `\r\n` 分割，而这是玩家会写的一个游戏文件；两
  边从不在大小写上一致（`[cmdrally]` 对 `CmdRally`），所以覆盖层遍历**目标**的行，一
  行只会被覆盖，绝不会被发明出来；而 `Hotkey=` 有时是一个**数字**（
  `[CmdCancel] Hotkey=27` 是 VK_ESCAPE，如果按字母读就是 "2"）。引擎自己的按钮没有对
  象行，所以它们的进入 `Units\CommandStrings.txt`—— 这就是为什么这些字母不再在
  `cmdSection` 的调用点被重新输入。Custom 档有一个**编辑器**（issue #156，下拉框旁的
  图标按钮）：它的卡片从表里**读出来**（`data/hotkeyCatalog.ts`），它**原地**编辑玩
  家的文件，并从中取回游戏自己的值集（`data/customKeysDoc.ts` —— 永远不要重新生成文
  件），提示框不可编辑并会自己重新镀金，而 Save 通过安装入口自己的写入器回去（
  `PickedInstall.saveCustomKeys`）。
- **提示框：** 在改动命令按钮弹出的板、世界悬停板，或任何把一行文本组合进这两者的东
  西之前，先读 [`docs/tooltips.md`](docs/tooltips.md)。**不要**去找它的 FrameDef ——
  没有，而 `UI\MiscUI.txt` 用同样多的字说明了原因（"not created through the use of
  FrameDef files"）。它的四个权威是该文件的 **[FontHeights]**（`ToolTipName`/`Desc`/
  `Cost` 全是**0.011** —— 名称行并不比正文画得更大）、`war3skins.txt` 的
  **[Default]**（这就是为什么每个种族悬停的都是**人类**框，而且其中一个键命名了一个
  1.30.4 从未发布的文件）、`GlobalStrings.fdf` 中引擎组合的行，以及
  `Units\CommandStrings.txt` 中引擎**自己的**按钮 —— 它们的 Ubertip 比任何转述都完整
  得多，而它们的建造动词是**种族**的（"Create Building"、"Summon Building"）。读一个
  字符串，永远不要重新输入：`REQUIRESTOOLTIP` 把颜色烘焙进字符串，它是**黄色**的；两
  个空货架字符串刻意是两个字符串（"Out of stock"对应尚未到来的 `stockStart`，"Coming
  soon"）。边框是一条 128×16 的条带，其 tile 是 16 个透明纹素中的 4 纹素笔画，所以可
  见的线是这条带的**四分之一** —— 按类型而不是按墨水来确定带宽。信息面板的 Damage /
  Armor / Hero Attributes 悬停板是同一个板，文字完全出自
  `UI\FrameDef\InfoPanelStrings.fdf`，射程与速度以**单词**形式从 `UI\MiscData.txt` 的
  [InfoPanel] 打印，而 "Damage Reduction" 按**未取整**的护甲计算（一个 Death Knight
  的 `realdef` 2.6 在面板上读作 "3"，在悬停板里读作 "13%"）。
- **选择与点击：** 在改动 `pickAt`、拖拽框或
  [`src/render/modelCollision.ts`](src/render/modelCollision.ts) 之前，先读
  [`docs/selection.md`](docs/selection.md)。一次点击是对模型自己的 `COLLISIONSHAPE`
  节点的一条**射线** —— `UnitUI.slk` 点名的 530 个模型中有 440 个带这些节点，一个单位
  通常是两个重叠的**球体**（头和胸），而一个**建筑**的盒子是它底部的扁平**板**而不是
  剪影（87 个中有 85 个从 z=0 开始；Town Hall 的板高**26** 单位，而模型高 643 单位），
  所以尖塔不是点击目标。这与 `collisionSize` 是不同系统，后者是**寻路**，从不询问
  模型任何事。89 个无形状模型几乎都是建筑，会回退到自己的占地。**拖拽框**是另一半：
  它把覆盖到的**自己**单位尽可能多地给你，而从别人那里最多只取**一个** —— 一支部队是
  你指挥的东西 —— 这也是为什么一个框同时罩住你的部队和敌人的部队时，不需要规则就只会
  取你的。
- **不可游玩区域：** 在改动地图边界、摄像机钳制、`GetCameraMargin`/
  `GetPlayableMapRect` 或任何询问"这个点在地图上吗"的东西之前，先读
  [`docs/unplayable-area.md`](docs/unplayable-area.md)。一张地图把它的边界陈述了**四**遍（两个意思相同的 w3e 标志、一个 wpm 位、它自己 `main()` 里的 `SetCameraBounds`，
  以及 w3i），而且它们完全一致 —— 所以这里不需要猜。那个位是 `0x04` **Unflyable**，
  与悬崖的 `0xca` 只差一位，这正是边界成为飞行单位唯一不能越过的东西的原因 —— 在空中
  它也是 `PathDomain` 的 `"air"` 唯一询问的东西，并且是让空中单位拥有寻路的唯一原因。
  色调是 `UI\MiscData.txt` **[FogOfWar]** 的 `BoundaryTerrain` = 230,0,0,0，是迷雾上
  的一个**下限**而不是颜色，带有一个对象孪生项（`BoundaryObject`，一个黑色剪影），住
  在 mdx 的 SD 着色器里。它**不**阻挡视线 —— 那被尝试过又撤掉了；再次伸手之前先看该文
  档的最后一节。而三个矩形（世界边界 ⊃ 可游玩区域 ⊃ 摄像机边界）彼此相距 512/256，不
  可互换。它唯一**不**拒绝的是脚本已关掉寻路的单位（`SetUnitPathing`，`PathDomain`
  的 **`ghost`**）：战役就是这样把一具躯体带出地图的，而它与模拟自己的 `noCollision`
  是不同的标志，因为它能在清除后者的命令下存活，并且会带着**地形**一起走。
- **可行走可破坏物：** 在改动
  [`src/render/walkableHeight.ts`](src/render/walkableHeight.ts) 或
  `RtsController.groundOrDeck` 之前，先读
  [`docs/walkable-destructibles.md`](docs/walkable-destructibles.md)。
  `DestructableData.slk` 的 `walkable` 列（247 个原版类型中的 106 个：每座桥、坡道、
  隐形平台）是一个**高度**标志，不是寻路标志 —— 单位可以走哪里已经由类型的 `pathTex`
  决定，而这里新增的是**甲板**就是地面。通过向模型自身几何体**垂直向下**投射射线找到，
  始终与地面取 MAX（所以走下桥不需要规则），而 `.doo` 的 `z` 是**绝对**世界高度。
  几何体是从归档里解析出来的，因为查看器不保留它：`setupGeosets` 把每个 geoset 上传
  到 GL 缓冲区，只保留字节偏移。点击射线行进同一块地面（`groundHit`），否则右键点桥
  会落到几百单位外的河里。甲板**不是**高地：视野安装的是**悬崖层级**场，从不询问它
  —— 看起来像是的东西，是迷雾通道用桥**原点**下方那一个视野格照亮了一座千单位长的桥，
  而它位于水中央（`propFogRadius` 现在给每个道具它自己寻路贴图的半范围，就像树一直
  有的那样）。
- **暂停：** 在改动 `src/render/mapViewer.ts` 中的 `paused`、F10 面板的 Pause 按钮或
  任务日志的 Done 按钮之前，先读 [`docs/pause.md`](docs/pause.md)。暂停有**三个**独
  立的所有者（一个模态面板、地图自己的 `PauseGame`、一个玩家），把它们折进一个布尔值
  会让它们互相覆盖。一个停下的世界是一张**静止画面** —— 每个让世界老去的时钟都读
  `wdt`，而不是帧的 `dt` —— 而整个特性在 `GlobalStrings.fdf` 里自我说明：
  `KEY_RESUME_GAME` 与 `KEY_PAUSE_GAME` 并排对应同一个按钮，而暂停按 TIMEOUT 计数，每
  人三次，任何人都可以解除。`deadPanels()` 是"哪些控制台按钮现在失效"的**唯一**答案，
  按钮条的置灰与 F 键都问它，而且任何键都不会把一个模态换成另一个 —— 面板自己的键
  关闭它，其他每个键都不做任何事。
- **近战 AI：** 在改动 [`src/ai/`](src/ai/) 中的任何内容、`MeleeStartingAI` 或一个电
  脑玩家的行为之前，先读 [`docs/melee-ai.md`](docs/melee-ai.md)。WC3 的电脑玩家是暴
  雪自己的 JASS——`Scripts\human.ai` / `orc.ai` / `elf.ai` / `undead.ai`，构建在
  `common.ai` 库上，四个都在安装目录里 —— 而这里的四个种族文件是从它们逐函数移植的，
  所以**其中的数字就是游戏的**，除非注释另有说明。建造数组是整个策略层，在你理解它之
  前读起来是反的：`SetBuildUnit(n, X)` 的意思是"至少拥有 n 个 X"（把队列和飞行中的命
  令都算进去，而不只是场上站着的），列表是一个**优先级阶梯**，其运行中的金币预算在第
  一个负担不起的行处**立即停止**，而 `TownCount` 把 Castle 折叠为"一座 Town Hall" ——
  这也是为什么 `SetBuildUnit(1, KEEP)` 意味着*升级大厅*，而绝不是*建造一座 Keep*。每
  个决策都通过 `RtsController.execute` 发出，所以电脑与你自己的点击受到完全相同的门控，
  无法作弊。战役章节没有近战 AI：它的电脑是任务自己的。**法术是"这里的数字属于游戏
  "这一规则的例外**：种族脚本只说明英雄**学习**什么，对如何使用只字未提，所以
  [`casting.ts`](src/ai/casting.ts) 建立在 Boris_Spider 的观察帖（hiveworkshop
  193280）之上 —— 每条规则都引用它的行，并以**基础**技能 code 为键，这正是那个帖子的
  要点。一波法术的触及距离与宽度来自那里的 `waveDistance`/ `waveHalfWidth`，与
  Computer+ 共享 —— 而三个波类元组对列的编号并**不**相同：`Osh1..4`/ `Ucs1..4` 把距
  离放在 `DataC`、把**半**宽放在 `Area1`，而 `Uim1..4`（Impale）把距离放在 `DataA`、
  把**伤害**放在 `DataC`、把**全**宽放在 `Area1`。读错列会让 Impale 的触及距离变成
  **75** —— 它的伤害 —— 于是永远没有东西在范围内，Crypt Lord 在两种施法者里都根本不
  按那个按钮。
- **Computer+：** 在改动 [`src/ai/plus/`](src/ai/plus/)、Advanced Options 面板的
  Computer+ 开关或 [`src/overrides/`](src/overrides/) 之前，先读
  [`docs/computer-plus.md`](docs/computer-plus.md)。它是暴雪移植版近战 AI **旁边**的
  第二个近战 AI，而不是它的难度设置：两个对象不共享任何状态，一个席位只属于其中之一，
  而 `src/ai/*.ts` 中的任何东西都不得从 `src/ai/plus/` 导入。让它不同的是它**不作弊** —— 既没有疯狂电脑的双倍采集，也没有它的迷雾穿透 —— 所以它三个档位之间的每一处差
  异都是 `PlusProfile` 里的一个数字，而**那些数字没有一个是游戏的**：安装目录里没有任
  何东西描述过一个改进版 AI，所以与种族脚本不同，那里的值**是我们**的，除非注释引用
  了来源。它的部队上限在**生产**处执行而不是在波次处，这就是"不许暴兵"的全部；它的认
  输通过 `EVENT_PLAYER_LEAVE` 发出，好让暴雪自己的 `MeleeTriggerActionPlayerLeft` 把
  单位交出去，而不是让 AI 拆掉自己的基地。SIEGE 是 `antiAir` 旁边的一行种族配置（
  `siegeUnit` / `siegeLine`）：二级站住后，`PlusProfile.siegeUnits` 个该种族攻城武器
  加在混编之上，而火炮**即使在战斗中**也会炮击建筑（`siegeNear`）。基地是**由外向内**拆除的（`peelPass`/ `razeCost`：部队到塔的距离 > 生产建筑 > 其余阶梯 —— 一波所瞄
  准的大厅只是用来命名目标基地），而士兵会离开建筑去追 `RAZE_CLOSE` 内的敌方躯体 ——
  但绝不跟随已经退到正被拆除的建筑**后面**的防守者（`assaultFrame`/ `deepIn`，且
  `contactPass` 不打扰基地突袭）；缺少的 Town Portal 会在英雄站着的**任何**商店购买，
  或者在队伍集结时绕路去买（`PlusItems.portalChance`）。一个种族是一张有名字的构筑
  表，每场对局掷一个，而**扩张属于建造顺序**（`PlusStrategy.expandAt`）而不是难度 ——
  速开是构筑，不是设置。构筑命名**单位**，其建筑是派生出来的，有两个走得更远的子句且
  没有第三个：`factories`（构筑以之**命名**的第二座 Arcane Sanctum / Ancient of Lore
  / Crypt —— 混编已经隐含多少座该建筑，从不指定是哪一座）与 `thenAt3`（三级时它**成
  长**成的构筑，是被掷中构筑的子句，而不是我们拒绝的中期切换）。**施法者**是一份占比
  而不是一支军队（`UnitRow.caster`，`CASTER_SHARE` = 一半）：克制关系的重新加权无法
  给法术打分，所以它只会把单位推到施法者**周围**，而一个糟糕的克制关系会悄悄提拔它们。
  唯一一行会为一个构筑从未要求的产兵建筑买单的是 `antiAir`—— 一座建筑加四个该种族
  **专职**防空单位，加在混编之上，并受与其余克制逻辑相同的 seen/sample/difficulty 开
  关以及 counter.ts 自己的 `AIR_HEAVY` 门控。克制读取游戏自己的 `DAMAGE_TABLE` 对照
  AI **已侦察**到的内容，所以永远不要添加手写的克制表。它从头到尾都是一个**近战**玩
  家，这就是它完全不玩**自定义**地图的原因：`startMeleeAIFor` 会拒绝在一张 w3i 近战
  标志为空的图上安排 Computer+ 席位，转而交给暴雪自己的 AI —— 因为在地图自己的触发器
  拥有席位的地方，建造顺序、扩张时钟和瞄准别人城镇的一波都没有意义。真正拥有它的两张
  自定义地图把席位安排在完全不同的地方（`startCandyWarAI`、`startWarChasersAI`），两
  者都不经过 `StartMeleeAI`。CREEPING（打野）是**按价值计价**的，从不用食物衡量（
  [`plus/power.ts`](src/ai/plus/power.ts)）：一个营地的合计等级已经在游戏自己的绿/橙
  /红标尺上说明了它有多难，而一支队伍按√Σ(dps× 当前生命值) × 英雄系数定价 —— 食物不
  是军队的价值，三个 Grunt 不等于三个 Archer。**发起**战斗与**脱身**用的是不同的门槛，
  后者低得多（在战斗中重新询问前者会让每一次行动在第一次擦伤时就中止）；同一条规则
  服务野怪与玩家，只有"对手是否仍然健康"的衡量方式不同。**第三**个门槛是**单个士兵**
  的而不是整支军队的：Easy 以上，一个生命值低于 `pullOutHp`（25 %）且正站在战斗中的单
  位会被带到战线后方 `PULL_BACK_DIST` 处，稍后再回来（`pullPass`），按**单位**冷却
  —— 没有那个计时器，它会在战斗里来回摇摆而不是在里面打；仅在 Insane 上，一个**远程**单位会在到位的那一刻立即归队（`pullRejoin`），而**任何**生命值低于 15 % 的东西
  —— 包括远程单位和英雄 —— 会**回家**，在 22 %时归队（`sendHomeHp`/`rejoinHp`），远
  程单位会先射击射程内伤势最重的躯体，然后才跟随集火（`finishWounded`，会把已经承诺
  给它的攻击计入，以免战线过量击杀）—— 而一个撤出的**队长**会停止锚定凝聚，否则一个
  受伤的英雄会把整支军队拖回家。Scroll of Town Portal 花在离开一个**玩家**时；面对一
  个**野怪营地**它是 8 % 时的**最后手段**（`LAST_RESORT_HP`），再高就没有别的，因为
  英雄在那里有两个更便宜的答案 —— 其他单位都有的那套走出战斗，按卷轴过去触发的更高门
  槛（`pullBar`），以及 `fightLost` 带队伍回家。它的军队还作为一个**整体**移动，锚定
  在**队长**上 —— 第一个训练出的英雄，然后第二个 —— 在五分之四到齐之前没有任何东西离
  开集结点，并带一个截止时间，因为一个没有截止时间的门把英雄锁在了家里。一个**落单**
  单位是同一教训的另外三次，每一次都是测试的**顺序**而不是一个数字："它**丢了**"要在
  "它在战斗中"之前问（`cohesionCall`），因为越过 `FOLLOW_RADIUS` 之后就没有战斗可以
  脱身 —— 只有那个单位和找到它的东西；队长的**身体**是"和它在一起"的东西，而不是整个
  小队的均值，否则地图另一头的一个士兵会让英雄在其余士兵集结时冻住；而一次 HOLD 有一
  个以 REGROUP 结束的截止时间，因为站着不动只有在身体正在靠拢时才能集结军队。集结检
  查也必须能够**够到**掉队的单位：它过去会跳过任何**无论站在哪里**都带有移动或攻击命
  令的东西，而那些恰恰是已经和它走散的单位，且模拟中的一场战斗结束时单位仍然持有它的
  攻击命令。**前六分钟**是为了保住军队（`EARLY_PRESERVE`、`earlyLost`）：面对玩家时，
  敌方的**塔**会计入对方（`oppositionPower` 会跳过建筑，这正是为什么过去一波会冲进
  基地，直到对方英雄在 40 % 时喝卷轴），而一场已经开始让我们吃亏的势均力敌的战斗、一
  场明显输掉的战斗、低于 55 % 的队伍或低于 50 %的队长会把军队带回家 —— 每个门槛也都
  在询问**另一侧**，所以一个走散的 Peasant 仍会被点掉。与敌方军队的**接触**是拿整条
  **纵队**衡量的，绝不是拿队长（`armyFrame`/`inContact`，由 `contactPass` 与
  `armyInReach` 共享 —— 一个它们中有一个看见、另一个没看见的躯体，就是一条停下来却什
  么也没决定的纵队）：行军是在普通 MOVE 命令下走的，而 MOVE 不会自动索敌，所以一个在
  英雄已经走过后遇到队尾的敌人，是在"不要还手"的命令下被走了过去。一个它无法**到达**
  的目标会像营地一样被放弃（`writeOff` →`Brain.avoid`，按基地自己的宽度匹配，因为目
  标是我们最近的哪座建筑），而 `pickTarget` 的**最后**一档是**任何**英雄等级下的野怪
  营地 —— 等级上限是营地和攻击之间的偏好，而在那里，替代方案是一支在基地里站到游戏结
  束的军队。**前十分钟**属于营地：英雄等级 3 以下 `waveReady` 会拒绝，而因为
  `creepNext` 询问同一个时钟，一个关闭的波次窗口就是一个**敞开**的打野窗口。**亡灵**
  基地是唯一一个种族专属的门槛（`mayAssault`，1.75 ×`attackFood`，以难度自己的部队上
  限封顶，读取目标**建筑**的 `race` 而不是大厅里的选择）。从来没有工人被闲置（
  `AiPlayer.workIdleWorkers`，在 `applyHarvest` 之下：把一座矿补满五人，否则去砍树
  —— 计划兜底的最后一档是**森林**，而对亡灵来说那不是任何人），也没有小队会带着命令
  闲站：一座我们的矿在我们派人时已经 `MINE_STALL` 时间没有产出金币，就会重新派出工人
  （`kickStalledMines`，读**矿**自己的金币而绝不是金库），因为一个持有采集命令的工人
  对上面两个检查都是不可见的。人类的 Scout Tower 会**变成**别的东西（
  `PlusRaceTable.towerUpgrades`：每镇一座 Arcane Tower，其余变成 Guard Tower，
  human.ai 自己的分配），每一行通过 `techMeets` 按自己的 `Requires` 门控 —— 一行即使
  不可能合法也会从运行预算中预留价格，所以 Guard Tower 的 `Requires=hlum` 白白给阶梯
  加税。一个**策略**命名的是构筑最终想要**达到**的军队，所以二十一个里有五个命名的东
  西在一级根本不存在 —— 因此 `buildableMix` 回退到该种族的**开局士兵**（派生而非命名：
  兵营能造的、**不需要其他任何东西站住**的最低阶单位，即
  Footman/Grunt/Archer/Ghoul）。没有它，空混编就是一个**死锁**而不是一个缓慢的开局，
  因为每一条"场上没东西就别攀科技"的门控都是用**军队食物**表述的：没有可训练的东西就
  没有食物，没有食物就没有建筑，没有建筑就没有可训练的东西。亡灵看起来是例外，只因为
  它的 Ghoul 出自**经济**（`lumberUnits`）而不是混编。回退会在建造顺序中有一行上线的
  那一刻让位，否则每个构筑都会悄悄变成"基础士兵，加攀科技"。建造**阶梯**的顺序就是策
  略，其中有七个位置是实测出来的：金币小队排第一 —— **字面意义上的**第一，大厅行与亡
  灵的矿都在它**下面**，因为它同时也是死亡工人的替补，而一次突袭恰恰是上方某一行建筑
  让循环永远停住的时刻（缺口会从一座没人站着的矿里被补掉）—— 森林小队紧随其后，英雄
  排在兵营之前，其余工人排在英雄之后，**商店**与开局同行，而**升级**与科技建筑一起放
  在升 tier **之上** —— 放在下面它们就根本不会被触达，这就是"AI 从不升级任何东西"的
  全部 —— 而在**二级**，**第二英雄**排在 Castle、科技建筑与升级三者之上（
  `tierTwoHero`），因为一行不必**无法触达**才会负担不起：循环花费的是一个**运行中**
  的预算，所以当英雄只是排在扩张之上时，它上面的行每次都会在读到它之前把金币花掉，二
  十个构筑中有十个在二级时以单英雄打到了十分钟。森林小队与商店是同一个教训的两遍：一
  行只有在阶梯**能够到达**它时才谈得上"优先级较低"，而 `OneBuildLoop` 会在它负担不起
  的第一行处返回。伐木工排在英雄之下会**死锁** —— 矿上五个工人加一个备用，树上只剩**
  一个**，英雄行要 100 木材，而本该雇第二个伐木工的行被卡住的那一行压在下面（一个暗
  夜精灵从 0:30 站到 4:45，银行里存着 2500 金币）；而一个排在军队行下面的商店根本不
  会被造出来，于是什么都不会被买。**核心军队**是升 tier 正上方的那一行，因此一旦那一
  行过了它的时钟它就**停止增长**（`coreArmy`/ `tierUpOverdue`，保持在 `TIER2_ARMY`）
  —— 一个 `army` 行每次都会永远要求再要一个士兵，所以在时钟与大厅之间，这就是从一行
  内部看到的同一个"永远还有另一个士兵"的漏口，而每个种族都因为这次保持而更早到达二级，
  且十分钟时的军队并不更小。`TIER2_CLOCK`（180 秒）是一个**默认值**，而某个种族可
  能想更早升二级：`PlusRaceTable.tier2Clock` 是人类自己的 120，因为人类第一个强势期
  完全在 Keep **之后**（一座 Arcane Sanctum 是 `[hars] Requires=hkee`，所以在等待期
  间没有便宜的一半可买），而它的开局是游戏里最贵的。Sanctum 出于同样的原因是人类的**
  支援**行 —— 人类全部五个构筑都命名 Priest、Sorceress 或 Spell Breaker —— 而 Lumber
  Mill 是**二级**支援行，而不是它过去的一级行：人类在 Castle 之前造的任何东西都不需
  要它，而它曾是任何种族唯一的第二个一级支援行，排在升 tier 之上。**三级**默认没有时
  钟 —— 普通行在阶梯的**底部**，从升级、攻城、扩张与第三英雄剩下的资源里购买 —— 所以
  一个计划**就是**三级的种族会命名一个（`PlusRaceTable.tier3Clock`：暗夜精灵的 510
  秒，为了熊；`tier3Delay` 让 Normal 晚三分钟），然后 `tier3Due` 就在二级行正下方要求
  大厅。**INSANE 对每个种族都会冲它**（`PlusProfile.tier3Rush`：时钟为零），而在第三
  座大厅未付款期间（`tier3Rushing`），核心军队超过 `TIER3_ARMY` 之后**什么都不**要求
  —— 保持在一个它仍会漏的数字上，因为每个军队行都是一个单位的**份额** —— 铁匠的研究
  会等待，而亡灵的森林会拿走它三分之二的 Ghoul（`LUMBER_SHARE_RUSH`：Black Citadel
  要 230 木材）。三级是**为了**什么而存在的，留到那里解决：Priest 与 Shaman Training
  是**解锁**行（二级是 Inner Fire / Bloodlust），而每个兽人与亡灵二级构筑都会成长成
  Tauren / Abomination（`thenAt3`）—— 兽人的是 Tauren、**BERSERKER** 与 Shaman：混编
  命名的是 Head Hunter，在 `Robk` 撤回它之后 `AiPlayer.replacedBy` 训练 Berserker，而
  `setBuildNext` 会计入它（一个普通计数把四个 Berserker 读成零，于是从不训练第五个）。
  Insane 还会**匹配**敌方空军（`antiAirMatch`）：看到四个飞行单位就够了，不管它们
  占比多少，防空行会随飞行单位增长（最多到该种族数量的 3×），而且它位于 tier 行**之
  上**，所以一次仓促的三级无法饿死它。它的熊也是为什么一个 Insane 暗夜精灵从不攻击**
  主基地**：强势期位于在 `SPIKE_LATEST` 之后才到来的三级背后，这就是为什么现在一支
  `SPIKE_ARMY_FOOD` 的军队自己就会去迎接强势期。两个 **ID 陷阱**各自让一整个子系统失
  效，而且从调用点看不出来：亡灵的祭坛是 ** `uaod`**（Altar of Darkness），**不是**
  `utod`（Temple of the Damned —— 那是**施法者**建筑）—— 命名错一个会让亡灵没有英雄，
  而且因为英雄行会让建造循环暂停，也没有军队；而一个 **BURROW** 要通过它所在基地的
  技能 code ** `Abun`** 来要求，绝不能靠"有 `garrisonCap`"来判断，因为 Entangled Gold
  Mine（`Aenc`）也有一个，而每次检查都让它的工人停工，正是暗夜精灵收入的大部分。**瞄
  准是一条**阶梯（[`targeting.ts`](src/ai/plus/targeting.ts)），由它的施法者与军队共
  享 —— 一个英雄定住 Tauren，而他旁边的每个 Footman 都在打 Shaman，是两个互相抵消的
  决策 —— 而难度评的是**读**，不只是反应：Easy 按数量瞄准（这就是它的 Storm Bolt 落
  在你的 Tauren 上的原因），Insane 按法术的**用途**定价。它也**不追英雄**：一个健康
  的英雄比一个士兵值不了多少，军队不会去追一个它杀不掉的目标。而一个单体 **NUKE** 绝
  不花在它杀不掉的**工人**上（`nukeWorthIt`）——Frost Nova 对命中单位的份额在每个等级
  都是 100，而游戏里没有哪个工人有那么少的生命 —— 按模拟自己的处理器所读的同一批数据
  列定价，并在**合法性**处执行，所以误点也不可能落在那里。Insane 会先把**驱散**花在
  敌方的**召唤物**上（`dispelSummons`、`PlusCaster.dispelSummon`）—— Abolish Magic
  是一个阶梯从不按下的**自动施法**，而它的智能自动施法在设计上就不碰召唤物。**MANA
  BURN** 是唯一一个瞄准**法力条**而不是躯体的按键（`manaBurnValue`）：它值它**抽走**
  的量，`min(DataA, mana)`，所以它会落在一直在**攒**法力条的人身上，绝不落在伤员身上
  —— 一个**英雄**是其他人的 4×，其溢价刻意**不**随 `heroFocus` 缩放（那个旋钮是反追
  击规则，而在 300 射程内按向已经站在 Demon Hunter 面前的人并不是追击），它下面的下限
  读取**目标**自己最便宜的 `Cost1`：在它还买得起自己一个按钮时抽。它旧的 `debuff` 评
  级正是它根本不触发的原因 —— `rolesFor` 只把 `debuff` 给 Insane，正如它曾让 Impale
  无法施放。一个 **WAND OF ILLUSION** 是当作**先锋**花的：分身被扔到橙色或红色野怪营
  地外几秒处，本体**停在**原地，只有复制品走进去 —— 豁免于凝聚，因为站在最前面就是全
  部职责。它旁边的陷阱是：幻象是军队的一张**图片**，不属于小队被判定的**任何**读数（
  `isCopy`）：它不造成伤害、满血到达、不占食物，而且**就是用来死的**，所以把它算进去
  会让队伍为它打不下的营地定价，并让先锋爆掉被读成军队崩溃。它**确实**会购物和喝药（
  [`plus/items.ts`](src/ai/plus/items.ts)）。一个种族的**开局购买**（`RACE_FIRST`——
  兽人的两瓶 Healing Salve、人类的两卷 Scroll of Regeneration、亡灵的 Rod of
  Necromancy，它的 `AIrd` 保留**自己的** code 却携带 Raise Dead 整个 `Rai1..Rai4` 组）
  是从钱包里买而不是从 `itemReserve` 以上的盈余里买，因为一个 Normal 电脑的金币几乎
  从来不会比任何东西多 300，而一瓶它永远够不到的 100 金币药膏就是一间白造的 Voodoo
  Lounge。**替补** Town Portal 也一样（替补不是购物），种族的**法力**行（`RACE_MANA`）
  也一样 —— 它对四个种族不是同一件物品，因为 `[pclr]` 需要 Tree of Eternity，只有
  `[plcl]` 没有门控，而 Tomb of Relics 二者**都**不卖：亡灵的法力是 `pman`，其
  `Requires = TWN2` 是商店自己执行的二级解锁。一次**区域**治疗花在三个问题上而不是人
  数上（`armyHeal`）：圈里有 `CLUSTER` 个躯体、超过**一半**的军队在圈内、且队伍的**
  合计**生命低于 `ARMY_HURT` —— 而圈是物品自己的 `Area1`，绝不是 `LOOK`；旁边还有一
  个只针对**英雄**的子句（`selfRegenWorthIt`，只限灌注类），因为一个受伤的英雄在一整
  支军队旁边会同时不满足这三条。**CLARITY POTION 不是 POTION OF MANA**，它们是两个档：
  `AIrg` 是灌注，所以只有视野里没有敌意东西时才喝（任何伤害都会剥掉
  `ITEM_REGEN_GROUP`），而且要**积极**喝 ——`MANA_TOPUP` 75 %，并用 `manaRoom` 保证灌
  注不浪费 —— 而 `AIma` 在按下时立即恢复，完全不问战斗状态。两者共用一个档，意味着积
  极的那个被门控在恰好会把它浪费掉的状态上。这旁边那个曾让几乎整条腰带失效的陷阱是：
  一次按键是**为了**什么，以技能的基础 **`code`** 为键，绝不是 `AbilityData.slk` 的
  `alias`—— `AIh1` 是 `AIhe`，`AIm1` 是 `AIma`，而 Salve、两瓶 Clarity Potion、
  Scroll of Regeneration 与 Replenishment 家族全都是同一个 code `AIrg`，靠它们自己的
  `Area1`/ `Rng1` 区分，正如模拟区分它们的方式（docs/items.md）。在**团队**对局中它
  也会**说话**（[`src/ai/plus/teamchat.ts`](src/ai/plus/teamchat.ts)），并分享它侦察
  到的东西。每一行都走普通聊天路径、在**盟友**频道发出 —— 电脑没有第二条频道 —— 而它
  **听到**的一切也以同样方式到达，门控在 `deliverChat` 已经算好的接收者列表与联盟矩
  阵上，所以它读不到没发给它的聊天，就像它看不穿迷雾一样。两个陷阱：文件自己的词汇由
  它自己的解析器读取，所以一个被解析成请求的拒绝会让两台电脑在余下对局里互相回答（
  `readAllyCall` 先测**回答**、再测拒绝，`tools/ai-plus-teamchat-test.cjs` 钉住它）；
  而且在 `heard` 里不执行任何动作，它是从聊天投递的中途被调用的。它按两个条件请求
  帮助 —— 自己城镇里有两个对手，或者**一个**正在碾压它（这是 `powerOf` 比较而不是计
  数）—— 并且每当一波向某个玩家出发时，它就宣布**它要打谁**（"im going to hit the
  undead"），按**种族**命名他们（`playerNames`，取自 `PlusHost.playerRace`），这是真
  人会说的话，也是队友不用查任何东西就能行动的信息。**位置**只在另一个玩家共享该种族
  时才加上（"the undead at the top"、"the human in the middle"），并对照**那些玩家**
  而不是地图的两半来测量，所以同一句话对说者和听者含义相同；两端都在同样的席位上跑
  `playerNames` 且**排除说话者**，这才使一个亡灵电脑说的 "the undead" 指另一个。**颜
  色**是没有已知种族的席位以及同一象限两个出生点的回退，这两者都**不**命名 —— 一个含
  糊的名字比一个色块更糟（`COLOUR_NAMES` 是 `UI\TriggerData.txt` 自己的 `playercolor`
  枚举，询问 `PlusHost.playerColor`，因为 `SetPlayerColor` 可能移动一个）。盟友回答
  "im coming with you" 然后真的会来；不感兴趣的**什么都不说**，因为没人会在队友每次
  进攻时都打 "no"。**点名某人**也正是让这个公告不被读成求助的原因 —— 求助不点名任何
  人 —— 而 `namedRace` 与 `namedColour` 都按**最长优先**匹配，否则一次"打左上角的亡
  灵"会被听成"打顶部的亡灵"，正如浅蓝会被听成蓝。侦察情报**不是**聊天 —— 一次目击在
  被做出的那一刻就写进每个盟友 Computer+ 玩家的 `EnemyMemory` —— 它也不是迷雾穿透，因
  为传递的是某人自己亲眼看到的东西。**一行的停止会停住它下面的一切**，而几乎每一份
  "AI 就站在那儿"的报告都是某一行因为不该有的原因停住了。四条规则让它继续走，每一条
  都让一个子系统付出了代价：升 tier 按**站着的**来源定价（`upgradeSources`，忙不忙都
  算）—— 如果按只扫空闲的版本定价，一座正在训练工人的大厅会让 Stronghold 读成
  700/375 而不是 315/190，阶梯在开局的大部分时间里就停在那里；某一行想要升级的大厅在
  那一轮**不接**工人（`holdForUpgrades`），否则升 tier 行上面的工人行会让它的队列一
  直满着，升级永远无法开始；森林从不会被留空（`LUMBER_DRY`），因为木材缺口在没有木材
  收入时永远不会缩小，而本该雇伐木工的行就在它停住的那一行下面；而一个已经不再**接近**其价格的停止会放行一轮（`releaseStall`）。有两行的价格是**种族**的而不是人类的：
  补给行手里保留**一座**补给建筑的食物的量，而不是固定的六（一座 Moon Well 是 180/40、
  五十秒、十食物，而一座 Farm 是 80/20、三十五秒、六食物 —— 六食物的提前量是一座井
  建造时间的三分之一，也就是暗夜精灵的食物卡顿），而且它用 ** `townCountDone`、绝不
  是 `countDone`** 来统计那份补给：`startUnit` 把一行与**折叠后**的计数比较，而亡灵
  的 Ziggurat 会升级成它自己的**塔**（一座 Spirit Tower 仍产十食物），所以按普通
  Ziggurat 读会让一个被洗劫的亡灵再也造不出补给。亡灵的扩张是 **HAUNTED GOLD MINE**
  （`expand` 用 `table.mineBuilding` 建立它，undead.ai 自己的
  `basicExpansion(…, UNDEAD_MINE)`），它的 210 木材是所有亡灵建筑里最多的 —— 所以
  `mineBuildings` 位于大厅行**之上**，由循环自己的停止来保护储蓄，否则每次都会先买
  225 金币、不要木材的 Necropolis，而矿永远买不到 —— 而一座**别人**在用的矿不是扩张（
  `AiPlayer.mineTaken`：被围住、上面有仓库、或有别人的工人在里面；要询问其他每个席位，
  而不只是敌人，因为为一块**队友**占了的矿而储蓄的那一行会永远停住它下面的一切）。
  军队的主体是**最后**一行，所以任何在它之上预留金币的东西 —— 第二英雄、扩张、一个
  tier —— 都是生产停止：在储蓄时让军队留在场上的底线是 `CORE_ARMY_FOOD`，它因此随
  tier 增长。第二座产兵建筑是用**金库**买的；旧的 `armyFood >= 40` 门控高于三个难度
  中两个自己的部队上限，永远不会触发。`tools/ai-plus-ladder-test.cjs` 对每个构筑无头
  运行阶梯十分钟。开场之后的**英雄**是开发者的**搭配**（`PlusRaceTable.combos`：
  Paladin → Blood Mage，先点 Siphon Mana；Blademaster → Shadow Hunter；Death Knight
  → Lich……，每个难度都如此），其中几个是**酒馆**英雄，通过把工人走到酒馆门口来雇佣（
  `AiPlayer.hireAtTavern`），而且只在英雄**合法**之后才雇（`heroLegal` —— 每个近战英
  雄的 `Requires1` 都是二级大厅，这也让旧的一级第二英雄行变成了一次 425 金币的死预留）
  。一个仅限 Insane 的构筑会用自己的开场**替换**被掷中的构筑（`replaces`）：亡灵在
  Crypt Lord 或 Dreadlord 背后速开，把升 tier 留到它自己的 `tier2Clock`。**兽人**是
  四个构筑组成的网格 ——Blademaster 或 Far Seer 开场，配两座出 Raider 的 Beastiary，
  或标准的 Beastiary + Spirit Lodge —— 全部成长成 Berserker、Shaman 与 Tauren（
  Tauren 会 `waitFor` Berserker Upgrade）；Far Seer 那两个围绕 Tauren Chieftain 作为
  它们的 `carry`（队长，在商店和拾取处优先）。每个**人类**二级构筑都成长成 Knight、
  Priest、三台 Flying Machine（`lead`），以及六个 Knight 之后的 Gryphon，而人类在为
  它 2:00 的 Keep 储蓄时保留一个英雄和四个士兵（`tier2Army`）。**暗夜精灵**的三级是
  先熊（lead 行里八只，Chimaera 要等五只之后 —— `waitFor` 会把处于 Bear Form 的德鲁
  伊算进去），Insane 从不掷它的 `talons`/ `dryads` 构筑（`notInsane`），而一个
  Priestess 开场的掷中第二英雄 —— Demon Hunter 或 Brewmaster —— 是 `carry`（
  `HeroCombo.carry`）。在 Insane 上，暗夜精灵与人类会购买该种族的**法杖**（
  Preservation / Sanctuary），任何持有它的英雄会把生命低于 15 % 的单位送回家，英雄优
  先（`staffPass`）；一个 Preservation 单位从落地那一刻起就被按住（`sentHomeHeld`，
  在唯一的 `issue()` 门处），并被带到 Moon Well 恢复到 95 %。AI 的种子先经过
  `mixSeed`，否则一个小的开发用 `?seed=` 会掷出每张表里的第一个构筑。Insane 还会**游
  走**（`PlusProfile.roam`）：它在地图自己那一半集结，绝不在家闲着。施法者的 `NEVER`
  持有**采集** code —— 一个 Ghoul 不是 `isPeon`，所以 `roleOf` 把它的 `Ahrl` 推导成
  法术，并把它扔向它正在砍的野怪，每一轮都取消那次挥砍（"Ghouls don't hit creeps"
  bug）。在 INSANE 上，一张**采空**的地图（任何地方都没有带金币的矿，`noteMinedOut`）
  会以**一场最终战**结束：每个波次门控都被解除（每个都在等某样东西被**购买**），没
  有东西脱身，结果会认输（`finalLost`）。一个单位有**一个**自动施法槽，正如游戏的开
  关一样：**治疗**占据它（`autocastSlot`），其他每个自动施法都由阶梯手工按下 —— 它的
  目标以一次停下**结束**（模拟 `CROWD_ARRIVE`）：停在上面时，集结外圈既不自动索敌也
  不自动施法。
- **AMAI 是 GPL** —— 研究它只是为了策略表的形状，别无其他；永远不要提取它的代码或数
  字。
- **单独的 `\r` 是 JASS 的行终止符。** JASS 是**面向行**的 —— 一条语句在行尾结束 ——
  所以终止符是一个**记号**而不是空白，而三种约定都必须恰好产出它一个。第三种不是假设：
  一个地图**保护器**会重新发出它重写的脚本，而至少有一种会写出旧 Mac 行尾，所以安
  装目录自己的 `Maps\Download` 里十一张地图中有四张就是这样（DotA v6.71b AI 有 **93
  138 个回车符，一个换行都没有**）。把 `\r` 当空白跳过会把这样的文件变成**一条**逻辑
  行，解析随后以**零**个函数"成功" —— 任何地方都不报错，`config`/`main` 是"未知函数"，
  而一场对局在一个空世界上进行。当词法器学会它之后，四张地图从 0 个函数变成 4022 /
  13 531 / 1285 / 961 个，Extreme Candy War 就在其中 —— 这意味着它的整个 AI 子系统（
  通过读那个脚本的全局变量来安排席位）此前从未被安排过。见
  [`docs/triggers.md`](docs/triggers.md)。
- **地图的自定义技能是被翻译的，绝不是手写的。** 一个 w3a 对象保留它的基础 `code`（
  于是基础技能的行为会运行），而地图改过的每一列都通过 `Units\AbilityMetaData.slk`
  路由到 SLK 加载器填充的同一个 `AbilityDef` 字段（
  [`src/data/objectData.ts`](src/data/objectData.ts) 中的 `applyAbilityMods`）。加载
  器读取而应用器不读的字段就是一次被丢弃的地图编辑 ——"Summon Void Walker" 召唤出
  Water Elemental，就是因为 `UnitID` 没有被路由 —— 而 meta 的 `field` 列按**不区分大
  小写**匹配，因为 meta 文件与 SLK 对列的拼写不同（`EffectArt` / `Effectart`）。
  Targets Allowed 有**两套**词汇（`UI\UnitEditorData.txt` 的 [targetList]：地图写
  `enemies`/ `vulnerable`，SLK 写 `enemy`/`vuln`），由 `normalizeTargetFlags` 折叠；
  一个**成对**项（`hero,nonhero`、`ancient,nonancient`）不限制任何东西；而一个**区域**辅助同时询问该行的阵营与种类（`World.allegianceAdmits`）—— 这就是为什么地图里一
  个仅 `self` 的 Scroll of Speed 只加速它的携带者。同一条路径上还有两个陷阱：**热键**是一个字符串字段，而 World Editor 会像任何提示一样把它存成 `TRIGSTR_` 键（先解析
  再取字母，否则每个这样的按钮都会响应对"T" 的按下）；而五个技能**类**在任何 Func 行
  里都没有 `Order=`（`ANfd` Finger of Death、`AHdr`、`AHca`、`ANdp`、`ANrc`），所以
  脚本按名字下的命令没有东西可匹配，会落到 "smart"—— 一次 FOLLOW。它们的字符串来自
  `UI\TriggerData.txt`，把 `HeroSkill<Name>` 的 code 与 `UnitOrder<Name>` 的字符串连
  接起来（`fillIntrinsicOrders`）；正是这一点让 Extreme Candy War 的 Candy Mage 守在
  岗位上。
- **更新格式的地图：** 在改动 [`src/compat/`](src/compat/README.md)、地图文件解析器
  或查看器补丁里的解析器片段之前，先读
  [`docs/map-compatibility.md`](docs/map-compatibility.md)。今天从 Hive 或 EpicWar
  下载的地图是 1.31–Reforged 2.0 的编辑器保存的，其中四个条目自 2018 年以来字段增长了：
  `war3map.w3i` **v32/v33**（两个摄像机距离，然后第三个）、对象文件 **v3**（每个对
  象的修改被包进 SETS —— `setCount`，然后每组 `setFlags`+`modCount`）、`war3map.w3e`
  **v12**（地面贴图加宽到 6 位以支持超过 16 个地形贴图集，所以一个角是 **8** 字节，
  标志也随之上移），以及 `.doo` 的皮肤 id（已经接好 —— 它只需要 w3i 的构建版本）。
  **w3i 门控着这一切**：它的抛出正是这样一张地图根本不出现在 Custom Game 列表里的原
  因，而同一个抛出还藏住了安装目录自己的 `Maps\Download` 里五张受保护的 v25 地图（
  Extreme Candy War、DotA、Angel Arena），它们的 w3i 是**截断**的 —— 所以读取者需要
  的不只是版本感知，还需要容错，而那个文件的**每一个**读取者都必须是容错的那个：共有
  **四个**，其中 `loadMap` 里的那个（`stampMapPathing`）抛出的结果是**黑屏**而不是缺
  一行，因为它在加载界面已经交接之后才触发。`grep parsers/w3x/w3i` 能找到它们。那个
  修复正后方的陷阱是 `solverParams.reforged`，查看器用 `buildVersion > 131` 设置它，
  并把贴图查找切换到 `.dds`、把队伍颜色表切换到 28：一个以**文件布局**为键的**资产线**开关，而我们是从 SD 安装里画 SD，所以它保持 false。这**是一个兼容层，并且必须保持
  是** —— 每个分支都是 `if (version >= N) … else <它今天做的事>`，格式在地图入口处被
  询问**一次**并存入 `MapFormatProfile`，而 `src/compat/` 之外的任何东西都不从它导入
  （与 `src/ai/plus/` 的规则相同，理由也相同）。更新的 `Blz*` native 是一个**降级**
  面，不是拦路虎 —— 一个未知 native 和一个未定义全局各记录一次然后被跳过，所以这样的
  地图在它们任何一个存在之前就能跑 —— 而它们的常量必须来自**我们自己的**前置定义，绝
  不是暴雪更新的 `common.j`。`war3mapSkin.w3u/.w3a/.w3t/…` 文件**不是**可以跳过的 HD
  附加物：它们持有每个对象的美术与**名称**，覆盖在主文件之上，而地图的触发器可以按名
  字找到技能。而地图导入的美术通过 `render/assetSolver.ts`（地图归档优先）为**脚本**
  创建的每个单位找到 —— 没有它，一个被卖掉的英雄没有身体，命令卡也是空的。地图的脚本
  也可以是 **LUA**（`war3map.lua`），而它之所以是一个前端而不是第二个引擎，是因为**
  语言**不同而 API 相同：这样的脚本调用的每个名字都是引擎 native、来自安装目录自己的
  `blizzard.j` 的 BJ（Test of Faith Reborn 调用 `IsUnitAliveBJ` 381 次），或一个
  common.j 常量。所以 `src/compat/lua/` 是一个 Lua 状态，其 `_G` 解析进运行中的 JASS
  运行时 —— 一个 JASS 全局**实时**读取且从不缓存（blizzard.j 不断重写
  `bj_lastCreatedUnit`），一个句柄作为驻留的**LIGHT USERDATA** 使 Lua 的 `==` 就是句
  柄身份，一个按名字注册进 `Runtime.hostFunctions` 的 Lua 函数使 `code` 值在下游保持
  不变，而一次 WAIT 作为协程让出，它能精确嵌套是因为解释器的线程协议已经按**秒**让出。
  Lua 地图需要两样 JASS 不需要的东西：`__jarray`（数组是读取其类型默认值的表）与
  ** `FourCC`**（JASS 写 `'hfoo'` 而 Lua 不能）—— 后者用 JS 实现，使其符号与词法器一
  致。沙箱是**封闭**的（移除 `io`、`os`、`load`、`require`）：地图是不可信内容。它是
  一个**动态导入**，所以从不打开 Lua 地图的玩家永远不会下载 Lua 解释器，而
  `preloadScriptHost` 在脚本运行前一个 await 处取它，因为 `loadMapScript` 必须保持同
  步。
- **Extreme Candy War：** 在改动 [`src/ai/plus/candy/`](src/ai/plus/candy/) 之前，先
  读 [`docs/candy-war-ai.md`](docs/candy-war-ai.md)。它是 Computer+ 作为暴雪走廊地图
  的**英雄**玩家，当脚本拥有地图的四个触发器时由 `startCustom` 安排席位（绝不按文件
  名），只在英雄席位 0–4/6–10 上 —— 5 和 11 是地图自己的军队电脑。它通过两次选择同一
  套装扮来在 `Pick_Heroes` 中**挑选**英雄（`RtsController.selectForAi`），作为
  `MAP_CONTROL_USER` 席位呈现给**脚本**（于是地图自己的初始化给它金币、食物上限与排行
  榜行，就像给真人一样 —— 引擎不授予任何东西），而它的目标是糖果怪物（600 范围内的英
  雄会推动它；野怪从不会），不是野怪。三个陷阱：施法命令按**基础** code 匹配，而地图
  把它的法术重建在不相关的基底上，所以一切都以地图的技能 id 为键并使用该技能自己的
  `code` 施放；一个死亡英雄是幽灵，必须**走**到它的尸体或 Spirit Healer 处按下复活；
  而物品栏规则是销毁并退款的触发器，所以 AI 自己执行它们（`mayCarry`）。
- **WarChasers：** 在改动 [`src/ai/plus/warchasers/`](src/ai/plus/warchasers/) 之前，
  先读 [`docs/warchasers-ai.md`](docs/warchasers-ai.md)。它是 Computer+ 作为暴雪合
  作地下城地图的**队员**，当脚本拥有地图的触发器时由 `startCustom` 安排在英雄席位
  0/1/5/6 上（席位 11 是地下城的）。它不玩地下城 —— 它跟随一个真人（队长：最后说
  "follow me" 的人，否则第一个入座的人），在他们旁边战斗，并服从队伍的聊天（"wait"、
  "back"、"lets go"、"follow me"、"attack"，错别字也算 ——`readCommand`），而一个命令
  会覆盖它自己的休息决定。只服从**真人**，绝不服从另一个电脑。四个陷阱：八个基座触发
  器会对任何走进去的东西触发（而且并不以它们造出的英雄命名），所以 Wisp 会沿着**过道**走再转弯；一个没有 `ankh`/ `IC17` 就死掉的英雄会永久消失（`Game_Over`），所以它
  先买 Ankh 再买别的，并为它存钱；**钥匙**只在携带者手里才能开门，所以电脑从不捡钥匙；
  而当玩家驾驶 `hC25` 蒸汽坦克时，坦克就是那个躯体。法术与药水是近战 Computer+ 自
  己的（`PlusCaster`、`PlusItems.beltPass`），除了队伍的治疗（`warchasers/heal.ts`）：
  一个低于 65 % 的友方英雄会在任何单位之前被治疗，一个开口请求的真人（"heal me"、
  "hael"）会被承诺治疗及其法力，只要能在 10 秒内落地，而近战施法者被排除在两者之外（
  `CasterView.refuses`、`CastCtx.holds`）；一个召唤师会在它的召唤物**后面**风筝（
  `kitePass`），并在它们不战斗时把它们送到队伍**前面**（`summonPass`，沿前线自己的路
  线，绝不落到没人去过的刷怪小屋上）。"go ahead"、"tank"、"take the lead"把领导权交
  给**一台**电脑，力量或敏捷先于智力，持续 12–20 秒（`leadPass`）；"help" 是一条攻击
  命令。战利品与购物会为**它自己的**英雄评估物品（智力英雄会先丢力量物品）。
- **下载地图：** 在改动地图列表的下载图标（搜索框右端）或其对话框之前，先读
  [`src/ui/mapSites.ts`](src/ui/mapSites.ts) 与
  [`electron/mapSitesView.mjs`](electron/mapSitesView.mjs) 的文件头。EpicWar 是**读**的 —— 原地搜索与下载，通过桌面外壳或 dev server 在**一个**允许列表下（
  `electron/mapSites.mjs`；托管网页构建无法访问它）。Hive Workshop 与 wc3maps 位于
  Cloudflare 之后并拒绝框架嵌入，所以从不抓取它们：桌面应用在对话框的标签页上覆盖一
  个真实网页视图（每个站点一个，`persist:mapsites`），它下载的 `.w3x`/ `.w3m` 会落到
  `Maps\Download\` 并自动出现在列表里；在网页上该标签页会在新标签页打开站点，而
  Import 会把文件取回。该视图是一个独立的**表面** —— 页面报告它的视口矩形，并且必须
  在标签页或对话框消失时隐藏它。
- **运输：** 在改动 Goblin Zeppelin、运输船、货舱或货物面板之前，先读
  [`docs/transports.md`](docs/transports.md)。运输工具是 BURROW 的舱位加在一个会移动
  的躯体上（`Acar` 与 `Abun`/`Aenc` 并列，一套 `garrison` 名单），有三样东西是它自己
  的：登乘是一次**会合**（运输工具走向乘客，同时乘客走向它 —— `issueLoad`/`tickLoad`，
  右键会召来一个空闲的），舱位按**座位**衡量（`UnitData.cargoSize` —— 一个 Mortar
  Team 是两个，一台 Siege Engine 是四个），而卸下会**询问地面**（`dropSpot`：乘客能
  站的一个格，位于货舱 `Area1` 的 250 以内、在乘客的域里，所以湖上的 Zeppelin 会保留
  它的货物，而船会停在沙滩上）。Unload All（`Adro`/`Sdro`）是一个**点**命令，"at a
  target location"，每个躯体 `Dur1` = 0.5 秒；一次被拒绝的卸下会说 `Cantland`
  "Unable to land there." —— 在点击时对某个槽位说，当运输工具只在到达时才发现时则通过
  `drainRefusals` 说。
- **野怪：** 在改动 `tickCreep`、`threatTier` / `creepScore`、野怪施法者（
  [`src/ai/creeps.ts`](src/ai/creeps.ts)）或 `trySeed` 中的野怪播种之前，先读
  [`docs/creeps.md`](docs/creeps.md)。一个营地是少数几条实测的**规则**而不是数字：
  **Camp (200)** 是编辑器的索敌设置，也是大多数营地"被动"的原因；威胁阶梯把**召唤物**放在第一位，然后是任何正在**攻击**营地的东西（这是每份指南都会教的重新选目标技巧）
  ，而 7 级以上的野怪会忽略它，转而攻击射程内生命值最低的；**仇恨掉落（aggro-drop）
  **技巧会被**记住**（`SimUnit.aggroDropped`），因为它的第二步是**取消**命令，而一
  个处于战斗中的营地只会**往上**走一级 —— 一次基于完整分数重新决策的再选会把营地放回
  它刚被拉走的那个单位，因为那个单位离它最近；一个用毒者会在战斗前散开；一个休息中的
  营地会在普通移动下忽略飞行单位；Ensnare 会落在战斗开始后**进入**其射程的东西上。野
  怪只在它的营地战斗时施法 —— 治疗除外。三个接线陷阱会一次让所有野怪技能失效：地图放
  置的野怪必须**带着**它们的卡被播种（`trySeed`），`auto` 列在野怪身上命名的是**基础
  CODE**（`autoArmed`），而一个中立所有者会满足每个 `Requires`（`techMeets`）。一行
  拥有**自己** code、与我们的某个东西成孪生的野怪行是这个区域长期存在的 bug（`ACtb`
  Hurl Boulder = Storm Bolt、`ACtc` Slam = Thunder Clap、`ACdv` Devour、`ACrn`
  Reincarnation、`ANin` Inferno）—— 效果存在，而 id 永远到不了它。那里还有：Inferno
  的陨石在伤害**和**眩晕落地前会在空中停留 `Uin3` "Impact Delay"；Reincarnation 会让
  躯体离场 `Ore1` "Reincarnation Delay"，并有 `ReincarnationTarget` 站在它上面（
  `"hold"` EffectAnim：Birth、Stand、Death）；而 **Hide 会把自己藏起来** —— 一个没有
  命令站着的单位会在夜间、在该行自己的 1.5 秒 Fade Duration 之后融入 —— 而一个隐藏的
  野怪在营地被攻击时会**起身**，因为融入会被被融入单位**做了**的事情打破，而遭到伏击
  不是它做的事（`unhideCreep`，它还会收回融入让它停住的 Hold）。ENSNARE 的网按**目标**选择：**空中**或**地面**的增益行（`Bena`/`Beng`，只靠 `EditorSuffix` 区分，空中
  那个列在**前面**），以及与被命中躯体**大小**匹配的 Birth/Stand/Death 组（
  `bodySize` →`BuffFx.anim` → `sizedSeq`）。而一个友好的自动施法增益 —— Bloodlust、
  Frost Armor、Inner Fire—— 会落在**战斗中**的盟友身上，只要还有别人，就绝不落在施法
  者自己身上：Ogre Magi 会给 Ogre 加增益，自己最后一个。一个营地作为一个**单位**行动，
  它战斗中的每个野怪都为它说话（`campFightAnchor`）—— **帮手**也算，按它回应的那次
  呼救的岗位衡量，这正是呼救不会在营地间跳的原因；跳过帮手正是当拉走营地的野怪停下后
  "一个野怪在打，其余站着"的原因。一个野怪的融入无论以何种方式结束都会带着它的 Hold
  一起走（`breakInvisibility`）—— 一个在黎明时活过融入的 Hold 会让 Nightcrawler 在它
  的岗位上冻住，直到游戏结束。
- **计分屏：** 在改动 [`src/sim/matchStats.ts`](src/sim/matchStats.ts)、
  [`src/ui/scoreScreen.ts`](src/ui/scoreScreen.ts) 或 `MapViewerScene.leave` 之前，
  先读 [`docs/score-screen.md`](docs/score-screen.md)。**每次**退出都会显示它，对局中
  途也是（显示目前的统计）—— 除了 `doScoreScreen` 为 false 的退出按钮和 Exit Program
  —— 而对局一旦分出结果，**什么都不**再计数，不管 Continue Game 与否（
  `MatchStats.freeze`；时钟也在那里停止）。没有文件说明一列统计的是什么，所以规则是
  warcraft3.info 394 的，而证明它们的那个事实是：四个起始 Unit Score（
  1005/965/945/825）**精确地**来自 `UnitBalance.slk`。只有权威方计数；一个 LAN 客户端
  会在结束它这局游戏的对话框里收到表格，或者在对局中途退出时**请求**它（`scorereq`）
  —— 绝不在快照里。美术里有两个陷阱：排序高亮是黑色不透明底上的一个 **ADD** 贴图（
  `addedLight`），而 FDF 的 SCROLLBAR 如果不移除，会把面板变成一个滚动框架。
- **自动摄像机（观察者）：** 在改动
  [`src/game/autoCamera.ts`](src/game/autoCamera.ts)或观察者的复选框之前，先读
  [`docs/auto-camera.md`](docs/auto-camera.md)。**控件**是游戏的（
  `ObserverPanel.fdf` 的 `ObserverCameraCheckBox`，标签 `REPLAY_CAMERA` = "Auto
  Camera"）；它**做什么**是我们的（issue #167），每个数字都标注了这一点。让它可用的
  两条规则：一次平移后它会**保持** `MIN_HOLD` 秒，不管别处发生了什么；它通过焦点不在
  它离开的位置来察觉观察者自己的手（`confirm` 在地图钳制之后运行，否则地图边缘会被读
  成一只手）。一个**近战**开局是对每座基地的一次定时**巡游**（在 0:00 时没有任何东西
  有分量，所以它过去会锁定在最先训练出英雄的那座基地上），而超过 `SNAP_DISTANCE` 的
  目标是**切**过去而不是平移过去。`?dev&map=…&observe` 会直接启动一场被观察的对局。
- **观察者 HUD：** 在改动 [`src/ui/observerHud.ts`](src/ui/observerHud.ts)、
  [`src/game/observerView.ts`](src/game/observerView.ts) 或 `WorldSnapshot.watched`
  之前，先读 [`docs/observer-hud.md`](docs/observer-hud.md)。观察者没有控制台：生产/
  军队/升级在左上，奖章两侧各有一个记分板，底部是小地图 + 四列英雄面板 + 精简选择（
  issue
  #168；**布局**是开发者的选择，部件是游戏的）。每个面板都是按命令提示框方式绘制的提示
框框架（填充 = 元素，描边向它**外面**拉 `--tt-bg-inset`）；把填充裁剪到边框盒会在两
者之间留下一圈地图。一个玩家的负载只携带**它自己的**银行、研究和死亡英雄，所以一个
LAN 观察者从自己的通道读取所有人的（`watched`，只为旁观席位构建）。APM 在
`Authority.execute` 统计，是我们的（一分钟窗口）。
- **手柄：** 在改动 [`src/ui/gamepad.ts`](src/ui/gamepad.ts) 或一条 `:hover` 规则之
  前，先读 [`docs/gamepad.md`](docs/gamepad.md)。WC3 没有手柄支持，所以**映射**是开
  发者的（issue #162），但一个按钮做什么是游戏的：一个带按键的按钮**就是**那个键（O
  Escape、Triangle Space、L1 "-"、R2 F8、Start F10 —— 过场动画期间的 Escape 会跳过它
  ——Select F9），而摇杆与 X/R1 是一个绘制的光标，用 `pointerId: 1` 派发真实指针事件，
  所以每个现有门控原样适用。`:hover` 看不到那个光标：要问 `isHovered(el)`，并给悬
  停辉光一个 `.pad-hover` 孪生类。操作系统指针由页面上一个透明的 `#gamepad-veil` 隐
  藏，绝不是全局 `cursor: none`：绘制的光标**读取**页面的 `cursor:` 值，所以一条全局
  规则会把它也隐藏掉。D-pad 用金色框遍历每个**菜单**（`FOCUSABLE`，从页面读取：可见、
  启用、在中心点位于最上层 —— 一种新的可点击控件需要加进那里），并且只在没有菜单或
  对话框的对局中驱动命令卡。
- **语音控制：** 在改动 [`src/voice/`](src/voice/) 或 `game/voiceActions.ts` 之前，
  先读 [`docs/voice-control.md`](docs/voice-control.md)。按住 "." 说话；它从头到尾都
  是**我们的**，循环里**没有**语言模型：Whisper（仅 small.en —— 曾尝试并移除了
  base.en "Fast" 下拉框 —— 由 Options 行的下载获取，transformers.js worker 中的 int8
  ONNX）转写，用屏幕上的名字做**预置**，而一个确定性解析器把文本 —— 容忍同音拼写 ——
  映射到点击/热键路径上，所以它无法作弊。ONNX 运行时是打包的，绝不从 CDN 获取，并且
  只在跨源隔离的页面上多线程运行（dev server 与 `electron/server.mjs` 会发送
  COOP/COEP）：单线程每条命令 4.7 秒，八线程 1.4 秒。"Here" 是**屏幕**中央（只有说出
  来时才用鼠标）。它开着时，我们的单位戴着**名字标签**（"Fiend 4"，每个单位一个编号，
  仅在同类单位有两个或以上时显示），这样就可以说出一个躯体，而 "," 切换一个提示框；
  对军队说出的命令会随摄像机跟随它的第一个英雄。"Gather" 会询问模拟的工人档案，绝
  不是"它是不是工人"（Ghoul）。
- **触摸手势控制台：** 在改动 [`src/ui/gesture/`](src/ui/gesture/) 或 Android 壳的资产桥之
  前，先读 [`docs/gesture-control.md`](docs/gesture-control.md)。手势是第三个外部输入
  Host（仿 `GamepadMatchHost` / `VoiceHost`）：识别器只产出 `GestureIntent`，动作全部落到
  `runCommand` / `selectAt` / `orderClickAt` / `moveAt` / `midPan` / `setZoomStop` 这些鼠标
  已在用的门上，**不新增 `Command`、不碰 `Authority.execute`、不改 flavor 数据线**；SD 与
  HD 共用一套识别与动作，唯一按美术变化的是底部禁区 `consoleTop`。关闭总开关时一个监听都
  不注册，**打开需要重载**（识别器在启动时决定是否挂监听）。Android 的资产来源是 SAF 目录
  授权 + `shouldInterceptRequest` 的虚拟安装（`ow3native` 页桥），APK 不含任何暴雪资产。
- **永远不要编辑安装目录的 UI 文件。** `UI\FrameDef\` 是玩家的。Warcraft Open 需要而
  2003 年的 UI 没有框架的控件放进 [`src/overrides/`](src/overrides/) —— 我们自己的
  FrameDef 文件，在挂载时通过 `mountFdfScreen` 的 `overrides` 选项分层到界面上 —— 它
  的 README 就是契约。
- **玩法常量只住在一个地方。** 游戏自己保存在 `Units\MiscGame.txt` /
  `Units\MiscData.txt` / `Scripts\Blizzard.j` 里的每个数字都属于
  [`src/data/gameplayConstants.ts`](src/data/gameplayConstants.ts)，放在它**确切的文
  件键**下（`MISC_GAME.GuardDistance`、`MELEE.MELEE_STARTING_GOLD_V1`）。永远不要在
  用处把这样的值重新输入成字面量，也永远不要手工抄写游戏派生出来的东西 —— 伤害表与经
  验曲线由原始 `DamageBonus*` 列表和 `f(x) = A·f(x-1) + B·x + C` 公式计算，所以它们
  不会漂移。
- **封闭的 SLK 域是枚举**，不是字符串 —— [`src/data/enums.ts`](src/data/enums.ts) 中
  的 `AttackType`、`ArmorType`、`WeaponType`、`MoveType`、`PrimaryAttribute`、
  `PlayerSlot`。在 SLK 边界解析一次（`toAttackType(...)`），然后让编译器携带它。一个
  字符串类型的 `atkType1` 会悄悄退化成 1.0 倍乘数。
- 匹配周围代码的注释密度与习惯 —— 这个代码库内联记录*为什么*（以及它的 WC3 来源）。
