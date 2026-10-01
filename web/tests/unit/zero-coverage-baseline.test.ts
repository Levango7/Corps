// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { dirname, join, relative, sep } from "path";
import { fileURLToPath } from "url";

/**
 * 零行覆盖基线文件的**结构**守卫（语义棘轮在 scripts/check_zero_coverage_ratchet.py，
 * 那里唯一负责"只允许收缩"，本文件刻意不复述那套比较逻辑 —— 同一指标两处声明
 * 会改一处、另一处静默腐烂，这在本仓库踩过）。
 *
 * 本文件管的是清单本身会不会烂掉：
 *  1. 排序、去重、无空行、无散落注释（否则 diff 会噪音化，"删一行"这个动作就失去意义）；
 *  2. 每条路径都必须**在 vitest coverage.include 的宇宙里且真实存在** ——
 *     文件被改名/删除后基线里的旧行既不可能再被覆盖、也永远不会触发 STALE，
 *     等于凭空留豁免额度；
 *  3. 不允许混进测试文件或配置（它们本就不进覆盖率统计，出现在这里说明生成脚本出错）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "../..");
const ROOT = join(HERE, "../../..");
const BASELINE = join(ROOT, "scripts/zero-coverage-baseline.txt");

// 与 vitest.config.ts 的 coverage.include 保持一致（三份 glob 一一对应）
const INCLUDE_GLOBS = ["app/api", "lib", "components"];
const INCLUDE_EXT: Record<string, string[]> = {
  "app/api": [".ts"],
  lib: [".ts"],
  components: [".tsx"],
};

function walk(dir: string, exts: string[], out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(relative(WEB, p).split(sep).join("/"));
  }
  return out;
}

function universe(): Set<string> {
  const acc: string[] = [];
  for (const g of INCLUDE_GLOBS) {
    const root = join(WEB, g);
    if (existsSync(root)) walk(root, INCLUDE_EXT[g], acc);
  }
  return new Set(acc);
}

function readRaw(): string[] {
  return readFileSync(BASELINE, "utf8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""));
}

const raw = readRaw();
const header = raw.filter((l) => l.startsWith("#"));
const entries = raw.filter((l) => l.trim() !== "" && !l.startsWith("#"));

describe("零行覆盖基线清单结构", () => {
  it("基线文件存在且带维护说明头", () => {
    expect(existsSync(BASELINE)).toBe(true);
    expect(header.length).toBeGreaterThan(3);
    expect(header.join("\n")).toContain("只允许收缩");
  });

  it("无 CR 残留、无行尾空格（否则 diff 噪音会淹没真正的增删）", () => {
    const badCrlf = raw.filter((l) => l.includes("\r"));
    const badTrail = raw.filter((l) => l !== l.replace(/\s+$/, ""));
    expect(badCrlf).toEqual([]);
    expect(badTrail).toEqual([]);
  });

  it("条目已排序且无重复", () => {
    const sorted = [...entries].sort();
    expect(entries).toEqual(sorted);
    expect(new Set(entries).size).toBe(entries.length);
  });

  it("每条路径都真实存在、且在 coverage.include 宇宙内", () => {
    const uni = universe();
    const missing = entries.filter((e) => !existsSync(join(WEB, e)));
    const outside = entries.filter((e) => !uni.has(e));
    expect({ missing, outside }).toEqual({ missing: [], outside: [] });
  });

  it("不混入测试/配置文件（它们不进覆盖率统计）", () => {
    const junk = entries.filter((e) => /\.test\.|\.spec\.|\.config\./.test(e));
    expect(junk).toEqual([]);
  });

  it("清单非空且不超过宇宙规模（防「把整棵树倒进来」式伪合规）", () => {
    const uni = universe();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThanOrEqual(uni.size);
    // 未覆盖占比若高于宇宙的一半，说明这份清单在替"没测"背书 —— 打印出来供人判断，不判红。
    console.log(
      `[zero-cov-baseline] 基线 ${entries.length} / 宇宙 ${uni.size} = ${((100 * entries.length) / uni.size).toFixed(1)}%`,
    );
  });
});
