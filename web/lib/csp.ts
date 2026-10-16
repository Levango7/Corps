/**
 * Content-Security-Policy 头构建（自 middleware.ts 抽出，便于单元测试）。
 *
 * TC-CFG-02 修复（渗透报告 P2-5）：原策略 script-src/style-src 同时含
 * `'unsafe-inline'` 与 nonce。按 CSP Level 3，nonce 存在时浏览器忽略
 * `'unsafe-inline'`，该冗余会掩盖未来 nonce 注入失效的回归——生产环境移除。
 *
 * 生产收紧的安全前提（已全量核实）：
 *  - 无裸 <script>；全库仅 1 处 dangerouslySetInnerHTML，内容为**模块级硬编码
 *    常量（零用户输入）**：app/global-error.tsx（主题初始化脚本）。
 *    其 nonce 依赖 Next.js 输出的 csp-nonce meta 经 React 传播至内联
 *    style/script；若生产环境出现 CSP 拦截报错，应改为外部资源或显式传 nonce
 *    （见 docs/audit 审核报告的"待实测验证项"）；
 *  - Next.js 读取 middleware 设置的 x-nonce 头后，为其自身生成的内联
 *    <script>/<style> 注入 nonce；
 *  - 开发环境保留 `'unsafe-inline'`：Next.js dev（HMR/错误 overlay）依赖内联
 *    脚本，收紧会破坏本地开发，且开发态无真实攻击面。（此条仅关乎 script-src；
 *    见下方 style-src-attr 说明，style-src 上的同类 token 在 nonce 存在时无效。）
 *
 * style-src-attr 说明：项目存在约 48 处 style={{}} 内联样式属性，React 直接写入
 * DOM 属性、无法携带 nonce，只能用 CSP3 子指令 `style-src-attr 'unsafe-inline'`
 * 单独放行（Chrome 75+ / Firefox 129+ / Safari 15.4+）。**开发与生产都需要该子指令**：
 *  - 生产：style-src 为纯 nonce，本就不含 unsafe-inline，样式属性只能靠它放行；
 *  - 开发：style-src 虽写了 `'unsafe-inline'`，但同一指令内存在 nonce 时该 token
 *    按 CSP3 被浏览器忽略（就是本文件第 5-6 行陈述的那条规则），于是 dev 同样放不了
 *    样式属性——真正生效的放行手段仍是 style-src-attr。此前该子指令只在 `if (isProd)`
 *    内注册，导致 dev 下 39 个 [style] 属性元素被拦、react-grid-item 的 transform/
 *    宽高被抑制、仪表盘布局失真，并污染所有本地 E2E/视觉断言与人工验收。现已移出
 *    条件块，两环境均注册；生产字符串保持逐字节不变。
 * 不识别该子指令的旧浏览器回退 style-src（无 unsafe-inline），内联样式将失效——
 * 项目目标为现代浏览器，该取舍已在修复计划 §4 风险 3 记录。
 * 后续将内联样式重构为 CSS 类后可彻底移除该放行。
 *
 * 开发环境 style-src 是否继续保留 `'unsafe-inline'`：保留。取舍理由——nonce 存在时
 * 该 token 被 CSP3 忽略，故它既不扩大攻击面、也不改变任何放行结果，属"无害冗余"而非
 * "额外风险"；保留还可让 style-src 主指令字符串与收紧前一致、缩小本次 diff。但它
 * **不构成** 「dev 已放行内联样式属性」的依据——那始终由 style-src-attr 负责，勿再
 * 依赖此 token（这正是本次缺陷的成因：误以为 dev 的 unsafe-inline 已放行样式属性）。
 */
export function buildCsp(nonce: string, isProd: boolean): string {
  const directives: string[] = [
    "default-src 'self'",
    // 生产：纯 nonce（移除 unsafe-inline）；开发：保留 unsafe-inline（HMR 兼容）
    isProd
      ? `script-src 'self' 'nonce-${nonce}'`
      : // 开发环境额外放开 'unsafe-eval'：React 16+ dev mode 启动时调用 eval()
        // 做错误堆栈重组,被 CSP 拦截会刷控制台错误（不影响功能但污染日志）。
        // 仅开发环境放行,生产环境绝不能加 'unsafe-eval'（XSS 大开）。
        `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'nonce-${nonce}'`,
    isProd
      ? `style-src 'self' 'nonce-${nonce}'`
      : `style-src 'self' 'unsafe-inline' 'nonce-${nonce}'`,
  ];
  // 内联 style 属性无法用 nonce，经独立子指令显式放行。
  // 开发环境同样需要：dev 的 style-src 虽含 'unsafe-inline'，但 nonce 存在时该 token
  // 被 CSP3 忽略，放行样式属性实际只能靠这条子指令。
  directives.push("style-src-attr 'unsafe-inline'");
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
