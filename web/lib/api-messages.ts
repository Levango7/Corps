/**
 * API 路由响应 message 双语常量（阶段 3 i18n 收口）
 *
 * 背景：UI 已全量双语（zh/en 683 键级对称），但 API 路由 JSON message 长期
 * 硬编码中文（审计时约百处/40+ 文件）——英文用户操作出错时拿到的提示
 * 仍是中文。本模块集中收口：
 *  - 全部 message 走键引用，禁止 route 内写裸中文文案
 *  - 语言协商与 next-intl 同源：NEXT_LOCALE cookie 优先，回退
 *    Accept-Language 头（与 lib/i18n-routing.ts 的 detection 策略一致；
 *    API 路径不走 intl middleware，故在此自行解析）
 *  - 纯函数 + 常量表，无 IO；测试直接断言键值对称
 *
 * 命名约定：短键（"taskNotFound" 而非 "api.taskNotFound"），与 labelKey
 * 短键约定一致（见 messages/ 约定）。
 */
import type { NextRequest } from "next/server";

export type ApiMsgKey = keyof typeof API_MESSAGES;

/** 各 key 的 { zh, en } 双语文案。新键必须双端同加。 */
export const API_MESSAGES = {
  /* ── 通用错误 ── */
  internalError: { zh: "服务器内部错误", en: "Internal server error" },
  invalidBody: { zh: "请求体无效", en: "Invalid request body" },
  invalidParams: { zh: "请求参数无效", en: "Invalid request parameters" },
  unauthorized: { zh: "未授权", en: "Unauthorized" },
  forbidden: { zh: "禁止访问", en: "Forbidden" },
  validationFailed: { zh: "参数校验失败", en: "Validation failed" },
  validationError: { zh: "参数校验错误", en: "Validation error" },

  /* ── 资源不存在 ── */
  taskNotFound: { zh: "任务不存在", en: "Task not found" },
  decisionNotFound: { zh: "决策不存在", en: "Decision not found" },
  documentNotFound: { zh: "文档不存在", en: "Document not found" },
  memberNotFound: { zh: "成员不存在", en: "Member not found" },
  milestoneNotFound: { zh: "里程碑不存在", en: "Milestone not found" },
  labelNotFound: { zh: "标签不存在", en: "Label not found" },
  parentTaskNotFound: { zh: "父任务不存在", en: "Parent task not found" },
  workspaceNotFound: { zh: "工作区不存在", en: "Workspace not found" },
  attachmentNotFound: { zh: "附件不存在", en: "Attachment not found" },
  fileNotFound: { zh: "文件不存在", en: "File not found" },
  userNotFound: { zh: "用户不存在", en: "User not found" },

  /* ── 任务 ── */
  assigneeNotMember: {
    zh: "被指派人必须是当前工作区成员",
    en: "Assignee must be a member of this workspace",
  },
  onlyAdminAssign: { zh: "仅管理员可指派任务", en: "Only admins can assign tasks" },
  onlyAdminBatchAssign: {
    zh: "仅管理员可批量指派任务",
    en: "Only admins can batch-assign tasks",
  },
  onlyCreatorOrAdminDelete: {
    zh: "仅任务创建者或管理员可删除任务",
    en: "Only the task creator or admins can delete tasks",
  },
  subtaskOneLevelOnly: {
    zh: "仅支持一层子任务（父级本身不能是子任务）",
    en: "Only one level of subtasks is supported (a subtask cannot have subtasks)",
  },

  /* ── 成员与权限 ── */
  noPermission: { zh: "无权限", en: "Permission denied" },
  onlyAdminOrOwnerChangeRole: {
    zh: "仅管理员或所有者可改成员角色",
    en: "Only admins or the owner can change member roles",
  },
  ownerRoleImmutable: {
    zh: "不能修改所有者的角色，请先转让所有权",
    en: "The owner's role cannot be changed; transfer ownership first",
  },
  cannotChangeOwnRole: { zh: "不能修改自己的角色", en: "You cannot change your own role" },
  onlyOwnerChangeAdmin: {
    zh: "仅所有者可变更管理员角色",
    en: "Only the owner can change admin roles",
  },
  onlyAdminOrOwnerRemoveMember: {
    zh: "仅管理员或所有者可移除成员",
    en: "Only admins or the owner can remove members",
  },
  cannotRemoveSelf: { zh: "不能移除自己", en: "You cannot remove yourself" },
  cannotRemoveOwner: { zh: "不能移除工作区拥有者", en: "The workspace owner cannot be removed" },
  onlyOwnerRemoveAdmin: {
    zh: "仅拥有者可移除管理员",
    en: "Only the owner can remove admins",
  },
  onlyOwnerOrAdminUpdateWorkspace: {
    zh: "仅所有者或管理员可修改工作区",
    en: "Only the owner or admins can update the workspace",
  },
  slugTaken: { zh: "该标识已被占用", en: "This identifier is already taken" },
  userAlreadyMember: { zh: "该用户已是成员", en: "This user is already a member" },
  onlyOwnerTransfer: { zh: "仅所有者可转让所有权", en: "Only the owner can transfer ownership" },
  alreadyOwner: { zh: "已经是所有者，无需转让", en: "Already the owner; no transfer needed" },
  transfereeNotMember: {
    zh: "被转让用户不是工作区成员",
    en: "The transferee is not a member of this workspace",
  },

  /* ── 邀请 ── */
  invitationInvalid: {
    zh: "该邀请已失效（已接受或已过期）",
    en: "This invitation is no longer valid (accepted or expired)",
  },
  invitationEmailMismatch: {
    zh: "请使用受邀邮箱注册/登录后再接受邀请",
    en: "Please sign up or sign in with the invited email before accepting",
  },
  invitationNotFound: { zh: "邀请不存在", en: "Invitation not found" },

  /* ── 席位门控 ── */
  seatsFullRenew: {
    zh: "席位已满，请增购或续费套餐后邀请更多成员",
    en: "Seats are full. Purchase more seats or renew your plan to invite more members",
  },
  seatsFullUpgrade: {
    zh: "席位已满，请升级套餐以邀请更多成员",
    en: "Seats are full. Upgrade your plan to invite more members",
  },
  seatsFullContactRenew: {
    zh: "席位已满，请联系工作区管理员增购或续费套餐",
    en: "Seats are full. Contact the workspace admin to purchase more seats or renew the plan",
  },
  seatsFullContactUpgrade: {
    zh: "席位已满，请联系工作区管理员升级套餐",
    en: "Seats are full. Contact the workspace admin to upgrade the plan",
  },

  /* ── 分享（任务/文档公开只读）── */
  shareLinkInvalidUnpublished: {
    zh: "分享链接无效或文档尚未发布",
    en: "Invalid share link, or the document has not been published yet",
  },
  shareLinkInvalidRevoked: {
    zh: "分享链接无效或已被撤销",
    en: "Invalid share link, or sharing has been revoked",
  },

  /* ── 计费 ── */
  billingUnavailable: {
    zh: "计费服务暂时不可用，请稍后重试",
    en: "Billing is temporarily unavailable; please try again later",
  },
  yearlyPriceNotConfigured: {
    zh: "年付价格未配置",
    en: "Yearly pricing is not configured",
  },
  portalNotSupported: {
    zh: "当前支付通道不支持自助管理",
    en: "Self-service billing management is not supported for this payment channel",
  },

  /* ── 通知 ── */
  notificationsNeedIdOrAll: {
    zh: "必须提供 id 或 all=true",
    en: "Either id or all=true must be provided",
  },

  /* ── 搜索 ── */
  searchQueryRequired: { zh: "参数 q 必填", en: "The q parameter is required" },
  searchQueryBlank: {
    zh: "参数 q 不能为空或纯空格",
    en: "The q parameter cannot be empty or whitespace",
  },

  /* ── 标签 ── */
  labelNameExists: { zh: "标签名已存在", en: "A label with this name already exists" },

  /* ── 附件上传 ── */
  missingFile: { zh: "缺少文件", en: "Missing file" },
  unsupportedFileType: {
    zh: "不支持的文件类型",
    en: "Unsupported file type",
  },
  fileSizeExceededPro: {
    zh: "文件大小不能超过 50MB",
    en: "File size cannot exceed 50MB",
  },
  fileSizeExceededFree: {
    zh: "免费版附件单文件最大 10MB，升级 Pro 可到 50MB",
    en: "Free plan attachments are limited to 10MB; upgrade to Pro for up to 50MB",
  },

  /* ── SSE ── */
  tooManySseConnections: {
    zh: "并发连接过多，请关闭其他标签页后重试",
    en: "Too many concurrent connections; close other tabs and retry",
  },

  /* ── 日历 OAuth ── */
  unsupportedCalendarProvider: {
    zh: "不支持的日历 provider",
    en: "Unsupported calendar provider",
  },
  calendarMissingParams: {
    zh: "缺少 code 或 state 参数",
    en: "Missing code or state parameter",
  },
  calendarStateInvalid: { zh: "state 验证失败", en: "State validation failed" },
  calendarCallbackFailed: { zh: "授权回调失败", en: "Authorization callback failed" },
  calendarConnectFailed: { zh: "授权发起失败", en: "Failed to initiate authorization" },
  calendarDisconnectFailed: { zh: "断开连接失败", en: "Failed to disconnect" },
  calendarSyncFailed: { zh: "同步失败", en: "Sync failed" },
  refreshTokenMissing: {
    zh: "未获取到 refresh_token，请重新授权",
    en: "Failed to obtain refresh_token; please re-authorize",
  },

  /* ── 账户删除 ── */
  accountEmailMismatch: {
    zh: "确认邮箱与账户邮箱不一致，已取消删除",
    en: "The confirmation email does not match the account email; deletion cancelled",
  },

  /* ── 认证 ── */
  invalidCredentials: { zh: "邮箱或密码错误", en: "Invalid credentials" },
  notMemberOfWorkspace: {
    zh: "不是该工作区成员",
    en: "Not a member of this workspace",
  },
  emailAlreadyRegistered: { zh: "该邮箱已注册", en: "Email already registered" },
  noActiveSession: { zh: "无活跃会话", en: "No active session" },
  noWorkspace: { zh: "无可用工作区", en: "No workspace" },
  authProviderNoUser: {
    zh: "认证服务未返回用户",
    en: "Auth provider returned no user",
  },

  /* ── 权限（细粒度 403）── */
  onlyOwnerAdminInvite: {
    zh: "仅所有者或管理员可邀请",
    en: "Only the owner or admins can invite",
  },
  onlyOwnerAdminCreateLabels: {
    zh: "仅所有者或管理员可创建标签",
    en: "Only the owner or admins can create labels",
  },
  onlyOwnerAdminCreateMilestones: {
    zh: "仅所有者或管理员可创建里程碑",
    en: "Only the owner or admins can create milestones",
  },
  onlyOwnerManageBilling: {
    zh: "仅所有者可管理计费",
    en: "Only the owner can manage billing",
  },
  forbiddenInProduction: {
    zh: "生产环境禁止此操作",
    en: "Forbidden in production",
  },

  /* ── 决策并发 ── */
  optimisticLockConflict: {
    zh: "决策已被他人更新，请刷新后重试",
    en: "The decision has been updated by someone else. Please refresh and retry",
  },

  /* ── 用户状态 ── */
  userDeactivated: { zh: "已注销用户", en: "Deactivated user" },

  /* ── Webhook 处理 ── */
  handlerError: { zh: "处理错误", en: "Handler error" },

  /* ── Prisma 统一错误处理（DL-14）── */
  prismaUniqueConstraint: {
    zh: "数据冲突，资源已存在或字段唯一性被破坏",
    en: "Data conflict; the resource already exists or a unique constraint was violated",
  },
  prismaRecordNotFound: {
    zh: "记录不存在",
    en: "Record not found",
  },
  prismaConnectionFailed: {
    zh: "数据库连接失败，请稍后重试",
    en: "Database connection failed; please try again later",
  },
  prismaForeignKeyViolation: {
    zh: "关联数据不存在或冲突",
    en: "Related data does not exist or conflicts",
  },
  prismaConstraintFailed: {
    zh: "数据约束校验失败",
    en: "Data constraint validation failed",
  },
} as const;

/**
 * 解析请求应使用的语言（与 next-intl cookie/Accept-Language 协商同源）：
 * NEXT_LOCALE cookie 命中 zh/en 直接采用；否则 Accept-Language 含 zh* 用 zh，
 * 含 en* 用 en；再回退默认 zh（SPEC §1 主市场中国大陆）。
 */
export function apiLocale(req: NextRequest): "zh" | "en" {
  const cookie = req.cookies.get("NEXT_LOCALE")?.value;
  if (cookie === "zh" || cookie === "en") return cookie;
  const accept = req.headers.get("accept-language")?.toLowerCase() ?? "";
  if (accept.includes("zh")) return "zh";
  if (accept.includes("en")) return "en";
  return "zh";
}

/** 取指定 key 在请求语言下的 message 文案。 */
export function apiMsg(req: NextRequest, key: ApiMsgKey): string {
  return API_MESSAGES[key][apiLocale(req)];
}
