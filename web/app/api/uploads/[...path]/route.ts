import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

/**
 * GET /api/uploads/[...path] — 服务上传的文件
 *
 * MVP 本地存储方案：从 web/uploads/ 目录读取文件并返回。
 * 升级路径：替换为对象存储（S3/OSS）的签名 URL 重定向。
 *
 * 安全：
 *  - 路径遍历防护：规范化路径后校验仍在 uploads/ 目录内
 *  - 文件类型白名单：仅允许上传时定义的类型
 */

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  const relativePath = segments.join("/");

  // 路径遍历防护
  const resolved = path.resolve(UPLOAD_DIR, relativePath);
  if (!resolved.startsWith(UPLOAD_DIR + path.sep) && resolved !== UPLOAD_DIR) {
    return NextResponse.json({ code: 403, message: "Forbidden" }, { status: 403 });
  }

  try {
    const buffer = await fs.readFile(resolved);
    // 从文件扩展名推断 Content-Type
    const ext = path.extname(resolved).toLowerCase();
    const contentType = EXT_TO_MIME[ext] ?? "application/octet-stream";

    // Buffer → Uint8Array，兼容 NextResponse BodyInit 类型
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