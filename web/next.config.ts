import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 游戏页是单独构建的静态包（仓库根的 `npm run build:web`，base 为 /play/），复制到
  // `public/play/` 后由这里把 `/play` 指到它的入口；正式环境同样由 Web 服务器挂在 /play/。
  async rewrites() {
    return [{ source: "/play", destination: "/play/index.html" }];
  },
  // The UI kit (packages/ui) ships TypeScript source, not a build.
  transpilePackages: ["@warcraft-open/ui"],
  // ali-oss is CommonJS with its own dynamic requires; let Node load it instead of bundling it.
  serverExternalPackages: ["ali-oss"],
  // This folder is its own project with its own lockfile (the repo root holds the game's), and
  // the kit is hard-linked INTO node_modules here, so nothing it builds lives above this folder.
  turbopack: { root: __dirname },
};

export default nextConfig;
