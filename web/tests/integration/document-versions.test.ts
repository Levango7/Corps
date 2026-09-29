import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 文档版本历史端点的回归锚点
 *
 * 起因：GET /documents/{id}/versions 返回分页信封
 * `data:{ items, page, limit, total, hasMore }`（route.ts 里 items 的取值是 result.versions，
 * **响应键仍是 items**），而客户端一度写成 `api<{versions?}>(...)` 并按 data.versions 取键，
 * 被 `Array.isArray` 兜底成 [] → 版本历史恒为空且不报错（静默失效，比崩溃更难发现）。
 *
 * 该端点此前**零测试覆盖**：`web/tests` + `web/e2e` 全量 grep `versions|版本历史` 命中 0，
 * 所以"按错键"这类改动不会被任何既有用例拦住——本文件即为该锚点。
 */

interface Ctx {
  accessToken: string;
  wid: string;
  docId: string;
}

let ctx: Ctx;

beforeAll(async () => {
  const owner = await registerUser({ prefix: "docver-owner", workspaceName: "文档版本工作区" });
  ctx = { accessToken: owner.accessToken, wid: owner.workspace.id, docId: "" };

  // 建文档：POST /documents 只接受 title/markdown（见 route.ts 的 createDocSchema）
  const doc = await fetch(`${BASE}/workspaces/${ctx.wid}/documents`, {
    method: "POST",
    headers: { ...authHeader(ctx.accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ title: "版本锚点文档", markdown: "# v1\n\n初始内容" }),
  });
  expect(doc.status, "创建文档应成功").toBe(201);
  const docBody = (await doc.json()) as { data?: { id?: string } };
  ctx.docId = docBody?.data?.id ?? "";
  expect(ctx.docId, "应拿到文档 id").not.toBe("");

  // 手动创建一个版本快照，保证列表非空（空列表走不到聚合分支，等于漏测）
  const created = await fetch(`${BASE}/workspaces/${ctx.wid}/documents/${ctx.docId}/versions`, {
    method: "POST",
    headers: { ...authHeader(ctx.accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ message: "首个版本" }),
  });
  expect([200, 201], `创建版本应成功，实际 ${created.status}`).toContain(created.status);
});

describe("GET /workspaces/{wid}/documents/{id}/versions", () => {
  it("返回 200，版本数组在 data.items（不是 data.versions）", async () => {
    const res = await fetch(`${BASE}/workspaces/${ctx.wid}/documents/${ctx.docId}/versions`, {
      headers: authHeader(ctx.accessToken),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data?: {
        items?: Array<{ id?: string; version?: number }>;
        total?: number;
        versions?: unknown;
      };
    };
    // 契约锚点：客户端必须读 items；按 versions 取会恒为空（曾发生的静默失效）
    expect(Array.isArray(json?.data?.items)).toBe(true);
    expect(json?.data?.items?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect((json?.data as Record<string, unknown>)?.versions).toBeUndefined();
    expect(typeof json?.data?.total).toBe("number");
  });
});
