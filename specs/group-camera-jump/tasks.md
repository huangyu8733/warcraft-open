# Tasks：点击编队镜头居中（含线上更新）

- [x] T1 修改 `src/render/mapViewer.ts` 手势宿主 `group` 的 `recall` 分支：
      召回成功且 `jump` 时，先 `cameraLock = false`、`groupFollow = false`、`releaseCameraRide()`，
      再 `jumpToSelection()`（与 `focusSelection` 同语义）。
- [x] T2 校验：`./node_modules/.bin/tsc --noEmit -p tsconfig.json`、
      `npm run --silent gesture:test`、`npm run --silent cycles`。
- [x] T3 构建：`npm run build:web`（base `/play/`），记录新的入口资产 hash。
- [x] T4 部署到 `120.26.173.20`：
      - `ssh -i ~/.ssh/id_jrbzw_deploy -o IdentitiesOnly=yes root@120.26.173.20`
      - 上传 `dist/` → `/var/www/warcraft/play.new`
      - 备份现有 `play` 到 `/root/backup-warcraft-play-<ts>.tar.gz`
      - `mv play play.old-<ts>; mv play.new play`
      - `chown -R 501:games /var/www/warcraft/play && chmod -R a+rX /var/www/warcraft/play`
- [x] T5 线上验证：
      - `curl -s https://warcraft.hhkj.me/play/ | grep assets/index-`
      - 新 JS 200，且其中 `"recall"` 调用带 `jump`（压缩后形如 `group("recall",i,!0)` 或等价）
      - 浏览器打开 `/play/`，SD/HD 按钮可见，控制台无报错
- [x] T6 汇报：本机手势模式点编队实测由用户确认；若仍不跳，再排查跟随锁定与 `selectionAnchor`。
