// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * 文档版本 API 路由的鉴权守卫单元测试。
 *
 * 动机：这两个路由（compare / restore）的业务逻辑在 lib/document-diff.ts
 * （已有 12 个单测覆盖），但**路由文件本身**是新增的源文件，在 CI 的
 * zero-coverage ratchet 里会报 NEW_ZERO（新代码要么带测试，要么显式登记）。
 * 这里补最小覆盖：验证"未认证 → 401"这条守卫路径确实被执行到。
 *
 * Mock 策略（只 mock 叶子依赖，路由自身的守卫逻辑走真实实现）：
 *  - @/lib/auth：getWorkspaceContext 返回 null（模拟未认证）；
 *    runWithWorkspace 直接执行回调（避免真实事务/RLS 依赖）。
 *  - @/lib/permissions、@/lib/prisma-error、@/lib/document-diff：
 *    让模块加载不触发真实副作用，本组用例不会走到它们。
 */

const authMock = vi.hoisted(() => ({
  getWorkspaceContext: vi.fn<() => Promise<unknown>>(async () => null),
  runWithWorkspace: vi.fn<
    (ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>
  >(async (_ctx, fn) => fn({})),
}));

vi.mock("@/lib/auth", () => authMock);
vi.mock("@/lib/permissions", () => ({
  requirePermission: vi.fn(() => null),
}));
vi.mock("@/lib/prisma-error", () => ({
  handlePrismaError: vi.fn(() => null),
}));
vi.mock("@/lib/document-diff", () => ({
  diffMarkdown: vi.fn(() => ({ lines: [], stats: { added: 0, removed: 0, unchanged: 0 } })),
}));

import { POST as comparePOST } from "@/app/api/v1/workspaces/[wid]/documents/[id]/versions/compare/route";
import { POST as restorePOST } from "@/app/api/v1/workspaces/[wid]/documents/[id]/versions/[versionId]/restore/route";

function postReq(path: string, body: unknown = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("文档版本 API · 鉴权守卫", () => {
  it("compare：未认证返回 401", async () => {
    const res = await comparePOST(
      postReq("/api/v1/workspaces/w1/documents/d1/versions/compare", { from: 1, to: 2 }),
      { params: Promise.resolve({ wid: "w1", id: "d1" }) },
    );
    expect(res.status).toBe(401);
  });

  it("restore：未认证返回 401", async () => {
    const res = await restorePOST(
      postReq("/api/v1/workspaces/w1/documents/d1/versions/v1/restore", {}),
      { params: Promise.resolve({ wid: "w1", id: "d1", versionId: "v1" }) },
    );
    expect(res.status).toBe(401);
  });
});
