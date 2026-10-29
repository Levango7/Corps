/**
 * 事件名白名单 —— 单一事实源（FUNNEL-METRICS §4.3 落实）。
 *
 * 设计：
 *  - 服务端 events/route.ts 与客户端 SDK 共同 import，消除「服务端过滤、客户端无感」的双源漂移。
 *  - 客户端 dev 环境 warn 非法名（见 analytics.ts track()），生产环境仍由服务端静默丢弃。
 *  - 白名单追加 9 名与 SDK 改造同一 PR 合入，避免「事件已打、闸门未开」的静默丢弃窗口期。
 *
 * 计数：40 名（实测。原注释写 32，集合实际早已是 34 —— 有两处新增没回写；
 * P1-C 再 +3：workspace_create / decision_landed / export_pdf；
 * #48 再 +3：decision_reviewed / ai_extract_started / ai_extract_failed。
 * 该数字由 tests/unit/analytics-event-contract.test.ts 断言，不再靠人记得改。）
 */
export const ALLOWED_EVENT_NAMES: ReadonlySet<string> = new Set([
  // 注册激活漏斗（9）
  "register_view",
  "register_submit",
  "register_success",
  "login_view",
  "login_submit",
  "login_success",
  "onboarding_start",
  "onboarding_complete",
  "onboarding_skip",
  // 核心激活（5）
  "create_task",
  "invite_member",
  "create_decision",
  "create_comment",
  "task_status_change",
  // 留存信号（2）
  "page_view",
  "workspace_switch",
  // 转化（4）
  "billing_view",
  "billing_checkout",
  "billing_success",
  "billing_cancel",
  // ─── 新增 9 名（FUNNEL-METRICS §4.1）───
  // 获客段
  "landing_view",
  "click_signup",
  "session_start",
  // 激活段
  "activation_completed",
  // Referral
  "invite_accepted",
  // Revenue（webhook 侧，支付线消费）
  "subscription_activated",
  "payment_failed",
  "subscription_renewed",
  "subscription_churned",
  // ─── spec §8 三事件（定价线消费，裁决一/三约定由埋点线一次性扩齐）───
  "view_pricing",
  "select_billing_period",
  "click_upgrade",
  // ─── 阶段 2-2 筛选与自定义视图（看板体验线消费）───
  "filter_applied",
  "view_saved",
  // ─── P1-C 决策闭环与导出（2026-10-20）───
  // workspace_create：客户端早就在发（layout.tsx 新建工作区后 track），但从未进白名单
  //   ⇒ 服务端静默丢弃（"事件已打、闸门未开"）。补开闸，并用 analytics-event-contract 测试防再犯。
  "workspace_create",
  // decision_landed：决策创建时自动同步出至少一个任务（decision-action-parser 的 tasks 非空）
  //   —— 这是产品楔子"讨论→决策→任务"闭环的唯一可测信号。
  "decision_landed",
  // export_pdf：导出预览里点「打印 / 保存为 PDF」（PDF 走浏览器打印，纯前端）。
  "export_pdf",
  // ─── #48 决策漏斗补口（2026-10-28，owner 口径）───
  // decision_reviewed：人工点「标记已复盘」。**只在未复盘→已复盘的跃迁上发**，
  //   撤销复盘不发——分子要的是"被宣告复盘过的决策数"，不是点击次数。
  //   刻意不用"停留时长/打开详情"这类隐式信号：那是代理指标，污染当期定义，
  //   且换口径后历史数据不可再解释。
  "decision_reviewed",
  // ai_extract_started / _failed：AI 提炼决策（POST .../decisions/extract）的开始与失败。
  //   不设 _confirmed：该流程只把结果拷到剪贴板，没有"确认/采纳"动作可打；
  //   硬造一个 confirmed 会与 create_decision 形成两个事实源（同类先例已撤过
  //   decision_created / task_from_decision）。
  "ai_extract_started",
  "ai_extract_failed",
]);
