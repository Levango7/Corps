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
    const re = /\p{Extended_Pictographic}/u;
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
        if (text && re.test(text)) {
          hits.push({ where: el.tagName.toLowerCase(), text: text.slice(0, 40) });
        }
      }
    }
    // 2) 输入控件的占位符与标题
    for (const el of Array.from(document.querySelectorAll("input[placeholder], [title]"))) {
      const text = el.getAttribute("placeholder") ?? el.getAttribute("title") ?? "";
      if (text && re.test(text)) {
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
