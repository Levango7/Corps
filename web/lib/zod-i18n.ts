import type { z } from "zod";

/**
 * Zod 校验错误 → 可直接展示的人类可读消息（中英双语）。
 *
 * 动机：此前各路由在 ZodError 分支只返回 `apiMsg(req, "validationError")` 这一条通用文案，
 * 用户看到"参数校验错误"却不知道**是哪个字段、错在哪**——注册页尤其致命
 * （邮箱格式错 / 密码太短 / 工作区名太短，提示全一样）。
 *
 * 设计取舍：不改动各路由既有的 zod schema 定义（避免大面积改动带来的回归风险），
 * 而是在错误出口做一层统一翻译。新增字段只需在下面的标签表补一行，
 * 未登记的字段回退为字段名本身，不会因缺标签而报错。
 */

/** 字段名 → 中文标签。新增业务字段时在此登记。 */
const FIELD_LABELS_ZH: Record<string, string> = {
  email: "邮箱",
  password: "密码",
  name: "姓名",
  workspaceName: "工作区名称",
  clientSessionId: "会话标识",
  inviteToken: "邀请令牌",
  wid: "工作区",
  workspaceId: "工作区",
  title: "标题",
  description: "描述",
  status: "状态",
  priority: "优先级",
  assigneeId: "负责人",
  dueDate: "截止日期",
  taskId: "任务",
  body: "内容",
  markdown: "正文",
  reason: "原因",
  query: "搜索词",
  limit: "数量上限",
  type: "类型",
  token: "令牌",
  id: "ID",
};

/** 字段名 → 英文标签。 */
const FIELD_LABELS_EN: Record<string, string> = {
  email: "Email",
  password: "Password",
  name: "Name",
  workspaceName: "Workspace name",
  clientSessionId: "Session ID",
  inviteToken: "Invite token",
  wid: "Workspace",
  workspaceId: "Workspace",
  title: "Title",
  description: "Description",
  status: "Status",
  priority: "Priority",
  assigneeId: "Assignee",
  dueDate: "Due date",
  taskId: "Task",
  body: "Content",
  markdown: "Body",
  reason: "Reason",
  query: "Query",
  limit: "Limit",
  type: "Type",
  token: "Token",
  id: "ID",
};

function labelOf(field: string | undefined, locale: "zh" | "en"): string {
  if (!field) return locale === "zh" ? "请求内容" : "Request body";
  const table = locale === "zh" ? FIELD_LABELS_ZH : FIELD_LABELS_EN;
  return table[field] ?? field;
}

/** 取 Zod issue 的字段路径（多段路径取最后一段，形如 `items.0.title` → `title`）。 */
function fieldOf(issue: z.ZodIssue): string | undefined {
  const path = issue.path;
  if (!path || path.length === 0) return undefined;
  const last = path[path.length - 1];
  return typeof last === "string" ? last : String(last);
}

/** 把单个 Zod issue 翻译为一句可展示的话。 */
function describe(issue: z.ZodIssue, locale: "zh" | "en"): string {
  const label = labelOf(fieldOf(issue), locale);
  const zh = locale === "zh";

  switch (issue.code) {
    case "invalid_type": {
      // 缺失（undefined）与类型不符分开说，前者更像"没填"
      const received = (issue as { received?: string }).received;
      if (received === "undefined" || received === "null") {
        return zh ? `${label}不能为空` : `${label} is required`;
      }
      return zh ? `${label}格式不正确` : `${label} has an invalid format`;
    }
    case "invalid_format": {
      // zod 4：格式类 issue 的 code 为 invalid_format，格式名在 format 属性
      const validation = (issue as { format?: unknown }).format;
      const kind = typeof validation === "string" ? validation : "";
      if (kind === "email") {
        return zh
          ? `${label}格式不正确，请检查是否包含 @`
          : `${label} is not a valid email address`;
      }
      if (kind === "url") {
        return zh ? `${label}必须是合法的链接` : `${label} must be a valid URL`;
      }
      if (kind === "uuid") {
        return zh ? `${label}标识不合法` : `${label} must be a valid ID`;
      }
      return zh ? `${label}格式不正确` : `${label} has an invalid format`;
    }
    case "too_small": {
      const minimum = (issue as { minimum?: number }).minimum;
      const origin = (issue as { origin?: string }).origin;
      if (origin === "string" && typeof minimum === "number") {
        return zh
          ? `${label}至少需要 ${minimum} 个字符`
          : `${label} must be at least ${minimum} characters`;
      }
      return zh ? `${label}取值过小` : `${label} is too small`;
    }
    case "too_big": {
      const maximum = (issue as { maximum?: number }).maximum;
      const origin = (issue as { origin?: string }).origin;
      if (origin === "string" && typeof maximum === "number") {
        return zh
          ? `${label}不能超过 ${maximum} 个字符`
          : `${label} must be at most ${maximum} characters`;
      }
      return zh ? `${label}取值过大` : `${label} is too large`;
    }
    case "invalid_value": {
      // zod 4：invalid_enum_value 与 invalid_literal 合并为 invalid_value
      const options = (issue as { values?: unknown[] }).values;
      const list = Array.isArray(options) ? options.join(" / ") : "";
      return zh
        ? `${label}取值不在允许范围内${list ? `（${list}）` : ""}`
        : `${label} is not an allowed value`;
    }
    default:
      // 兜底：优先用 zod 自带 message，但它是英文，仅在没有更好选择时使用
      return zh ? `${label}填写有误` : issue.message;
  }
}

/**
 * 取第一个问题翻译成一句话。
 * 用于 `{ message }` 这类单字段出口，让前端无需改动即可展示更准确的原因。
 */
export function zodMessage(error: z.ZodError, locale: "zh" | "en" = "zh"): string {
  const issue = error.issues[0];
  if (!issue) return locale === "zh" ? "请求参数校验失败" : "Invalid request parameters";
  return describe(issue, locale);
}

/**
 * 翻译全部问题为 `字段 → 消息` 映射（同字段多条时保留第一条）。
 * 供需要做字段级高亮的表单使用。
 */
export function zodFieldErrors(
  error: z.ZodError,
  locale: "zh" | "en" = "zh",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = fieldOf(issue) ?? "_";
    if (!(key in out)) out[key] = describe(issue, locale);
  }
  return out;
}
