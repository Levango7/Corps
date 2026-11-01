/**
 * contrast-matrix.spec.ts —— 渲染层对比度矩阵（视觉回归模板 · corps 试点）
 * ----------------------------------------------------------------------------
 * 从 Interaction 的 visual-kit 复制（v3.7.122）。守护的是**渲染层不变量**
 * （不依赖像素基线，本机与 CI 结果一致）：
 *   ① light / dark 两套主题的关键令牌配对对比度 ≥ WCAG AA（4.5:1），
 *      或 ≥ 实测基线 × 0.9（取两者较大）；已在豁免清单登记的已知不达标项除外
 *   ② 核心 UI 元素在两套主题下都真实可见且无横向溢出
 *   ③ 令牌本身有值（缺失会让主题静默退化）
 *
 * 基线 = 本机实测值（contrast-probe.mjs 取数：Playwright + design-tokens.css，
 * 纯令牌计算、不起 server；对着 committed 版 design-tokens.css 复验一致）。
 * 每次动色值都要重新取数，**取数日期与命令记在 BASELINE 表上方的注释里**——
 * 2026-10-12 首版、2026-11-02 路线 A 重取、2026-11-02 路线 B 整表重取（现值）。
 *
 * ⚠️ 2026-10-14 口径修正（重要）：此前本文件用共享模板的 ABS_FLOOR = 1.5 作绝对底线，
 * 实际底线是 max(1.5, 基线 × 0.9)。问题在于**它锁死的是"当前实测值"，而不是 WCAG 标准**，
 * 实测（contrast-probe.mjs，纯令牌计算不需 server）发现 5 处放纵：
 *   A 类 · 锁死不达标（实测已低于 AA，旧底线却放行）：
 *     - light danger/surface = 4.32，旧底线 3.89
 *     - dark  accent/surface = 3.85，旧底线 3.46
 *   B 类 · 允许退化到不达标（实测达标，但旧底线低于 AA，可一路退化而门禁不响；
 *     且跌破 AA 后旧底线会跟着实测值一起降，所以永远不会报警）：
 *     - light on-accent/accent = 4.98，旧底线 4.48
 *     - light accent/surface    = 4.93，旧底线 4.44
 *     - dark  on-accent/accent  = 4.51，旧底线 4.06
 * 一道"允许不达标、且允许继续变坏"的门禁比没有门禁更危险——它给人虚假的安全感。
 * 现改为：底线 = max(WCAG AA 4.5, 基线 × 0.9)；确实不达标且短期改不动的，
 * 必须进 AA_EXEMPT 显式登记（带理由与修复路径），并受「豁免腐烂」断言约束。
 *
 * 口径：实测值 ≥ 基线 × 0.9（允许 10% 抖动，退步超过一成就红）。
 * ⚠️ 调基线必须在提交信息里说明原因，不要为了变绿而下调。
 *
 * 令牌配对（corps 特定，基于 design-tokens.css 的 --p-* 与 --shell-* 层，共 18 组）：
 *   --fg   / --surface、--bg、--shell-content        —— 正文
 *   --fg-2 / --surface                               —— 次正文
 *   --muted / --meta × (--surface / --bg / --surface-2 / --surface-3
 *                        / --shell-sidebar / --shell-content) —— 两个次要文字档 × 六面底
 *   --on-accent/--accent、--danger/--surface、--accent/--surface —— 强调与危险语义
 *   （键集与 visual-kit/contrast-probe.mjs 的 PAIRS、BASELINE 表必须一致，
 *    由 tests/unit/contrast-kernel.test.ts 判）
 */

import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";
import {
  CONTRAST_INJECT,
  TOLERANCE,
  applyTheme,
  readPairs,
  checkOverflow,
  dumpReport,
} from "./visual-kit/index.js";

/** WCAG 2.x AA 对**普通正文**的硬性要求：4.5:1（大号文字 3:1，本项目不区分，从严取 4.5）。 */
const AA_MIN = 4.5;

