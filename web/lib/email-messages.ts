/**
 * 事务邮件双语文案表（P0-6 B 类）。
 *
 * 为什么邮件不能走 next-intl：邮件是在服务端拼成 HTML 字符串直接发出去的，没有
 * React 渲染树可挂载，拿不到 useTranslations / getTranslations 的 hook；
 * useTranslations 依赖请求级 provider，而 cron 定时发送路径（due-reminders /
 * weekly-digest / ai-push-web）**连 request 对象都没有**。
 *
 * 更关键的是语义差别：next-intl 给的是"发请求的这个人"的语言，而邮件必须按
 * **收件人**的语言渲染——管理员在中文界面上邀请一位英文用户，那封邀请邮件
 * 就该是英文。所以语言的唯一正确来源是收件人自己 User 行上的 locale 列，
 * 这张表只负责"给定语言取出对应文案"。
 *
 * 设计约定（改这个文件时请一并遵守，否则会重新引入本表要消灭的问题）：
 *   1. 每个键都是 `{ zh, en }` 双份，缺一侧即为缺陷——英文站漏了 zh 会露出原始 key，
 *      中文站漏了 en 会露出中文。新增键时两侧必须同时给。
 *   2. 文案值里**只有纯文本与 {占位符}**，不含 HTML 标签。需要强调（<strong>）、
 *      换行之类的排版由渲染侧在填充占位符时包好——标签混进文案会让翻译者
 *      在改语序时顺手改坏标记，也会让文案无法被无 HTML 的文本邮件（text 分支）复用。
 *   3. emailMsg **不做 HTML 转义**：转义是渲染侧的职责（web/lib/email.ts 的 escapeHtml）。
 *      约定是"传进来的变量值已经是安全的 HTML 片段"，传原始用户输入进来等于开注入口子。
 *   4. 语序不硬拆成"前段/后段"：中文"在 X 中给你指派了一个任务"与英文
 *      "assigned you a task in X" 的介词位置不同，拆段会逼两种语言共用中文语序。
 *      整句进表、占位符定位，才翻得动。
 */

/** 邮件语言。与 User.locale 的取值域一致，未知值一律按 zh 处理（见 normalizeEmailLocale）。 */
export type EmailLocale = "zh" | "en";

/**
 * 双语文案表。
 *
 * 键按邮件类型分组，命名沿用调用它的渲染函数名，便于"看到文案就知道改哪封邮件"。
 */
