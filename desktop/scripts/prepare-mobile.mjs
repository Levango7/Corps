#!/usr/bin/env node
/**
 * 移动端构建准备脚本
 *
 * 功能：
 * 1. 从 CORPS_WEB_URL 环境变量读取远程 URL（**必填，无默认值**）
 * 2. 更新 tauri.android.conf.json / tauri.ios.conf.json 中的 url
 * 3. 更新 HarmonyOS Index.ets 中的 CORPS_URL 常量
 *
 * 用法：
 *   CORPS_WEB_URL=https://app.example.com node prepare-mobile.mjs
 *
 * 为什么没有默认值：
 *   APK/IPA 一旦产出就分发到用户手机，壳内的远程 URL 无法事后召回。
 *   构建期是唯一能拦住「指向错误站点」的时点，因此这里 fail loud。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcTauriDir = resolve(__dirname, '../src-tauri');
const harmonyosDir = resolve(__dirname, '../harmonyos');

const WEB_URL = process.env.CORPS_WEB_URL?.trim();

// --- 必填校验：未设置 CORPS_WEB_URL 直接失败 ---
// 不要在这里补任何兜底域名。历史上这里兜底到一个不属于本项目的第三方域名，
// 导致移动端壳在生产环境加载了别人的站点；此类产物分发后不可逆。
if (!WEB_URL) {
  console.error('');
  console.error('[prepare-mobile] FATAL: 环境变量 CORPS_WEB_URL 未设置。');
  console.error('');
  console.error('移动端壳（Android APK / iOS IPA / HarmonyOS）的 WebView 会加载这个 URL，');
  console.error('产物一旦分发到用户设备就无法召回。此处刻意不提供兜底域名 ——');
  console.error('写死任何占位域名都可能在某次构建里被当成生产地址发货。');
  console.error('');
  console.error('请按你的场景二选一设置后重试：');
  console.error('');
  console.error('  1) 本地开发 / 手动构建 —— 在命令里直接给：');
  console.error('       CORPS_WEB_URL=https://app.example.com node scripts/prepare-mobile.mjs');
  console.error('     （Windows PowerShell：');
  console.error('       $env:CORPS_WEB_URL="https://app.example.com"; node scripts/prepare-mobile.mjs）');
  console.error('     该地址必须是你自己可控、且已部署本应用 web/ 的环境；');
  console.error('     https://<host>/api/health 应返回本应用的健康响应。');
  console.error('');
  console.error('  2) CI（.github/workflows/mobile-build.yml）—— 配仓库变量，不要写进 workflow：');
  console.error('       Settings → Secrets and variables → Actions → Variables → New repository variable');
  console.error('       名称：CORPS_WEB_URL');
  console.error('       值：本应用实际对外服务的地址');
  console.error('     workflow 的 env 已从 vars.CORPS_WEB_URL 读取，配好后无需改代码。');
  console.error('     手动触发（workflow_dispatch）时也可用 corps_web_url 入参临时覆盖。');
  console.error('');
  process.exit(1);
}

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
// --- 创建占位 frontendDist ---
// Tauri 要求 frontendDist 指向有效目录（即使移动端用远程 URL）
// desktop/dist/ 被 .gitignore 忽略，CI 中需要手动创建
const distDir = resolve(__dirname, '../dist');
const distIndex = resolve(distDir, 'index.html');
if (!existsSync(distIndex)) {
  mkdirSync(distDir, { recursive: true });
  writeFileSync(
    distIndex,
    '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>Corps</title></head>\n<body>\n' +
      '<p>Loading Corps...</p>\n' +
      `<script>window.location.href='${WEB_URL}';</script>\n` +
      '</body></html>\n',
    'utf8'
  );
  console.log('[prepare-mobile] Created placeholder dist/index.html');
}