// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * getWorkspaceContext × write-policy 接线测试
 *
 * 目标：证明 choke point **真的被调用**（本仓库反复出现的形态是"函数写对了但没人调"）。
 * lib/write-policy.ts 的纯函数由 write-policy.test.ts 覆盖；本文件覆盖的是
 * 「lib/auth.ts 是否真的把裁决接进了 getWorkspaceContext」——如果哪天有人把这段
 * if 删掉，这里必须变红。
 *
 * 断言：
 *  - viewer 写工作区资源 → getWorkspaceContext 返回 null（handler 走既有 401 分支）
 *  - member / admin / owner 同路径 → 正常返回 ctx
 *  - viewer 写自助类端点（自己的收藏）→ 放行
 *  - GET 不受影响
 *  - WRITE_POLICY_MODE=shadow → 放行但仍会记 shadow 日志
 *  - WRITE_POLICY_MODE=off → 完全不介入（viewer 也放行）
 *
 * Mock 策略与 auth-wid-guard.test.ts 一致：只 mock 叶子依赖（prisma / jwt / email /
 * better-auth），被测的 getWorkspaceContext 与 write-policy 走真实实现。
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
process.env.BETTER_AUTH_SECRET = "test-secret-for-write-policy-wiring-0123456789abcdef";
process.env.JWT_ACCESS_SECRET = "test-jwt-secret-for-write-policy-wiring-0123456789abcdef";

const { getWorkspaceContext } = await import("@/lib/auth");

const PAYLOAD = {
  sub: "user-1",
  wid: "ws-A",
  role: "member",
  iat: 1_700_000_000,
  exp: 1_700_000_900,
};

function makeRequest(method: string, path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost"), {
    method,
    headers: { Cookie: "access_token=token-A" },
  });
}

const WS_TASK = "/api/v1/workspaces/ws-A/tasks";

beforeEach(() => {
  jwtMock.verifyAccessToken.mockReset();
  txMock.member.findFirst.mockReset();
  txMock.memberPermission.findMany.mockReset();
  txMock.temporaryGrant.findUnique.mockReset();
  txMock.$executeRawUnsafe.mockReset();
  jwtMock.verifyAccessToken.mockResolvedValue(PAYLOAD);
  txMock.memberPermission.findMany.mockResolvedValue([]);
  txMock.temporaryGrant.findUnique.mockResolvedValue(null);
  txMock.$executeRawUnsafe.mockResolvedValue(undefined);
  delete process.env.WRITE_POLICY_MODE;
});

describe("default-deny 接线：viewer 写工作区资源被拦", () => {
  it("viewer + POST 工作区资源 → null（fail-closed）", async () => {
    txMock.member.findFirst.mockResolvedValue({ role: "viewer", workspaceId: "ws-A" });
    const res = await getWorkspaceContext(makeRequest("POST", WS_TASK), "ws-A");
    expect(res).toBeNull();
  });

  it("viewer + DELETE / PATCH / PUT 同样被拦", async () => {
    txMock.member.findFirst.mockResolvedValue({ role: "viewer", workspaceId: "ws-A" });
    for (const m of ["DELETE", "PATCH", "PUT"]) {
      const res = await getWorkspaceContext(makeRequest(m, `${WS_TASK}/t-1`), "ws-A");
      expect(res, m).toBeNull();
    }
  });

  it("member / admin / owner 同路径正常放行", async () => {
    for (const role of ["member", "admin", "owner"]) {
      txMock.member.findFirst.mockResolvedValue({ role, workspaceId: "ws-A" });
      const res = await getWorkspaceContext(makeRequest("POST", WS_TASK), "ws-A");
      expect(res, role).not.toBeNull();
      expect(res!.member.role, role).toBe(role);
    }
  });

  it("GET 不受写策略影响", async () => {
    txMock.member.findFirst.mockResolvedValue({ role: "viewer", workspaceId: "ws-A" });
    const res = await getWorkspaceContext(makeRequest("GET", WS_TASK), "ws-A");
    expect(res).not.toBeNull();
  });
});

describe("自助类端点对 viewer 放行", () => {
  it("viewer + POST /api/v1/favorites → 放行", async () => {
    txMock.member.findFirst.mockResolvedValue({ role: "viewer", workspaceId: "ws-A" });
    const res = await getWorkspaceContext(makeRequest("POST", "/api/v1/favorites"), "ws-A");
    expect(res).not.toBeNull();
  });

  it("viewer + PATCH /api/v1/users/me → 放行", async () => {
    txMock.member.findFirst.mockResolvedValue({ role: "viewer", workspaceId: "ws-A" });
    const res = await getWorkspaceContext(makeRequest("PATCH", "/api/v1/users/me"), "ws-A");
    expect(res).not.toBeNull();
  });
});

describe("灰度开关", () => {
  it("WRITE_POLICY_MODE=shadow：viewer 也放行（用于观察误杀）", async () => {
    process.env.WRITE_POLICY_MODE = "shadow";
    txMock.member.findFirst.mockResolvedValue({ role: "viewer", workspaceId: "ws-A" });
    const res = await getWorkspaceContext(makeRequest("POST", WS_TASK), "ws-A");
    expect(res).not.toBeNull();
  });

  it("WRITE_POLICY_MODE=off：完全不介入", async () => {
    process.env.WRITE_POLICY_MODE = "off";
    txMock.member.findFirst.mockResolvedValue({ role: "viewer", workspaceId: "ws-A" });
    const res = await getWorkspaceContext(makeRequest("DELETE", `${WS_TASK}/t-1`), "ws-A");
    expect(res).not.toBeNull();
  });

  it("WRITE_POLICY_MODE 拼错 → fail-closed（不等于 off）", async () => {
    process.env.WRITE_POLICY_MODE = "of";
    txMock.member.findFirst.mockResolvedValue({ role: "viewer", workspaceId: "ws-A" });
    const res = await getWorkspaceContext(makeRequest("POST", WS_TASK), "ws-A");
    expect(res).toBeNull();
  });
});

describe("临时授权折算", () => {
  it("viewer + 未过期的 admin 临时授权 → 放行", async () => {
    txMock.member.findFirst.mockResolvedValue({ role: "viewer", workspaceId: "ws-A" });
    txMock.temporaryGrant.findUnique.mockResolvedValue({
      tempRole: "admin",
      originalRole: "viewer",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const res = await getWorkspaceContext(makeRequest("POST", WS_TASK), "ws-A");
    expect(res).not.toBeNull();
  });

  it("viewer + 已过期的 admin 临时授权 → 仍被拦（过期不得提权）", async () => {
    txMock.member.findFirst.mockResolvedValue({ role: "viewer", workspaceId: "ws-A" });
    txMock.temporaryGrant.findUnique.mockResolvedValue({
      tempRole: "admin",
      originalRole: "viewer",
      expiresAt: new Date(Date.now() - 1_000),
    });
    const res = await getWorkspaceContext(makeRequest("POST", WS_TASK), "ws-A");
    expect(res).toBeNull();
  });
});
