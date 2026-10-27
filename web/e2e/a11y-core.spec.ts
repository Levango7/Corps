import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { collectKeys, diffBaseline } from "./a11y-axe-keys";
import { registerAndLogin, uniqueEmail } from "./helpers";

/**
 * axe 真实浏览器 a11y 基线（WCAG 2.1 A/AA）。
 *
 * ## 为什么另起一条，而不是扩展现有的 a11y 门禁
 *
 * `web/tests/unit/a11y-baseline.test.ts` 跑的是 **eslint-plugin-jsx-a11y 静态扫描**
 * （228 处 / 98 文件）。它只能看到"JSX 里写没写 alt/aria"，看不到渲染后的实际 DOM：
 * 样式导致的对比度不足、`aria-modal` 打开了但焦点没进弹窗、动态插入的控件没有可及名——
 * 这些只有真浏览器 + 真渲染才判得出。两者是互补关系，不是替代：
 *   - 静态：便宜、覆盖全仓文件、能卡在写代码那一刻
 *   - 运行时：贵、只覆盖被访问的页面、但能抓到"代码看着对、渲染出来不对"
 *
 * ## 基线只允许收缩（与零覆盖率棘轮同语义）
 *
 *  - 现测有、基线没有 → 红（新增违规）
 *  - 基线有、现测没有 → 红（修好了但没从基线摘掉，否则豁免清单只增不减）
 *  - 基线文件不存在 → 红，并把当前快照打到日志 + 附件，供人一次性建基线
 *    （刻意不"缺基线就当作零违规"，那会变成一条永远绿的空门禁）
 *
 * ## 建基线 / 更新基线
 *
 * 本机跑不了（`next build` 被 Windows SWC 原生绑定缓存挡住，非仓库缺陷），
 * 所以流程是：CI 首跑红 → 从日志里的 `A11Y_AXE_SNAPSHOT=` 或 `a11y-axe-snapshot` 附件
 * 取出 JSON → 写进 `web/tests/a11y-axe-baseline.json` → 重跑转绿。
 * 本机若能起服务，可 `A11Y_AXE_WRITE_BASELINE=1 npx playwright test a11y-core`。
 */

const BASELINE_PATH = resolve(process.cwd(), "tests/a11y-axe-baseline.json");
const SNAPSHOT_PREFIX = "A11Y_AXE_SNAPSHOT=";
/** 每条规则集：WCAG 2.1 A/AA。刻意不含 best-practice，避免把"建议"混进"不达标"。 */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** 被扫描的页面。key 要稳定——它进基线键，改名等于全量重建基线。 */
const AUTHED_PAGES: Array<{ key: string; path: (wid: string) => string }> = [
  { key: "/w/:wid", path: (wid) => `/w/${wid}` },
  { key: "/w/:wid/tasks", path: (wid) => `/w/${wid}/tasks` },
  { key: "/w/:wid/im", path: (wid) => `/w/${wid}/im` },
  { key: "/w/:wid/decisions", path: (wid) => `/w/${wid}/decisions` },
  { key: "/w/:wid/documents", path: (wid) => `/w/${wid}/documents` },
  { key: "/w/:wid/settings", path: (wid) => `/w/${wid}/settings` },
];

interface BaselineFile {
  version: 1;
  /** 生成方式与时间，便于判断这份基线有多旧 */
  note: string;
  keys: string[];
}

function loadBaseline(): BaselineFile | null {
  try {
    const raw = readFileSync(BASELINE_PATH, "utf8");
    const parsed = JSON.parse(raw) as BaselineFile;
    if (!Array.isArray(parsed.keys)) return null;
    return parsed;
  } catch {
    return null;
  }
}

test.describe("axe 无障碍基线（WCAG 2.1 A/AA）", () => {
  test("核心页面不新增 axe 违规，且基线里没有已修的陈旧项", async ({ page }, testInfo) => {
    test.setTimeout(300_000);

    const keys: string[] = [];

    // 未登录页：注册/登录是外部用户第一眼看到的面，单独扫
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator("form").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    keys.push(
      ...collectKeys(
        "/login",
        (await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()).violations,
      ),
    );

    // 登录后逐页扫描。用固定测试账号注册，避免依赖别人种的数据。
    const wid = await registerAndLogin(page, uniqueEmail("e2e-a11y"), "E2E无障碍工作区");
    for (const target of AUTHED_PAGES) {
      await page.goto(target.path(wid), { waitUntil: "domcontentloaded" });
      // 等主体渲染出来再扫：扫一个空骨架会把违规扫成 0（假绿）。
      await expect(page.locator("main").first()).toBeVisible({ timeout: 30_000 });
      // 不用 networkidle：IM 页有长连接，等 idle 会拖到超时。
      await page.waitForTimeout(800);
      const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      keys.push(...collectKeys(target.key, result.violations));
    }

    const current = [...new Set(keys)].sort();

    // 无论红绿都把快照落盘 + 打印，供建/更新基线用
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    const snapshotPayload: BaselineFile = {
      version: 1,
      note: `由 web/e2e/a11y-core.spec.ts 生成（${new Date().toISOString()}）`,
      keys: current,
    };
    await testInfo.attach("a11y-axe-snapshot", {
      body: JSON.stringify(snapshotPayload, null, 2),
      contentType: "application/json",
    });
    console.info(SNAPSHOT_PREFIX + JSON.stringify(current));

    if (process.env.A11Y_AXE_WRITE_BASELINE === "1") {
      writeFileSync(BASELINE_PATH, JSON.stringify(snapshotPayload, null, 2) + "\n", "utf8");
      test.info().annotations.push({ type: "baseline", description: `已写入 ${BASELINE_PATH}` });
      return;
    }

    const baseline = loadBaseline();
    expect(
      baseline,
      `基线文件缺失或不可解析：${BASELINE_PATH}\n` +
        `当前实测 ${current.length} 条违规。请从本次日志里的 ${SNAPSHOT_PREFIX} 一行` +
        `（或 a11y-axe-snapshot 附件）取出 JSON 写入基线后重跑。`,
    ).not.toBeNull();

    const { added, stale } = diffBaseline(baseline!.keys, current);

    expect(
      added,
      `新增 axe 违规 ${added.length} 条（基线只允许收缩）：\n` + added.slice(0, 40).join("\n"),
    ).toEqual([]);
    expect(
      stale,
      `基线里有 ${stale.length} 条已不再出现——修好了就要从基线摘掉，否则豁免清单只增不减：\n` +
        stale.slice(0, 40).join("\n"),
    ).toEqual([]);
  });
});
