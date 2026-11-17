import { describe, it, expect, beforeAll, vi } from "vitest";

/**
 * 关键写端点"上游失败 → 500 + 标准错误信封"集成断言。
 *
 * 既有覆盖的缺口：400/401/403 的错误信封断言很全（tests/api/*.test.ts +
 * auth-denial.test.ts + check_response_envelope.py 的 required 门禁），但
 * "写端点在 DB 层炸掉后，响应体还是不是标准信封 { code, message, data }、
 * message 是否走 apiMsg 既有键"没有集成级断言——恰好是 500 最容易在重构中
 * 退化成裸文本/HTML 的路径。
 *
 * 覆盖的两个写端点（documents 系列）：
 *  1. POST /workspaces/{wid}/documents           —— 新建文档
 *  2. POST /workspaces/{wid}/documents/{id}/comments —— 新建批注
 *
 * 故障注入方式（mock 层面断连，经团队裁决允许）：
 *  - 只 mock @/lib/auth 的 runWithWorkspace，注入**真实的**
 *    Prisma.PrismaClientKnownRequestError（P2003 外键违约，非 P2002），
 *    模拟上游 DB 写失败；路由模块、认证（getWorkspaceContextV2 走真实
 *    模块内部实现）、角色门禁、Zod 校验、错误出口全部走真实代码。
 *  - getWorkspaceContextV2 对 runWithWorkspace 的调用是 lib/auth 模块内部
 *    闭包引用，不受本 mock 影响（认证仍查真库）；路由 handler 拿到的是
 *    mock 后的导出绑定，进入 try 块后第一次 DB 写即抛 P2003 → 走既有
 *    catch → 500 internalError 信封。
 *  - 两个端点的 requirePermission 均为 owner 角色短路（无 DB 查询），
 *    不会在进入 try 之前被 mock 误伤。
 *
 * 断言口径（不钉脆弱文案全文）：
 *  - status === 500；信封键恰为 { code, message, data }；code === 500；
 *    data === null；message 非空且必须等于 api-messages.ts 的 internalError
 *    键值（zh 或 en，不假设无语言头时的默认语种）——即"走既有键"，
 *    route 内任何本地硬编码文案都会变红。
 */

// 本测试进程自签自验 JWT（signAccessToken/verifyAccessToken 同进程同密钥同
// issuer），无需与 dev server 的签名密钥一致；缺环境时给一个仅测试用的回退值。
// 不能用 server 签发的 access_token：部分集成腿（test 专项步 / test-hardened）
// 的 vitest 进程没有 JWT_ACCESS_SECRET，server 侧密钥对测试进程不可知。
process.env.JWT_ACCESS_SECRET ||= "corps-itest-jwt-access-secret-32chars";

// 集成测试两套 CI 环境变量口径（同 ai-usage-quota-concurrent.test.ts）：
// 必须在首次 import "@/lib/prisma"（构造时解析连接串）之前落位。
const DB_URL = process.env.DATABASE_URL ?? process.env.RLS_SMOKE_OWNER_URL;
if (DB_URL && !process.env.DATABASE_URL) process.env.DATABASE_URL = DB_URL;
const describeDb = DB_URL ? describe : describe.skip;

// 故障注入：runWithWorkspace 一进即抛真实 Prisma 已知错误（P2003，非 P2002）。
// 认证路径（getWorkspaceContextV2）在 lib/auth 模块内部自引用，不走本 mock。
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  const { Prisma } = await import("@prisma/client");
  return {
    ...actual,
    runWithWorkspace: () =>
      Promise.reject(
        new Prisma.PrismaClientKnownRequestError(
          "Simulated upstream FK violation (integration fault injection)",
          { code: "P2003", clientVersion: "6.15.0" },
        ),
      ),
  };
});

import { registerUser, authHeader, BASE } from "../helpers";
import { API_MESSAGES } from "@/lib/api-messages";

let serverToken: string; // dev server 签发（HTTP 操作走它，server 只认自己的密钥）
let localToken: string; // 测试进程自签（进程内直调 route handler 走它，验签自洽）
let wid: string;
let docId: string;

/** 断言响应是 500 标准错误信封（键结构 + code + message 走 internalError 键）。 */
async function expect500Envelope(res: Response): Promise<void> {
  expect(res.status, "上游 DB 写失败必须映射为 500").toBe(500);
  const body = (await res.json()) as { code?: number; message?: string; data?: unknown };
  expect(Object.keys(body).sort(), "信封键必须恰为 code/message/data").toEqual([
    "code",
    "data",
    "message",
  ]);
  expect(body.code).toBe(500);
  expect(body.data, "错误信封 data 必须为 null").toBeNull();
  expect(typeof body.message).toBe("string");
  expect(body.message?.length, "message 非空").toBeGreaterThan(0);
  expect(
    [API_MESSAGES.internalError.zh, API_MESSAGES.internalError.en],
    "message 必须取自 api-messages 的 internalError 键（禁止 route 本地硬编码）",
  ).toContain(body.message);
}

describeDb("documents 写端点 5xx 错误信封（上游 DB 失败注入）", () => {
  beforeAll(async () => {
    const u = await registerUser({ prefix: "env5xx", workspaceName: "5xx 信封工作区" });
    serverToken = u.accessToken;
    wid = u.workspace.id;

    // 进程内直调用自签 owner 票据（同进程验签，密钥自洽；见文件头说明）。
    const { signAccessToken } = await import("@/lib/jwt");
    localToken = await signAccessToken({ sub: u.user.id, wid, role: "owner" });

    // 经真实 dev server 建一条文档，供批注端点使用（服务器进程不受本文件 mock 影响）。
    const res = await fetch(`${BASE}/workspaces/${wid}/documents`, {
      method: "POST",
      headers: { ...authHeader(serverToken), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "5xx 信封载体文档" }),
    });
    expect(res.status, "前置：创建文档应成功").toBe(201);
    const json = (await res.json()) as { data?: { id?: string } };
    docId = json.data?.id ?? "";
    expect(docId).not.toBe("");
  });

  it("POST documents：DB 写失败 → 500 + 标准信封", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/v1/workspaces/[wid]/documents/route");

    const req = new NextRequest(`${BASE}/workspaces/${wid}/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${localToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "上游失败探针" }),
    });
    const res = await POST(req, { params: Promise.resolve({ wid }) });
    await expect500Envelope(res);
  });

  it("POST documents/{id}/comments：DB 写失败 → 500 + 标准信封", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/v1/workspaces/[wid]/documents/[id]/comments/route");

    const req = new NextRequest(`${BASE}/workspaces/${wid}/documents/${docId}/comments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${localToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        anchorPath: "1.0.0",
        anchorText: "锚点文本",
        body: "上游失败探针批注",
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ wid, id: docId }) });
    await expect500Envelope(res);
  });
});
