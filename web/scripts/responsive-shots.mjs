/* eslint-disable */
// 响应式验证截图：PC / iPad / iPhone 三档，登录页 + 工作区四页
// 用法：node scripts/responsive-shots.mjs（dev server 须在 localhost:3000）
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = "shots";
const PASSWORD = "Test1234!";
const VIEWPORTS = [
  { name: "pc", width: 1440, height: 900 },
  { name: "ipad", width: 768, height: 1024 },
  { name: "iphone", width: 390, height: 844 },
];

async function registerAndLogin(page, email, wid) {
  await page.goto(`${BASE}/auth/signup`);
  await page.getByLabel("工作区名称").fill(`响应式验证${Date.now() % 10000}`);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "创建并进入" }).click();
  await page.waitForURL(/\/w\//, { timeout: 30_000 });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const results = [];

  for (const vp of VIEWPORTS) {
    const email = `resp-${vp.name}-${Date.now()}@example.com`;
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
    });
    const page = await ctx.newPage();
    try {
      // 1. 登录页
      await page.goto(`${BASE}/auth/login`);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/${vp.name}-login.png` });

      // 2. 注册 + 概览
      await registerAndLogin(page, email);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/${vp.name}-overview.png` });
      const wid = page.url().match(/\/w\/([0-9a-f-]{36})/)?.[1];

      // 3. 看板
      await page.goto(`${BASE}/w/${wid}/board`);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/${vp.name}-board.png` });

      // 4. 通知中心
      await page.goto(`${BASE}/w/${wid}/notifications`);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/${vp.name}-notifications.png` });

      // 5. 设置页
      await page.goto(`${BASE}/w/${wid}/settings`);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/${vp.name}-settings.png` });

      // 6. 移动端再开抽屉侧栏
      if (vp.width < 1024) {
        await page.getByRole("button", { name: "打开侧栏" }).click();
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}/${vp.name}-drawer.png` });
      }

      // 横向溢出检测：documentElement.scrollWidth vs clientWidth
      for (const p of ["", "/board", "/notifications", "/settings"]) {
        await page.goto(`${BASE}/w/${wid}${p}`);
        await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(() => {
          const de = document.documentElement;
          return { scroll: de.scrollWidth, client: de.clientWidth };
        });
        if (overflow.scroll > overflow.client + 1) {
          results.push(`❌ ${vp.name} ${p || "/"}: 横向溢出 ${overflow.scroll}>${overflow.client}`);
        } else {
          results.push(`✓ ${vp.name} ${p || "/"}: 无溢出`);
        }
      }
    } catch (e) {
      results.push(`❌ ${vp.name} 失败: ${e.message.split("\n")[0]}`);
    }
    await ctx.close();
  }

  await browser.close();
  console.log(results.join("\n"));
  console.log("ALL DONE");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
