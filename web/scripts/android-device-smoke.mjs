/* eslint-disable */
// Android 云真机冒烟（mobile-matrix.yml android-chrome-emulator job 调用）：
// Playwright 实验性 Android API（_android）驱动云模拟器内的真实系统 Chrome——
// 覆盖桌面 chromium 近似不到的档位：Android 视口/系统 Chrome 行为/触控层。
//
// 前提：
//  - reactivecircus/android-emulator-runner 已把模拟器经 adb 接好（本脚本由其
//    script 步骤调用，adb devices 有一台 emulator）
//  - 宿主 dev server 已起（模拟器经 10.0.2.2 访问宿主 loopback——AOSP 模拟器
//    对宿主 127.0.0.1 的固定别名，next dev 绑 localhost 即可达）
//
// 覆盖：注册→建工作区→概览/看板/通知/设置四页溢出检测（与 layout-audit 同
// 规则）→未捕获 JS 异常检查→截图产物（shots-android/）。
import { _android as android } from "@playwright/test";
import { mkdirSync } from "fs";

const BASE = process.env.ANDROID_BASE_URL || "http://10.0.2.2:3000";
const PASSWORD = "Test1234!";
const SHOTS = "shots-android";

mkdirSync(SHOTS, { recursive: true });

const [device] = await android.devices();
if (!device) throw new Error("未发现 Android 设备（adb devices 为空）");
console.log("device:", device.model());

// 干净起 Chrome（Playwright 以 devtools 通道驱动，等价 chrome://inspect 调试）
await device.shell("am force-stop com.android.chrome");
const context = await device.launchBrowser();
const page = await context.newPage();

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));

try {
  await page.goto(`${BASE}/auth/signup`);
  await page.getByLabel("工作区名称").pressSequentially(`安卓云${Date.now() % 100000}`, {
    delay: 30,
  });
  await page.getByLabel("邮箱").fill(`android-ci-${Date.now()}@example.com`);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.screenshot({ path: `${SHOTS}/01-signup.png` });
  await page.getByRole("button", { name: "创建并进入" }).click();
  await page.waitForURL(/\/w\//, { timeout: 60_000 });
  const wid = page.url().match(/\/w\/([0-9a-f-]{36})/)[1];

  const issues = [];
  const pages = [
    ["/", "概览"],
    ["/board", "看板"],
    ["/notifications", "通知"],
    ["/settings", "设置"],
  ];
  for (const [p, label] of pages) {
    await page.goto(`${BASE}/w/${wid}${p}`);
    await page.waitForLoadState("networkidle");
    const bad = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const out = [];
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden") return;
        if (r.right > vw + 2 && r.width < vw * 2) {
          let par = el.parentElement;
          let scrollable = false;
          while (par && par !== document.body) {
            if (/(auto|scroll)/.test(getComputedStyle(par).overflowX)) {
              scrollable = true;
              break;
            }
            par = par.parentElement;
          }
          if (!scrollable) out.push(el.tagName + "." + String(el.className).slice(0, 40));
        }
      });
      return out.slice(0, 5);
    });
    if (bad.length) issues.push(`${label}: ${bad.join(" | ")}`);
    if (p === "/" || p === "/board") {
      await page.screenshot({ path: `${SHOTS}/0${pages.indexOf([p, label]) + 2}-${label}.png` });
    }
  }

  console.log("\n=== Android Chrome 云冒烟结果 ===");
  console.log("溢出 issue 页数:", issues.length);
  issues.forEach((i) => console.log("  OVERFLOW", i));
  console.log("未捕获 JS 异常:", pageErrors.length);
  pageErrors.slice(0, 5).forEach((e) => console.log("  PAGEERROR", e));

  if (issues.length || pageErrors.length) {
    process.exitCode = 1;
  } else {
    console.log("PASS：4 页零溢出零异常");
  }
} finally {
  await page.close().catch(() => {});
  await device.close().catch(() => {});
}