/**
 * 已知不达标配对的显式豁免清单。键为 `<主题>|<配对名>`，值为**必须写**的理由。
 *
 * 为什么用清单而不是继续藏在"基线 × 0.9"里：藏在基线里的问题是**不可见**的——
 * 看门禁全绿，没人知道有两处文字其实读不清。登记出来，问题才有人认领。
 *
 * 当前两项（2026-11-02 由十一项收到两项）。收掉的是 meta / muted 那九项，走的是路线 B，
 * 而 B 之所以不能是"把 meta 调浅一点"，是一条数学天花板，不是审美取舍：
 *   连纯白 #ffffff 做底，过 AA 4.5 的最浅灰也只能到 #767673；旧 --p-meta 是 #9a9a96
 *   （纯白上 2.82）—— 也就是「比 muted 更浅的一档次要文字」**在任何合法背景上都不可能达标**。
 *   抬到刚过线的 #686865 又与当时 muted #6b6b68 只差 1.05（dark 抬到 #909088 与现 muted
 *   差 1.00 = 同一个色），两档名义上存在、肉眼分不开。
 * 所以 B 的做法是两档一起重建：层级靠**间距**表达而不是靠"更浅"（两两对比 <1.3 就分不开）。
 * 落地实测（`node e2e/visual-kit/contrast-probe.mjs`，18 组配对 × 两套主题，数在 BASELINE 表）：
 *   light meta 最低 4.70（压在 --shell-content）/ muted 最低 6.39
 *   dark  meta 最低 4.66（同一面）/ muted 最低 6.39
 *   阶梯间距 fg→fg-2→muted→meta：light 1.60 / 1.39 / 1.36，dark 1.53 / 1.36 / 1.37
 *   派生面也一起过了：状态徽章 `color-mix(--muted 12%, transparent)` 上的 muted 文字，
 *   light 最差从 3.79 → 5.40、dark 从 3.83 → 5.10（这类面矩阵按令牌配不出来，故单独算过）。
 * 那九项为什么曾经存在（历史脉络，防下一个人重走）：A（外壳两层补成实色）之前这些配对读的是
 * 声明原文——未求值的 `color-mix(...)` 串，解析返回 null，而本文件当时写的是「null 就跳过」，
 * 所以矩阵对它们持续报绿；A 之后第一次算得出数，才把这九项登记进来。逐条归因与取数口径的
 * 完整记录见 web/tests/a11y-axe-baseline.json 的 note。
 *
 * 1. light danger/surface = 4.32（差 AA 0.18）
 *    `--p-danger: #dc3d4a` 作文字色（--prio-high-fg / --danger）出现在任务优先级、
 *    危险操作提示上。修法很轻：把 --p-danger 调深到 #d33240 即 4.84 达标，色相观感几乎不变。
 *    未顺手改的原因：改的是全站语义色，属设计决策，需确认后再动。
 *
 * 2. dark accent/surface = 3.85（差 AA 0.65）
 *    这一项**不是调个数值就能解决的**，是设计约束冲突：dark 主题的 --accent
 *    同时充当「强调色文字（--eyebrow-fg / --status-doing-fg，此时它是前景，要更亮）」
 *    和「强调按钮底色（--on-accent 白字压在它上面，此时它是背景，要更暗）」。
 *    实测扫描显示两者无法靠单一色值同时满足 4.5：
 *      #4973d1（现值）→ 文字 3.85 ✗ / 白字 4.51 ✓
 *      #517cd6        → 文字 4.30 ✗ / 白字 4.04 ✗（两头不讨好）
 *      #5b83db        → 文字 4.72 ✓ / 白字 3.68 ✗
 *    正解是**分离令牌**：引入 --accent-on-surface（作文字，取亮）与保留 --accent（作背景，取暗），
 *    并同步改使用处。这是设计系统级变更，影响租户换肤的 color-mix 派生链，故单独排期。
 */
