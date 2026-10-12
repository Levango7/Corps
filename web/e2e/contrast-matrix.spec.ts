/**
 * contrast-matrix.spec.ts —— 渲染层对比度矩阵（视觉回归模板 · corps 试点）
 * ----------------------------------------------------------------------------
 * 从 Interaction 的 visual-kit 复制（v3.7.122）。守护的是**渲染层不变量**
 * （不依赖像素基线，本机与 CI 结果一致）：
 *   ① light / dark 两套主题的关键令牌配对对比度 ≥ 实测基线 × 0.9
 *   ② 核心 UI 元素在两套主题下都真实可见且无横向溢出
 *   ③ 令牌本身有值（缺失会让主题静默退化）
 *
 * 基线 = 2026-10-12 本机实测值（需 Corps 生产构建 + dev server 跑出后填入）。
 * 口径：实测值 ≥ 基线 × 0.9（允许 10% 抖动，退步超过一成就红）。
 * ⚠️ 调基线必须在提交信息里说明原因，不要为了变绿而下调。
 *
 * 令牌配对（corps 特定，基于 design-tokens.css 的 --p-* 层）：
 *   --text/--panel  —— 正文/面板
 *   --text/--bg     —— 正文/页面底
 *   --muted/--panel —— 次要文字/面板
 *   --on-accent/--accent —— 强调按钮上的字/强调底色
 *   --danger/--panel —— 危险色文字/面板
 *   --accent/--panel —— 强调色文字/面板
 */

import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";
import {
  CONTRAST_INJECT,
  ABS_FLOOR,
  TOLERANCE,
  applyTheme,
  readPairs,
  checkOverflow,
  dumpReport,
} from "./visual-kit/index.js";

/* 两套主题：light 是默认态（无 data-theme 属性），dark 用 data-theme="dark" */
const THEMES = ["light", "dark"];

/* 关键前景/背景令牌配对（corps 特定） */
const CONTRAST_PAIRS: Record<string, [string, string]> = {
  "fg/surface": ["--fg", "--surface"],
  "fg/bg": ["--fg", "--bg"],
  // fg-2/surface 曾被漏在此清单外（基线表与 visual-kit/contrast-probe.cjs 都有它），
  // key 集不一致 → 断言「缺少配对」当场红。两处清单必须保持同集（2026-10-13 首跑实测）。
  "fg-2/surface": ["--fg-2", "--surface"],
  "muted/surface": ["--muted", "--surface"],
  "on-accent/accent": ["--on-accent", "--accent"],
  "danger/surface": ["--danger", "--surface"],
  "accent/surface": ["--accent", "--surface"],
};

/* 基线表（待实测填入 —— 首跑后从 _probe/contrast-actual.txt 复制真实值）
   初始全 0 → 首跑会全红，这是**预期的**（基线必须先实测）。
   填入后删除此注释。 */
const BASELINE: Record<string, Record<string, number>> = {
  light: {
    "fg/surface": 17.26,
    "fg/bg": 16.39,
    "fg-2/surface": 10.79,
    "muted/surface": 5.29,
    "on-accent/accent": 4.98,
    "danger/surface": 4.32,
    "accent/surface": 4.93,
  },
  dark: {
    "fg/surface": 15.75,
    "fg/bg": 17.14,
    "fg-2/surface": 10.32,
    "muted/surface": 5.39,
    "on-accent/accent": 4.51,
    "danger/surface": 5.34,
    "accent/surface": 3.85,
  },
};

test.describe("渲染层对比度矩阵（视觉回归模板）", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page, uniqueEmail("visual"));
    await page.waitForSelector("main, [role=main], #main", { state: "attached", timeout: 15_000 });
    await page.evaluate(CONTRAST_INJECT);
  });

  test("每套主题的关键配对对比度不低于实测基线", async ({ page }) => {
    const report: string[] = [];
    for (const th of THEMES) {
      await applyTheme(page, th);
      const pairs = await readPairs(page, CONTRAST_PAIRS);
      const base = BASELINE[th];
      for (const k in base) {
        const _k: string = k;
        const v = pairs[k];
        expect(v, "主题 " + th + " 缺少配对 " + k).toBeTruthy();
        if (v.c === null) continue;
        const floor = Math.max(ABS_FLOOR, base[k] * TOLERANCE);
        const line =
          th +
          " · " +
          k +
          " = " +
          v.c.toFixed(2) +
          "（基线 " +
          base[k] +
          "，下限 " +
          floor.toFixed(2) +
          "）";
        report.push(line);

        expect(
          v.c,
          "对比度退步：" + line + "  [" + v.fg + " / " + v.bg + "]",
        ).toBeGreaterThanOrEqual(floor);
      }
    }
    /* 落盘实测值，便于填入基线 */
    dumpReport(report, "contrast-actual");
  });

  test("每套主题下核心 UI 可见且无横向溢出", async ({ page }) => {
    for (const th of THEMES) {
      await applyTheme(page, th);
      const overflow = await checkOverflow(page);
      expect(overflow, "主题 " + th + " 出现横向溢出 " + overflow + "px").toBeLessThanOrEqual(0);
      /* 主内容区域存在且可见 */
      await expect(
        page.locator("main, [role=main]").first(),
        "主题 " + th + "：主内容不可见",
      ).toBeVisible();
    }
  });

  test("令牌有值（缺失会让主题静默退化）", async ({ page }) => {
    for (const th of THEMES) {
      await applyTheme(page, th);
      const pairs = await readPairs(page, CONTRAST_PAIRS);
      for (const k in pairs) {
        expect(
          pairs[k].fg,
          "主题 " + th + " 的前景令牌 " + CONTRAST_PAIRS[k][0] + " 为空",
        ).not.toBe("");
        expect(
          pairs[k].bg,
          "主题 " + th + " 的背景令牌 " + CONTRAST_PAIRS[k][1] + " 为空",
        ).not.toBe("");
      }
    }
  });
});
