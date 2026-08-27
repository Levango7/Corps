/**
 * Content-Security-Policy 头构建（自 middleware.ts 抽出，便于单元测试）。
 *
 * TC-CFG-02 修复（渗透报告 P2-5）：原策略 script-src/style-src 同时含
 * `'unsafe-inline'` 与 nonce。按 CSP Level 3，nonce 存在时浏览器忽略
 * `'unsafe-inline'`，该冗余会掩盖未来 nonce 注入失效的回归——生产环境移除。
 *
 * 生产收紧的安全前提（已全量核实）：
 *  - 代码库无 dangerouslySetInnerHTML、无裸 <script>，Next.js 读取 middleware
 *    设置的 x-nonce 头后自动为内联 <script>/<style> 注入 nonce；
 *  - 开发环境保留 `'unsafe-inline'`：Next.js dev（HMR/错误 overlay）依赖内联
 *    脚本，收紧会破坏本地开发，且开发态无真实攻击面。
 *
 * style-src-attr 说明：项目存在约 48 处 style={{}} 内联样式属性，React 直接写入
 * DOM 属性、无法携带 nonce。生产环境用 CSP3 子指令 `style-src-attr 'unsafe-inline'`
 * 单独放行样式属性（Chrome 75+ / Firefox 129+ / Safari 15.4+），从而让 style-src
 * 本身保持纯 nonce；不识别该子指令的旧浏览器回退 style-src（无 unsafe-inline），
 * 内联样式将失效——项目目标为现代浏览器，该取舍已在修复计划 §4 风险 3 记录。
 * 后续将内联样式重构为 CSS 类后可彻底移除该放行。
 */
export function buildCsp(nonce: string, isProd: boolean): string {
  const directives: string[] = [
    "default-src 'self'",
    // 生产：纯 nonce（移除 unsafe-inline）；开发：保留 unsafe-inline（HMR 兼容）
    isProd
      ? `script-src 'self' 'nonce-${nonce}'`
      : `script-src 'self' 'unsafe-inline' 'nonce-${nonce}'`,
    isProd
      ? `style-src 'self' 'nonce-${nonce}'`
      : `style-src 'self' 'unsafe-inline' 'nonce-${nonce}'`,
  ];
  if (isProd) {
    // 仅生产需要：内联 style 属性无法用 nonce，经独立子指令显式放行
    directives.push("style-src-attr 'unsafe-inline'");
  }
  directives.push(
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  );
  return directives.join("; ");
}