const AA_EXEMPT: Record<string, string> = {
  "light|danger/surface":
    "4.32 < AA 4.5（差 0.18）。--p-danger 调深一档即可达 4.84（色值与推导见上方注释），属设计决策待确认",
  "dark|accent/surface":
    "3.85 < AA 4.5（差 0.65）。单一色值无法同时满足「accent 作文字」与「白字在 accent 上」，需分离 --accent-on-surface 令牌，设计系统级变更",
};

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
  "meta/surface": ["--meta", "--surface"],
  "meta/bg": ["--meta", "--bg"],
  "on-accent/accent": ["--on-accent", "--accent"],
  "danger/surface": ["--danger", "--surface"],
  "accent/surface": ["--accent", "--surface"],
  /* 四面实色底 × 两个次要文字档（2026-11-02 补，路线 B）。豁免注释里一直写着
     「--surface-2 / --surface-3 这两面不在清单里，但修法必须一起过」——B 就是那次修法，
     所以把那两面收进射程，而不是改完令牌就宣称做完。 */
  "meta/surface-2": ["--meta", "--surface-2"],
  "meta/surface-3": ["--meta", "--surface-3"],
  "muted/surface-2": ["--muted", "--surface-2"],
  "muted/surface-3": ["--muted", "--surface-3"],
  /* 外壳三层配对（2026-11-02 补，路线 A）。此前清单只有 --surface/--bg 这类实色令牌配对，
     而应用正文区与侧栏**真正压着**的是 --shell-content / --shell-sidebar：axe 现场数据
     （main run 41319565816 的产物）显示 27 条 color-contrast 违规里 14 条的底就是这两层。
     当时它们写成 color-mix 权重和不满 100% ⇒ 半透明色，矩阵既算不出色值也看不见叠色结果，
     所以这道门对那 14 条是结构性的瞎。补配对 + 走 used value 解析，退化才会当场报警。 */
  "meta/shell-sidebar": ["--meta", "--shell-sidebar"],
  "meta/shell-content": ["--meta", "--shell-content"],
  "muted/shell-sidebar": ["--muted", "--shell-sidebar"],
  "muted/shell-content": ["--muted", "--shell-content"],
  "fg/shell-content": ["--fg", "--shell-content"],
};

/* 基线表：值一律来自本机实测（`node e2e/visual-kit/contrast-probe.mjs`，它注入
   design-tokens.css 后用同一个内核算 used value），不是按公式推的。
   改任何一档色值都要重新取数再填，别顺手"修正"成想要的数。
   2026-11-02（路线 B）整表重取：meta / muted 两档压暗（light）与提亮（dark）后，
   18 组配对里除 danger(light) 4.32 与 accent(dark) 3.85 之外全部 ≥ AA 4.5。
   键集必须与 CONTRAST_PAIRS / contrast-probe.mjs 的 PAIRS 一致 ——
   tests/unit/contrast-kernel.test.ts 判这条（少一个键就是那一套静默不判）。 */
const BASELINE: Record<string, Record<string, number>> = {
  light: {
    "fg/surface": 17.26,
    "fg/bg": 16.39,
    "fg-2/surface": 10.79,
    "muted/surface": 7.76,
    "meta/surface": 5.7,
    "meta/bg": 5.42,
    "on-accent/accent": 4.98,
    "danger/surface": 4.32,
    "accent/surface": 4.93,
    "meta/surface-2": 5.23,
    "meta/surface-3": 4.86,
    "muted/surface-2": 7.11,
    "muted/surface-3": 6.62,
    // 外壳两层（A 补成实色、B 压暗文字档之后重取；A 之前这两层算不出色）
    "meta/shell-sidebar": 5.24,
    "meta/shell-content": 4.7,
    "muted/shell-sidebar": 7.13,
    "muted/shell-content": 6.39,
    "fg/shell-content": 14.21,
  },
  dark: {
    "fg/surface": 15.75,
    "fg/bg": 17.14,
    "fg-2/surface": 10.32,
    "muted/surface": 7.59,
    "meta/surface": 5.54,
    "meta/bg": 6.02,
    "on-accent/accent": 4.51,
    "danger/surface": 5.34,
    "accent/surface": 3.85,
    "meta/surface-2": 5.24,
    "meta/surface-3": 4.72,
    "muted/surface-2": 7.18,
    "muted/surface-3": 6.47,
    "meta/shell-sidebar": 5.02,
    "meta/shell-content": 4.66,
    "muted/shell-sidebar": 6.89,
    "muted/shell-content": 6.39,
    "fg/shell-content": 13.28,
  },
};

