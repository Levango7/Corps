import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { authenticate, runWithAuthOp, runWithWorkspace } from "@/lib/auth";

/**
 * GET /api/uploads/[...path] — 服务上传的文件（鉴权版）
 *
 * 安全（审计修复 2026-08-29）：
 *  - 必须登录（authenticate），未登录 401
 *  - 路径遍历防护：规范化路径后校验仍在 uploads/ 目录内
 *  - 归属校验：仅允许"已关联消息"的附件下载（url 命中 message_attachments 记录）；
 *    未发送的孤儿文件 404（不对外暴露）
 *  - 租户隔离：请求者必须是附件所属工作区的成员，否则 403
 *
 * 说明：归属定位经 runWithAuthOp("cron") 逃生口（FORCE RLS 下裸查恒空），
 * 对应 db/rls-activate.sql 的 p_message_attachments_cron_select 策略。
 */

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const relativePath = segments.join("/");

  // 1. 登录校验
  const payload = await authenticate(req);
  if (!payload) {
    return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  }

  // 2. 路径遍历防护
  const resolved = path.resolve(UPLOAD_DIR, relativePath);
  if (!resolved.startsWith(UPLOAD_DIR + path.sep) && resolved !== UPLOAD_DIR) {
    return NextResponse.json({ code: 403, message: "Forbidden" }, { status: 403 });
  }

  // 3. 归属定位：仅已关联消息的附件可下载（孤儿文件 404）
  const fileUrl = `/uploads/${relativePath}`;
  const att = await runWithAuthOp("cron", (tx) =>
    tx.messageAttachment.findFirst({
      where: { url: fileUrl },
      select: { workspaceId: true },
    }),
  );
  if (!att) {
    return NextResponse.json({ code: 404, message: "附件不存在" }, { status: 404 });
  }

  // 4. 租户校验：请求者必须是附件所属工作区的成员
  const member = await runWithWorkspace(
    att.workspaceId,
    (tx) =>
      tx.member.findFirst({
        where: { userId: payload.sub, workspaceId: att.workspaceId },
        select: { userId: true },
      }),
    payload.sub,
  );
  if (!member) {
    return NextResponse.json({ code: 403, message: "Forbidden" }, { status: 403 });
  }

  // 5. 读取文件返回
  try {
    const buffer = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const contentType = EXT_TO_MIME[ext] ?? "application/octet-stream";

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ code: 404, message: "文件不存在" }, { status: 404 });
  }
}

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
};
