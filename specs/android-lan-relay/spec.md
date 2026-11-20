# 安卓内嵌中继：让手机成为局域网主机

## 1. 问题

安卓 App 是一个窗口，页面来自 `https://warcraft.hhkj.me/play/`（[MainActivity.java](file:///Users/huangyu/魔兽/开源魔兽争霸/android/app/src/main/java/me/hhkj/warcraft/MainActivity.java#L69-L71)）。
页面里的中继地址只有一个来源：同源的 `wss://warcraft.hhkj.me/relay`（[transport.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/net/transport.ts#L20-L35)）。

因此手机：

- 只能连**云端**中继开房，没有外网就完全不能联机；
- 同处一个 WiFi 的两台设备，流量也要绕一圈公网；
- 不能像桌面 App 那样在本机 8787 端口既开页面又开中继（`electron/server.mjs`）。

桌面端的两块拼图手机都缺：**一个本机中继**，以及**把中继地址交给页面的那条桥**
（`ow3native.servers()` / `onServers`，当前在 [MainActivity.java](file:///Users/huangyu/魔兽/开源魔兽争霸/android/app/src/main/java/me/hhkj/warcraft/MainActivity.java#L973-L974) 返回空）。

## 2. 目标

1. APK 内嵌一个 WebSocket 中继，监听 `0.0.0.0:8787`（被占用时顺延），完整实现
   [rooms.mjs](file:///Users/huangyu/魔兽/开源魔兽争霸/server/rooms.mjs) 的协议语义，`PROTOCOL_VERSION = 14`。
2. 通过注入的 `ow3native` 桥把 `ws://<手机局域网 IP>:<端口>/relay` 作为**发现的服务器**交给页面，
   页面的 `lobby.setDiscovered()` 会把它当 `found` 源接进来（[main.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/main.ts#L579-L589)）。
3. 允许 `https` 页面连 `ws://` 本机地址（混合内容），否则握手在 WebView 层就被拦掉。
4. 「创建游戏」的服务器菜单在安卓上**默认选中**这台手机自己的中继；PC / 另一台手机
   用 `ws://<手机 IP>:8787/relay` 加入，开局、名单、转发全部走局域网。

## 3. 非目标

- **UDP beacon 自动发现**：桌面 App 仍靠输入地址加入手机；beacon 留作后续（`electron/beacon.mjs` 协议届时对齐）。
- 安卓在线升级、云端中继改动、iOS。
- 独立进程 / 前台服务：中继活在 Activity 生命周期内，进程被杀则房间消失——与桌面关掉窗口一致。
- 端口可配置、TLS（局域网内 `ws://`，页面侧由混合内容开关放行）。

## 4. 设计决定

| # | 决定 | 理由 |
|---|------|------|
| D1 | Java 手写 RFC 6455 服务端，不新增 Gradle 依赖；JSON 用 `org.json`（Android 自带） | 构建长期 `--offline`，引第三方库会破坏这条路径 |
| D2 | 拆三个类：`RelayCore`（纯逻辑，无 socket）、`WsConnection`（握手/帧/心跳）、`LanRelay`（监听/连接表/地址/生命周期） | 与 `server/rooms.mjs` + `server/wsAdapter.mjs` 的分层一一对应，语义可逐条对照 |
| D3 | 端口 `8787`，占用则试 `8788..8797`，全占则用系统临时端口；真实端口写进 URL | 与桌面中继同端口，玩家少记一个数 |
| D4 | 地址 = `NetworkInterface` 枚举出的非回环 IPv4（含热点 `ap0` 的 `192.168.43.1`）`ip:port`；一个都没有时回退 `127.0.0.1:<端口>` | 热点场景不需要路由器也能当主机；不需要任何额外权限（不要用 `WifiManager`，新系统要定位权限） |
| D5 | 每个连接握手时现算 `host`：`{kind:"app", lan:true, addresses:[...]}` | 与 `server/hostInfo.mjs` 的 `HostInfo` 同形；WiFi 切换后新连接立刻拿到新地址 |
| D6 | 页面桥 `servers()` 同步读 `native.relayServers()`；`onServers()` 注册回调并**每 3 秒**轮询，JSON 变过才回调 | `onServersFound` 只在启动时调用一次（`src/main.ts`），启动时中继可能还没 bind 好；WiFi 换 IP 也要能反映 |
| D7 | `WebSettings.setMixedContentMode(MIXED_CONTENT_ALWAYS_ALLOW)` | 页面是 https，中继是 ws:// 局域网地址 |
| D8 | `onCreate` 后台线程 `start()`，`onDestroy` `stop()` | 不阻塞首帧；Activity 销毁即释放端口 |
| D9 | 安卓平台 + 存在 `found` 目标时，「创建游戏」默认选它（只改默认选中，不改 `hostTargets` 顺序） | 不把游戏默认开到云端；桌面端行为零变化 |
| D10 | 协议号三处同步：`protocol.ts` / `rooms.mjs` / `LanRelay.java`，并在 `tools/relay-test.mjs` 的版本检查里加上 Java | 漂移会让所有联机死掉且难查 |
| D11 | 单帧上限 8 MiB，超出直接断开 | 64 位长度字段可以要求任意大分配，是外部输入边界 |

## 5. 协议移植清单（逐条对齐 rooms.mjs）

### 5.1 常量与形状

- `PROTOCOL_VERSION = 14`
- `HOLD_MS = 120_000`，`DROPPED = "You were dropped from the game."`
- `roomInfo`：`id, name, hostName, mapName, mapPath, players, maxPlayers, observers, edition, speed, flavor, gameVersion`
- `peerInfo`：`id, name, host`
- token = `UUID.randomUUID().toString()`

### 5.2 收到的消息

| `t` | 行为（与 rooms.mjs 相同） |
|-----|--------------------------|
| `list` | 回 `rooms` |
| `create` | 已在房间→`error "Already in a game."`；否则建房、`nextPeerId=2`、发 `created`、广播 `rooms` |
| `join` | 已在房间→同样报错；房间不存在→`"That game is no longer available."`；flavor 不符→`"That game is on a different version line (SD/HD)."`；HD 版本不符→`"That game needs Reforged <v>."`；token 命中被 hold 的槽→原地重连（`joined` + 对他人 `peer-rejoin`）；有 token 无槽→`DROPPED`；满员→`"That game is full."`；否则新 peer（`joined` + 对他人 `peer-join`），随后广播 `rooms` |
| `leave` | 立即自由槽位；主机离开或房间空→`room-closed` + 删房 |
| `seat` | 只看 token：`{t:"seat", held, left}` |
| `abandon` | 释放被 hold 的槽，对他人 `peer-leave`；房空则删房 |
| `drop` | 仅主机、仅对被 hold 的槽：释放并发 `peer-leave` |
| `relay` | 不在房间→`"Not in a game."`；`to` 是数字且目标有活连接才发，`null` 静默跳过；否则广播给房内其他活 peer |
| 其它 | `Unknown message: <t>` |
| JSON 解析失败 | `"Malformed message."` |

### 5.3 断线

- 主机断、或房间已无其他活连接 → `room-closed`（reason 分别 `"The host left the game."` / `"Empty."`）+ 删房 + 广播 `rooms`
- 非主机断 → 标记 `disconnected`、`conn=null`、`droppedAt=now`，对房内发 `peer-drop{peerId,holdMs}`；`holdMs` 后若仍未回来：从房间删掉，其他人收 `peer-leave`，广播 `rooms`
- 定时器用 `ScheduledExecutorService`，重连/`drop`/`abandon`/`leave` 时要取消

### 5.4 心跳

每 15 秒对每个连接发 ping；上一轮 ping 仍未收到 pong 的连接直接关闭（触发断线逻辑）。收到 pong 清除标记。
客户端发来的 ping 回 pong；close 帧回 close 并结束读循环。

## 6. 线上细节（WsConnection）

- 请求必须是 `GET` 且带 `Upgrade: websocket`、`Sec-WebSocket-Key`；回应
  `101 Switching Protocols` + `Upgrade: websocket` + `Connection: Upgrade` +
  `Sec-WebSocket-Accept = base64(SHA1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))`。
  路径不做限制（客户端用 `/relay`）。
- 不协商任何扩展（不回 `Sec-WebSocket-Extensions`），即不使用 permessage-deflate。
- 读：支持 7/16/64 位长度、客户端掩码、分片（continuation）拼接；文本帧 `UTF-8` 交给核心；二进制帧忽略。
- 写：服务端帧不加掩码；`sendText` 对输出流加锁，广播与心跳可并发调用。
- 关闭：`close()` 发 close 帧后关 socket；`terminate()` 直接关 socket。
- 帧上限：`> 8 MiB` 关闭连接。

## 7. 文件变更

### 新增

1. `android/app/src/main/java/me/hhkj/warcraft/RelayCore.java`
   - 与 `server/rooms.mjs` 一一对应：`Map<String,Room>`、`Set<Conn>`、`nextRoomId`。
   - 所有公开方法 `synchronized`（读线程与定时器线程都会进来）。
   - `interface Conn { void send(Object msg); }`（用 `JSONObject` 构造消息）、`interface DescribeHost { JSONObject describe(); }`。
   - `connect/disconnect/leaveRoom/handle/listing/broadcastRooms/inRoom` 同名。
   - `shutdown()`：取消所有 hold 定时器、清空表。

2. `android/app/src/main/java/me/hhkj/warcraft/WsConnection.java`
   - `WsConnection(Socket, Listener)`，`Listener { onOpen(WsConnection); onText(WsConnection,String); onClose(WsConnection); }`
   - `start()` 起读线程；`sendText(String)`；`ping()`；`close()`；`terminate()`。
   - 内部维护 `awaitingPong`（`volatile`）供 `LanRelay` 心跳扫描。

3. `android/app/src/main/java/me/hhkj/warcraft/LanRelay.java`
   - `static final int PROTOCOL_VERSION = 14;`（注释：必须与 `src/net/protocol.ts`、`server/rooms.mjs` 同步）
   - `start()`：后台线程 bind `0.0.0.0`（8787→8788…8797→0），成功后在 logcat 打 `relay listening on <port>`；accept 循环为每个 socket 建 `WsConnection`。
   - `stop()`：关 ServerSocket、关闭全部连接、停心跳与 hold 线程池。
   - `int port()`、`List<String> addresses()`（`ip:port`）、`List<String> urls()`（`ws://ip:port/relay`）。
   - `hostInfo()`：`{kind:"app",lan:true,addresses}`，每次调用现算。

### 修改

4. `MainActivity.java`
   - 字段 `private volatile LanRelay lanRelay;`
   - `onCreate`：`settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);`；
     `lanRelay = new LanRelay(); new Thread(lanRelay::start, "lan-relay").start();`
   - `onDestroy`：`if (lanRelay != null) lanRelay.stop();` 后 `super.onDestroy()`。
   - `Bridge` 新增：
     ```java
     @JavascriptInterface
     public String relayServers() { /* JSONArray [{"id":"android-lan","url":"ws://…"}] */ }
     ```
     中继未起或异常时返回 `"[]"`。
   - `PAGE_BRIDGE` 尾部替换两行：
     ```js
     "    servers: function () { return Promise.resolve(parse(native.relayServers(), [])); },",
     "    onServers: function (fn) {",
     "      var last = null;",
     "      function tick() {",
     "        var now = parse(native.relayServers(), []);",
     "        var key = JSON.stringify(now);",
     "        if (key !== last) { last = key; fn(now); }",
     "      }",
     "      tick();",
     "      var timer = setInterval(tick, 3000);",
     "      return function () { clearInterval(timer); };",
     "    }",
     ```

5. `src/ui/hd/lanCreate.ts`
   - 引入 `import { touchDevice } from "../gesture/device";`
   - `target()` 在“记住的 server 命中”之后、官方兜底之前插入：
     ```ts
     if (touchDevice().platform === "android-webview") {
       const lan = targets.find((x) => x.kind === "found");
       if (lan) return lan;
     }
     ```
   - 其余不变（`hostTargets` 顺序、标签、下拉禁用条件都不动）。

6. `tools/relay-test.mjs`
   - 在 `clientProtocol` 之后读 `LanRelay.java` 的 `PROTOCOL_VERSION` 并断言三者一致。

## 8. 验证

1. **编译**：`cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew --offline :app:assembleRelease`。
2. **中继协议自测（不需要真机 UI）**：
   - `adb install -r android/app/build/outputs/apk/release/app-release.apk`，启动 App；
   - `adb logcat -s WarcraftOpen` 看到 `relay listening on 8787`；
   - `adb forward tcp:8787 tcp:8787`，用 `node` + `ws`（已在 devDependencies）跑一段脚本：
     hello（`protocol=14`，`host.addresses` 非空）→ `list` → `create` 得 `created` →
     第二个连接 `join` 得 `joined`，房主收 `peer-join` → `relay` 双向 `deliver` →
     客户端断开，房主收 `peer-drop` → 带 token 重连收 `peer-rejoin` → 房主断开，另一方收 `room-closed`。
   - `npm run relay:test` 通过（含新的 Java 协议号检查）。
3. **真机联机**：手机开 WiFi（或热点），创建游戏时“服务器”默认是该手机地址；PC 桌面 App
   在局域网屏幕输入手机地址加入，双方在同一房间、可开始游戏；对局中手机断开→PC 收 `room-closed`。
4. **回归**：HD ☰ 快捷菜单仍正常；不选局域网服务器时，云端房间列表仍可浏览/加入。

## 9. 风险

- WebView 对 `https` → `ws://` 的混合内容放行是本次唯一“平台开关”依赖；若个别 ROM 仍拦截，需在页面侧给出可读错误（现有 `noRelay(url)` 文案已覆盖）。
- 部分 OEM 的 `NetworkInterface` 可能不列热点接口；此时回退到 WiFi 地址或 loopback，真机验证时确认。
- `targetSdk 34` 不受 Android 16 局域网权限影响；未来升到 36 需补该权限。
- 中继与页面同进程：App 被系统回收时房间消失，属已接受的取舍。
