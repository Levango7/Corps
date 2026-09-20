// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

/**
 * i18n 消息 key 一致性单元测试
 *
 * 覆盖 messages/zh.json 与 messages/en.json：
 *  - 递归提取所有叶子 key，断言两侧 key 集合完全相等（zh 独有 0、en 独有 0）；
 *    只比较 key，不比较值。
 *  - 断言所有 key 仅含字母数字 / 点 / 下划线，且按点分层（防止误加非法 key，
 *    例如带空格、连字符、emoji 或首尾多余点号的 key）。
 *
 * 用 fs 读取而非 import JSON：不依赖 cwd，且不引入 JSON 模块解析差异。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = join(HERE, "../../messages");

function loadMessages(lang: "zh" | "en"): Record<string, unknown> {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${lang}.json`), "utf-8")) as Record<
    string,
    unknown
  >;
}

/** 递归提取对象的所有叶子 key，路径用 "." 连接 */
function collectLeafKeys(obj: unknown, prefix = ""): string[] {
  const keys: string[] = [];
  if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        keys.push(...collectLeafKeys(v, full));
      } else {
        keys.push(full);
      }
    }
  }
  return keys;
}

/** 递归提取对象的所有叶子 key-value 对，路径用 "." 连接 */
function collectLeafEntries(obj: unknown, prefix = ""): Record<string, string> {
  const entries: Record<string, string> = {};
  if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        Object.assign(entries, collectLeafEntries(v, full));
      } else {
        entries[full] = String(v);
      }
    }
  }
  return entries;
}

/**
 * 合理例外：zh 值允许等于 en 值的 key。
 * 包括：品牌名、技术术语（OKR/Markdown/PDF/Office）、语言自名、
 * 单字母缩写（R/C/U/D）、符号（—）、URL/邮箱占位符示例、
 * slug 示例、版本号格式、快捷键符号、版权声明等。
 */
const ALLOWED_SAME_VALUE_KEYS = new Set([
  "nav.menu.okr",
  "nav.search.shortcut",
  "pricing.footer.copyright",
  "languageSwitcher.zh",
  "languageSwitcher.en",
  "settings.avatarUrlPlaceholder",
  "settings.workspaceSlugPlaceholder",
  "permissions.action.read",
  "permissions.action.create",
  "permissions.action.update",
  "permissions.action.delete",
  "document.customSlugPlaceholder",
  "document.customSlugPrefix",
  "document.versionCompareTitle",
  "document.commentAnchorPlaceholder",
  "editor.markdown",

  "database.rollupField.empty",
  "database.fieldControls.urlPlaceholder",
  "database.fieldControls.emailPlaceholder",
  "database.fieldControls.emptyDash",
  "files.preview.categoryPdf",
  "files.preview.categoryOffice",
  "files.filePreview.categoryPdf",
  "files.filePreview.categoryOffice",
  "files.filePreview.categoryMarkdown",
]);

describe("i18n 消息 key 一致性", () => {
  const zh = loadMessages("zh");
  const en = loadMessages("en");

  const zhKeys = collectLeafKeys(zh).sort();
  const enKeys = collectLeafKeys(en).sort();

  it("zh.json 与 en.json 叶子 key 集合完全相等", () => {
    expect(zhKeys).toEqual(enKeys);
  });

  it("zh 独有 key 为 0 个", () => {
    const zhOnly = zhKeys.filter((k) => !enKeys.includes(k));
    expect(zhOnly, `zh 独有但 en 缺失的 key: ${zhOnly.join(", ")}`).toEqual([]);
  });

  it("en 独有 key 为 0 个", () => {
    const enOnly = enKeys.filter((k) => !zhKeys.includes(k));
    expect(enOnly, `en 独有但 zh 缺失的 key: ${enOnly.join(", ")}`).toEqual([]);
  });

  it("两侧叶子 key 数量一致", () => {
    expect(zhKeys.length).toBe(enKeys.length);
  });

  it("所有 i18n key 仅含字母数字/点/下划线，且按点分层", () => {
    const allKeys = [...new Set([...zhKeys, ...enKeys])];
    // 每段仅允许字母数字/下划线，段间以单个点连接；拒绝首尾/连续点号、空格、连字符等
    const pattern = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;
    for (const key of allKeys) {
      expect(key, `非法 i18n key: "${key}"`).toMatch(pattern);
    }
  });

  it("zh.json 值不应等于 en.json 值（排除合理例外）", () => {
    const zhEntries = collectLeafEntries(zh);
    const enEntries = collectLeafEntries(en);
    const sameValueKeys: string[] = [];
    for (const key of enKeys) {
      if (ALLOWED_SAME_VALUE_KEYS.has(key)) continue;
      if (zhEntries[key] !== undefined && zhEntries[key] === enEntries[key]) {
        sameValueKeys.push(key);
      }
    }
    expect(
      sameValueKeys,
      `zh 值与 en 值相同的 key（未翻译）：\n${sameValueKeys.map((k) => `  ${k} => "${enEntries[k]}"`).join("\n")}`,
    ).toEqual([]);
  });
});
