/**
 * visual-kit/contrast.ts —— WCAG 对比度计算内核（跨项目共享）
 * ----------------------------------------------------------------------------
 * 从 Interaction 的 theme-matrix.spec.js 抽出（v3.7.122）。设计目标：**任何前端项目
 * 都能直接用**，只依赖注入到页面上下文的一段纯函数。
 *
 * 口径（WCAG 2.x，sRGB 相对亮度）：
 *   luminance = 0.2126*R' + 0.7152*G' + 0.0722*B'  （R' = 线性化后的通道）
 *   contrast  = (Lmax + 0.05) / (Lmin + 0.05)
 *
 * ⚠️ 解析器支持四种写法：#rgb / #rrggbb / rgb()·rgba()（逗号或空格分隔，可带 / alpha）
 *    以及 **color(srgb r g b / a)** —— 后者是 Chromium 序列化 `color-mix(...)` 的形式。
 *
 * ⚠️ 2026-11-02 取数口径升级：配对改用 `resolve()`（把令牌落到一个真实属性上读
 *    **used value**），不再读 `getPropertyValue()` 的**声明原文**。因为派生层
 *    （`--shell-*`）的声明原文是替换过 var 但**没求值**的 `color-mix(...)`，算子只能返回
 *    null，而调用方当时写的是「null 就跳过」——于是半透明层把底色叠成别的颜色这件事
 *    矩阵完全看不见（axe 现场数据 27 条里 14 条就是这么漏的，见
 *    web/tests/a11y-axe-baseline.json 的 note）。hex 支持保留：直接传色值进来的调用方还要用。
 *
 * 所有函数挂在 window.__vk 命名空间下（避免污染全局，也避免多 spec 冲突）。
 */

/** 注入到页面上下文：对比度计算 + 令牌解析。注入一次即可全 spec 复用。 */
const CONTRAST_INJECT = `(() => {
  if (window.__vk && window.__vk.pair) return true;
  window.__vk = {
    lum: function(rgb){
      const f = rgb.map(v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); });
      return 0.2126*f[0]+0.7152*f[1]+0.0722*f[2];
    },
    /** 从颜色串取 alpha：没有 /a 也没有第四个分量，就是实色。
     *  注意先剔掉非数字片段：color(srgb 0.94 0.96 0.97) 里那个 srgb 不是通道值，
     *     按位置取「第四个数」会把蓝通道读成 alpha（第一版就是这么错的）。 */
    alphaOf: function(s){
      s = String(s);
      const slash = s.match(/\\/\\s*([0-9.]+)\\s*\\)/);
      if (slash) return parseFloat(slash[1]);
      const inner = s.replace(/^[a-z]+\\(/i, "").replace(/\\)$/, "");
      const nums = inner.split(/[\\s,\\/]+/).filter(t => /^[0-9.]+$/.test(t));
      return nums.length >= 4 ? parseFloat(nums[3]) : 1;
    },
    parse: function(s){
      s = String(s).trim();
      let m = s.match(/^#([0-9a-f]{3})$/i);
      if (m) return m[1].split("").map(c => parseInt(c + c, 16));
      m = s.match(/^#([0-9a-f]{6})$/i);
      if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
      m = s.match(/^color\\(srgb ([^)]+)\\)/i);
      if (m) {
        const p = m[1].split(/[\\s\\/]+/).filter(Boolean).map(Number);
        return [0, 1, 2].map(i => Math.round(p[i] * 255));
      }
      m = s.match(/^rgba?\\(([^)]+)\\)/i);
      if (m) { const p = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2]]; }
      return null;
    },
    contrast: function(a, b){
      const pa = window.__vk.parse(a), pb = window.__vk.parse(b);
      if(!pa || !pb) return null;
      const la = window.__vk.lum(pa), lb = window.__vk.lum(pb);
      const hi = Math.max(la, lb), lo = Math.min(la, lb);
      return (hi + 0.05) / (lo + 0.05);
    },
    /** 把令牌解析成浏览器真正拿去绘制的颜色（used value）+ 它的 alpha。 */
    resolve: function(name){
      const d = document.createElement("div");
      document.body.appendChild(d);
      d.style.color = "";
      d.style.setProperty("color", "var(" + name + ")");
      const v = getComputedStyle(d).color;
      d.remove();
      return { value: v, alpha: window.__vk.alphaOf(v) };
    },
    /** 一对令牌 → 实测对比度 + 各自 used value 与 alpha（调用方据此判"是不是实色"）。 */
    pair: function(fgName, bgName){
      const fg = window.__vk.resolve(fgName), bg = window.__vk.resolve(bgName);
      return {
        fg: fg.value, bg: bg.value, fgAlpha: fg.alpha, bgAlpha: bg.alpha,
        c: window.__vk.contrast(fg.value, bg.value)
      };
    }
  };
  return true;
})()`;

/** 绝对硬底线：任何主题、任何配对都不得低于此值（低于就完全读不清了）。 */
const ABS_FLOOR = 1.5;

/** 允许的抖动比例：实测值 ≥ 基线 × 此值 即通过。抓"退步超过一成就红"。 */
const TOLERANCE = 0.9;

export { CONTRAST_INJECT, ABS_FLOOR, TOLERANCE };
