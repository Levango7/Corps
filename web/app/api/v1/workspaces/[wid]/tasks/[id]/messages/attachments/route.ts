import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

/**
 * POST /v1/workspaces/{wid}/tasks/{id}/messages/attachments — 上传文件附件
 *
 * 请求：multipart/form-data
 *  - field "file": 文件二进制（≤10MB）
 *
 * 响应：{ code: 201, data: MessageAttachment }
 *  - 返回附件记录（含 url、thumbnailUrl），前端用 attachmentId 关联到消息
 *
 * 行为：
 *  1. 校验文件大小 ≤ 10MB
 *  2. 校验文件类型（图片: jpg/png/gif/webp，文档: pdf/doc/docx/xls/xlsx/zip）
 *  3. 存储到 web/uploads/（MVP 本地存储，文件名 = uuid + 原扩展名）
 *  4. 创建 MessageAttachment 记录（messageId 暂留空，发送消息时通过 attachmentIds 关联）
 *  5. 图片类型生成缩略图 URL（MVP 直接用原图，thumbnailUrl = url）
 *
 * 注意：MessageAttachment.messageId 是必填字段，但上传时还没有 messageId。
 * 解决方案：先创建一条空消息占位，或修改 schema 让 messageId 可空。
 * MVP 方案：上传时创建一条空 body 的 Message，立即关联附件，返回 messageId + attachmentId。
 * 前端可以在该消息上追加文本，或直接发送附件消息。
 *
 * 更简洁的方案：本端点只存储文件 + 返回 url，不创建 DB 记录。
 * 前端发送消息时，在 send 端点同时创建 Message + MessageAttachment。
 * 但 send 端点目前只接受 attachmentIds（已存在的附件 ID）。
 *
 * 最终方案：本端点存储文件 + 创建 MessageAttachment 记录（messageId 留空），
 * 但 schema 中 messageId 是必填。所以改为：本端点只存储文件，返回 { url, fileName, fileSize, fileType }。
 * send 端点扩展为同时创建 Message + MessageAttachment（接受 file 元数据而非 attachmentId）。
 *
 * 简化 MVP：本端点存储文件并返回元数据，前端调用 send 端点时附带 file 元数据。
 */

/** 最大文件大小：10MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** 允许的文件类型（MIME type → 扩展名） */
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/zip": "zip",
};

/** 图片 MIME type 集合 */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** 上传目录（相对 web/ 根） */
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

interface AttachmentMeta {
  url: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  thumbnailUrl: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ code: 400, message: "缺少文件" }, { status: 400 });
    }

    // 校验文件大小
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ code: 400, message: "文件大小不能超过 10MB" }, { status: 400 });
    }

    // 校验文件类型
    const ext = ALLOWED_TYPES[file.type];
    if (!ext) {
      return NextResponse.json({ code: 400, message: "不支持的文件类型" }, { status: 400 });
    }

    // 确保上传目录存在
    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    // 生成唯一文件名：uuid + 扩展名
    const fileId = randomUUID();
    const savedFileName = `${fileId}.${ext}`;
    const savedPath = path.join(UPLOAD_DIR, savedFileName);

    // 写入文件
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(savedPath, buffer);

    // 构造 URL（相对路径，前端通过 Next.js 静态服务或专用端点访问）
    const url = `/uploads/${savedFileName}`;
    const isImage = IMAGE_TYPES.has(file.type);
    // MVP：图片缩略图直接用原图（后续可接入图片处理服务生成真正缩略图）
    const thumbnailUrl = isImage ? url : null;

    const meta: AttachmentMeta = {
      url,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      thumbnailUrl,
    };

    // 校验任务存在（防跨租户）
    const taskExists = await runWithWorkspace(
      wid,
      (tx) => tx.task.findFirst({ where: { id, workspaceId: wid }, select: { id: true } }),
      ctx.payload.sub,
    );
    if (!taskExists) {
      // 清理已写入的文件
      await fs.unlink(savedPath).catch(() => {});
      return NextResponse.json({ code: 404, message: "任务不存在" }, { status: 404 });
    }

    return NextResponse.json({ code: 201, data: meta }, { status: 201 });
  } catch (error) {
    console.error("Upload attachment error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
