/**
 * 事件名白名单 —— 单一事实源（FUNNEL-METRICS §4.3 落实）。
 *
 * 设计：
 *  - 服务端 events/route.ts 与客户端 SDK 共同 import，消除「服务端过滤、客户端无感」的双源漂移。
 *  - 客户端 dev 环境 warn 非法名（见 analytics.ts track()），生产环境仍由服务端静默丢弃。
 *  - 白名单追加 9 名与 SDK 改造同一 PR 合入，避免「事件已打、闸门未开」的静默丢弃窗口期。
 *
 * 计数：20 旧 + 9 新 + 3 spec §8 = 32 名（P2-4 基数更正 + 集成验证补齐 spec §8 三事件）。
 *  - 旧 20：9 注册激活 + 5 核心激活 + 2 留存 + 4 转化
 *  - 新 9：landing_view / click_signup / session_start / activation_completed /
 *          invite_accepted / subscription_activated / payment_failed /
 *          subscription_renewed / subscription_churned
 *  - spec §8 三事件（定价线消费，裁决一/三约定由埋点线一次性扩齐）：
 *          view_pricing / select_billing_period / click_upgrade
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
]);
