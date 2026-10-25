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
 * ⚠️ 解析器支持四种写法：#rgb / #rrggbb / rgb() / rgba()。
 *    **必须支持 hex** —— 实测踩过：`getPropertyValue('--text')` 返回的是**声明原文**
 *    （本项目为 hex），不是计算后的 rgba()；只按 rgba 解析会全部返回 null。
 *
 * 所有函数挂在 window.__vk 命名空间下（避免污染全局，也避免多 spec 冲突）。
 */

/** 注入到页面上下文：对比度计算三件套。注入一次即可全 spec 复用。 */
const CONTRAST_INJECT = `(() => {
  if (window.__vk && window.__vk.contrast) return true;
  window.__vk = {
    lum: function(rgb){
      const f = rgb.map(v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); });
      return 0.2126*f[0]+0.7152*f[1]+0.0722*f[2];
    },
    parse: function(s){
      s = String(s).trim();
      let m = s.match(/^#([0-9a-f]{3})$/i);
      if (m) return m[1].split("").map(c => parseInt(c + c, 16));
      m = s.match(/^#([0-9a-f]{6})$/i);
      if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
      m = s.match(/rgba?\\(([^)]+)\\)/);
      if (m) { const p = m[1].split(",").map(x => parseFloat(x)); return [p[0], p[1], p[2]]; }
      return null;
    },
    contrast: function(a, b){
      const pa = window.__vk.parse(a), pb = window.__vk.parse(b);
      if(!pa || !pb) return null;
      const la = window.__vk.lum(pa), lb = window.__vk.lum(pb);
      const hi = Math.max(la, lb), lo = Math.min(la, lb);
      return (hi + 0.05) / (lo + 0.05);
    }
  };
  return true;
})()`;

/** 绝对硬底线：任何主题、任何配对都不得低于此值（低于就完全读不清了）。 */
const ABS_FLOOR = 1.5;

/** 允许的抖动比例：实测值 ≥ 基线 × 此值 即通过。抓"退步超过一成就红"。 */
const TOLERANCE = 0.9;

export { CONTRAST_INJECT, ABS_FLOOR, TOLERANCE };
