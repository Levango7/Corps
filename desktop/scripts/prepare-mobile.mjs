#!/usr/bin/env node
/**
 * 移动端构建准备脚本
 *
 * 功能：
 * 1. 从 CORPS_WEB_URL 环境变量读取远程 URL（默认 https://corps.com）
 * 2. 更新 tauri.android.conf.json / tauri.ios.conf.json 中的 url
 * 3. 更新 HarmonyOS Index.ets 中的 CORPS_URL 常量
 *
 * 用法：
 *   CORPS_WEB_URL=https://staging.corps.com node prepare-mobile.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcTauriDir = resolve(__dirname, '../src-tauri');
const harmonyosDir = resolve(__dirname, '../harmonyos');

const WEB_URL = process.env.CORPS_WEB_URL || 'https://corps.com';

console.log(`[prepare-mobile] CORPS_WEB_URL = ${WEB_URL}`);

// --- Tauri Android/iOS 配置 ---
for (const confFile of ['tauri.android.conf.json', 'tauri.ios.conf.json']) {
  const confPath = resolve(srcTauriDir, confFile);
  try {
    const conf = JSON.parse(readFileSync(confPath, 'utf8'));
    if (conf.app?.windows?.[0]) {
      conf.app.windows[0].url = WEB_URL;
      writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n', 'utf8');
      console.log(`[prepare-mobile] Updated ${confFile}`);
    }
  } catch (e) {
    console.warn(`[prepare-mobile] Skip ${confFile}: ${e.message}`);
  }
}

// --- HarmonyOS Index.ets ---
const etsPath = resolve(harmonyosDir, 'entry/src/main/ets/pages/Index.ets');
try {
  let ets = readFileSync(etsPath, 'utf8');
  ets = ets.replace(
    /const CORPS_URL = '[^']*';/,
    `const CORPS_URL = '${WEB_URL}';`
  );
  writeFileSync(etsPath, ets, 'utf8');
  console.log('[prepare-mobile] Updated HarmonyOS Index.ets');
} catch (e) {
  console.warn(`[prepare-mobile] Skip HarmonyOS Index.ets: ${e.message}`);
}

console.log('[prepare-mobile] Done.');