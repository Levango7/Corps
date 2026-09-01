/** Tailwind v4 PostCSS 接线（生产构建必需）。
 *
 * 背景：next dev（Turbopack dev 路径）会自动检测 tailwindcss 依赖并接入
 * @tailwindcss/postcss，但 next build 的生产构建路径不自动接入——没有本
 * 配置时 globals.css 的 @import "tailwindcss" / @custom-variant 等 v4 指令
 * 无人处理，产物 CSS 仅剩 design-tokens 变量、缺失全部工具类（v0.2.0
 * 镜像 UI 粗糙的根因）。显式声明插件后 dev/build 两条路径行为一致。
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
