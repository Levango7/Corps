/**
 * 邀请未注册用户完整流程集成测试
 *
 * 覆盖场景：
 * 1. admin 邀请未注册邮箱 → 201 pending + inviteUrl
 * 2. GET 预览端点 → 200 且邮箱掩码
 * 3. 伪造 token → 404
 * 4. 受邀邮箱注册后 accept → 200 且加入邀请方工作区
 * 5. 再次 accept → 410（一次性消费）
 * 6. 其他邮箱用户 accept → 403
 */
import { describe, it, expect } from "vitest";
import { BASE, TEST_PASSWORD, uniqueEmail, registerUser, authHeader } from "../helpers";

/** 从 inviteUrl 中提取明文 token */
function extractToken(inviteUrl: string): string {
  const match = inviteUrl.match(/[?&]invite=([0-9a-f]+)/);
  if (!match) throw new Error(`inviteUrl 无效: ${inviteUrl}`);
  return match[1];
}

/** 以指定邮箱注册新用户，返回 Bearer token（注册接口会同时建默认工作区） */
async function signupWithEmail(email: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD, workspaceName: "随意工作区" }),
  });
  if (res.status !== 201) {
    throw new Error(`signup failed: ${res.status} ${await res.text()}`);
  }
  const cookies = res.headers.getSetCookie?.() ?? [];
  const accessTokenCookie = cookies.find((c) => c.startsWith("access_token="));
  return accessTokenCookie?.split("=")[1]?.split(";")[0] ?? "";
}

/** admin 邀请未注册邮箱，返回 inviteUrl 中的明文 token */
async function inviteUnregistered(
  adminToken: string,
  wid: string,
  email: string,
): Promise<{ status: number; token: string | null }> {
  const res = await fetch(`${BASE}/workspaces/${wid}/members/invite`, {
    method: "POST",
    headers: { ...authHeader(adminToken), "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (res.status !== 201) return { status: res.status, token: null };
  const json = (await res.json()) as { data: { inviteUrl: string } };
  return { status: res.status, token: extractToken(json.data.inviteUrl) };
}

describe("邀请未注册用户完整流程", () => {
  it("场景1：admin 邀请未注册邮箱 → 201 且 data.inviteUrl 含 /auth/signup?invite=", async () => {
    const admin = await registerUser({ prefix: "inv-admin" });
    const guestEmail = uniqueEmail("inv-guest");

    const res = await fetch(`${BASE}/workspaces/${admin.workspace.id}/members/invite`, {
      method: "POST",
      headers: { ...authHeader(admin.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ email: guestEmail }),
    });
    expect(res.status).toBe(201);

    const json = (await res.json()) as {
      code: number;
      data: { pending: boolean; email: string; inviteUrl: string };
    };
    expect(json.data.pending).toBe(true);
    expect(json.data.email).toBe(guestEmail);
    expect(json.data.inviteUrl).toContain("/auth/signup?invite=");
  });

  it("场景2：GET 预览端点 → 200 且返回掩码邮箱与工作区信息", async () => {
    const admin = await registerUser({ prefix: "inv-prev-admin" });
    const guestEmail = uniqueEmail("inv-prev-guest");

    const invited = await inviteUnregistered(admin.accessToken, admin.workspace.id, guestEmail);
    expect(invited.status).toBe(201);
    const token = invited.token as string;

    // 公开预览：无需认证头
    const res = await fetch(`${BASE}/invitations/${token}`);
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      code: number;
      data: {
        workspaceName: string;
        inviterName: string;
        emailMasked: string;
        expiresAt: string;
      };
    };
    expect(json.data.workspaceName).toBe(admin.workspace.name);
    // 掩码格式：前 2 字符 + *** + @域名
    expect(json.data.emailMasked).toBe(`${guestEmail.slice(0, 2)}***@${guestEmail.split("@")[1]}`);
    expect(json.data.expiresAt).toBeTruthy();
  });

  it("场景3：伪造 token → 404", async () => {
    const fakeToken = "f".repeat(64);
    const res = await fetch(`${BASE}/invitations/${fakeToken}`);
    expect(res.status).toBe(404);
  });

  it("场景4：受邀邮箱注册后 accept → 200 且返回邀请方工作区 id", async () => {
    const admin = await registerUser({ prefix: "inv-acc-admin" });
    const guestEmail = uniqueEmail("inv-acc-guest");

    const invited = await inviteUnregistered(admin.accessToken, admin.workspace.id, guestEmail);
    expect(invited.status).toBe(201);

    // 受邀人以同一邮箱注册（signup 时 workspaceName 随意，会创建自己的默认工作区）
    const guestToken = await signupWithEmail(guestEmail);

    const res = await fetch(`${BASE}/invitations/${invited.token}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${guestToken}` },
    });
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      code: number;
      data: { workspaceId: string; workspaceName: string; role: string };
    };
    expect(json.data.workspaceId).toBe(admin.workspace.id);
    expect(json.data.workspaceName).toBe(admin.workspace.name);
    expect(json.data.role).toBe("member");
  });

  it("场景5：已接受的邀请再次 accept → 410", async () => {
    const admin = await registerUser({ prefix: "inv-twice-admin" });
    const guestEmail = uniqueEmail("inv-twice-guest");

    const invited = await inviteUnregistered(admin.accessToken, admin.workspace.id, guestEmail);
    expect(invited.status).toBe(201);

    const guestToken = await signupWithEmail(guestEmail);

    // 首次接受成功
    const first = await fetch(`${BASE}/invitations/${invited.token}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${guestToken}` },
    });
    expect(first.status).toBe(200);

    // 二次接受 → 邀请已被一次性消费
    const second = await fetch(`${BASE}/invitations/${invited.token}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${guestToken}` },
    });
    expect(second.status).toBe(410);
  });

  it("场景6：其他邮箱用户 accept → 403", async () => {
    const admin = await registerUser({ prefix: "inv-forbid-admin" });
    const guestEmail = uniqueEmail("inv-forbid-guest");

    const invited = await inviteUnregistered(admin.accessToken, admin.workspace.id, guestEmail);
    expect(invited.status).toBe(201);

    // 用一个不同邮箱的已注册用户尝试顶替接受
    const other = await registerUser({ prefix: "inv-forbid-other" });
    const res = await fetch(`${BASE}/invitations/${invited.token}/accept`, {
      method: "POST",
      headers: authHeader(other.accessToken),
    });
    expect(res.status).toBe(403);

    const json = (await res.json()) as { message?: string };
    expect(json.message).toContain("请使用受邀邮箱");
  });
});

