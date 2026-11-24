#!/usr/bin/env node
/**
 * 桌面端发布构建准备脚本
 *
 * 生成 `src-tauri/tauri.release.conf.json`，作为 `tauri build --config <file>` 的
 * 增量配置注入 updater 端点与公钥。
 *
 * 为什么不在 tauri.conf.json 里写死：
 *   Tauri v2 不支持在 tauri.conf.json 中用 $VAR 由 CLI 展开 —— 官方只有
 *   平台配置文件（tauri.<platform>.conf.json）、--config 参数、以及 CLI 专用
 *   环境变量三条途径，TAURI_ENV_* 只注入 hook 命令、不参与插值。
 *   本项目至今没有固定域名，任何写死的端点都会在某次构建里变成错误事实
 *   （历史上这里曾写着一个 DNS 根本不解析的发布域名，就是这么来的）。
 *
 * 环境变量（都在 CI 里配仓库 Variables，不是 Secrets —— 这些都不是机密）：
 *   CORPS_SHELL_MODE       embedded（默认，内嵌 Next.js sidecar）或 remote（WebView 直连 CORPS_WEB_URL）
 *   CORPS_WEB_URL          remote 模式必填；只接受 https，或 localhost/127.0.0.1 的 http
 *   CORPS_UPDATER_ENDPOINT updater 清单地址，可含 {{target}}/{{arch}}/{{current_version}}
 *   CORPS_UPDATER_PUBKEY   tauri signer generate 产出的 .key.pub 内容
 *
 * 行为：
 *   embedded + updater 成对 → 写 updater 覆盖配置（启用自动更新）
 *   embedded + updater 缺失 → 写 {}（自动更新关闭，构建照常通过）
 *   remote  + CORPS_WEB_URL → 写窗口 URL 并强制关闭 updater
 *   任何模式混淆/地址缺失/只设 updater 一半 → exit 1，构建红（不静默降级）
 *
 * 注意：本脚本**无条件写文件**。`--config <path>` 要求文件存在，哪怕内容是 {}。
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReleaseConfig } from './release-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '../src-tauri/tauri.release.conf.json');

const SHELL_MODE = process.env.CORPS_SHELL_MODE?.trim() || 'embedded';
const WEB_URL = process.env.CORPS_WEB_URL?.trim();
const ENDPOINT = process.env.CORPS_UPDATER_ENDPOINT?.trim();
const PUBKEY = process.env.CORPS_UPDATER_PUBKEY?.trim();

let releaseConf;
try {
  releaseConf = buildReleaseConfig({
    mode: SHELL_MODE,
    webUrl: WEB_URL,
    updaterEndpoint: ENDPOINT,
    updaterPubkey: PUBKEY,
  });
} catch (e) {
  console.error('');
  console.error(`[prepare-release] FATAL: ${e.message}`);
  console.error('');
  console.error('shell 模式与 updater/Web URL 必须自洽：');
  console.error('  - CORPS_SHELL_MODE 只接受 embedded 或 remote');
  console.error('  - remote 必须显式 CORPS_WEB_URL（https，或 localhost/127.0.0.1 的 http）');
  console.error('  - embedded 不得设置 CORPS_WEB_URL');
  console.error('  - embedded 启用自动更新时，CORPS_UPDATER_ENDPOINT 与 CORPS_UPDATER_PUBKEY 必须成对');
  console.error('  - remote 保持手动分发，updater 端点/公钥不得设置');
  console.error('');
  process.exit(1);
}

console.log(`[prepare-release] shell mode = ${SHELL_MODE}`);
if (SHELL_MODE === 'remote') {
  console.log(`[prepare-release] remote url = ${WEB_URL}`);
  console.log('[prepare-release] 自动更新：关闭（remote 模式手动分发）');
} else if (ENDPOINT && PUBKEY) {
  console.log('[prepare-release] 自动更新：启用');
  console.log(`[prepare-release] endpoint = ${ENDPOINT}`);
} else {
  console.log('[prepare-release] 自动更新：关闭（未配置 CORPS_UPDATER_ENDPOINT / CORPS_UPDATER_PUBKEY）');
}

writeFileSync(outPath, JSON.stringify(releaseConf, null, 2) + '\n', 'utf8');
console.log(`[prepare-release] Wrote ${outPath}`);
