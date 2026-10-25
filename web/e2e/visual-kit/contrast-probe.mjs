#!/usr/bin/env node
/* contrast-probe.mjs —— corps 令牌对比度实测（基线取数工具）
 * ----------------------------------------------------------------------------
 * 为什么需要：corps 本机 e2e 需要 postgres（容器不总在跑），而对比度矩阵的**基线值**
 * 只依赖 CSS 令牌定义（design-tokens.css 的 :root 与 [data-theme="dark"] 两块），
 * 不需要登录态、不需要起 server。
 * 本探针用 Playwright 打开一个 data: URL 页面，把 design-tokens.css 注入，
 * 再用 visual-kit 的对比度内核量真实值，写入 _probe/contrast-actual.txt。
 *
 * ⚠️ 复用说明：从 contrast.ts 导入（Node≥22.18 原生剥类型可直接引 .ts）；
 *    不要改成 ./contrast.js —— corps 的 kit 是 .ts，plain node 不做 .js→.ts 映射。
 *
 * 运行：cd F:/Nexus/corps/web && node e2e/visual-kit/contrast-probe.mjs
 * 可选：第二个参数指定 CSS 路径（默认 app/design-tokens.css），用于对着
 *       git show 出的 committed 版本复验基线：
 *       git show HEAD:web/app/design-tokens.css > /tmp/tokens.css
 *       node e2e/visual-kit/contrast-probe.mjs /tmp/tokens.css
 */
/* global document, getComputedStyle, window, console, process */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { CONTRAST_INJECT } from "./contrast.ts";

const ROOT = process.cwd();
const CSS_FILE = path.resolve(ROOT, process.argv[2] || "app/design-tokens.css");
const OUT_FILE = path.join(ROOT, "_probe", "contrast-actual.txt");

/* corps 的语义令牌名（基于 design-tokens.css 的 --p-* 层解析后的值） */
const PAIRS = {
  "fg/surface": ["--fg", "--surface"],
  "fg/bg": ["--fg", "--bg"],
  "fg-2/surface": ["--fg-2", "--surface"],
  "muted/surface": ["--muted", "--surface"],
  "on-accent/accent": ["--on-accent", "--accent"],
  "danger/surface": ["--danger", "--surface"],
  "accent/surface": ["--accent", "--surface"],
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const css = fs.readFileSync(CSS_FILE, "utf8");
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
    for (const k of Object.keys(pairs)) {
      const fg = g(pairs[k][0]),
        bg = g(pairs[k][1]);
      out.push({ name: k, fg, bg, c: window.__vk.contrast(fg, bg) });
    }
    return out;
  }, PAIRS);
  console.info("\n[" + theme + "]");
  for (const r of rows) {
    const line =
      theme +
      " · " +
      r.name +
      " = " +
      (r.c === null ? "N/A" : r.c.toFixed(2)) +
      "  [" +
      r.fg +
      " / " +
      r.bg +
      "]";
    console.info("  " + line);
    report.push(line);
  }
}
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, report.join("\n") + "\n", "utf8");
console.info("\n写入 " + OUT_FILE);
await browser.close();
