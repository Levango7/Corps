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
 * 基线 = 2026-10-12 本机实测值（contrast-probe.mjs 取数：Playwright + design-tokens.css，
 * 纯令牌计算、不起 server；对着 committed 版 design-tokens.css 复验一致）。
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
 * 当前六项，均有实测数据支撑（contrast-probe.mjs；danger/accent 两项 2026-10-14 复验一致，
 * meta 四项 2026-10-31 本机 `node e2e/visual-kit/contrast-probe.mjs` 实测）：
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
 *
 * 3. light meta/surface = 2.80、meta/bg = 2.66；dark meta/surface = 3.18、meta/bg = 3.46
 *    （四项 2026-10-31 本机 `node e2e/visual-kit/contrast-probe.mjs` 实测）
 *    `--p-meta`（light #9a9a96 / dark #6a6a62）是全站**使用最广的次要文字层**：
 *    `text-[var(--meta)]` 607 处 / 该令牌全部用法 644 处。本清单此前压根没有 meta 配对，
 *    于是矩阵一直守着 7 个达标的配对、把真正不达标的那一档漏在门外。
 *    axe 基线余下 27 条 color-contrast 里**已按源码核到这一档的是 15 条**（选择器直接带
 *    --meta 的 5 条 + kbd 6 条 = app/[locale]/w/[wid]/layout.tsx:506 压在 bg-[var(--surface-2)]
 *    上 + 侧栏分组标签 4 条 = components/SidebarNavClient.tsx:92/101/117/126）；
 *    余 12 条**未归因**，不写成"同一个根因"（理由见 web/tests/a11y-axe-baseline.json 的 note）。
 *    四面底由难到易：--surface-3 2.38 < --surface-2（chip 底，kbd 实测压在这面）2.56 <
 *    --bg 2.66 < --surface 2.80；本清单只登记了后两面，前两面不在清单里但修法必须一起过。
 *    候选色值（对 surface / bg / surface-2 / surface-3 四面）：
 *      --p-meta → #707069 → 4.94 / 4.69 / 4.53 / **4.21** —— 三面过、surface-3 仍差 0.29
 *      但 --p-muted 是 #6b6b68（同四面 5.29 / 5.03 / 4.85 / 4.51），与 #707069 几乎同深 → 层级塌陷
 *      dark 要过 AA 得**往亮走**（#909087 即现 --p-muted 为 5.39 / 5.86 / 5.10 / 4.60），与 light 反向
 *    所以需 owner 定档：
 *      ① 只压暗 meta —— 已核到的 15 条清了（若要连 surface-3 也过还得再深一档），但 meta 与 muted 塌成一层
 *      ② 同时把 muted 压到 #5a5a57、重建成两档 —— 视觉改动更大（1600+ 用法受影响、
 *         ui-visual 快照要重录），但层级关系保住
 *      ③ 第二批先把 axe 的 fgColor/bgColor/contrastRatio 一起进快照，把余 12 条归完因再动令牌
 */
const AA_EXEMPT: Record<string, string> = {
  "light|meta/surface":
    "2.80 < AA 4.5（差 1.70）。--p-meta 是全站**使用最广的次要文字层**" +
    "（`text-[var(--meta)]` 607 处 / 该令牌全部用法 644 处），本清单此前压根没有 meta 配对，" +
    "于是矩阵一直守着 7 个达标的配对、把真正不达标的那一档漏在门外；" +
    "axe 基线余下 27 条 color-contrast 里已按源码核到这一档的是 15 条，余 12 条未归因" +
    "（判据与逐条出处见 web/tests/a11y-axe-baseline.json 的 note）。" +
    "四面底由难到易是 surface-3 2.38 < surface-2（chip 底，kbd 实测压在这面）2.56 < bg 2.66 < surface 2.80，" +
    "本清单只登记了后两面，另两面修法里必须一起过。" +
    "候选色值与三条路线（①只压暗 meta 会层级塌陷 ②同时压暗 muted 重建两档 ③先把余 12 条归完因）" +
    "见上方注释第 3 条 —— 属设计决策，需 owner 定后再动",
  "light|meta/bg": "2.66 < AA 4.5。与 light|meta/surface 同一根因，修法同上",
  "dark|meta/surface":
    "3.18 < AA 4.5。dark 的 --p-meta 同样不达标（四面由难到易 surface-3 2.71 < surface-2 3.01 < bg 3.18 < surface 3.46）；" +
    "过 AA 需要往**亮**走，与 light 方向相反，所以两个主题必须一起定档，否则只是把缺口换了个主题。色值见上方注释第 3 条",
  "dark|meta/bg": "3.46 < AA 4.5。与 dark|meta/surface 同一根因，修法同上",
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
    "meta/surface": 2.8,
    "meta/bg": 2.66,
    "on-accent/accent": 4.98,
    "danger/surface": 4.32,
    "accent/surface": 4.93,
  },
  dark: {
    "fg/surface": 15.75,
    "fg/bg": 17.14,
    "fg-2/surface": 10.32,
    "muted/surface": 5.39,
    "meta/surface": 3.18,
    "meta/bg": 3.46,
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
        if (v.c === null) continue;
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
      }
    }
  });
});
