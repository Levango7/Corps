import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { collectDetails, collectKeys, diffBaseline, type ViolationDetail } from "./a11y-axe-keys";
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
 *
 * ## 现场取色数据（不参与红绿）
 *
 * 键只能定位「哪条规则的哪个位置」，归因不到「那个位置的 fg/bg 各是多少」——
 * 而选择器是 axe 挑的最小唯一类集合，里面没出色令牌 ≠ 该元素不经过令牌。
 * 所以每次 analyze 同时摊一份 `collectDetails(...)`，落三个出口：
 * Playwright 附件 `a11y-axe-details`、`test-results/a11y-axe-details.json`、
 * 日志 `A11Y_AXE_DETAILS=` 一行（日志会截长行，所以文件是主通道）。
 * 刻意**不**把它变成断言：不参与判定的采数冒充门禁，只会让人以为已经守住了。
 */

const BASELINE_PATH = resolve(process.cwd(), "tests/a11y-axe-baseline.json");
const SNAPSHOT_PREFIX = "A11Y_AXE_SNAPSHOT=";
/** 现场数据（fg/bg/比值）单独一行：它不进基线，只用来把「这条违规到底是谁的颜色」问清楚。 */
const DETAILS_PREFIX = "A11Y_AXE_DETAILS=";
/** 每条规则集：WCAG 2.1 A/AA。刻意不含 best-practice，避免把"建议"混进"不达标"。 */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** 被扫描的页面。key 要稳定——它进基线键，改名等于全量重建基线。 */
const AUTHED_PAGES: Array<{ key: string; path: (wid: string) => string }> = [
  // 用 /board 而不是裸的 /w/:wid：裸根会落到不带应用壳的入口页，
  // 拿它当"页面已就绪"的信号会把 404/重定向误判成"骨架未渲染"。
  { key: "/w/:wid/board", path: (wid) => `/w/${wid}/board` },
  // 没有 /w/:wid/tasks 这个路由（任务列表在 board / my-tasks），实测 404
  { key: "/w/:wid/my-tasks", path: (wid) => `/w/${wid}/my-tasks` },
  { key: "/w/:wid/im", path: (wid) => `/w/${wid}/im` },
  { key: "/w/:wid/decisions", path: (wid) => `/w/${wid}/decisions` },
  { key: "/w/:wid/documents", path: (wid) => `/w/${wid}/documents` },
  { key: "/w/:wid/settings", path: (wid) => `/w/${wid}/settings` },
];

/**
 * 让页面稳定下来再扫。
 *
 * `networkidle` 不能直接等：IM 页有长连接（WebSocket / SSE），等 idle 会一路拖到超时。
 * 所以给它一个 5s 上限，超时就当作"够稳了"继续扫；两个短 settle 用来吃掉
 * 首屏动画/懒加载组件挂载的抖动。
 */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(300);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

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
    const details: Record<string, ViolationDetail> = {};

    /** 扫一次，同时产出基线键与现场数据（两件事共用同一次 analyze，避免两次渲染不一致）。 */
    async function scanAs(routeKey: string): Promise<void> {
      const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      keys.push(...collectKeys(routeKey, result.violations));
      Object.assign(details, collectDetails(routeKey, result.violations));
    }

    // 未登录页：登录是外部用户第一眼看到的面，单独扫。
    // 路径是 /auth/login（仓里没有 /login 路由——首跑就是在这里红的）。
    await page.goto("/auth/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator('input[type="email"]').first()).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await scanAs("/login");

    // 登录后逐页扫描。用固定测试账号注册，避免依赖别人种的数据。
    const wid = await registerAndLogin(page, uniqueEmail("e2e-a11y"), "E2E无障碍工作区");
    for (const target of AUTHED_PAGES) {
      const url = target.path(wid);
      const nav = await page.goto(url, { waitUntil: "domcontentloaded" });
      // 先看状态码再等渲染：一条 404 否则会伪装成"等不到 header 的超时"，
      // 排查时分不清是路径错了还是壳没渲染。
      expect(nav?.status() ?? 0, `导航到 ${url} 返回 ${nav?.status()}`).toBeLessThan(400);
      // 就绪信号用应用壳（顶栏 header + 侧栏 nav 地标）：扫一个空骨架会把违规扫成 0（假绿）。
      // 页面级 <main> 不能当信号——六个页里只有 documents 有 <main>。
      await expect(page.locator("header").first()).toBeVisible({ timeout: 30_000 });
      await settle(page);
      // 客户端渲染的 not-found 状态码仍是 200，必须显式判一次。
      expect(await page.getByText("页面未找到").count(), `页面 ${url} 渲染成了「页面未找到」`).toBe(
        0,
      );
      await scanAs(target.key);
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
    // 再写一份到 test-results/：CI 失败时该目录会被 upload-artifact 带走，
    // 不必从日志里抠那一行 JSON（长行会被日志系统截断）。
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/a11y-axe-snapshot.json", JSON.stringify(snapshotPayload, null, 2));
    console.info(SNAPSHOT_PREFIX + JSON.stringify(current));

    // 现场数据同批落盘：键只说"这条位置不达标"，这份说"它的 fg/bg/比值各是多少"。
    // 长行走文件，日志里那行只是兜底（日志系统会截长行，所以不能只靠它）。
    const detailOrder = Object.fromEntries(
      Object.entries(details).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    await testInfo.attach("a11y-axe-details", {
      body: JSON.stringify(detailOrder, null, 2),
      contentType: "application/json",
    });
    writeFileSync("test-results/a11y-axe-details.json", JSON.stringify(detailOrder, null, 2));
    console.info(DETAILS_PREFIX + JSON.stringify(detailOrder));

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