export const EMAIL_MESSAGES = {
  // ── 通用邮件外壳 ──
  shellFooter: {
    zh: "corps · 面向中小团队的轻量协作工具",
    en: "corps · the lightweight collaboration tool for small teams",
  },

  // ── 邀请 / 已注册直加 ──
  inviteSubject: {
    zh: "{inviter} 邀请你加入 {workspace}",
    en: "{inviter} invited you to join {workspace}",
  },
  invitePendingBody1: {
    zh: "{inviter} 邀请你加入 {workspace}。",
    en: "{inviter} invited you to join {workspace}.",
  },
  invitePendingBody2: {
    zh: "点击下方按钮设置密码并加入，链接 7 天内有效。",
    en: "Click the button below to set your password and join. The link expires in 7 days.",
  },
  inviteJoinedBody1: {
    zh: "{inviter} 将你加入了 {workspace}。",
    en: "{inviter} added you to {workspace}.",
  },
  inviteJoinedBody2: {
    zh: "登录后即可在任务看板中查看并开始协作。",
    en: "Sign in to find it on your task board and start collaborating.",
  },
  ctaAcceptInvite: { zh: "接受邀请", en: "Accept invitation" },
  ctaSignInCorps: { zh: "登录 corps", en: "Sign in to corps" },

  // ── 任务指派 ──
  taskAssignedSubject: {
    zh: "{assigner} 给你指派了任务「{task}」",
    en: '{assigner} assigned you the task "{task}"',
  },
  taskAssignedPreheader: {
    zh: "新任务指派：{task}",
    en: "New task assigned: {task}",
  },
  taskAssignedBody1: {
    zh: "{assigner} 在 {workspace} 中给你指派了一个任务：",
    en: "{assigner} assigned you a task in {workspace}:",
  },
  taskAssignedBody2: {
    zh: "点击下方按钮查看任务详情。",
    en: "Click the button below to see the task details.",
  },
  ctaViewTask: { zh: "查看任务", en: "View task" },

  // ── 截止日提醒 ──
  dueReminderSubject: {
    zh: "任务「{task}」明天到期",
    en: 'The task "{task}" is due tomorrow',
  },
  dueReminderPreheader: {
    zh: "截止日提醒：{task} 明天到期",
    en: "Due date reminder: {task} is due tomorrow",
  },
  dueReminderBody1: {
    zh: "你在 {workspace} 中负责的任务即将到期：",
    en: "A task you own in {workspace} is coming due:",
  },
  dueReminderDueDate: {
    zh: "截止日期：{due}",
    en: "Due date: {due}",
  },
  dueReminderBody2: {
    zh: "请尽快处理，避免逾期。",
    en: "Please take care of it soon so it does not slip past the deadline.",
  },

  // ── @提及 ──
  mentionSubject: {
    zh: "{mentioner} 在「{task}」中提到了你",
    en: '{mentioner} mentioned you in "{task}"',
  },
  mentionPreheader: {
    zh: "@提及：{mentioner} 在 {task} 中提到了你",
    en: "Mention: {mentioner} mentioned you in {task}",
  },
  mentionBody1: {
    zh: "{mentioner} 在 {workspace} 的任务评论中提到了你：",
    en: "{mentioner} mentioned you in a task comment in {workspace}:",
  },
  mentionBody2: {
    zh: "点击下方按钮查看并回复。",
    en: "Click the button below to view it and reply.",
  },
  ctaViewComment: { zh: "查看评论", en: "View comment" },

  // ── 密码重置 ──
  resetSubject: { zh: "重置你的 corps 密码", en: "Reset your corps password" },
  resetPreheader: {
    zh: "密码重置请求：链接 1 小时内有效",
    en: "Password reset request: the link is valid for 1 hour",
  },
  resetBody1: {
    zh: "我们收到了你的密码重置请求。点击下方按钮设置新密码，链接 {expiry}。",
    en: "We received a request to reset your password. Click the button below to set a new one — the link {expiry}.",
  },
  resetExpiry: { zh: "1 小时内有效", en: "is valid for 1 hour" },
  resetBody2: {
    zh: "如果不是你本人操作，可以忽略这封邮件，你的密码不会被更改。",
    en: "If this was not you, you can safely ignore this email — your password stays unchanged.",
  },
  ctaResetPassword: { zh: "重置密码", en: "Reset password" },

  // ── 邮箱验证 ──
  verifySubject: { zh: "验证你的 corps 邮箱", en: "Verify your corps email address" },
  verifyPreheader: {
    zh: "完成邮箱验证即可开始使用（链接 24 小时内有效）",
    en: "Verify your email to get started (the link is valid for 24 hours)",
  },
  verifyBody1: {
    zh: "感谢注册 corps。点击下方按钮验证你的邮箱，完成注册。",
    en: "Thanks for signing up for corps. Click the button below to verify your email and finish signing up.",
  },
  verifyBody2: {
    zh: "链接 {expiry}，且只能使用一次。",
    en: "The link {expiry} and can only be used once.",
  },
  verifyExpiry: { zh: "24 小时内有效", en: "is valid for 24 hours" },
  verifyBody3: {
    zh: "如果不是你本人操作，可以忽略这封邮件，不会创建任何账户活动。",
    en: "If this was not you, you can safely ignore this email — no account activity will be created.",
  },
  ctaVerifyEmail: { zh: "验证邮箱", en: "Verify email" },

  // ── 账户删除确认 ──
  deletedSubject: { zh: "你的 corps 账户已删除", en: "Your corps account has been deleted" },
  deletedPreheader: { zh: "账户删除确认通知", en: "Account deletion confirmation" },
  deletedBody1: {
    zh: "我们确认你的 corps 账户及关联数据已删除完毕。",
    en: "This confirms that your corps account and the data associated with it have been deleted.",
  },
  deletedBody2: {
    zh: "随账户一并删除的{workspaces}共 {count} 个（含其任务、决策、聊天与附件记录）；你曾作为成员加入的其他工作区不受影响，仅移除了你的成员身份。",
    en: "A total of {count} {workspaces} were deleted along with your account, including their tasks, decisions, chats and attachments. Workspaces you had joined as a member are unaffected — only your membership was removed.",
  },
  deletedOwnWorkspaces: { zh: "自有工作区", en: "workspaces you owned" },
  deletedBody3: {
    zh: "如果这是误操作或你有任何疑问，请在 7 天内联系支持邮箱——部分数据可能仍有备份可恢复（见隐私政策）。",
    en: "If this was a mistake or you have questions, reach out to our support email within 7 days — some data may still exist in backups (see the privacy policy).",
  },
  ctaRevisitCorps: { zh: "重新访问 corps", en: "Revisit corps" },

  // ── 每周任务摘要 ──
  digestSubject: {
    zh: "本周任务摘要：{workspace}（逾期 {overdue} · 本周到期 {upcoming}）",
    en: "Weekly task digest: {workspace} ({overdue} overdue · {upcoming} due this week)",
  },
  digestTitle: {
    zh: "本周任务摘要 · {workspace}",
    en: "Weekly task digest · {workspace}",
  },
  digestPreheader: {
    zh: "逾期 {overdue} 项，本周到期 {upcoming} 项",
    en: "{overdue} overdue, {upcoming} due this week",
  },
  digestGreeting: {
    zh: "{name}，这是你在 {workspace} 的每周任务摘要：",
    en: "{name}, here is your weekly task digest for {workspace}:",
  },
  digestFallbackName: { zh: "同事", en: "Hello" },
  digestOverdueHeading: { zh: "已逾期（{count}）", en: "Overdue ({count})" },
  digestUpcomingHeading: {
    zh: "未来 7 天到期（{count}）",
    en: "Due in the next 7 days ({count})",
  },
  digestAllClear: {
    zh: "你负责的任务没有逾期项，未来 7 天也没有到期任务——干得漂亮。",
    en: "Nothing you own is overdue and nothing is due in the next 7 days — nice work.",
  },
  digestTruncationNote: {
    zh: "列表最多显示 10 条，完整清单请打开工作区查看。",
    en: "Each list shows at most 10 items — open the workspace for the full list.",
  },
  digestStatsHeading: { zh: "本周大盘", en: "This week at a glance" },
  digestStatsLine: {
    zh: "注册 {registers} · 激活 {activations} · 建任务 {taskCreates} · 浏览 {pageViews}",
    en: "Sign-ups {registers} · Activations {activations} · Tasks created {taskCreates} · Page views {pageViews}",
  },
  ctaOpenWorkspace: { zh: "打开工作区", en: "Open workspace" },

  // ── AI 推送邮件（web/lib/ai/push-email.ts）──
  pushCtaViewDetails: { zh: "查看详情", en: "View details" },
  pushFooter: { zh: "corps · AI 推送通知", en: "corps · AI push notification" },

  // ── 离线通知邮件（web/lib/notification/offline-push.ts）──
  offlineActorSystem: { zh: "系统", en: "System" },
  offlineSubject: { zh: "{actor}：{title}", en: "{actor}: {title}" },
  offlineUpdateLine: {
    zh: "{actor} 在 {title} 中有新动态。",
    en: "{actor} posted an update in {title}.",
  },
  offlineSignInHint: { zh: "请登录查看详情。", en: "Sign in to see the details." },
} as const;

