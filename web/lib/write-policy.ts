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
 * ─── MemberPermission 行级覆盖（2026-10-03 接入）──────────────────────
 *  permissions.ts 的语义是「默认矩阵 ∪ 覆盖，覆盖只能放宽」。对应到这里：
 *  角色本会被拒（如 viewer）但工作区给它显式配了某模块的写动作
 *  （DB MemberPermission.actions 含 create/update/delete）时，放行该模块
 *  的写请求。判定要素：
 *    - 路径 → 模块：pathToWriteModule() 的映射表，与各路由
 *      requirePermission(ctx, "<module>", ...) 的实参一致（全量核对过）；
 *    - 方法 → 写码：POST→c、PUT/PATCH→u、DELETE→d，与 permissions.ts
 *      的单字符动作代码一致；
 *    - 覆盖 key：`${role}:${module}`，与 auth.ts 加载 Map 的口径一致。
 *  fail-closed 边界：路径映射不到任何模块（如 okr、meetings 等 MODULES 之外
 *  的域）或覆盖串里不含对应写码时，一律维持拒绝——覆盖只会放宽，不会越权。
 *  owner/admin/member 不查覆盖（角色本身已允许写，覆盖对它们无意义）。
 *
 * ─── 剩余未收编项 ───────────────────────────────────────────────────
 *  不走 getWorkspaceContext 的写 handler（AI 部分端点、webhook、auth 自身）
 *  不在本 choke point 覆盖范围内，由 `scripts/check_write_access_registry.py`
 *  静态登记并防止新增。
 */

/** 会被裁决的写方法 */
export const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

/** 允许写工作区内容的角色。viewer 不在其中——这是产品的只读承诺 */
export const WRITE_ALLOWED_ROLES = ["owner", "admin", "member"] as const;

/** 写方法 → permissions.ts 的单字符动作代码（c=create u=update d=delete） */
const METHOD_WRITE_CODE: Record<(typeof WRITE_METHODS)[number], string> = {
  POST: "c",
  PUT: "u",
  PATCH: "u",
  DELETE: "d",
};

/**
 * 路径 → 权限模块 的映射（MemberPermission 行级覆盖的裁决依据）。
 *
 * 事实来源：各路由 requirePermission(ctx, "<module>", ...) 的实参（2026-10-03
 * 全量核对）。注意模块名 ≠ 路径段的一一对应：tasks/{id}/comments 走 messages
 * 模块、dashboard/widgets 走 analytics 模块、databases/{dbid}/records 走
 * databaseRecords 模块——所以必须整表维护而不是按路径段猜。
 *
 * **顺序敏感**：具体前缀在前（records 先于 databases 容器、tasks/{id} 子路由
 * 先于 tasks 兜底），匹配到第一条即返回。
 * MODULES 之外的域（okr、meetings、wiki、forms、calendar 等）不在此表——
 * 它们的写请求不享受覆盖放行（fail-closed，维持拒绝）。
 * labels / milestones 两条是**语义归类**（任务标签/里程碑归属 tasks 域）而非
 * requirePermission 实参核对——它们目前是零角色判断 handler，路由层没有模块调用。
 */
