import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { BASE, registerUser, authHeader, createTask } from "../helpers";

/**
 * IM 附件上传 / 下载集成测试
 *
 * 覆盖（审计修复闭环：附件租户隔离 + 下载鉴权）：
 * 1. 未登录下载 /api/uploads/* → 401（此前端点完全无鉴权，P0）
 * 2. 登录后上传附件（multipart, FormData + Blob, 10MB 内 png）→ 201
 * 3. 发送消息携带附件元数据 → 201，响应含 attachments 记录（含 workspaceId 归属）
 * 4. 用上传返回的 url 下载 → 200 且 Content-Type 为 image/png
 * 5. 非本工作区成员下载该附件 → 403/404（归属校验拦截）
 * 6. 不存在的文件 → 404
 *
 * 注意：上传会真实写入 web/uploads/，测试结束后在 afterAll 清理（fs.rm）。
 * 依赖外部 dev server（BASE），与 tasks.test.ts 同款真实 HTTP 往返。
 */

/** 下载端点在 /api/uploads（与上传 /api/v1/... 不同前缀），取 origin 拼完整路径 */
const ORIGIN = new URL(BASE).origin;
/** 与服务端 UPLOAD_DIR 对齐（dev server 与 vitest 均以 web/ 为 cwd） */
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

/** 1x1 透明 PNG（合法 image/png，远小于 10MB 上限） */
const PNG_1PX_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

interface UploadMeta {
  url: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  thumbnailUrl: string | null;
}

interface SendResult {
  code: number;
  data: {
    id: string;
    attachments: Array<{ id: string; url: string; workspaceId: string; fileName: string }>;
  };
}

let token: string;
let wid: string;
let taskId: string;
let otherToken: string;

/** 已上传到 web/uploads/ 的文件绝对路径，测试结束后统一清理 */
const uploadedPaths: string[] = [];

beforeAll(async () => {
  const owner = await registerUser({ prefix: "im-upload-owner", workspaceName: "IM 附件测试" });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const task = await createTask(token, wid, { title: "IM 附件测试任务" });
  expect(task.status).toBe(201);
  taskId = task.body.data!.id;

  const other = await registerUser({ prefix: "im-upload-other" });
  otherToken = other.accessToken;
});

afterAll(async () => {
  // 清理真实写入 web/uploads/ 的文件（force 容忍文件已不存在）
  await Promise.all(uploadedPaths.map((p) => fs.rm(p, { force: true })));
});

describe("IM 附件上传 / 下载（租户隔离 + 鉴权）", () => {
  let uploadMeta: UploadMeta;

  it("未登录下载 /uploads/xxx 返回 401", async () => {
    const res = await fetch(`${ORIGIN}/api/uploads/some-file.png`);
    expect(res.status).toBe(401);
  });

  it("登录后上传附件（multipart png）返回 201", async () => {
    const form = new FormData();
    const pngBytes = Buffer.from(PNG_1PX_BASE64, "base64");
    form.append("file", new Blob([pngBytes], { type: "image/png" }), "test.png");

    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}/messages/attachments`, {
      method: "POST",
      headers: authHeader(token),
      body: form,
    });
    const json = (await res.json()) as { code: number; data: UploadMeta };

    expect(res.status).toBe(201);
    expect(json.code).toBe(201);
    expect(json.data.url).toMatch(/^\/uploads\/.+\.png$/);
    expect(json.data.fileName).toBe("test.png");
    expect(json.data.fileType).toBe("image/png");
    expect(json.data.fileSize).toBe(pngBytes.length);

    uploadMeta = json.data;
    // 记录真实写入的文件路径供 afterAll 清理
    uploadedPaths.push(path.join(UPLOAD_DIR, uploadMeta.url.replace("/uploads/", "")));
  });

  it("发送消息携带附件元数据返回 201，响应含 attachments 记录（带 workspaceId）", async () => {
    expect(uploadMeta).toBeDefined();

    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}/messages/send`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        body: "附件消息：test.png",
        attachments: [
          {
            fileName: uploadMeta.fileName,
            fileSize: uploadMeta.fileSize,
            fileType: uploadMeta.fileType,
            url: uploadMeta.url,
          },
        ],
      }),
    });
    const json = (await res.json()) as SendResult;

    expect(res.status).toBe(201);
    expect(json.code).toBe(201);
    expect(Array.isArray(json.data.attachments)).toBe(true);
    expect(json.data.attachments).toHaveLength(1);
    expect(json.data.attachments[0].url).toBe(uploadMeta.url);
    // 任务 1 闭环：嵌套 create 必须写入租户归属，否则 FORCE RLS 下不可见/写入被拒
    expect(json.data.attachments[0].workspaceId).toBe(wid);
  });

  it("用上传返回的 url 下载返回 200 且 Content-Type 为 image/png", async () => {
    expect(uploadMeta).toBeDefined();

    const res = await fetch(`${ORIGIN}/api${uploadMeta.url}`, {
      headers: authHeader(token),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(Buffer.from(PNG_1PX_BASE64, "base64"))).toBe(true);
  });

  it("非本工作区成员下载该附件返回 403/404", async () => {
    expect(uploadMeta).toBeDefined();

    const res = await fetch(`${ORIGIN}/api${uploadMeta.url}`, {
      headers: authHeader(otherToken),
    });

    // 403 = 归属定位成功但成员校验失败；404 = 加固模式下归属查询不可见（fail-closed）
    expect([403, 404]).toContain(res.status);
  });

  it("不存在的文件返回 404", async () => {
    const res = await fetch(`${ORIGIN}/api/uploads/00000000-0000-4000-8000-000000000000.png`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(404);
  });
});
