import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { promises as fs } from "fs";
import path from "path";
import { apiMsg } from "@/lib/api-messages";

/**
 * 云盘文件下载 API · /api/v1/workspaces/{wid}/files/{fid}/download
 * Phase 4A — 文件下载（返回文件流，设置 Content-Disposition: attachment）
 *
 * 安全：
 *  - 鉴权：必须是工作区成员
 *  - 租户隔离：文件必须属于该工作区
 *  - 路径遍历防护：storageKey 直接拼接到 UPLOAD_DIR，不经过用户输入
 */

/** 上传目录 */
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

/** 扩展名 → MIME type 映射（下载时设置 Content-Type） */
const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".py": "text/x-python",
  ".go": "text/x-go",
  ".md": "text/markdown",
  ".json": "application/json",
  ".txt": "text/plain",
};

/** GET /v1/workspaces/{wid}/files/{fid}/download — 下载文件 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; fid: string }> },
) {
  const { wid, fid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    // 查询文件元信息（鉴权 + 租户隔离）
    const fileAsset = await runWithWorkspace(
      wid,
      (tx) =>
        tx.fileAsset.findFirst({
          where: { id: fid, workspaceId: wid },
          select: { id: true, fileName: true, storageKey: true, fileType: true },
        }),
      ctx.payload.sub,
    );

    if (!fileAsset) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "fileNotFound"), data: null },
        { status: 404 },
      );
    }

    // 读取文件（storageKey 为相对 UPLOAD_DIR 的路径）
    const filePath = path.join(UPLOAD_DIR, fileAsset.storageKey);
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "fileNotFound"), data: null },
        { status: 404 },
      );
    }

    // Content-Type：优先用 DB 存储的 fileType，回退到扩展名映射
    const ext = path.extname(filePath).toLowerCase();
    const contentType = fileAsset.fileType || EXT_TO_MIME[ext] || "application/octet-stream";

    // Content-Disposition: attachment（强制下载，避免浏览器内联显示——尤其 HTML/SVG 可 XSS）
    // 支持 ASCII 和非 ASCII 文件名（RFC 5987）
    const fileName = fileAsset.fileName;
    const asciiSafe = fileName.replace(/[^\x20-\x7E]/g, "").replace(/"/g, '\\"');
    const encodedName = encodeURIComponent(fileName);
    const contentDisposition = `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encodedName}`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": contentDisposition,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (error) {
    console.error("[GET file download] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}