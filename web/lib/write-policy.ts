/**
 * 统一写策略（default-deny）—— viewer 只读承诺的唯一执行点。
 *
 * ─── 为什么需要这个文件 ─────────────────────────────────────────────
 * `lib/permissions.ts` 声明了 owner/admin/member/viewer 的角色矩阵（viewer 全只读），
 * 但大量写 handler 只验证了「是不是本工作区成员」（getWorkspaceContext），没有验证
 * 「这个角色能不能写」。实测 `check_permission_gates.py` 的 T3 档共 157 个写 handler
 * 处于「零角色判断」状态：viewer 在这些端点上可以改工作区内容，矩阵的只读承诺没有执行点。
 *
 * 逐个给 157 个 handler 补 requirePermission 成本高且容易漏；这里把写权限收敛成
 * **一个 choke point**：所有经过 `getWorkspaceContext()` 的写请求都在此裁决。
 * 裁决口径是 fail-closed：角色不在允许集 → 拒绝；只有显式登记的「自助类」端点
 * （操作的是用户自己的数据，与工作区内容无关）才对所有角色开放。
 *
 * ─── 三种模式（WRITE_POLICY_MODE）───────────────────────────────────
 *   enforce（默认）  ：裁决生效，拒绝即拒绝。
 *   shadow          ：只记录裁决结果，一律放行。用于上线前灰度观察误杀面。
 *   off             ：完全不介入。
 * 环境变量取值非法时按 enforce 处理（fail-closed），不允许拼错 env 就悄悄降级安全性。
 *
 * ─── 已知未收编项（下一步）──────────────────────────────────────────
 *  1. MemberPermission 行级覆盖：目前只按角色裁决，未读 ctx.permissions。
 *     给 viewer 显式开了某模块写权限的场景，仍会被这里拦下——登记在
 *     `scripts/write-access-registry.txt` 的 TODO 段，待 product 定义后接入。
 *  2. 不走 getWorkspaceContext 的写 handler（AI 部分端点、webhook、auth 自身）
 *     不在本 choke point 覆盖范围内，由 `scripts/check_write_access_registry.py`
 *     静态登记并防止新增。
 */

/** 会被裁决的写方法 */
export const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

/** 允许写工作区内容的角色。viewer 不在其中——这是产品的只读承诺 */
export const WRITE_ALLOWED_ROLES = ["owner", "admin", "member"] as const;

export type WritePolicyMode = "enforce" | "shadow" | "off";

/**
 * 自助类写端点（对所有角色开放，含 viewer）。
 *
 * 判据：**写的是用户自己的数据，不改变工作区共享内容**。放宽这一类不会破坏
 * 「viewer 不能改工作区」的承诺；反过来，如果 viewer 连自己的收藏/通知都改不了，
 * 只读成员就变成了半个残废账号。
 *
 * 每一条都必须能回答「它改的是谁的数据」，否则不许进这张表（建议 CR 时追问）。
 */
export const SELF_SERVICE_WRITE_PATHS: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /^\/api\/v1\/favorites(\/|$)/, why: "收藏属于用户本人，不影响他人" },
  { pattern: /^\/api\/v1\/notifications(\/|$)/, why: "只改自己的已读/忽略状态" },
  { pattern: /^\/api\/v1\/push\/(register|unsubscribe)$/, why: "注册自己的设备推送" },
  { pattern: /^\/api\/v1\/users\/me(\/|$)/, why: "改自己的账号资料/注销自己的账号" },
  { pattern: /^\/api\/v1\/notification-preferences(\/|$)/, why: "自己的通知偏好" },
  { pattern: /^\/api\/v1\/ai\/preferences(\/|$)/, why: "自己的 AI 偏好" },
  {
    pattern: /^\/api\/v1\/ai\/(chat|completion|format|summarize|translate|feedback)$/,
    why: "纯文本生成/反馈，不落位业务对象；AI 的写操作需用户二次确认后才走独立端点",
  },
];

export interface WorkspaceWriteInput {
  /** 请求方法（原样传 req.method，内部大写化） */
  method: string;
  /** 路径名（不含 query），如 /api/v1/workspaces/{wid}/tasks */
  pathname: string;
  /** 生效角色：已把临时授权折算进来后的角色 */
  role: string;
}

export type WriteDenyReason =
  | "not-a-write"
  | "role-allowed"
  | "self-service"
  | "role-denied"
  | "viewer-readonly"
  | "unknown-role";

export interface WorkspaceWriteDecision {
  /** 是否允许继续。shadow 模式下恒为 true，但 reason 反映真实裁决 */
  allowed: boolean;
  /** 裁决依据（也用于日志与排障） */
  reason: WriteDenyReason;
  /** shadow 模式下为 true：表示「本会被拒，但当前放行」 */
  shadowDenied: boolean;
  mode: WritePolicyMode;
}

/** 解析 env：非法值 fail-closed 到 enforce */
export function parseWritePolicyMode(raw: string | undefined | null): WritePolicyMode {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "enforce":
      return "enforce";
    case "shadow":
      return "shadow";
    case "off":
      return "off";
    default:
      // 空串与拼错的 env 都不能成为「安全的另一条路」
      return "enforce";
  }
}

/** pathname 归一：去掉尾斜杠，便于正则匹配 */
function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

/**
 * 裁决一次写请求。纯函数，不碰 DB / 不读 env —— 环境与日志由调用方负责，
 * 这样它才能被单元测试与变异测试直接打。
 */
export function decideWorkspaceWrite(
  input: WorkspaceWriteInput,
  mode: WritePolicyMode = "enforce",
): WorkspaceWriteDecision {
  const method = input.method.toUpperCase();

  if (!WRITE_METHODS.includes(method as (typeof WRITE_METHODS)[number])) {
    return { allowed: true, reason: "not-a-write", shadowDenied: false, mode };
  }

  if (mode === "off") {
    return { allowed: true, reason: "role-allowed", shadowDenied: false, mode };
  }

  const pathname = normalizePath(input.pathname);
  const role = (input.role ?? "").trim();

  const allowed =
    WRITE_ALLOWED_ROLES.includes(role as (typeof WRITE_ALLOWED_ROLES)[number]) ||
    SELF_SERVICE_WRITE_PATHS.some((entry) => entry.pattern.test(pathname));

  if (allowed) {
    const isSelfService = !WRITE_ALLOWED_ROLES.includes(
      role as (typeof WRITE_ALLOWED_ROLES)[number],
    );
    return {
      allowed: true,
      reason: isSelfService ? "self-service" : "role-allowed",
      shadowDenied: false,
      mode,
    };
  }

  const reason: WriteDenyReason = role === "viewer" ? "viewer-readonly" : "unknown-role";
  return {
    allowed: mode === "shadow",
    reason,
    shadowDenied: mode === "shadow",
    mode,
  };
}
