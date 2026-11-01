import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRAST_INJECT } from "../../e2e/visual-kit/contrast";

/**
 * 文字四档阶梯（fg / fg-2 / muted / meta）的不变量。
 *
 * 为什么要单独钉这一条：2026-11-02 定档路线 B 时撞到一条数学天花板——
 * **连纯白 #ffffff 做底，过 WCAG AA 4.5 的最浅灰也只能到 #767673**。
 * 所以"比 muted 更浅的一档次要文字"在任何合法背景上都不可能达标，层级只能靠
 * **间距**表达，不能靠"更浅"。而对比度矩阵（e2e/contrast-matrix.spec.ts）守的是
 * 「每档 vs 底色」，**没有任何门禁守「档与档之间」**：后人为了达标把两档并成
 * 一个颜色，矩阵照样全绿。这份文件补的就是那个盲区。
 *
 * 阈值 1.3 的出处：不是 WCAG 条文，是本轮实测的可分辨下限——重建后的间距是
 * light 1.60 / 1.39 / 1.36、dark 1.53 / 1.36 / 1.37，而"只抬 meta"那条路算出来是
 * 1.05 / 1.00（等于同一个色）。取 1.3 卡在两者之间，比"实测刚好过"低一档留出抖动。
 *
 * 算式不在这儿复制：用 `new Function` 载入**真正注入页面的**那段内核
 * （与 tests/unit/contrast-kernel.test.ts 同一手法），测试与 shipped 代码不可能各说一套。
 */

interface Vk {
  lum(rgb: number[]): number;
  parse(s: string): number[] | null;
  contrast(a: string, b: string): number | null;
}
const win: { __vk?: Vk } = {};
new Function("window", "document", CONTRAST_INJECT)(win, undefined as never);
const vk = win.__vk as Vk;

const CSS = readFileSync(resolve(process.cwd(), "app/design-tokens.css"), "utf8");
const DARK_START = CSS.indexOf(':root[data-theme="dark"]');

const TIERS = ["--p-fg", "--p-fg-2", "--p-muted", "--p-meta"] as const;

/** 取某令牌的全部声明；返回 [{value, isDark}]，isDark 由所在块判定。 */
function declarations(token: string): { value: string; isDark: boolean }[] {
  const re = new RegExp(`^\\s*${token}:\\s*(#[0-9a-fA-F]{6})\\s*;`, "gm");
  const hits: { value: string; isDark: boolean }[] = [];
  for (const m of CSS.matchAll(re)) {
    hits.push({ value: m[1].toLowerCase(), isDark: (m.index as number) > DARK_START });
  }
  return hits;
}

function ladder(theme: "light" | "dark"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of TIERS) {
    const hits = declarations(t).filter((h) => (theme === "dark") === h.isDark);
    expect(hits.length, `${t} 在 ${theme} 块里应恰好声明一次（实测 ${hits.length} 次）`).toBe(1);
    out[t] = hits[0].value;
  }
  return out;
}

function luminance(hex: string): number {
  return vk.lum(vk.parse(hex) as number[]);
}

describe("文字四档阶梯的不变量（层级靠间距，不靠更浅）", () => {
  it("两套主题都各自定义了四档（漏一套会静默继承浅色的值）", () => {
    const light = ladder("light");
    const dark = ladder("dark");
    for (const t of TIERS) {
      expect(light[t], `light ${t} 缺失`).toMatch(/^#[0-9a-f]{6}$/);
      expect(dark[t], `dark ${t} 缺失`).toMatch(/^#[0-9a-f]{6}$/);
      // 深浅两套不可能同值：同值说明 dark 块没覆盖该档
      expect(dark[t], `${t} 在 dark 与 light 同值，等于没做深色档`).not.toBe(light[t]);
    }
  });

  it("light：亮度单调递进 fg < fg-2 < muted < meta", () => {
    const l = ladder("light");
    const order = TIERS.map((t) => luminance(l[t]));
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i],
        `第 ${i} 档 (${TIERS[i]}) 必须比第 ${i - 1} 档更浅，否则层级顺序被打乱`,
      ).toBeGreaterThan(order[i - 1]);
    }
  });

  it("dark：亮度单调递进 fg > fg-2 > muted > meta（深色方向相反）", () => {
    const l = ladder("dark");
    const order = TIERS.map((t) => luminance(l[t]));
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i],
        `dark 第 ${i} 档 (${TIERS[i]}) 必须比上一档更暗`,
      ).toBeLessThan(order[i - 1]);
    }
  });

  for (const theme of ["light", "dark"] as const) {
    it(`${theme}：相邻两档的对比间距 ≥ 1.3（把两档并成一个颜色就是这条在红）`, () => {
      const l = ladder(theme);
      const rows: string[] = [];
      const failures: string[] = [];
      for (let i = 1; i < TIERS.length; i++) {
        const gap = vk.contrast(l[TIERS[i - 1]], l[TIERS[i]]) as number;
        rows.push(`${TIERS[i - 1]}→${TIERS[i]} ${gap.toFixed(2)}`);
        if (gap < 1.3) failures.push(`${TIERS[i - 1]}→${TIERS[i]} 只有 ${gap.toFixed(2)}`);
      }
      // 三组间距都要有读数，否则"循环空转"会伪装成通过
      expect(rows.length, "四档应有 3 组相邻间距").toBe(3);
      expect(failures, `${theme} 阶梯塌陷：\n  ${failures.join("\n  ")}\n  实测 ${rows.join(" · ")}`).toEqual(
        []
      );
    });
  }

  it("射程反向对照：把 meta 并到 muted 同一颜色，判据必须报红", () => {
    // 不依赖"真文件恰好没塌"来证明断言有效——直接喂一份塌陷的阶梯给同一个判据。
    const collapsed = { "--p-fg": "#1a1a18", "--p-fg-2": "#3d3d3a", "--p-muted": "#52524f", "--p-meta": "#52524f" };
    const gap = vk.contrast(collapsed["--p-muted"], collapsed["--p-meta"]) as number;
    expect(gap, "同色两档的间距应为 1").toBeCloseTo(1, 5);
    expect(gap).toBeLessThan(1.3);
    // 现值必须在阈值之上（否则上面那条反向对照是空枪）
    const real = ladder("light");
    expect(vk.contrast(real["--p-muted"], real["--p-meta"]) as number).toBeGreaterThanOrEqual(1.3);
  });

  it("钉住那条天花板：AA 4.5 决定了 faint 档不可能存在，别再走「调浅一点」的歧路", () => {
    // #767673 是纯白底上刚好过 4.5 的最浅灰；旧 --p-meta #9a9a96 在纯白上只有 2.82。
    expect(vk.contrast("#767673", "#ffffff") as number).toBeGreaterThanOrEqual(4.5);
    expect(vk.contrast("#9a9a96", "#ffffff") as number).toBeLessThan(3.0);
    // 现 meta 必须已经落进可达区间（比天花板更深那一侧）
    const meta = ladder("light")["--p-meta"];
    expect(vk.contrast(meta, "#ffffff") as number).toBeGreaterThanOrEqual(4.5);
  });
});