/** 文案键。新增键时 EMAIL_MESSAGES 里 zh/en 两侧都要给，类型会强制键存在但不会强制双语。 */
export type EmailMsgKey = keyof typeof EMAIL_MESSAGES;

/**
 * 把任意来源的语言值收敛到 EmailLocale。
 *
 * 为什么要这个收敛：User.locale 是可变长字符串列（历史行由迁移的 DEFAULT 回填），
 * 类型上只是 string，直接拿去索引文案表会得到 undefined 并渲染出 "undefined"。
 * 按"未知即 zh"兜底与 apiLocale(req)（lib/api-messages.ts）的兜底保持一致。
 */
export function normalizeEmailLocale(value: unknown): EmailLocale {
  return value === "en" ? "en" : "zh";
}

/**
 * 取指定 key 在给定语言下的文案，并填充 {占位符}。
 *
 * 不做 HTML 转义（见文件头约定 3）：调用方必须传入已转义/已拼好标签的片段。
 * 占位符在文案里缺失时原样保留 {name}，方便一眼看出是哪个变量没传。
 */
export function emailMsg(
  key: EmailMsgKey,
  locale: EmailLocale,
  vars?: Record<string, string | number>,
): string {
  const template: string = EMAIL_MESSAGES[key][locale];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/** <html lang> 取值：中文走 zh-CN（含地区，影响字形与断行），英文走无地区的 en。 */
export function emailHtmlLang(locale: EmailLocale): string {
  return locale === "en" ? "en" : "zh-CN";
}

/**
 * Intl 区域标签：邮件正文里的日期（截止日、摘要列表）必须跟正文同语言，
 * 否则英文邮件里会夹一个 "10月19日"。
 */
export function emailDateLocale(locale: EmailLocale): string {
  return locale === "en" ? "en-US" : "zh-CN";
}
