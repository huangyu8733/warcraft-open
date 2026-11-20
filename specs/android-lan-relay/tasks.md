# 安卓内嵌中继：实施任务

- [x] T1 新增 `RelayCore.java`：按 `server/rooms.mjs` 逐条移植（房间表、create/join/leave/seat/abandon/drop/relay、重连 token、HOLD_MS、广播），全部方法 `synchronized`
- [x] T2 新增 `WsConnection.java`：RFC 6455 握手、7/16/64 位长度、掩码/分片、ping/pong/close、8 MiB 上限、线程安全发送
- [x] T3 新增 `LanRelay.java`：8787→8797→临时端口、accept 循环、每连接心跳 15s、地址枚举（非回环 IPv4，含热点）、`hostInfo()`、`urls()`、`start()/stop()`
- [x] T4 `MainActivity.java`：混合内容放行、`onCreate` 后台启动中继、`onDestroy` 停止、`Bridge.relayServers()`、`PAGE_BRIDGE` 的 `servers`/`onServers`（3s 轮询去重）
- [x] T5 创建游戏的默认服务器：`src/ui/hd/lanCreate.ts` 与 `src/ui/fdfLanCreate.ts`（SD/HD 两套创建界面）在 Android + `found` 目标时默认选中本机中继；已部署线上包 `index-Mz7X68NS.js`
- [x] T6 `tools/relay-test.mjs`：增加 `LanRelay.java` 的 `PROTOCOL_VERSION` 一致性检查（`npm run relay:test` 通过）
- [x] T7 编译：`JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew --offline :app:assembleRelease` 通过
- [x] T8 协议自测（真机 192.168.0.100:37671）：hello(protocol=14, host.kind=app, addresses 非空) / list / create / join / 双向 relay / 断线 peer-drop(holdMs=120000) / token peer-rejoin / 无效 token DROPPED / 主机断开 room-closed / 房间从列表消失，全部通过；页面内 `new WebSocket('ws://192.168.0.100:8787/relay')` 在 https 页面成功握手（混合内容放行生效）
- [x] T9 真机联机验证：局域网屏幕上出现 `192.168.0.100:8787 (局域网发现)`；页面 `lobby.host(...)` 在该中继建房；局域网 WebSocket 客户端 list → join 成功，手机侧 `lan.snapshot` 名单变为 2 人，离开后回到 1 人（未使用桌面 App 实例，等价线路已覆盖）
- [x] T10 回归：页面重载到新包后启动、进入局域网屏幕正常，云端中继仍处于连接状态；☰ 菜单代码本次未改动