test.describe("渲染层对比度矩阵（视觉回归模板）", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page, uniqueEmail("visual"));
    await page.waitForSelector("main, [role=main], #main", { state: "attached", timeout: 15_000 });
    await page.evaluate(CONTRAST_INJECT);
  });

  test("每套主题的关键配对对比度不低于 AA 或实测基线", async ({ page }) => {
    const report: string[] = [];
    const exempted: string[] = [];
    for (const th of THEMES) {
      await applyTheme(page, th);
      const pairs = await readPairs(page, CONTRAST_PAIRS);
      const base = BASELINE[th];
      for (const k in base) {
        const v = pairs[k];
        expect(v, "主题 " + th + " 缺少配对 " + k).toBeTruthy();
        /* 算不出来 = 红，不许跳过。旧写法是 `if (v.c === null) continue`，后果是
           「配对里的令牌不是色值」时这道门静默放行 —— 2026-11-02 就是这么漏掉
           --shell-* 的（当时读的是声明原文 color-mix(...)，解析器返回 null，
           于是一路绿灯，而屏幕上那两层正把 14 条文字压在不达标的合成底上）。 */
        expect(
          v.c,
          "对比度算不出来：主题 " +
            th +
            " 配对 " +
            k +
            "  [" +
            v.fg +
            " / " +
            v.bg +
            "] " +
            "—— 令牌解析不出颜色（多半是取数口径或令牌本身写错），不要当成通过",
        ).not.toBeNull();
        if (v.c === null) continue; // 上一行已红，这里只是让下面的 toFixed 类型安全
        const exempt = AA_EXEMPT[th + "|" + k];
        /* 豁免项只受棘轮约束（不许比基线更差）；非豁免项必须同时满足 AA 与棘轮。
           取 max 而非只取 AA：已达标的配对若被改坏 10%，AA 未必能立刻抓到
           （例如 4.93 → 4.44 仍 > 4.5 的话 AA 放行），棘轮负责这种"缓慢下滑"。 */
        const floor = exempt ? base[k] * TOLERANCE : Math.max(AA_MIN, base[k] * TOLERANCE);
        if (exempt) {
          exempted.push(th + " · " + k + " = " + v.c.toFixed(2) + "（AA " + AA_MIN + "）");
        }
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
          (exempt ? "，已登记豁免" : "") +
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
    /* 把当前仍不达标的项一并落盘——豁免清单是给人看的，不能只活在代码里 */
    if (exempted.length) {
      dumpReport(
        [
          "以下配对仍低于 WCAG AA " + AA_MIN + "（见 contrast-matrix.spec.ts 的 AA_EXEMPT）：",
          ...exempted,
        ],
        "contrast-below-aa",
      );
    }
  });

  test("豁免清单不放行已修好的条目（防豁免腐烂）", async ({ page }) => {
    // 与 a11y 门禁（tests/unit/a11y-baseline.test.ts）同款的"防豁免腐烂"：
    // 修好了但豁免没删，门禁会继续放行更差的实现，清单也越来越像一份过期档案。
    // 这里反向断言——豁免项必须**仍然**不达标。
    const stillBad: string[] = [];
    for (const th of THEMES) {
      await applyTheme(page, th);
      const pairs = await readPairs(page, CONTRAST_PAIRS);
      for (const key of Object.keys(AA_EXEMPT)) {
        const [theme, pair] = key.split("|");
        if (theme !== th) continue;
        const v = pairs[pair];
        if (!v || v.c === null) {
          stillBad.push(key + " 已无法测到（配对消失了？）");
          continue;
        }
        if (v.c >= AA_MIN) {
          stillBad.push(
            key +
              " 现为 " +
              v.c.toFixed(2) +
              "，已达标 —— 请从 AA_EXEMPT 删除该条，让它回归 AA 硬底线",
          );
        }
      }
    }
    expect(
      stillBad,
      "以下豁免项已修好或已失效，请同步清理 AA_EXEMPT：\n  " + stillBad.join("\n  "),
    ).toEqual([]);
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
        /* 配对里的令牌必须是**实色**（alpha=1）。半透明令牌的屏幕色取决于它叠在什么上面，
           矩阵按配对算出来的那个数不代表用户看到的那个 —— 留一个半透明层在清单里，
           这道门就又变回"给人虚假安全感"的那种门禁。这正是 A 修掉的缺陷，所以这里钉住：
           谁再把 --shell-* 的 color-mix 权重写成不满 100%，这里直接红。
           （权重和不满时结果 alpha = w1+w2：80%+10% 得到 alpha 0.9，不是 100% 的淡版。） */
        expect(
          pairs[k].bgAlpha,
          "主题 " +
            th +
            " 配对 " +
            k +
            " 的背景令牌 " +
            CONTRAST_PAIRS[k][1] +
            " 是半透明（alpha " +
            pairs[k].bgAlpha +
            "）：color-mix 权重和须为 100%",
        ).toBe(1);
        expect(
          pairs[k].fgAlpha,
          "主题 " +
            th +
            " 配对 " +
            k +
            " 的前景令牌 " +
            CONTRAST_PAIRS[k][0] +
            " 是半透明（alpha " +
            pairs[k].fgAlpha +
            "）：文字色须是实色，否则屏幕色取决于叠在哪儿",
        ).toBe(1);
      }
    }
  });
});
