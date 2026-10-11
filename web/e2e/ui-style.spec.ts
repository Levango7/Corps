import { expect, test } from "@playwright/test";
import { registerAndLogin } from "./helpers";

/**
 * UI 风格硬断言（用户规约的机器化，PR #50 时代是手工判据）：
 *
 *  1. 界面禁 emoji（「去 AI 味」）——可见文本 + placeholder 全扫
 *  2. 导航图标跨机制不复用——可见 <nav> 内 lucide class 去重
 *     （侧栏与移动底栏同源各渲染一份；按可见性过滤，隐藏副本不算）
 *  3. 可见文字最小字号 ≥ 11px（设计 token 最小 --text-xs=12px，留 1px 余量）
 *
 * 挂在 e2e/ 下即自动进入 CI 的「E2E (production build)」job
 * （playwright.config.ts 的 testDir 未限定 testMatch）。
 */

/** 采集可见文本节点里的 emoji（含 placeholder/title 属性），返回命中列表。 */
async function scanEmoji(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    // 字符集与 scripts/check_p0_content.py 的 EMOJI_CLUSTER_RE **同口径**（改一处要改两处）：
    //   - 含 0x2600-0x27BF，所以 dingbat 图标（对勾 / 叉号 U+2713 / U+2715）同样会被抓到
    //     ——\p{Extended_Pictographic} 抓不到它们（它们不是 emoji），那是旧口径的盲区；
    //   - 不含 0x00A9，所以页脚版权符号不误报——规则原意是「禁把符号当图标用」。
    //
    // 之所以写成码点区间数组而不是 /[\uXXXX-\uYYYY]/ 正则：P0 门禁
    // （scripts/check_p0_content.py）会先把源码里的 \uXXXX 转义解码，再按
    // 「emoji 作图标」判红——那段口径是刻意从严的（转义不该成为后门）。
    // 于是这里改写法，而不是给门禁开路径豁免。
    const EMOJI_CODEPOINT_RANGES: Array<[number, number]> = [
      [0x1f000, 0x1faff],
      [0x2600, 0x27bf],
      [0x2b00, 0x2bff],
      [0x203c, 0x203c],
      [0x2049, 0x2049],
      [0x2139, 0x2139],
      [0x2194, 0x2199],
      [0x21a9, 0x21aa],
    ];
    const isEmoji = (text: string) =>
      Array.from(text).some((ch) => {
        const cp = ch.codePointAt(0) ?? 0;
        return EMOJI_CODEPOINT_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
      });
    const hits: { where: string; text: string }[] = [];
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    // 1) 可见叶子元素的直接文本
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (!visible(el)) continue;
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const text = (node.textContent ?? "").trim();
        if (text && isEmoji(text)) {
          hits.push({ where: el.tagName.toLowerCase(), text: text.slice(0, 40) });
        }
      }
    }
    // 2) 输入控件的占位符与标题
    for (const el of Array.from(document.querySelectorAll("input[placeholder], [title]"))) {
      const text = el.getAttribute("placeholder") ?? el.getAttribute("title") ?? "";
      if (text && isEmoji(text)) {
        hits.push({ where: "placeholder/title", text: text.slice(0, 40) });
      }
    }
    return hits;
  });
}

/** 采集可见 <nav> 内的 lucide 图标 class，返回 { name, count }（去重后）与重复项。 */
async function scanNavIcons(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const seen = new Map<string, number>();
    for (const nav of Array.from(document.querySelectorAll("nav"))) {
      const r = nav.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // 隐藏副本（移动底栏在桌面端 display:none）
      for (const svg of Array.from(nav.querySelectorAll("svg"))) {
        const m = Array.from(svg.classList).find((c) => c.startsWith("lucide-"));
        if (m) seen.set(m, (seen.get(m) ?? 0) + 1);
      }
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1);
    return { total: [...seen.values()].reduce((a, b) => a + b, 0), dupes };
  });
}

/** 采集可见文字元素的最小计算字号（px）。 */
async function minFontSize(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    let min = Infinity;
    let where = "";
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent ?? "").trim())
        .join("");
      if (!own) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.opacity === "0") continue;
      const size = parseFloat(cs.fontSize);
      if (size < min) {
        min = size;
        where = `${el.tagName.toLowerCase()}: "${own.slice(0, 30)}"`;
      }
    }
    return { min, where };
  });
}

test.describe.serial("UI 风格硬断言", () => {
  /** 每个测试现取唯一邮箱（勿提取为共享常量——同文件内第二次注册会撞 409）。 */
  const uniqueEmail = () =>
    `e2e-style-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.local`;

  test("注册/登录页：无 emoji、最小字号 ≥ 11px", async ({ page }) => {
    for (const path of ["/auth/signup", "/auth/login"]) {
      await page.goto(path);
      await expect(page.getByLabel("邮箱")).toBeVisible(); // 水合完成
      expect(await scanEmoji(page), `${path} 存在 emoji`).toEqual([]);
      const { min, where } = await minFontSize(page);
      expect(min, `${path} 最小字号 ${min}px（${where}）低于 11px 红线`).toBeGreaterThanOrEqual(11);
    }
  });

  test("定价页（公开）：无 emoji、最小字号 ≥ 11px", async ({ page }) => {
    await page.goto("/pricing");
    // 等服务端渲染的 Hero H1 就位（公开页无水合依赖，SSR 直出）
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(await scanEmoji(page), "定价页存在 emoji").toEqual([]);
    const { min, where } = await minFontSize(page);
    expect(min, `定价页最小字号 ${min}px（${where}）低于 11px 红线`).toBeGreaterThanOrEqual(11);
  });

  test("工作区首页：无 emoji、最小字号 ≥ 11px", async ({ page }) => {
    await registerAndLogin(page, uniqueEmail());
    // 等顶栏搜索按钮 = 工作区壳水合完成（SSR 首屏不含客户端交互态）
    await expect(page.getByRole("button", { name: /搜索/ }).first()).toBeVisible({
      timeout: 15_000,
    });
    expect(await scanEmoji(page), "工作区首页存在 emoji").toEqual([]);
    const { min, where } = await minFontSize(page);
    expect(min, `工作区首页最小字号 ${min}px（${where}）低于 11px 红线`).toBeGreaterThanOrEqual(11);
  });

  test("工作区侧栏导航：lucide 图标不复用（跨机制唯一）", async ({ page }) => {
    await registerAndLogin(page, uniqueEmail());
    await expect(page.getByRole("button", { name: /搜索/ }).first()).toBeVisible({
      timeout: 15_000,
    });
    const { total, dupes } = await scanNavIcons(page);
    expect(total, "侧栏未扫到任何导航图标").toBeGreaterThan(0);
    expect(dupes, `导航图标复用：${JSON.stringify(dupes)}`).toEqual([]);
  });
});
