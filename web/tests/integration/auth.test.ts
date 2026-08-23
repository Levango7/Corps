import { describe, it, expect, beforeAll } from "vitest";

const BASE = "http://localhost:3000/api/v1";

describe("AC-01: 注册创建账户+工作区+owner+返回JWT", () => {
  const email = `test-${Date.now()}@corps.test`;

  it("POST /auth/register 返回 201 + accessToken + workspace + owner角色", async () => {
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

    // JWT令牌
    expect(json.data.accessToken).toBeDefined();
    expect(typeof json.data.accessToken).toBe("string");

    // 工作区创建
    expect(json.data.workspace).toBeDefined();
    expect(json.data.workspace.name).toBe("测试工作区");
    expect(json.data.workspace.role).toBe("owner");
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