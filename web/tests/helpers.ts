/**
 * 集成测试通用工具
 *
 * 设计原则：
 * 1. 所有 helper 走真实 HTTP（fetch localhost:3000），不做模块 mock
 * 2. 每次注册生成唯一邮箱，避免测试间数据耦合
 * 3. 返回强类型结果，方便调用方解构
 */

// 可用 TEST_BASE_URL 覆盖（CI 默认本机 3000）
export const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000/api/v1";

/** 测试用固定密码（满足 register schema min 8 位） */
export const TEST_PASSWORD = "Test123456!";

/** 生成唯一测试邮箱（用 Date.now + 随机数避免同毫秒冲突） */
export function uniqueEmail(prefix = "test"): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@corps.test`;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export interface AuthWorkspace {
  id: string;
  name: string;
  slug: string;
}

export interface RegisterResult {
  user: AuthUser;
  workspace: AuthWorkspace;
  accessToken: string;
  /** 注册响应中的 Set-Cookie 头（含 Better Auth session + access_token） */
  cookies: string[];
}

/** 从响应头提取所有 Set-Cookie 值 */
function extractCookies(res: Response): string[] {
  // NextResponse.headers.append 会合并 set-cookie，getSetCookie() 拆分返回
  return res.headers.getSetCookie?.() ?? [];
}

/**
 * 注册新用户并返回 access token + cookie
 * @param overrides 可覆盖 workspaceName 等
 */
export async function registerUser(
  overrides: { workspaceName?: string; prefix?: string } = {},
): Promise<RegisterResult> {
  const email = uniqueEmail(overrides.prefix ?? "u");
  const workspaceName = overrides.workspaceName ?? "测试工作区";

  const res = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD, workspaceName }),
  });

  if (res.status !== 201) {
    const body = await res.text();
    throw new Error(`register failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as {
    code: number;
    data: { user: AuthUser; workspace: AuthWorkspace };
  };
  const cookies = extractCookies(res);

  // access_token 在 httpOnly cookie 中，也从 cookie 解析备用
  const accessTokenCookie = cookies.find((c) => c.startsWith("access_token="));
  const accessTokenFromCookie = accessTokenCookie?.split("=")[1]?.split(";")[0];

  // 兼容：register 响应体未直接返回 accessToken，从 cookie 提取
  const accessToken = accessTokenFromCookie ?? "";

  return {
    user: json.data.user,
    workspace: json.data.workspace,
    accessToken,
    cookies,
  };
}

/**
 * 登录已存在用户，返回 access token + cookie
 */
export async function loginUser(email: string, password: string = TEST_PASSWORD): Promise<{
  user: AuthUser;
  workspaces: Array<{ id: string; name: string; slug: string; role: string }>;
  accessToken: string;
  cookies: string[];
}> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`login failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as {
    code: number;
    data: {
      user: AuthUser;
      workspaces: Array<{ id: string; name: string; slug: string; role: string }>;
    };
  };
  const cookies = extractCookies(res);
  const accessTokenCookie = cookies.find((c) => c.startsWith("access_token="));
  const accessToken = accessTokenCookie?.split("=")[1]?.split(";")[0] ?? "";

  return { user: json.data.user, workspaces: json.data.workspaces, accessToken, cookies };
}

/** 构造带 Bearer token 的 Authorization 头 */
export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/** 构造带 cookie 的请求头（模拟浏览器自动发送 httpOnly cookie） */
export function cookieHeader(cookies: string[]): { Cookie: string } {
  // 仅取 name=value 部分，丢弃属性
  const pairs = cookies.map((c) => c.split(";")[0]);
  return { Cookie: pairs.join("; ") };
}

/**
 * 邀请已注册用户加入工作区（owner/admin 调用）
 * @returns 邀请结果（201 成员 / 422 未注册 / 409 已是成员 / 402 席位满）
 */
export async function inviteMember(
  ownerToken: string,
  wid: string,
  inviteeEmail: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}/workspaces/${wid}/members/invite`, {
    method: "POST",
    headers: { ...authHeader(ownerToken), "Content-Type": "application/json" },
    body: JSON.stringify({ email: inviteeEmail }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/**
 * 在指定工作区创建任务
 */
export async function createTask(
  token: string,
  wid: string,
  payload: { title: string; status?: string; priority?: string; assigneeId?: string; description?: string },
): Promise<{ status: number; body: { code: number; data?: { id: string; title: string; status: string; priority: string } & Record<string, unknown>; message?: string } }> {
  const res = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** 简单 sleep（等待异步副作用如通知生成） */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}