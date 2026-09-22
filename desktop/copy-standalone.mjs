/**
 * copy-standalone.mjs
 *
 * 在 `pnpm build`（Next.js standalone 输出）后执行，将 standalone server 及其
 * 静态资源复制到 Tauri 的 resources 目录，使其被打包进最终二进制。
 *
 * 源目录（相对于 web/ 工作目录）：
 *   - web/.next/standalone/   → Next.js standalone server（含 server.js）
 *   - web/.next/static/       → 静态资源（JS/CSS/字体等）
 *   - web/public/             → 公共静态文件
 *
 * 目标目录：
 *   - desktop/src-tauri/resources/standalone/          ← standalone server 根
 *   - desktop/src-tauri/resources/standalone/.next/static/  ← 静态资源
 *   - desktop/src-tauri/resources/standalone/public/        ← 公共文件
 *
 * 另外在 desktop/dist/ 创建占位 index.html，Tauri 需要 frontendDist 目录存在。
 *
 * 用法：node ./copy-standalone.mjs（从 desktop/ 目录调用）
 *      或 node ../desktop/copy-standalone.mjs（从 web/ 目录调用，beforeBuildCommand 场景）
 */

import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 解析项目根路径：此脚本位于 desktop/ 目录下
const desktopDir = __dirname;
const projectRoot = resolve(desktopDir, "..");
const webDir = resolve(projectRoot, "web");
const srcTauriDir = resolve(desktopDir, "src-tauri");

// 源路径
// Next.js 16+ standalone 输出结构：.next/standalone/<项目名>/server.js
// 需要检测是否存在子目录（项目名），兼容新旧两种结构<projectname>
const standaloneRoot = resolve(webDir, ".next", "standalone");
const standaloneProjectDir = resolve(standaloneRoot, "web");
const standaloneSrc = existsSync(resolve(standaloneProjectDir, "server.js"))
  ? standaloneProjectDir
  : standaloneRoot;
const staticSrc = resolve(webDir, ".next", "static");
const publicSrc = resolve(webDir, "public");

// 目标路径
const resourcesDir = resolve(srcTauriDir, "resources");
const standaloneDest = resolve(resourcesDir, "standalone");
const staticDest = resolve(standaloneDest, ".next", "static");
const publicDest = resolve(standaloneDest, "public");
const distDir = resolve(desktopDir, "dist");

/**
 * 递归复制目录，先清空目标再复制，确保无残留旧文件。
 * @param {string} src - 源目录绝对路径
 * @param {string} dest - 目标目录绝对路径
 * @param {string} label - 日志标签
 */
function copyDir(src, dest, label) {
  if (!existsSync(src)) {
    console.warn(`⚠️  [copy-standalone] 源目录不存在，跳过: ${src}`);
    return;
  }
  // 清空目标目录（若存在）
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`✅ [copy-standalone] ${label}: ${src} → ${dest}`);
}

console.log("━━━ copy-standalone: 开始复制 Next.js standalone 资源 ━━━");

// 1. 复制 standalone server（含 server.js、node_modules 等）
copyDir(standaloneSrc, standaloneDest, "standalone server");

// 2. 复制 .next/static 静态资源
copyDir(staticSrc, staticDest, "static assets");

// 3. 复制 public 公共文件
copyDir(publicSrc, publicDest, "public assets");

// 4. 在 desktop/dist/ 创建占位 index.html（Tauri 需要 frontendDist 存在）
mkdirSync(distDir, { recursive: true });
const placeholderHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Corps</title>
  <style>
    body { margin: 0; padding: 40px; font-family: system-ui, -apple-system, sans-serif; }
    p { color: #666; }
  </style>
</head>
<body>
  <p>Loading Corps…</p>
  <p>The Next.js standalone server is starting. If this page persists, please restart the application.</p>
</body>
</html>
`;
writeFileSync(resolve(distDir, "index.html"), placeholderHtml, "utf8");
console.log(`✅ [copy-standalone] placeholder index.html → ${resolve(distDir, "index.html")}`);

// 5. 验证 server.js 存在
const serverJs = resolve(standaloneDest, "server.js");
if (!existsSync(serverJs)) {
  console.error(`❌ [copy-standalone] 警告: ${serverJs} 不存在！`);
  console.error("   请确认 web/ 的 next.config.ts 中已配置 output: 'standalone'。");
  process.exit(1);
}

console.log("━━━ copy-standalone: 复制完成 ━━━");