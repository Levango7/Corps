import { describe, it, expect } from "vitest";
import {
  BASE,
  TEST_PASSWORD,
  uniqueEmail,
  registerUser,
  authHeader,
  cookieHeader,
} from "../helpers";

/**
 * 认证全流程集成测试：注册 → 登录 → 刷新 → 登出
 *
 * 重点验证：
 * 1. 各步骤返回正确的状态码和信封格式
 * 2. access_token 通过 httpOnly cookie 下发（非响应体），XSS 不可读
 * 3. cookie 属性正确：httpOnly, sameSite=lax, path=/
 * 4. 登出后 access_token cookie 被清除（maxAge=0）
 */

/** 从 Set-Cookie 头解析单个 cookie 的属性 */
function parseCookie(cookieStr: string) {
  const [nameValue, ...attrs] = cookieStr.split("; ");
  const [name, value] = nameValue.split("=");
  const attrMap: Record<string, string> = {};
  for (const attr of attrs) {
    const [k, v] = attr.split("=");
    attrMap[k.toLowerCase()] = v ?? "true";
  }
  return { name, value, attrs: attrMap };
}

describe("认证全流程：注册 → 登录 → 刷新 → 登出", () => {
  it("注册返回 201 并通过 httpOnly cookie 下发 access_token", async () => {
    // Arrange
    const email = uniqueEmail("flow-reg");

    // Act
    const res = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: TEST_PASSWORD, workspaceName: "认证流程测试" }),
    });
    const json = await res.json();
    const cookies = res.headers.getSetCookie?.() ?? [];

    // Assert - 状态码与信封
    expect(res.status).toBe(201);
    expect(json.code).toBe(201);
    expect(json.data.user.email).toBe(email);
    expect(json.data.workspace.name).toBe("认证流程测试");

    // Assert - access_token 通过 cookie 下发，不在响应体
    const accessTokenCookie = cookies.find((c) => c.startsWith("access_token="));
    expect(accessTokenCookie).toBeDefined();
    expect(json.data.accessToken).toBeUndefined(); // 安全设计：不在响应体暴露

    // Assert - cookie 属性
    const parsed = parseCookie(accessTokenCookie!);
    expect(parsed.attrs.httponly).toBe("true");
    expect(parsed.attrs.samesite?.toLowerCase()).toBe("lax");
    expect(parsed.attrs.path).toBe("/");
    expect(parsed.value.length).toBeGreaterThan(10); // JWT 非空
  });

  it("登录返回 200 并下发新的 access_token cookie", async () => {
    // Arrange - 先注册

    await registerUser({ prefix: "flow-login" });
    // 用同邮箱注册会失败，改用 registerUser 返回的邮箱重新登录
    const reg = await registerUser({ prefix: "flow-login2" });

    // Act - 用注册时的 cookie 登录（模拟前端登录页提交）
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: reg.user.email, password: TEST_PASSWORD }),
    });
    const json = await res.json();
    const cookies = res.headers.getSetCookie?.() ?? [];

    // Assert
    expect(res.status).toBe(200);
    expect(json.code).toBe(200);
    expect(json.data.user.id).toBe(reg.user.id);
    expect(Array.isArray(json.data.workspaces)).toBe(true);
    expect(json.data.workspaces.length).toBeGreaterThan(0);
    expect(json.data.workspaces[0].role).toBe("owner");

    // access_token cookie 下发
    const accessTokenCookie = cookies.find((c) => c.startsWith("access_token="));
    expect(accessTokenCookie).toBeDefined();
    const parsed = parseCookie(accessTokenCookie!);
    expect(parsed.attrs.httponly).toBe("true");
  });

  it("登录失败（错误密码）返回 401 且不下发 access_token cookie", async () => {
    // Arrange
    const reg = await registerUser({ prefix: "flow-badpw" });

    // Act
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: reg.user.email, password: "WrongPassword123!" }),
    });
    const cookies = res.headers.getSetCookie?.() ?? [];

    // Assert
    expect(res.status).toBe(401);
    const accessTokenCookie = cookies.find((c) => c.startsWith("access_token="));
    expect(accessTokenCookie).toBeUndefined();
  });

  it("刷新端点凭 session cookie 签发新 access_token", async () => {
    // Arrange - 注册拿到 session cookie + access_token cookie
    const reg = await registerUser({ prefix: "flow-refresh" });
    expect(reg.cookies.length).toBeGreaterThan(0);

    // Act - 用注册返回的全部 cookie 调用 refresh（session cookie 验证身份）
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { ...cookieHeader(reg.cookies), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const json = await res.json();
    const cookies = res.headers.getSetCookie?.() ?? [];

    // Assert
    expect(res.status).toBe(200);
    expect(json.code).toBe(200);
    expect(json.data.workspace.id).toBe(reg.workspace.id);
    expect(json.data.workspace.role).toBe("owner");

    // 新 access_token cookie 下发
    const accessTokenCookie = cookies.find((c) => c.startsWith("access_token="));
    expect(accessTokenCookie).toBeDefined();
    const parsed = parseCookie(accessTokenCookie!);
    expect(parsed.attrs.httponly).toBe("true");
  });

  it("刷新端点无 session cookie 返回 401", async () => {
    // Act - 不带任何 cookie
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    // Assert
    expect(res.status).toBe(401);
  });

  it("登出清除 access_token cookie（maxAge=0）", async () => {
    // Arrange
    const reg = await registerUser({ prefix: "flow-logout" });

    // Act - 用注册的 cookie 调用登出
    const res = await fetch(`${BASE}/auth/logout`, {
      method: "POST",
      headers: cookieHeader(reg.cookies),
    });
    const cookies = res.headers.getSetCookie?.() ?? [];

    // Assert
    expect(res.status).toBe(200);
    const accessTokenCookie = cookies.find((c) => c.startsWith("access_token="));
    expect(accessTokenCookie).toBeDefined();
    const parsed = parseCookie(accessTokenCookie!);
    // maxAge=0 让浏览器立即删除 cookie
    expect(parsed.attrs["max-age"]).toBe("0");
    expect(parsed.value).toBe(""); // 值清空
  });

  it("登出后旧 access_token 在剩余 TTL 内仍有效（无状态 JWT 的已知取舍，TC-AUTH-06）", async () => {
    // Arrange
    const reg = await registerUser({ prefix: "flow-after-logout" });
    const wid = reg.workspace.id;

    // 先验证 token 有效
    const beforeRes = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
      headers: authHeader(reg.accessToken),
    });
    expect(beforeRes.status).toBe(200);

    // Act - 登出
    await fetch(`${BASE}/auth/logout`, {
      method: "POST",
      headers: cookieHeader(reg.cookies),
    });

    // Assert - 这是**有意的设计取舍**，不是缺陷：
    //   1) access_token 是无状态 JWT，TTL = "15m"（web/lib/jwt.ts:6，硬编码、无 env 可覆盖），
    //      验签只查签名/过期/issuer（web/lib/jwt.ts:62-67）不查库，故登出不会让已签发的
    //      access_token 即刻失效。
    //   2) 但登出**确实在服务端删除了会话**：logout route 调 auth.api.signOut
    //      （web/app/api/v1/auth/logout/route.ts:12）→ Better Auth internalAdapter.deleteSession，
    //      故攻击者拿不到续期能力，实际可利用窗口被钳死在旧 token 剩余 TTL（≤15 分钟）。
    //   3) 该取舍已被审查并明确接受：见 docs/security/PENTEST-REPORT-Phase1.md:359（TC-AUTH-06，
    //      列为观察项非缺陷）与 docs/security/PENTEST-PLAN.md:131。
    // 本用例断言 200 是**确定性**结果：登出只删会话 + 清 cookie，不改成员资格；beforeRes 与
    // afterRes 相隔毫秒级，远小于 15 分钟。
    // 若将来要收紧到"登出即刻失效"：需引入 jti denylist 或 User.tokenVersion。当前不做——
    // tokenVersion 的语义是"全端失效"（登出一个设备会踢掉该用户所有设备），相对 ≤15min 的
    // 窗口收益有限，不值得引入该语义副作用。
    const afterRes = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
      headers: authHeader(reg.accessToken),
    });
    expect(afterRes.status).toBe(200);
  });

  it("登出后原会话已服务端吊销：refresh 必须 401（TC-AUTH-06 的可续期窗口 = 0）", async () => {
    // Arrange
    const reg = await registerUser({ prefix: "flow-logout-refresh" });
    const wid = reg.workspace.id;

    // Act - 登出（走注册时捕获的会话 cookie）
    await fetch(`${BASE}/auth/logout`, {
      method: "POST",
      headers: cookieHeader(reg.cookies),
    });

    // Assert - 用**原会话 cookie** 调 refresh 必须 401：
    // refresh 走查库的 auth.api.getSession({ headers })（web/app/api/v1/auth/refresh/route.ts:77-81），
    // 会话行已被登出 DELETE ⇒ !session?.user?.id ⇒ 401 noActiveSession。
    // body 传合法 workspaceId——该 401 发生在 req.json() 之前，即使 body 有偏差也仍 401，
    // 但传合法值可避免未来 handler 调序后出现假红。
    //
    // 防空转（这条断言必须归因于"登出"，而不是"cookie 本来就无效"）：
    //   - 本用例在登出前**没有**调用过 refresh，故 401 不可能来自 session token 轮换；
    //   - 兄弟用例 TC-AUTH-05 的 Act 1（下方 describe）证明 reg.cookies 在登出前对 refresh
    //     是 200 —— 即该 cookie 确实是 refresh 认得的有效会话。
    //   两相印证：此处的 401 只能由登出删除会话行造成。
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { ...cookieHeader(reg.cookies), "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: wid }),
    });
    expect(res.status).toBe(401);
  });
});