export const PATH_MODULE_RULES: ReadonlyArray<{ pattern: RegExp; module: string }> = [
  {
    pattern: /^\/api\/v1\/workspaces\/[^/]+\/databases\/[^/]+\/records(\/|$)/,
    module: "databaseRecords",
  },
  { pattern: /^\/api\/v1\/workspaces\/[^/]+\/databases(\/|$)/, module: "databases" },
  { pattern: /^\/api\/v1\/workspaces\/[^/]+\/tasks\/[^/]+\/decisions(\/|$)/, module: "decisions" },
  {
    pattern: /^\/api\/v1\/workspaces\/[^/]+\/tasks\/[^/]+\/(comments|conversation|messages)(\/|$)/,
    module: "messages",
  },
  {
    pattern: /^\/api\/v1\/workspaces\/[^/]+\/documents\/[^/]+\/comments(\/|$)/,
    module: "messages",
  },
  { pattern: /^\/api\/v1\/workspaces\/[^/]+\/conversations(\/|$)/, module: "messages" },
  { pattern: /^\/api\/v1\/workspaces\/[^/]+\/(labels|milestones)(\/|$)/, module: "tasks" },
  { pattern: /^\/api\/v1\/workspaces\/[^/]+\/tasks(\/|$)/, module: "tasks" },
  { pattern: /^\/api\/v1\/workspaces\/[^/]+\/decisions(\/|$)/, module: "decisions" },
  { pattern: /^\/api\/v1\/workspaces\/[^/]+\/documents(\/|$)/, module: "documents" },
  { pattern: /^\/api\/v1\/workspaces\/[^/]+\/members(\/|$)/, module: "members" },
  { pattern: /^\/api\/v1\/workspaces\/[^/]+\/billing(\/|$)/, module: "billing" },
  {
    pattern: /^\/api\/v1\/workspaces\/[^/]+\/(analytics|dashboard\/widgets)(\/|$)/,
    module: "analytics",
  },
  { pattern: /^\/api\/v1\/workspaces\/[^/]+\/(permissions|settings)(\/|$)/, module: "settings" },
  { pattern: /^\/api\/v1\/workspaces\/[^/]+\/whiteboards(\/|$)/, module: "whiteboards" },
  { pattern: /^\/api\/v1\/workspaces\/[^/]+\/time-entries(\/|$)/, module: "timetrack" },
  { pattern: /^\/api\/v1\/workspaces\/[^/]+\/announcements(\/|$)/, module: "announcements" },
  { pattern: /^\/api\/v1\/workspaces\/[^/]+\/contacts(\/|$)/, module: "contacts" },
];

/** 路径属于哪个权限模块；映射不到返回 null（调用方按无覆盖处理） */
export function pathToWriteModule(pathname: string): string | null {
  for (const rule of PATH_MODULE_RULES) {
    if (rule.pattern.test(pathname)) return rule.module;
  }
  return null;
}

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
  {
    pattern: /^\/api\/v1\/workspaces\/[^/]+\/notifications(\/|$)/,
    why: "标记自己的通知已读：handler 按 ctx.payload.sub 过滤，只动自己的数据（2026-10-03 choke point 误杀面排查中实测确认）",
  },
  {
    pattern: /^\/api\/v1\/workspaces\/[^/]+\/presence(\/|$)/,
    why: "上报自己的在线状态（onlineAt 时间戳），只写自己的 User 行；viewer 参与 IM 查看时也需心跳",
  },
];

export interface WorkspaceWriteInput {
  /** 请求方法（原样传 req.method，内部大写化） */
  method: string;
  /** 路径名（不含 query），如 /api/v1/workspaces/{wid}/tasks */
  pathname: string;
  /** 生效角色：已把临时授权折算进来后的角色 */
  role: string;
  /**
   * MemberPermission 行级覆盖（auth.ts 按 `${role}:${module}` 加载，value 为
   * 单字符动作代码串如 "cru"）。只在角色会被拒时才查（覆盖只放宽不收紧），
   * owner/admin/member 传入也不会被使用。
   */
  overrides?: Map<string, string> | null;
}

export type WriteDenyReason =
  | "not-a-write"
  | "role-allowed"
  | "self-service"
  | "module-override"
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

  // MemberPermission 行级覆盖：owner 给该角色显式配了此模块的写动作才放行。
  // 查不到 / 模块映射不到 / 覆盖串不含本方法的写码 → 维持拒绝（fail-closed）。
  const overrideModule = pathToWriteModule(pathname);
  if (overrideModule && input.overrides) {
    const codes = input.overrides.get(`${role}:${overrideModule}`);
    const writeCode = METHOD_WRITE_CODE[method as (typeof WRITE_METHODS)[number]];
    if (codes && writeCode && codes.includes(writeCode)) {
      return { allowed: true, reason: "module-override", shadowDenied: false, mode };
    }
  }

  const reason: WriteDenyReason = role === "viewer" ? "viewer-readonly" : "unknown-role";
  return {
    allowed: mode === "shadow",
    reason,
    shadowDenied: mode === "shadow",
    mode,
  };
}
