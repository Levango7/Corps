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
/* global document, window, console, process */
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
  "meta/surface": ["--meta", "--surface"],
  "meta/bg": ["--meta", "--bg"],
  "on-accent/accent": ["--on-accent", "--accent"],
  "danger/surface": ["--danger", "--surface"],
  "accent/surface": ["--accent", "--surface"],
  // 四面实色底 × 两个次要文字档（2026-11-02 补，路线 B）。键集必须与
  // contrast-matrix.spec.ts 的 CONTRAST_PAIRS 一致——tests/unit/contrast-kernel.test.ts 判这条。
  "meta/surface-2": ["--meta", "--surface-2"],
  "meta/surface-3": ["--meta", "--surface-3"],
  "muted/surface-2": ["--muted", "--surface-2"],
  "muted/surface-3": ["--muted", "--surface-3"],
  // 外壳三层的配对（2026-11-02 补）。此前清单只有 --surface/--bg 这类实色令牌配对，
  // 而应用正文区/侧栏真正压着的是 --shell-content / --shell-sidebar —— axe 现场数据显示
  // 27 条违规里 14 条的底就是这两层（当时它们还是半透明色，矩阵结构上看不见）。
  // 补上配对，改一次层色的退化才会当场报警。
  "meta/shell-sidebar": ["--meta", "--shell-sidebar"],
  "meta/shell-content": ["--meta", "--shell-content"],
  "muted/shell-sidebar": ["--muted", "--shell-sidebar"],
  "muted/shell-content": ["--muted", "--shell-content"],
  "fg/shell-content": ["--fg", "--shell-content"],
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
    const out = [];
    for (const k of Object.keys(pairs)) {
      // 与 contrast-matrix.spec.ts 同一个口径：走 __vk.pair() 读 used value，
      // 派生层（color-mix）才求得出颜色；这里若读声明原文会拿到未求值的串。
      const r = window.__vk.pair(pairs[k][0], pairs[k][1]);
      out.push({ name: k, fg: r.fg, bg: r.bg, c: r.c, bgAlpha: r.bgAlpha });
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
      "]" +
      (r.bgAlpha < 1 ? "  ⚠️ 底是半透明（alpha " + r.bgAlpha + "），屏幕色取决于叠在哪儿" : "");
    console.info("  " + line);
    report.push(line);
  }
}
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, report.join("\n") + "\n", "utf8");
console.info("\n写入 " + OUT_FILE);
await browser.close();
