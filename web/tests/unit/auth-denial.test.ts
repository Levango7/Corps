// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * getWorkspaceContextV2 的 4 个 denial 分支逐条断言（AC-06 ~ AC-10）
 *
 * 为什么单独测：既有 getWorkspaceContext 把四种拒绝情形全压成 `return null`，
 * handler 无从区分，只能统一回 401。V2 的价值**全在**这四个分支的判定上——
 * 判错一个就是把 403 说成 401（用户被误导去重新登录，而登录解决不了问题）。
 * 这类"编译过、跑得动、语义错"正是沉默逻辑错误的高发区，必须逐条钉死。
 *
 * Mock 策略与既有 auth-write-policy.test.ts 完全一致：只 mock 叶子依赖
 * （prisma / jwt / email / better-auth），被测的 getWorkspaceContextV2 与
 * write-policy 走真实实现。
 *
 * 另需保证 AC-11：既有 getWorkspaceContext 行为未变（25 处 [401,403] 断言）。
 * 本文件因此额外断言"同一输入下 v1 仍返回 null、v2 返回 denial"——
 * 两条路径并存期间，v1 的 null 语义不得被本批改动污染。
 */

const txMock = vi.hoisted(() => ({
  $executeRawUnsafe: vi.fn<() => Promise<unknown>>(async () => undefined),
  member: { findFirst: vi.fn<() => Promise<unknown>>(async () => null) },
  memberPermission: { findMany: vi.fn<() => Promise<unknown>>(async () => []) },
  temporaryGrant: { findUnique: vi.fn<() => Promise<unknown>>(async () => null) },
}));

const jwtMock = vi.hoisted(() => ({
  verifyAccessToken: vi.fn<() => Promise<unknown>>(async () => null),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
  },
  withDbRetry: vi.fn(async <T>(fn: () => Promise<T>): Promise<T> => fn()),
}));

vi.mock("@/lib/jwt", () => ({ verifyAccessToken: jwtMock.verifyAccessToken }));
vi.mock("@/lib/email", () => ({ sendResetPasswordEmail: vi.fn(async () => undefined) }));
vi.mock("better-auth", () => ({ betterAuth: vi.fn(() => ({})) }));
vi.mock("better-auth/adapters/prisma", () => ({ prismaAdapter: vi.fn(() => ({})) }));

process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-for-auth-denial-0123456789abcdef";
process.env.JWT_ACCESS_SECRET = "test-jwt-secret-for-auth-denial-0123456789abcdef";

const { getWorkspaceContextV2, getWorkspaceContext } = await import("@/lib/auth");
const { authFailure, DENIAL_MESSAGE_KEY } = await import("@/lib/auth-response");
const { API_MESSAGES } = await import("@/lib/api-messages");

const WS = "ws-A";
const OTHER_WS = "ws-B";
const WS_TASK = `/api/v1/workspaces/${WS}/tasks`;

function makeRequest(method: string, path: string, cookie = "access_token=token-A"): NextRequest {
  return new NextRequest(new URL(path, "http://localhost"), {
    method,
    headers: { Cookie: cookie },
  });
}

beforeEach(() => {
  jwtMock.verifyAccessToken.mockReset();
  txMock.member.findFirst.mockReset();
  txMock.memberPermission.findMany.mockReset();
  txMock.temporaryGrant.findUnique.mockReset();
  txMock.$executeRawUnsafe.mockReset();
  txMock.memberPermission.findMany.mockResolvedValue([]);
  txMock.temporaryGrant.findUnique.mockResolvedValue(null);
  txMock.$executeRawUnsafe.mockResolvedValue(undefined);
  delete process.env.WRITE_POLICY_MODE;
});

describe("AC-06 无有效凭据 → 401 unauthenticated", () => {
  it("verifyAccessToken 返回 null 时，V2 返回 401/unauthenticated", async () => {
    jwtMock.verifyAccessToken.mockResolvedValue(null);
    const res = await getWorkspaceContextV2(makeRequest("GET", WS_TASK), WS);
    expect(res).toEqual({ ok: false, status: 401, reason: "unauthenticated" });
  });

  it("authFailure 对该 denial 返回 401 且文案取 unauthorized 键", async () => {
    const res = authFailure({ ok: false, status: 401, reason: "unauthenticated" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      code: 401,
      message: API_MESSAGES.unauthorized.zh,
      data: null,
    });
  });
});

