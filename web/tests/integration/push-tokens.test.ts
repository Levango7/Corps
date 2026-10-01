import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * push_tokens 集成测试（ADR-010 G3 收编试点）
 *
 * 与姊妹用例的分工：db/rls-smoke.sh 在【数据库引擎层】以 corps_app 直连断言策略
 * （自可见 1 / 跨用户 0 / 裸连接 0）；本用例在【应用层】验证两条真实读写路径
 * （注册 upsert / 注销 deleteMany）在普通与 NOBYPASSRLS 加固两种连接模式下行为
 * 一致——加固回归正是本试点的验收点：若哪条路径漏了 withGuc 注入 app.user_id，
 * 加固模式下会被策略拦空而后一条断言就会转红。
 */

const DEVICE = { platform: "android", token: "itest-fcm-token-0001" };

let authToken: string;

beforeAll(async () => {
  const u = await registerUser({ prefix: "push-token" });
  authToken = u.accessToken;
  expect(authToken.length).toBeGreaterThan(0);
});

describe("POST /push/register（注册/幂等/鉴权）", () => {
  it("注册设备 token 返回 200", async () => {
    const res = await fetch(`${BASE}/push/register`, {
      method: "POST",
      headers: { ...authHeader(authToken), "Content-Type": "application/json" },
      body: JSON.stringify(DEVICE),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.code).toBe(0);
  });

  it("同一设备重复注册幂等（upsert 命中已存在行）", async () => {
    const res = await fetch(`${BASE}/push/register`, {
      method: "POST",
      headers: { ...authHeader(authToken), "Content-Type": "application/json" },
      body: JSON.stringify(DEVICE),
    });
    expect(res.status).toBe(200);
  });

  it("非法 platform 返回 400", async () => {
    const res = await fetch(`${BASE}/push/register`, {
      method: "POST",
      headers: { ...authHeader(authToken), "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "windows-phone", token: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("未认证返回 401", async () => {
    const res = await fetch(`${BASE}/push/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(DEVICE),
    });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /push/register（注销/幂等/鉴权）", () => {
  it("注销已注册 token 返回 200", async () => {
    const res = await fetch(`${BASE}/push/register`, {
      method: "DELETE",
      headers: { ...authHeader(authToken), "Content-Type": "application/json" },
      body: JSON.stringify(DEVICE),
    });
    expect(res.status).toBe(200);
  });

  it("再次注销（行已不存在）仍返回 200（幂等）", async () => {
    const res = await fetch(`${BASE}/push/register`, {
      method: "DELETE",
      headers: { ...authHeader(authToken), "Content-Type": "application/json" },
      body: JSON.stringify(DEVICE),
    });
    expect(res.status).toBe(200);
  });

  it("未认证返回 401", async () => {
    const res = await fetch(`${BASE}/push/register`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(DEVICE),
    });
    expect(res.status).toBe(401);
  });
});
