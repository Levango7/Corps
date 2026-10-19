/**
 * 独立 HTML 文档的调色板（邮件模板 / 批量导出）
 *
 * ## 为什么这里是 hex 字面量而不是 design token
 *
 * 这里的两类产物都**拿不到本站的 CSS 自定义属性**：
 *   - 邮件 HTML：Gmail / Outlook 系客户端会剥掉或无视 `var(--token)`，
 *     只认内联 style 里的字面色值；
 *   - 批量导出 HTML/PDF：脱离本站 CSS 的独立文档，引不到 design token。
 *
 * 也就是说「用 var() 替换硬编码色」在这两处是**硬约束下做不到**的，不是偷懒。
 * 结论已在 `scripts/p0-content-baseline.txt` 的 P0-4 段里论证过，不要试图推翻。
 *
 * ## 那为什么还要集中到这一个文件
 *
 * 因为真正的缺陷从来不是「用了字面量」，而是**同一套调色板被复制粘贴了三份**：
 * `lib/email.ts`（22 处）、`lib/ai/push-email.ts`（9 处，模板明显是从 email.ts 抄的）、
 * `lib/notification/offline-push.ts`（1 处）。三份副本之间没有单一真源，改品牌色时
 * 只改一处就会让两类邮件配色不一致，而且这种漂移没有任何测试能发现。
 *
 * 集中到一处后：
 *   - 改色只改这里，三个消费方同步生效；
 *   - `web/tests/unit/html-palette.test.ts` 钉死值集合，误改即红；
 *   - 消费方源码里不再出现 hex 字面量，P0-4 命中从「散落 3 文件」收敛为「此处 1 文件」。
 *
 * ⚠️ 改这里的值 = 改邮件的实际观感，属于产品决策，不要顺手改。
 */

/** 邮件 HTML 模板调色板（13 色，来自三个邮件模板文件的全部唯一值） */
export const EMAIL_COLORS = {
  /** 页面底色：<body> 与最外层 <table> 的 background */
  pageBg: "#f6f7f9",
  /** 标题/正文主色：<body> 的 color 与 <h1> 标题 */
  titleFg: "#0f172a",
  /** 分隔线：卡片 border 与页脚 border-top */
  border: "#e5e7eb",
  /** 正文文字色：内容段落 */
  bodyFg: "#334155",
  /**
   * 品牌主色：CTA 按钮底色 + 强调文字（「未来 7 天到期」「本周大盘」小标题）。
   *
   * 2026-10-19 对齐 `--p-accent`。原本这里是两个键：
   *   - `ctaBg`   = `#2563eb`（Tailwind blue-600）
   *   - `accentFg` = `#4263eb`（品牌主色）
   * 产品界面用 #4263eb 而邮件按钮用 #2563eb，同一封邮件里按钮和强调文字撞出
   * 两个不同的蓝。统一到主色后两者取值相同，**故合并为一个键**——保持两个键
   * 只会让它们在将来悄悄漂移回两个颜色（html-palette.test.ts 的「同一调色板
   * 内部不重复」断言会挡住这种重复，合并才是正解）。
   *
   * 键名不带 Fg/Bg 后缀是**刻意的**：本调色板其余键都以后缀标明前景/背景，而
   * 这一色同时承担两种角色（按钮底色 + 强调文字色），带任一个后缀都会误导
   * 另一种用法。
   */
  accent: "#4263eb",
  /** 页脚弱化文字色 */
  footerFg: "#94a3b8",
  /** 引用块底色：任务标题块 / 评论摘要块 background */
  quoteBg: "#f1f5f9",
  /** 警示块底色：截止日提醒的任务块、每周摘要的逾期任务行 background */
  warnBg: "#fef3c7",
  /** 引用块文字色：评论摘要片段；离线通知邮件的正文片段 */
  quoteFg: "#475569",
  /** 附注文字色：「如果不是你本人操作…」说明段 */
  noteFg: "#64748b",
  /** 信息块底色：每周摘要的未来到期任务行 / 本周大盘块 background */
  infoBg: "#eef2ff",
  /** 逾期强调文字色：「已逾期（N）」小标题 */
  overdueFg: "#b45309",
  /** 脚注文字色：「列表最多显示 10 条…」 */
  footnoteFg: "#6b7280",
} as const;

/**
 * 批量导出 HTML/PDF 调色板（9 色，来自 batch-export/route.ts 的 13 处去重后唯一值）
 *
 * 键名按语义起，注释标注原本对应的 CSS 位置，方便与内联 <style> 逐条核对。
 */
export const EXPORT_COLORS = {
  /** 正文文字色：body { color } */
  text: "#1a1a1a",
  /** 分隔线：h1 { border-bottom } 与 hr { border-top } */
  border: "#e5e5e5",
  /** 引用块左侧竖条：blockquote { border-left } */
  quoteBar: "#d0d0d0",
  /** 引用块文字色：blockquote { color } */
  quoteFg: "#555",
  /** 浅底块面：code / pre / th 的 background */
  surface: "#f5f5f5",
  /** 链接色与目录标题下划线：a { color }、.toc h1 { border-bottom } */
  link: "#2563eb",
  /** 表格单元格边框：th, td { border } */
  thBorder: "#ddd",
  /** 文档元信息弱化文字色：.doc-meta { color } */
  metaFg: "#888",
  /** 文档元信息下方分隔线：.doc-meta { border-bottom } */
  rowBorder: "#f0f0f0",
} as const;
