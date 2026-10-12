#!/usr/bin/env node
/* contrast-probe.cjs —— corps 令牌对比度实测（本机无 DB 时的基线取数工具）
 * ----------------------------------------------------------------------------
 * 为什么需要：corps 本机 e2e 需要 postgres（容器已被删），而对比度矩阵的**基线值**
 * 只依赖 CSS 令牌定义（:root 与 [data-theme="dark"] 两块），不需要登录态、不需要起 server。
 * 本探针用 Playwright 打开一个 data: URL 页面，把 corps 的 design-tokens.css 注入，
 * 再用 visual-kit 的对比度内核量真实值，写入 _probe/contrast-actual.txt。
 *
 * 运行：cd F:/Nexus/corps/web && node e2e/visual-kit/contrast-probe.cjs
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const { CONTRAST_INJECT } = require("./contrast.js");

const ROOT = path.resolve(__dirname, "..", "..");
const CSS_FILE = path.join(ROOT, "app", "design-tokens.css");
const OUT_FILE = path.join(ROOT, "_probe", "contrast-actual.txt");

/* corps 的语义令牌名（与 Interaction 不同：--fg/--surface 而非 --text/--panel） */
const PAIRS = {
  "fg/surface": ["--fg", "--surface"],
  "fg/bg": ["--fg", "--bg"],
  "fg-2/surface": ["--fg-2", "--surface"],
  "muted/surface": ["--muted", "--surface"],
  "on-accent/accent": ["--on-accent", "--accent"],
  "danger/surface": ["--danger", "--surface"],
  "accent/surface": ["--accent", "--surface"]
};

(async () => {
  const css = fs.readFileSync(CSS_FILE, "utf8");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent("<style>" + css + "</style><body></body>");
  await page.evaluate(CONTRAST_INJECT);

  const report = [];
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => {
      const el = document.documentElement;
      if (t === "light") el.removeAttribute("data-theme");
      else el.setAttribute("data-theme", t);
    }, theme);
    const rows = await page.evaluate((pairs) => {
      const cs = getComputedStyle(document.documentElement);
      const g = (k) => cs.getPropertyValue(k).trim();
      const out = [];
      for (const k in pairs) {
        const fg = g(pairs[k][0]), bg = g(pairs[k][1]);
        out.push({ name: k, fg, bg, c: window.__vk.contrast(fg, bg) });
      }
      return out;
    }, PAIRS);
    console.log("\n[" + theme + "]");
    for (const r of rows) {
      const line = theme + " · " + r.name + " = " + (r.c === null ? "N/A" : r.c.toFixed(2)) +
        "  [" + r.fg + " / " + r.bg + "]";
      console.log("  " + line);
      report.push(line);
    }
  }
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, report.join("\n") + "\n", "utf8");
  console.log("\n写入 " + OUT_FILE);
  await browser.close();
})().catch((e) => { console.error("探针异常:", e.message); process.exit(1); });