describe("AC-07 token 的 wid 与 URL wid 不符 → 403 workspace_mismatch", () => {
  it("payload.wid 与 URL wid 不一致时返回 403/workspace_mismatch", async () => {
    jwtMock.verifyAccessToken.mockResolvedValue({
      sub: "user-1",
      wid: OTHER_WS,
      role: "member",
      iat: 1_700_000_000,
      exp: 1_700_000_900,
    });
    const res = await getWorkspaceContextV2(
      makeRequest("GET", `/api/v1/workspaces/${WS}/tasks`),
      WS,
    );
    expect(res).toEqual({ ok: false, status: 403, reason: "workspace_mismatch" });
  });

  it("是 403 而不是 401 —— 身份有效，只是用错了工作区", async () => {
    jwtMock.verifyAccessToken.mockResolvedValue({
      sub: "user-1",
      wid: OTHER_WS,
      role: "member",
      iat: 1_700_000_000,
      exp: 1_700_000_900,
    });
    const res = await getWorkspaceContextV2(makeRequest("GET", WS_TASK), WS);
    expect(res).not.toBeNull();
    expect((res as { status: number }).status).not.toBe(401);
  });

  it("authFailure 对该 denial 返回 403 且文案取 forbidden 键", async () => {
    const res = authFailure({ ok: false, status: 403, reason: "workspace_mismatch" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: 403,
      message: API_MESSAGES.forbidden.zh,
      data: null,
    });
  });
});

describe("AC-08 非该工作区成员 → 403 not_a_member", () => {
  it("成员查询为空时返回 403/not_a_member", async () => {
    jwtMock.verifyAccessToken.mockResolvedValue({
      sub: "user-1",
      wid: WS,
      role: "member",
      iat: 1_700_000_000,
      exp: 1_700_000_900,
    });
    txMock.member.findFirst.mockResolvedValue(null);
    const res = await getWorkspaceContextV2(makeRequest("GET", WS_TASK), WS);
    expect(res).toEqual({ ok: false, status: 403, reason: "not_a_member" });
  });

  it("authFailure 对该 denial 返回 403 且文案取 noPermission 键", async () => {
    const res = authFailure({ ok: false, status: 403, reason: "not_a_member" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: 403,
      message: API_MESSAGES.noPermission.zh,
      data: null,
    });
  });
});

describe("AC-09 写策略拒绝（viewer 写工作区数据）→ 403 write_policy", () => {
  it("viewer + POST 工作区资源 → 403/write_policy", async () => {
    jwtMock.verifyAccessToken.mockResolvedValue({
      sub: "user-1",
      wid: WS,
      role: "viewer",
      iat: 1_700_000_000,
      exp: 1_700_000_900,
    });
    txMock.member.findFirst.mockResolvedValue({ role: "viewer", workspaceId: WS });
    const res = await getWorkspaceContextV2(makeRequest("POST", WS_TASK), WS);
    expect(res).toEqual({ ok: false, status: 403, reason: "write_policy" });
  });

  it("viewer + GET 不受影响（读不在写策略域内）", async () => {
    jwtMock.verifyAccessToken.mockResolvedValue({
      sub: "user-1",
      wid: WS,
      role: "viewer",
      iat: 1_700_000_000,
      exp: 1_700_000_900,
    });
    txMock.member.findFirst.mockResolvedValue({ role: "viewer", workspaceId: WS });
    const res = await getWorkspaceContextV2(makeRequest("GET", WS_TASK), WS);
    expect(res).not.toBeNull();
    expect((res as { ok: boolean }).ok).toBe(true);
  });

  it("WRITE_POLICY_MODE=off 时不介入（viewer 也放行）", async () => {
    process.env.WRITE_POLICY_MODE = "off";
    jwtMock.verifyAccessToken.mockResolvedValue({
      sub: "user-1",
      wid: WS,
      role: "viewer",
      iat: 1_700_000_000,
      exp: 1_700_000_900,
    });
    txMock.member.findFirst.mockResolvedValue({ role: "viewer", workspaceId: WS });
    const res = await getWorkspaceContextV2(makeRequest("POST", WS_TASK), WS);
    expect((res as { ok: boolean }).ok).toBe(true);
  });

  it("authFailure 对该 denial 返回 403 且文案取 noPermission 键", async () => {
    const res = authFailure({ ok: false, status: 403, reason: "write_policy" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: 403,
      message: API_MESSAGES.noPermission.zh,
      data: null,
    });
  });
});

