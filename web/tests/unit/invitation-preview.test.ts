/**
 * 邀请预览路由单元测试（TC-RATE-07 + TC-RLS-07 逻辑层）
 *
 * 覆盖 web/app/api/v1/invitations/[token]/route.ts GET：
 *  - 有效 token → 200（掩码邮箱 / 工作区名 / 过期时间），且查询经 invite 逃生口
 *  - token 不存在 → 404；已接受/已过期 → 410
 *  - TC-RATE-07：同一客户端连续 11 次 → 第 11 次 429（bucket invitations:preview，10 次/分钟）
 *
 * 隔离策略：vi.mock @/lib/auth，runWithAuthOp 用假事务客户端执行回调
 * （路由本身不再直连 prisma，RLS 加固模式下的端到端回归见 integration/invitation.test.ts）。
 * 限流器走真实进程内内存实现：测试前清除 REDIS_URL / RATE_LIMIT_DISABLED 环境干扰。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  runWithAuthOp: vi.fn(),
}));

import { GET } from "@/app/api/v1/invitations/[token]/route";
import { runWithAuthOp } from "@/lib/auth";

const mockRunWithAuthOp = runWithAuthOp as unknown as ReturnType<typeof vi.fn>;

/** 每个用例独立的假事务客户端（与 Prisma TransactionClient 调用面一致的最小子集） */
function makeFakeTx(invitation: unknown, inviter: unknown = { name: "张三", email: "z@corps.test" }) {
  return {
    invitation: { findUnique: vi.fn().mockResolvedValue(invitation) },
    user: { findUnique: vi.fn().mockResolvedValue(inviter) },
  };
}

/** 构造预览路由请求：无 socket 地址（vitest 环境 req.ip 为 undefined），用 XFF 区隔限流键 */
function makeReq(token: string, xff: string): NextRequest {
  const req = new NextRequest(`http://localhost/api/v1/invitations/${token}`, {
    headers: { "x-forwarded-for": xff },
  });
  return req;
}

function ctx(token: string) {
  return { params: Promise.resolve({ token }) };
}

/** 未接受且未过期的邀请样本 */
function validInvitation() {
  return {
    id: "inv-1",
    workspaceId: "wid-1",
    email: "guest@corps.test",
    tokenHash: "h".repeat(64),
    role: "member",
    invitedBy: "uid-1",
    acceptedAt: null,
    expiresAt: new Date(Date.now() + 24 * 3600_000),
    createdAt: new Date(),
    workspace: { name: "演示工作区" },
  };
}

const ORIGINAL_DISABLED = process.env.RATE_LIMIT_DISABLED;
const ORIGINAL_REDIS = process.env.REDIS_URL;

beforeEach(() => {
  // 确保限流器处于内存模式且未被禁用（.env.local 中 RATE_LIMIT_DISABLED=1 会干扰断言）
  delete process.env.RATE_LIMIT_DISABLED;
  delete process.env.REDIS_URL;
  mockRunWithAuthOp.mockReset();
});

afterEach(() => {
  if (ORIGINAL_DISABLED === undefined) delete process.env.RATE_LIMIT_DISABLED;
  else process.env.RATE_LIMIT_DISABLED = ORIGINAL_DISABLED;
  if (ORIGINAL_REDIS === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIGINAL_REDIS;
});

describe("GET /api/v1/invitations/[token] 预览", () => {
  it("有效 token → 200，返回掩码邮箱/工作区名，且经 invite 逃生口查询（TC-RLS-07）", async () => {
    const fakeTx = makeFakeTx(validInvitation());
    mockRunWithAuthOp.mockImplementation(async (op: string, fn: (tx: unknown) => Promise<unknown>) => {
      expect(op).toBe("invite"); // 必须走 invite 受控逃生口
      return fn(fakeTx);
    });

    const res = await GET(makeReq("tok-abc", `10.80.0.${Math.floor(Math.random() * 200) + 1}`), ctx("tok-abc"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      code: number;
      data: { workspaceName: string; inviterName: string; emailMasked: string; expiresAt: string };
    };
    expect(body.data.workspaceName).toBe("演示工作区");
    expect(body.data.inviterName).toBe("张三");
    // 掩码：前 2 字符 + *** + @域名
    expect(body.data.emailMasked).toBe("gu***@corps.test");
    expect(body.data.expiresAt).toBeTruthy();
    // 邀请人查询与邀请查询在同一逃生口事务内
    expect(fakeTx.invitation.findUnique).toHaveBeenCalledTimes(1);
    expect(fakeTx.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it("token 不存在 → 404", async () => {
    const fakeTx = makeFakeTx(null);
    mockRunWithAuthOp.mockImplementation(async (_op: string, fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx));

    const res = await GET(makeReq("tok-404", `10.80.1.${Math.floor(Math.random() * 200) + 1}`), ctx("tok-404"));
    expect(res.status).toBe(404);
  });

  it("已接受的邀请 → 410", async () => {
    const invitation = { ...validInvitation(), acceptedAt: new Date() };
    const fakeTx = makeFakeTx(invitation);
    mockRunWithAuthOp.mockImplementation(async (_op: string, fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx));

    const res = await GET(makeReq("tok-410a", `10.80.2.${Math.floor(Math.random() * 200) + 1}`), ctx("tok-410a"));
    expect(res.status).toBe(410);
  });

  it("已过期邀请 → 410", async () => {
    const invitation = { ...validInvitation(), expiresAt: new Date(Date.now() - 1000) };
    const fakeTx = makeFakeTx(invitation);
    mockRunWithAuthOp.mockImplementation(async (_op: string, fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx));

    const res = await GET(makeReq("tok-410b", `10.80.3.${Math.floor(Math.random() * 200) + 1}`), ctx("tok-410b"));
    expect(res.status).toBe(410);
  });

  it("TC-RATE-07：同一客户端 10 次放行，第 11 次返回 429 且带 Retry-After", async () => {
    const fakeTx = makeFakeTx(validInvitation());
    mockRunWithAuthOp.mockImplementation(async (_op: string, fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx));

    // 固定 XFF：同一客户端标识（bucket invitations:preview，max 10 / 60s）
    const xff = `10.80.4.${Math.floor(Math.random() * 200) + 1}`;
    for (let i = 0; i < 10; i++) {
      const res = await GET(makeReq("tok-rate", xff), ctx("tok-rate"));
      expect(res.status, `第 ${i + 1} 次应放行`).toBe(200);
    }
    const blocked = await GET(makeReq("tok-rate", xff), ctx("tok-rate"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await blocked.json()) as { code: number; message: string };
    expect(body.code).toBe(429);
    // 不同客户端不受影响（配额按客户端隔离）
    const other = await GET(
      makeReq("tok-rate", `10.80.5.${Math.floor(Math.random() * 200) + 1}`),
      ctx("tok-rate"),
    );
    expect(other.status).toBe(200);
  });
});