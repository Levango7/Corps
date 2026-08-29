// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * getWorkspaceContext JWT wid 守卫单元测试
 *
 * 目标：验证 lib/auth.ts 的审计修复（2026-08-29）——payload.wid 与 URL 参数
 * wid 不一致时立即返回 null（跨租户防护），一致或无 wid（旧 token）时走正常
 * 成员查询路径。守卫返回 null 时必须零副作用（不触发成员查询 / 不触发事务）。
 *
 * Mock 策略（只 mock 叶子依赖，被测 getWorkspaceContext / authenticate /
 * runWithWorkspace / withGuc 全部走真实实现）：
 *  - @/lib/prisma：prisma.$transaction 直接执行 fn(tx)，tx 为受控 mock，
 *    避免真实 DB / RLS 依赖（本机无 PG）。
 *  - @/lib/jwt：verifyAccessToken 返回受控 payload（authenticate 内部调用它）。
 *  - @/lib/email、better-auth、better-auth/adapters/prisma：仅用于让 auth.ts
 *    模块加载不触发 betterAuth 真实构造副作用，一并 mock（宁可范围大一些）。
 */

// vi.hoisted：让 mock 工厂与测试体共享同一 mock 对象
// 泛型显式声明返回 Promise<unknown>，避免 mockResolvedValue 传对象时
// tsc 按初始值 (null) 收紧参数类型报 TS2345。
const txMock = vi.hoisted(() => ({
  $executeRawUnsafe: vi.fn<() => Promise<unknown>>(async () => undefined),
  member: { findFirst: vi.fn<() => Promise<unknown>>(async () => null) },
}));

const jwtMock = vi.hoisted(() => ({
  verifyAccessToken: vi.fn<() => Promise<unknown>>(async () => null),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    // 直接执行传入的回调（等价于真实事务内执行 fn(tx)），tx 用受控 txMock。
    // withGuc 会在回调内先 setGucs（调用 tx.$executeRawUnsafe），再执行成员查询。
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
  },
}));

vi.mock("@/lib/jwt", () => ({
  verifyAccessToken: jwtMock.verifyAccessToken,
}));

vi.mock("@/lib/email", () => ({
  sendResetPasswordEmail: vi.fn(async () => undefined),
}));

vi.mock("better-auth", () => ({
  betterAuth: vi.fn(() => ({})),
}));

vi.mock("better-auth/adapters/prisma", () => ({
  prismaAdapter: vi.fn(() => ({})),
}));

// betterAuth 虽已 mock，仍按规范注入 env，避免任何未被拦截的构造路径抛错。
// 用动态 import 确保 env 在模块求值前就位（与 jwt.test.ts 同风格）。
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-for-auth-wid-guard-only-0123456789abcdef";
process.env.JWT_ACCESS_SECRET = "test-jwt-secret-for-auth-wid-guard-only-0123456789abcdef";

const { getWorkspaceContext } = await import("@/lib/auth");
const { prisma } = await import("@/lib/prisma");

const PAYLOAD_WITH_WID = {
  sub: "user-1",
  wid: "ws-A",
  role: "member",
  iat: 1_700_000_000,
  exp: 1_700_000_900,
};

/** 旧 token：签发时不带 wid */
const PAYLOAD_LEGACY_NO_WID = {
  sub: "user-1",
  role: "member",
  iat: 1_700_000_000,
  exp: 1_700_000_900,
};

const MEMBER = { role: "owner", workspaceId: "ws-A" };

/** 构造带 access_token cookie 的工作区请求 */
function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/v1/workspaces/ws-A", {
    headers: { Cookie: "access_token=token-A" },
  });
}

// 运行时 prisma 即 mock 工厂中的对象，$transaction 实为 vi.fn；
// cast 仅为让 tsc 通过（本文件不跑 tsc，vitest 直接转译执行）。
const prismaTx = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  jwtMock.verifyAccessToken.mockReset();
  txMock.member.findFirst.mockReset();
  txMock.$executeRawUnsafe.mockReset();
  // 只清调用记录，保留工厂里的 "直接执行 fn(tx)" 实现（mockReset 会丢掉实现）
  prismaTx.mockClear();
  txMock.member.findFirst.mockResolvedValue(MEMBER);
  txMock.$executeRawUnsafe.mockResolvedValue(undefined);
});

describe("getWorkspaceContext - JWT wid 守卫", () => {
  it("payload.wid='ws-A' 而 URL wid='ws-B' → 返回 null，且不触发成员查询", async () => {
    // Arrange
    jwtMock.verifyAccessToken.mockResolvedValue(PAYLOAD_WITH_WID);

    // Act
    const result = await getWorkspaceContext(makeRequest(), "ws-B");

    // Assert：守卫生效，直接短路，零 DB 副作用
    expect(result).toBeNull();
    expect(txMock.member.findFirst).not.toHaveBeenCalled();
    expect(prismaTx).not.toHaveBeenCalled();
  });

  it("payload.wid='ws-A' 且 URL wid='ws-A' → 返回 { payload, member }", async () => {
    // Arrange
    jwtMock.verifyAccessToken.mockResolvedValue(PAYLOAD_WITH_WID);

    // Act
    const result = await getWorkspaceContext(makeRequest(), "ws-A");

    // Assert：member 来自 mock 的 findFirst
    expect(result).not.toBeNull();
    expect(result!.payload).toEqual(PAYLOAD_WITH_WID);
    expect(result!.member).toEqual(MEMBER);
    expect(txMock.member.findFirst).toHaveBeenCalledTimes(1);
    expect(txMock.member.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", workspaceId: "ws-A" },
      select: { role: true, workspaceId: true },
    });
  });

  it("payload 无 wid 字段（旧 token）→ 走正常成员查询路径", async () => {
    // Arrange
    jwtMock.verifyAccessToken.mockResolvedValue(PAYLOAD_LEGACY_NO_WID);

    // Act：URL wid 与 payload 无关（payload 无 wid，守卫不生效）
    const result = await getWorkspaceContext(makeRequest(), "ws-C");

    // Assert：照常查询成员并返回
    expect(result).not.toBeNull();
    expect(result!.payload).toEqual(PAYLOAD_LEGACY_NO_WID);
    expect(result!.member).toEqual(MEMBER);
    expect(txMock.member.findFirst).toHaveBeenCalledTimes(1);
    expect(txMock.member.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", workspaceId: "ws-C" },
      select: { role: true, workspaceId: true },
    });
  });

  it("authenticate 返回 null（无有效 token）→ 返回 null", async () => {
    // Arrange
    jwtMock.verifyAccessToken.mockResolvedValue(null);

    // Act
    const result = await getWorkspaceContext(makeRequest(), "ws-A");

    // Assert
    expect(result).toBeNull();
    expect(txMock.member.findFirst).not.toHaveBeenCalled();
    expect(prismaTx).not.toHaveBeenCalled();
  });

  it("成员不存在（findFirst 返回 null）→ 返回 null", async () => {
    // Arrange
    jwtMock.verifyAccessToken.mockResolvedValue(PAYLOAD_WITH_WID);
    txMock.member.findFirst.mockResolvedValue(null);

    // Act
    const result = await getWorkspaceContext(makeRequest(), "ws-A");

    // Assert：wid 守卫通过，但成员查询无结果 → 仍返回 null
    expect(result).toBeNull();
    expect(txMock.member.findFirst).toHaveBeenCalledTimes(1);
  });
});