describe("刷新端点 session token 一次性轮换（TC-AUTH-05）", () => {
  it("每次 refresh 下发新 session token，旧 token 立即失效", async () => {
    // Arrange - 注册拿到 session cookie（注册响应透传 Better Auth 会话 cookie）
    const reg = await registerUser({ prefix: "rotate" });
    // session cookie 名随 server NODE_ENV 切换：dev = better-auth.session_token，
    // production = __Secure-better-auth.session_token。vitest 进程 NODE_ENV="test"
    // 无法通过 process.env 判断，按注册响应中实际 cookie 存在性检测。
    const SESSION_COOKIE = reg.cookies.some((c) =>
      c.startsWith("__Secure-better-auth.session_token="),
    )
      ? "__Secure-better-auth.session_token"
      : "better-auth.session_token";
    const oldSessionCookie = reg.cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(oldSessionCookie).toBeDefined();
    const oldValue = parseCookie(oldSessionCookie!).value;
    expect(oldValue.length).toBeGreaterThan(10);

    // Act 1 - 用注册 cookie 首次 refresh
    const res1 = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { ...cookieHeader(reg.cookies), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const cookies1 = res1.headers.getSetCookie?.() ?? [];

    // Assert 1 - 200 且 Set-Cookie 含轮换后的新 session token
    expect(res1.status).toBe(200);
    const newSessionCookie = cookies1.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(newSessionCookie).toBeDefined();
    const parsedNew = parseCookie(newSessionCookie!);
    expect(parsedNew.value).not.toBe(oldValue); // 发生了轮换
    expect(parsedNew.value.length).toBeGreaterThan(10);
    // cookie 安全属性
    expect(parsedNew.attrs.httponly).toBe("true");
    expect(parsedNew.attrs.samesite?.toLowerCase()).toBe("lax");
    expect(parsedNew.attrs.path).toBe("/");
    // maxAge=7 天，与 lib/auth.ts session.expiresIn 对齐
    expect(parsedNew.attrs["max-age"]).toBe(String(60 * 60 * 24 * 7));

    // Act 2 - 用旧 session cookie 再次 refresh → 应 401（DB 中 token 已被覆写）
    const res2 = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { ...cookieHeader(reg.cookies), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res2.status).toBe(401);

    // Act 3 - 换用新 session cookie refresh → 200（新 token 有效，轮换链可继续）
    const mergedCookies = [
      ...reg.cookies.filter((c) => !c.startsWith(`${SESSION_COOKIE}=`)),
      newSessionCookie!,
    ];
    const res3 = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { ...cookieHeader(mergedCookies), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const cookies3 = res3.headers.getSetCookie?.() ?? [];

    // Assert 3 - 200 且再次轮换（第三次的 token 又不同于第二次）
    expect(res3.status).toBe(200);
    const thirdCookie = cookies3.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(thirdCookie).toBeDefined();
    expect(parseCookie(thirdCookie!).value).not.toBe(parsedNew.value);
    // 不写死超时：继承 vitest.config.ts 的全局预算（原 30_000 会盖掉配置里的实测余量）
  });
});

describe("认证边界条件", () => {
  it("注册缺少 workspaceName 返回 400", async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: uniqueEmail("bad"), password: TEST_PASSWORD }),
    });
    expect(res.status).toBe(400);
  });

  it("登录邮箱格式无效返回 400", async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: TEST_PASSWORD }),
    });
    expect(res.status).toBe(400);
  });

  it("刷新传入非 UUID workspaceId 返回 400", async () => {
    const reg = await registerUser({ prefix: "flow-bad-wid" });
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { ...cookieHeader(reg.cookies), "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
  });
});
