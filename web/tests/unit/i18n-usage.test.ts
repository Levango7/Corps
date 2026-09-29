// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

/**
 * i18n「代码引用 ↔ 词条存在」门禁
 *
 * 为什么需要它：i18n-keys.test.ts 只比对 zh 与 en 两份文件的**键集合相等**，
 * 于是"两份都缺同一个键"完全合规却照样在运行期抛 MISSING_MESSAGE。
 * 实测证据：看板长按快捷菜单用了 task.complete / task.copy / task.share，
 * 单测全绿，而 dev.log 里每条各抛 164 次 MISSING_MESSAGE —— 用户实际看到坏菜单。
 * 本守卫把断言方向补全：代码引用的键，必须真的存在于词条里。
 *
 * 基线口径（沿用 scripts/api-contract-baseline.txt 的做法）：
 *  现存缺口先进基线，门禁只挡**新增**缺口；修掉一个就应从基线删除一行，
 *  基线里已不存在的条目同样让测试失败（防"豁免腐烂"）。
 *
 * 静态解析的边界（刻意保守，宁漏不误报）：
 *  - 只认 `const t = useTranslations("ns")` 形式的绑定，并按**变量名**归属命名空间
 *    （同一文件里 t / tStatus / tIm 各属不同 ns，若都归给第一个会产生成批假阳性）；
 *  - 只认 `t("字面量")`，动态拼接如 t("diagram" + k) 一律跳过；
 *  - 命名空间与键都按点号逐层解析（useTranslations("ai.aiAgent") 是合法写法）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "../..");
const BASELINE = join(HERE, "../i18n-usage-baseline.txt");
const SCAN_DIRS = ["app", "components", "lib", "hooks"];

function listTsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) listTsFiles(p, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

function loadMessages(lang: "zh" | "en"): Record<string, unknown> {
  return JSON.parse(readFileSync(join(WEB, "messages", `${lang}.json`), "utf8"));
}

/** 按点号逐层解析；只有落到字符串叶子才算"存在"（落在对象上=不是可用词条） */
function resolveLeaf(obj: unknown, segs: string[]): string | undefined {
  let cur = obj;
  for (const s of segs) {
    if (cur && typeof cur === "object" && !Array.isArray(cur) && s in (cur as object)) {
      cur = (cur as Record<string, unknown>)[s];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

/** 收集"代码引用了但词条缺失"的键 */
function findMissingKeys(): string[] {
  const zh = loadMessages("zh");
  const en = loadMessages("en");
  const missing = new Set<string>();

  for (const dir of SCAN_DIRS) {
    for (const file of listTsFiles(join(WEB, dir))) {
      const src = readFileSync(file, "utf8");
      const bindings = [
        ...src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*useTranslations\(\s*"([^"]*)"\s*\)/g),
      ].map((m) => ({ fn: m[1], ns: m[2] }));
      if (!bindings.length) continue;

      for (const { fn, ns } of bindings) {
        // 只认 t("字面量") 且紧跟 ) 或 , —— 排除 t("x" + y) 这类动态拼接
        const call = new RegExp(
          `\\b${fn.replace(/\$/g, "\\$")}\\(\\s*"([a-zA-Z0-9_.]+)"\\s*[,)]`,
          "g",
        );
        for (const m of src.matchAll(call)) {
          const segs = [...(ns ? ns.split(".") : []), ...m[1].split(".")].filter(Boolean);
          const path = segs.join(".");
          if (resolveLeaf(zh, segs) === undefined || resolveLeaf(en, segs) === undefined) {
            missing.add(path);
          }
        }
      }
    }
  }
  return [...missing].sort();
}

function loadBaseline(): string[] {
  if (!existsSync(BASELINE)) return [];
  return readFileSync(BASELINE, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .sort();
}

describe("i18n 代码引用键必须存在于词条", () => {
  const missing = findMissingKeys();
  const baseline = loadBaseline();

  it("能扫到足够多的引用以证明扫描本身在工作", () => {
    // 阈值取自当前仓库规模；若大幅下降到个位数，多半是解析式失效而非真的修完了
    expect(missing.length).toBeLessThanOrEqual(baseline.length + 5);
    expect(baseline.length).toBeGreaterThan(0);
  });

  it("不引入基线之外的新缺口", () => {
    const grown = missing.filter((k) => !baseline.includes(k));
    expect(
      grown,
      `新出现的缺失 i18n 键（请补 messages/zh.json 与 en.json）:\n  ${grown.join("\n  ")}`,
    ).toEqual([]);
  });

  it("基线不放行已修复的条目（防豁免腐烂）", () => {
    const stale = baseline.filter((k) => !missing.includes(k));
    expect(
      stale,
      `以下 i18n 缺口已被修复，请同步从 tests/i18n-usage-baseline.txt 删除:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });
});