describe("TC-RLS-07 回归：RLS 加固模式下预览路由", () => {
  /**
   * 引擎事实（db/rls-activate.sql）：invitations 表 ENABLE+FORCE RLS，
   * 运行时角色 corps_app 为 NOBYPASSRLS。预览路由未设 GUC 的直连查询
   * fail-closed 恒返 null → 404；修复后经 runWithAuthOp("invite") 取件。
   * 本用例在被测服务以 corps_app 运行时（如 pentest-start.sh）即为端到端回归：
   * 有效 token 必须返回 200 且字段完整。
   */
  it("有效 token 预览 → 200 且字段完整（加固模式 fail-closed 回归锚点）", async () => {
    const admin = await registerUser({ prefix: "tcrls07-admin" });
    const guestEmail = uniqueEmail("tcrls07-guest");

    const invited = await inviteUnregistered(admin.accessToken, admin.workspace.id, guestEmail);
    expect(invited.status).toBe(201);
    const token = invited.token as string;

    const res = await fetch(`${BASE}/invitations/${token}`);
    // 修复前（直连 prisma 无 GUC）：加固模式下此处为 404；修复后必须 200
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      code: number;
      data: {
        workspaceName: string;
        inviterName: string;
        emailMasked: string;
        expiresAt: string;
      };
    };
    expect(json.code).toBe(200);
    expect(json.data.workspaceName).toBe(admin.workspace.name);
    expect(json.data.inviterName).toBeTruthy();
    expect(json.data.emailMasked).toBe(`${guestEmail.slice(0, 2)}***@${guestEmail.split("@")[1]}`);
    expect(new Date(json.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});