describe("AC-10 authFailure 的 status 与 reason 一一对应", () => {
  const cases: Array<{ reason: keyof typeof DENIAL_MESSAGE_KEY; status: 401 | 403 }> = [
    { reason: "unauthenticated", status: 401 },
    { reason: "workspace_mismatch", status: 403 },
    { reason: "not_a_member", status: 403 },
    { reason: "write_policy", status: 403 },
  ];

  it.each(cases)("$reason → status $status，且 message 来自既有键", async ({ reason, status }) => {
    const res = authFailure({ ok: false, status, reason });
    expect(res.status).toBe(status);
    const body = (await res.json()) as { code: number; message: string; data: null };
    expect(body.code).toBe(status);
    expect(body.data).toBeNull();
    // message 必须是既有键的表值，绝不能是裸 key 名或空串
    expect(body.message).toBe(API_MESSAGES[DENIAL_MESSAGE_KEY[reason]].zh);
    expect(body.message).not.toBe(reason);
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("四个 reason 的文案键都存在且中英对称（不新增文案）", () => {
    for (const reason of Object.keys(DENIAL_MESSAGE_KEY) as Array<
      keyof typeof DENIAL_MESSAGE_KEY
    >) {
      const key = DENIAL_MESSAGE_KEY[reason];
      expect(API_MESSAGES[key], `reason=${reason} 的文案键 ${key} 必须存在`).toBeDefined();
      expect(API_MESSAGES[key].zh.length, `${key}.zh`).toBeGreaterThan(0);
      expect(API_MESSAGES[key].en.length, `${key}.en`).toBeGreaterThan(0);
    }
  });
});

describe("AC-11 并存期：既有 getWorkspaceContext 行为未变", () => {
  it("同一拒绝输入下，v1 仍返回 null（既有 25 处 [401,403] 断言依赖此行为）", async () => {
    // 无凭据
    jwtMock.verifyAccessToken.mockResolvedValue(null);
    expect(await getWorkspaceContext(makeRequest("GET", WS_TASK), WS)).toBeNull();
    expect(await getWorkspaceContextV2(makeRequest("GET", WS_TASK), WS)).toMatchObject({
      status: 401,
    });

    // 非成员
    jwtMock.verifyAccessToken.mockResolvedValue({
      sub: "user-1",
      wid: WS,
      role: "member",
      iat: 1_700_000_000,
      exp: 1_700_000_900,
    });
    txMock.member.findFirst.mockResolvedValue(null);
    expect(await getWorkspaceContext(makeRequest("GET", WS_TASK), WS)).toBeNull();
    expect(await getWorkspaceContextV2(makeRequest("GET", WS_TASK), WS)).toMatchObject({
      status: 403,
    });

    // viewer 写
    txMock.member.findFirst.mockResolvedValue({ role: "viewer", workspaceId: WS });
    expect(await getWorkspaceContext(makeRequest("POST", WS_TASK), WS)).toBeNull();
    expect(await getWorkspaceContextV2(makeRequest("POST", WS_TASK), WS)).toMatchObject({
      status: 403,
    });
  });

  it("放行路径下 v1 与 v2 返回等价的 payload/member", async () => {
    jwtMock.verifyAccessToken.mockResolvedValue({
      sub: "user-1",
      wid: WS,
      role: "member",
      iat: 1_700_000_000,
      exp: 1_700_000_900,
    });
    txMock.member.findFirst.mockResolvedValue({ role: "member", workspaceId: WS });
    const v1 = await getWorkspaceContext(makeRequest("GET", WS_TASK), WS);
    const v2 = await getWorkspaceContextV2(makeRequest("GET", WS_TASK), WS);
    expect(v1).not.toBeNull();
    expect(v2).toMatchObject({ ok: true });
    expect((v2 as { member: { role: string } }).member.role).toBe(v1!.member.role);
    expect((v2 as { payload: { sub: string } }).payload.sub).toBe(v1!.payload.sub);
  });
});
