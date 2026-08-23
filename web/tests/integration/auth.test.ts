import { describe, it, expect, beforeAll } from "vitest";

// 可用 TEST_BASE_URL 覆盖（CI 默认本机 3000）
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000/api/v1";

/** 从 Set-Cookie 头提取 access_token 值 */
function extractAccessToken(res: Response): string {
  const cookies = res.headers.getSetCookie?.() ?? [];
  const tokenCookie = cookies.find((c) => c.startsWith("access_token="));
  return tokenCookie?.split("=")[1]?.split(";")[0] ?? "";
}

describe("AC-01: 注册创建账户+工作区+owner+返回JWT", () => {
  const email = `test-${Date.now()}@corps.test`;

  it("POST /auth/register 返回 201 + accessToken(cookie) + workspace", async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "Test123456!",
        workspaceName: "测试工作区",
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();

    // 信封格式
    expect(json.code).toBeDefined();
    expect(json.data).toBeDefined();

    // JWT令牌通过 httpOnly cookie 下发（不在响应体，XSS 不可读）
    const accessToken = extractAccessToken(res);
    expect(accessToken).toBeDefined();
    expect(typeof accessToken).toBe("string");
    expect(accessToken.length).toBeGreaterThan(10);

    // 工作区创建
    expect(json.data.workspace).toBeDefined();
    expect(json.data.workspace.name).toBe("测试工作区");
    // register 响应的 workspace 不含 role（role 通过 login/refresh 的 workspaces 列表返回）
    expect(json.data.workspace.id).toBeDefined();
  });
});

describe("AC-02: 邮箱重复返回 409", () => {
  const dupEmail = `dup-${Date.now()}@corps.test`;

  beforeAll(async () => {
    // 第一次注册——创建账户
    await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: dupEmail,
        password: "Test123456!",
        workspaceName: "First WS",
      }),
    });
  });

  it("重复注册同一邮箱返回 409", async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: dupEmail,
        password: "Another456!",
        workspaceName: "Second WS",
      }),
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.message).toBeDefined();
  });
});

describe("AC-01/02 边界条件", () => {
  it("密码过短返回 400", async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `short-${Date.now()}@test.com`,
        password: "123",
        workspaceName: "Short PW",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("邮箱格式无效返回 400", async () => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "not-an-email",
        password: "Test123456!",
        workspaceName: "Bad Email",
      }),
    });
    expect(res.status).toBe(400);
  });
});
