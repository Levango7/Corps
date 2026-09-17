// 提取所有 useTranslations 命名空间下的 t("key") 调用，检查 zh.json/en.json 中是否存在
const fs = require('fs');
const path = require('path');

const zh = JSON.parse(fs.readFileSync('./messages/zh.json', 'utf8'));
const en = JSON.parse(fs.readFileSync('./messages/en.json', 'utf8'));

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      results.push(...walk(full));
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
      results.push(full);
    }
  }
  return results;
}

const files = walk('components').concat(walk('app'));

const nsPattern = /(?:const|let|var)\s+(\w+)\s*=\s*useTranslations\("([^"]+)"\)/g;
const callPattern = /\b(\w+)\s*\(\s*"([^"]+)"\s*(?:,|\))/g;

const missingZh = new Set();
const missingEn = new Set();
const missingInfo = [];

function hasPath(obj, keyPath) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !(p in cur)) return false;
    cur = cur[p];
  }
  return true;
}

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const varToNs = new Map();
  let m;
  nsPattern.lastIndex = 0;
  while ((m = nsPattern.exec(content)) !== null) {
    varToNs.set(m[1], m[2]);
  }
  if (varToNs.size === 0) continue;

  callPattern.lastIndex = 0;
  while ((m = callPattern.exec(content)) !== null) {
    const varName = m[1];
    const key = m[2];
    const ns = varToNs.get(varName);
    if (!ns) continue;
    const fullKey = ns + '.' + key;
    if (!hasPath(zh, fullKey)) {
      missingZh.add(fullKey);
      missingInfo.push({ file: file.replace(/\\/g, '/'), key: fullKey, lang: 'zh' });
    }
    if (!hasPath(en, fullKey)) {
      missingEn.add(fullKey);
      missingInfo.push({ file: file.replace(/\\/g, '/'), key: fullKey, lang: 'en' });
    }
  }
}

console.log('=== Missing in zh.json (' + missingZh.size + ' unique keys) ===');
for (const k of [...missingZh].sort()) console.log(k);
console.log('\n=== Missing in en.json (' + missingEn.size + ' unique keys) ===');
for (const k of [...missingEn].sort()) console.log(k);

console.log('\n=== Detail (first 100) ===');
for (const info of missingInfo.slice(0, 100)) {
  console.log(info.lang + ' | ' + info.file + ' | ' + info.key);
}