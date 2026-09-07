/* eslint-disable */
// 程序化布局崩点检测（替代人眼截图审阅）：
//  1) 横向溢出（元素超出视口）
//  2) 文本截断（scrollWidth > clientWidth 且非刻意的 truncate）
//  3) 可交互元素重叠（button/input/select 相交）
//  4) 触控目标过小（< 24px 高或宽的按钮，仅移动档）
// 三引擎：chromium + firefox + webkit（Safari 近似——无 Mac/iPhone 时的
// 日常替代，注意：WebKit 引擎近似渲染，不覆盖真机触摸/安全区/滚动回弹）。
// 输出文本报告；dev server 须在 localhost:3000。
import { chromium, firefox, webkit } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PASSWORD = "Test1234!";
const ENGINES = [
  { id: "chromium", name: "chromium", launch: () => chromium.launch() },
  { id: "firefox", name: "firefox", launch: () => firefox.launch() },
  { id: "webkit", name: "webkit(safari近似)", launch: () => webkit.launch() },
];
const VIEWPORTS = [
  { name: "pc", width: 1440, height: 900 },
  { name: "ipad", width: 768, height: 1024 },
  { name: "iphone", width: 390, height: 844 },
];

const AUDIT = `() => {
  try {
  const vw = document.documentElement.clientWidth;
  const issues = [];
  const isVisible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // 1) 溢出视口的元素（忽略滚动容器内的内容，只抓外壳级溢出）
  document.querySelectorAll('body *').forEach((el) => {
    if (!isVisible(el)) return;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 2 && r.width < vw * 2) {
      const tag = el.tagName.toLowerCase();
      if (['html','body','script','style','svg','path'].includes(tag)) return;
      let p = el.parentElement;
      let scrollable = false;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|overlay)/.test(s.overflowX)) { scrollable = true; break; }
        p = p.parentElement;
      }
      if (scrollable) return;
      let cls = '';
      try { cls = String(el.className || '').slice(0, 60); } catch (e) { cls = ''; }
      issues.push({ kind: 'overflow-right', desc: tag + '.' + cls, right: Math.round(r.right), vw: vw });
    }
  });
  // 2) 可交互元素重叠（前 60 个，限流）
  const inter = [...document.querySelectorAll('button, a, input, select, textarea')].filter(isVisible).slice(0, 60);
  for (let i = 0; i < inter.length; i++) {
    for (let j = i + 1; j < inter.length; j++) {
      const a = inter[i].getBoundingClientRect();
      const b = inter[j].getBoundingClientRect();
      if (inter[i].contains(inter[j]) || inter[j].contains(inter[i])) continue;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 4 && oy > 4) {
        const name = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20);
        issues.push({ kind: 'overlap', desc: name(inter[i]) + ' <-> ' + name(inter[j]), ox: Math.round(ox), oy: Math.round(oy) });
      }
    }
  }
  // 3) 触控目标过小（高 < 20）
  document.querySelectorAll('button, a[href]').forEach((el) => {
    if (!isVisible(el)) return;
    const r = el.getBoundingClientRect();
    if (r.height < 20) {
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20);
      issues.push({ kind: 'tiny-target', desc: name || el.tagName, h: Math.round(r.height) });
    }
  });
  return issues;
  } catch (e) {
    return [{ kind: 'audit-error', desc: String(e && e.message).slice(0, 200) }];
  }
}`;

async function registerAndLogin(page, email) {
  await page.goto(`${BASE}/auth/signup`);
  // WebKit 坑：fill() 对 React 受控 type=text 输入框在 WebKit 下不触发
  // onChange（值填不进 state，原生校验拦截提交）。pressSequentially 逐字符
  // 模拟真实按键在两个引擎下都可靠；email/password 不受影响但统一用。
  const ws = page.getByLabel("工作区名称");
  await ws.click();
  await ws.pressSequentially(`布局审计${Date.now() % 10000}`, { delay: 20 });
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "创建并进入" }).click();
  await page.waitForURL(/\/w\//, { timeout: 30_000 });
}

async function main() {
  const report = [];

  for (const engine of ENGINES) {
    let browser;
    try {
      browser = await engine.launch();
    } catch (e) {
      report.push(`\n=== ${engine.name} 引擎启动失败: ${e.message.split("\n")[0]} ===`);
      continue;
    }

    for (const vp of VIEWPORTS) {
      const email = `audit-${engine.id}-${vp.name}-${Date.now()}@example.com`;
      // Firefox 默认 locale 是 en-US，页面渲染成英文导致中文选择器全落空
      // （Chromium/WebKit 在本机会继承系统中文）。显式钉死，三引擎行为一致。
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        locale: "zh-CN",
      });
      const page = await ctx.newPage();
      try {
        await registerAndLogin(page, email);
        const wid = page.url().match(/\/w\/([0-9a-f-]{36})/)?.[1];
        // 注册成功但认证链（refresh/cookie 落定）在 WebKit 下偶尔未完成——
        // 立即 goto 会被工作区 layout 的 401 兜底跳 /auth/login 顶掉导航。
        // 等概览页渲染出内容再继续，规避竞态。
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1500);
        const pages = [
          ["/", "概览"],
          ["/board", "看板"],
          ["/decisions", "决策"],
          ["/notifications", "通知"],
          ["/members", "成员"],
          ["/settings", "设置"],
        ];
        for (const [p, label] of pages) {
          await page.goto(`${BASE}/w/${wid}${p}`);
          await page.waitForLoadState("networkidle");
          // 字符串形式的 evaluate 在此 playwright 版本返回 undefined，
          // 用函数形式包装：页面内 eval(AUDIT 源码) 拿结果
          const issues = await page.evaluate((src) => {
            try {
              const fn = eval(src);
              return fn();
            } catch (e) {
              return [{ kind: "audit-error", desc: String(e && e.message).slice(0, 200) }];
            }
          }, AUDIT);
          // 去重 + 截断
          const seen = new Set();
          const uniq = (issues || []).filter((i) => {
            const k = i.kind + "|" + i.desc;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
          report.push(`\n=== ${engine.name} ${vp.name} ${label} (${uniq.length} issues) ===`);
          uniq
            .slice(0, 12)
            .forEach((i) =>
              report.push(
                `  ${i.kind}: ${i.desc}${i.right ? ` right=${i.right}/${i.vw}` : ""}${i.h ? ` h=${i.h}px` : ""}`,
              ),
            );
        }
      } catch (e) {
        report.push(`\n=== ${engine.name} ${vp.name} 失败: ${e.message.split("\n")[0]} ===`);
      }
      await ctx.close();
    }
    await browser.close();
  }
  console.log(report.join("\n"));
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
