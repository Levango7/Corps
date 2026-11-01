/**
 * visual-kit/measure.ts —— 页面测量工具（跨项目共享）
 * ----------------------------------------------------------------------------
 * 从 Interaction 的 theme-matrix.spec.js 抽出（v3.7.122）。提供：
 *   · applyTheme(page, name, opts) —— 切换主题（light 用移除属性，其余用 data-theme）
 *   · readTokens(page, tokenNames) —— 读取 CSS 变量的**声明原文**
 *   · readPairs(page, pairs) —— 读取若干前景/背景令牌配对的对比度
 *   · checkOverflow(page) —— 横向溢出检测
 *   · checkVisible(page, selectors) —— 核心控件可见性检测
 *
 * 注意：两种取数口径要分清 ——
 *   · readTokens() 读的是 `getComputedStyle(documentElement).getPropertyValue()`，
 *     即**声明原文**（corps 多数令牌是 hex，contrast.ts 的 parse 认得）；用来验"令牌有没有值"。
 *   · readPairs() 走 `window.__vk.pair()`，它把令牌落到真实属性上读 **used value**，
 *     因此 `color-mix(...)` 这类派生层也能求出颜色；并且会带回 alpha，让调用方看得见
 *     "这一对里有没有半透明层"（半透明层的屏幕色取决于叠在哪儿，配对算出来的不代表屏幕）。
 *     取数口径不同 → 数字会不同，别把两者的基线互相抄。
 *
 * ⚠️ corps 的 Playwright 以 CommonJS 语义转译 .ts（web/package.json 无
 * type:module），本文件及同目录文件**不得使用 import.meta**。
 */

/** contrast.ts 注入的 window.__vk 命名空间形状（注入后全局可用）。 */
interface VkNamespace {
  lum(rgb: number[]): number;
  parse(s: string): number[] | null;
  contrast(a: string, b: string): number | null;
  alphaOf(s: string): number;
  resolve(name: string): { value: string; alpha: number };
  pair(fgName: string, bgName: string): PairReading;
}

/** 一对令牌的实测读数（见 readPairs 的注释）。 */
interface PairReading {
  fg: string;
  bg: string;
  fgAlpha: number;
  bgAlpha: number;
  c: number | null;
}

declare global {
  interface Window {
    __vk?: VkNamespace;
  }
}

/** 切换主题。light 用移除 data-theme 属性（默认态），其余用设置属性。
 *  opts.attr 可覆盖属性名（默认 "data-theme"），opts.lightValue 可覆盖 light 的处理。 */
export async function applyTheme(
  page: import("@playwright/test").Page,
  name: string,
  opts?: { attr?: string; lightValue?: string },
): Promise<void> {
  const o = opts || {};
  const attr = o.attr || "data-theme";
  await page.evaluate(
    ({ name, attr, lightValue }) => {
      const el = document.documentElement;
      if (name === (lightValue || "light")) el.removeAttribute(attr);
      else el.setAttribute(attr, name);
    },
    { name, attr, lightValue: o.lightValue },
  );
}

/** 读取若干 CSS 变量的声明原文。返回 { tokenName: value }。 */
export async function readTokens(
  page: import("@playwright/test").Page,
  tokenNames: string[],
): Promise<Record<string, string>> {
  return page.evaluate((names) => {
    const cs = getComputedStyle(document.documentElement);
    const g = (k: string): string => cs.getPropertyValue(k).trim();
    const out: Record<string, string> = {};
    for (const n of names) out[n] = g(n);
    return out;
  }, tokenNames);
}

/** 读取前景/背景令牌配对的对比度。pairs 格式：{ "名称": ["--fg-token", "--bg-token"], ... }
 *  返回 { "名称": { fg, bg, fgAlpha, bgAlpha, c } }：
 *   · fg/bg 是**用于绘制的颜色**（used value），不是声明原文 —— 派生层（color-mix）
 *     只有求值后才是一个可比对的颜色
 *   · fgAlpha/bgAlpha 让调用方能判「这一对里有没有半透明层」：半透明层的最终色
 *     取决于它叠在什么上面，配对表算出来的值不代表屏幕色
 *   · c 为对比度（null = 解析不出颜色，调用方必须当红处理，别跳过）
 */
export async function readPairs(
  page: import("@playwright/test").Page,
  pairs: Record<string, [string, string]>,
): Promise<Record<string, PairReading>> {
  return page.evaluate((pairs) => {
    const out: Record<string, PairReading> = {};
    for (const k of Object.keys(pairs)) {
      const [fgName, bgName] = pairs[k];
      out[k] =
        window.__vk && window.__vk.pair
          ? window.__vk.pair(fgName, bgName)
          : { fg: "", bg: "", fgAlpha: 1, bgAlpha: 1, c: null };
    }
    return out;
  }, pairs);
}

/** 检测横向溢出。返回溢出像素数（≤0 表示无溢出）。 */
export async function checkOverflow(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** 检测核心控件是否可见。selectors 为字符串数组，返回 { selector: boolean }。 */
export async function checkVisible(
  page: import("@playwright/test").Page,
  selectors: string[],
): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};
  for (const sel of selectors) {
    try {
      results[sel] = await page.locator(sel).first().isVisible();
    } catch {
      results[sel] = false;
    }
  }
  return results;
}
