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
 * 环境变量（都在 CI 里配仓库 Variables，不是 Secrets —— 这两项都不是机密）：
 *   CORPS_UPDATER_ENDPOINT  updater 清单地址，可含 {{target}}/{{arch}}/{{current_version}}
 *   CORPS_UPDATER_PUBKEY    tauri signer generate 产出的 .key.pub 内容
 *
 * 行为：
 *   两个都设   → 写 updater 覆盖配置（启用自动更新）
 *   两个都没设 → 写 {}（自动更新关闭，构建照常通过）
 *   只设一个   → exit 1，构建红（配置不自洽，宁可构建失败也不静默降级）
 *
 * 注意：本脚本**无条件写文件**。`--config <path>` 要求文件存在，哪怕内容是 {}。
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '../src-tauri/tauri.release.conf.json');

const ENDPOINT = process.env.CORPS_UPDATER_ENDPOINT?.trim();
const PUBKEY = process.env.CORPS_UPDATER_PUBKEY?.trim();

// --- 自洽性校验：只允许"都设"或"都不设" ---
if (Boolean(ENDPOINT) !== Boolean(PUBKEY)) {
  const missing = ENDPOINT ? 'CORPS_UPDATER_PUBKEY' : 'CORPS_UPDATER_ENDPOINT';
  const present = ENDPOINT ? 'CORPS_UPDATER_ENDPOINT' : 'CORPS_UPDATER_PUBKEY';
  console.error('');
  console.error(`[prepare-release] FATAL: ${present} 已设置，但 ${missing} 为空。`);
  console.error('');
  console.error('updater 的端点与公钥必须成对配置：');
  console.error('  - 只给端点没有公钥 → 客户端无法验签，更新会被拒绝；');
  console.error('  - 只给公钥没有端点 → 无处拉取更新清单。');
  console.error('二者任一成立都说明配置不完整，因此这里直接让构建失败，不静默降级。');
  console.error('');
  console.error('二选一：');
  console.error('  A) 启用自动更新 —— 两个都配：');
  console.error('       Settings → Secrets and variables → Actions → Variables');
  console.error('       CORPS_UPDATER_ENDPOINT = https://<你的域名>/desktop/updater/{{target}}/{{arch}}/{{current_version}}');
  console.error('       CORPS_UPDATER_PUBKEY   = <.key.pub 文件内容>');
  console.error('  B) 不启用自动更新 —— 两个都留空（不配变量即可），本脚本会写 {}，构建照常通过。');
  console.error('');
  process.exit(1);
}

let releaseConf;

if (ENDPOINT && PUBKEY) {
  if (!/^https?:\/\/\S+$/.test(ENDPOINT)) {
    console.error('');
    console.error(`[prepare-release] FATAL: CORPS_UPDATER_ENDPOINT 不是合法的 http(s) 地址：${ENDPOINT}`);
    console.error('');
    process.exit(1);
  }
  releaseConf = {
    plugins: {
      updater: {
        endpoints: [ENDPOINT],
        pubkey: PUBKEY,
      },
    },
  };
  console.log('[prepare-release] 自动更新：启用');
  console.log(`[prepare-release] endpoint = ${ENDPOINT}`);
} else {
  // 两个都没设 → 空覆盖配置。等价于"本次构建不带 updater 覆盖"，
  // 最终生效的是 tauri.conf.json 里 endpoints: [] / pubkey: ""，即更新功能关闭。
  releaseConf = {};
  console.log('[prepare-release] 自动更新：关闭（未配置 CORPS_UPDATER_ENDPOINT / CORPS_UPDATER_PUBKEY）');
}

writeFileSync(outPath, JSON.stringify(releaseConf, null, 2) + '\n', 'utf8');
console.log(`[prepare-release] Wrote ${outPath}`);
