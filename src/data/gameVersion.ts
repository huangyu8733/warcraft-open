// 当前挂载安装的精确构建版本，只服务于一个地方：HD 房间的 `gameVersion`。
//
// SD 不需要比较构建号——版本闸已经把数据钉在 1.30.4（或降级后的 1.31.1）；Reforged 各补丁
// 之间有平衡改动，所以 HD 对局必须精确同版本（SD-HD双版本方案.md §3.4）。
//
// 由 `mountInstall` 在挂载完成时写入（src/main.ts），`net/lobby.ts` 建房 / 加入时读取。
// 没挂载过（启动器阶段）就是 null。

let current: string | null = null;

export function gameVersion(): string | null {
  return current;
}

export function setGameVersion(version: string | null): void {
  current = version;
}
