#!/usr/bin/env node
/**
 * Android 构建准备脚本
 *
 * 在 `tauri android init` 之后运行，向 AndroidManifest.xml 注入
 * WebView 所需的运行时权限（相机、麦克风、定位、媒体访问等）。
 *
 * 这些权限无法通过 Tauri 配置文件声明——Tauri 插件只添加各自
 * 依赖的权限，而 WebView 内的 Web API（getUserMedia、Geolocation
 * 等）需要宿主 AndroidManifest 声明对应权限。
 *
 * 用法：node prepare-android.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(
  __dirname,
  '../src-tauri/gen/android/app/src/main/AndroidManifest.xml'
);

// WebView Web API 所需的 Android 运行时权限
const REQUIRED_PERMISSIONS = [
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.VIBRATE',
  'android.permission.POST_NOTIFICATIONS',
];

console.log('[prepare-android] Patching AndroidManifest.xml...');

let manifest;
try {
  manifest = readFileSync(manifestPath, 'utf8');
} catch (e) {
  console.error(`[prepare-android] Cannot read AndroidManifest.xml: ${e.message}`);
  process.exit(1);
}

// 检查已有权限，只注入缺失的
const existing = new Set(
  [...manifest.matchAll(/android\.permission\.(\w+)/g)].map((m) => `android.permission.${m[1]}`)
);

const toAdd = REQUIRED_PERMISSIONS.filter((p) => !existing.has(p));

if (toAdd.length === 0) {
  console.log('[prepare-android] All permissions already present.');
  process.exit(0);
}

// 在 <application> 标签前插入 <uses-permission> 行
const permissionTags = toAdd
  .map((p) => `    <uses-permission android:name="${p}"/>`)
  .join('\n');

manifest = manifest.replace(
  /(\s*)<application/,
  `\n${permissionTags}\n$1<application`
);

writeFileSync(manifestPath, manifest, 'utf8');
console.log(`[prepare-android] Added ${toAdd.length} permissions:`);
toAdd.forEach((p) => console.log(`  + ${p}`));
console.log('[prepare-android] Done.');