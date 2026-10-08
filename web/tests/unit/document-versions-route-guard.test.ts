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
 *  - @/lib/auth：getWorkspaceContextV2 默认返回「未认证」拒绝
 *    （`{ok:false,status:401,reason:"unauthenticated"}`）；
 *    runWithWorkspace 直接执行回调（避免真实事务/RLS 依赖）。
 *  - @/lib/permissions、@/lib/prisma-error、@/lib/document-diff：
 *    让模块加载不触发真实副作用，本组用例不会走到它们。
 *
 * 注意：路由在 4f877d1e 之后改调 `getWorkspaceContextV2`（判别联合），
 * 不再是返回 null 的 v1。mock 的方法名必须跟着改，否则 mock 拦截不到、
 * 路由会走真实实现（此前正是这样红的两条）。
 */

const authMock = vi.hoisted(() => ({
  getWorkspaceContextV2: vi.fn<() => Promise<unknown>>(async () => ({
    ok: false,
    status: 401,
    reason: "unauthenticated",
  })),
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

  it("compare：非成员返回 403，不再伪装成 401（v1 把四种拒绝一律说成未授权）", async () => {
    authMock.getWorkspaceContextV2.mockResolvedValueOnce({
      ok: false,
      status: 403,
      reason: "not_a_member",
    });
    const res = await comparePOST(
      postReq("/api/v1/workspaces/w1/documents/d1/versions/compare", { from: 1, to: 2 }),
      { params: Promise.resolve({ wid: "w1", id: "d1" }) },
    );
    expect(res.status).toBe(403);
  });

  it("restore：写策略拒绝返回 403", async () => {
    authMock.getWorkspaceContextV2.mockResolvedValueOnce({
      ok: false,
      status: 403,
      reason: "write_policy",
    });
    const res = await restorePOST(
      postReq("/api/v1/workspaces/w1/documents/d1/versions/v1/restore", {}),
      { params: Promise.resolve({ wid: "w1", id: "d1", versionId: "v1" }) },
    );
    expect(res.status).toBe(403);
  });

  it("compare：V2 返回 null（契约外）按 500 处理，fail-closed 不可当 401 重试", async () => {
    // lib/auth.ts 的 WorkspaceContextV2 文档写明：null 只为兼容 v1 调用形态存在，
    // V2 本身从不返回 null。真出现就说明契约被破坏，必须 500 而不是伪装成未授权
    // ——伪装成 401 会让前端 lib/api.ts 先做一次无意义的 token refresh 再重试。
    authMock.getWorkspaceContextV2.mockResolvedValueOnce(null);
    const res = await comparePOST(
      postReq("/api/v1/workspaces/w1/documents/d1/versions/compare", { from: 1, to: 2 }),
      { params: Promise.resolve({ wid: "w1", id: "d1" }) },
    );
    expect(res.status).toBe(500);
  });
});
