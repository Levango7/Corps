import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { randomUUID, createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";
import { z } from "zod";

/**
 * 云盘文件上传 API · /api/v1/workspaces/{wid}/files/upload
 * Phase 4A — 文件上传（multipart/form-data）
 *
 * 行为：
 *  1. 接收 multipart/form-data（field "file"）
 *  2. 校验文件大小 ≤ 50MB
 *  3. 校验 MIME 类型白名单（图片/PDF/Office/视频/音频/代码/文本）
 *  4. 计算 SHA-256 哈希
 *  5. 去重：同 workspace 内已有相同 sha256 的文件 → 创建新 FileVersion
 *     否则 → 创建新 FileAsset + 初始 FileVersion（version 1）
 *  6. 存储到 web/uploads/ 目录（MVP 本地存储，生产环境用 S3）
 */

/** 文件大小上限：50MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * 允许的文件类型（MIME type → 允许的扩展名列表）。
 * 同时校验 MIME type 和文件名扩展名，防止仅改 MIME type 绕过校验。
 */
const ALLOWED_TYPES: Record<string, string[]> = {
  // 图片
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "image/svg+xml": ["svg"],
  // PDF
  "application/pdf": ["pdf"],
  // Office
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  // 视频
  "video/mp4": ["mp4"],
  "video/webm": ["webm"],
  // 音频
  "audio/mpeg": ["mp3"],
  "audio/wav": ["wav"],
  "audio/x-wav": ["wav"],
  // 代码 & 文本（按扩展名映射 MIME）
  "text/javascript": ["js"],
  "application/javascript": ["js"],
  "text/typescript": ["ts"],
  "video/mp2t": ["ts"], // .ts 扩展名在 MIME 中常被映射为 video/mp2t
  "text/x-python": ["py"],
  "application/x-python": ["py"],
  "text/x-go": ["go"],
  "text/markdown": ["md"],
  "application/json": ["json"],
  "text/json": ["json"],
  "text/plain": ["txt"],
};

/** 图片 MIME type 集合（用于生成缩略图 key） */
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

/** 上传目录（web/uploads/，与消息附件一致；非 public 避免绕过鉴权） */
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

/**
 * 计算 Buffer 的 SHA-256 哈希（十六进制字符串）。
 * 来源：coding-pattern/2026-09-09-zod-datetime-string-to-prisma-date-conversion（crypto 模块使用模式）
 */
function computeSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  // 声明在 try 块外，以便 catch 块能访问并清理已写入磁盘的文件（防磁盘泄漏）
  let savedPath: string | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "missingFile"), data: null },
        { status: 400 },
      );
    }

    // 文件大小校验
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "fileSizeExceededPro"), data: null },
        { status: 400 },
      );
    }

    // 校验文件类型（MIME type + 文件名扩展名双重校验，防绕过）
    const allowedExts = ALLOWED_TYPES[file.type];
    if (!allowedExts) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "unsupportedFileType"), data: null },
        { status: 400 },
      );
    }
    const fileExt = path.extname(file.name).toLowerCase().replace(/^\./, "");
    if (!fileExt || !allowedExts.includes(fileExt)) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "unsupportedFileType"), data: null },
        { status: 400 },
      );
    }
    // 存储用扩展名：取该 MIME type 的主扩展名，保证一致性
    const ext = allowedExts[0];

    // 读取文件内容并计算 SHA-256
    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = computeSha256(buffer);

    // 确保上传目录存在
    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    // 生成唯一文件名并写入磁盘
    const fileId = randomUUID();
    const savedFileName = `${fileId}.${ext}`;
    savedPath = path.join(UPLOAD_DIR, savedFileName);
    await fs.writeFile(savedPath, buffer);

    // 存储 key（相对路径，下载时拼接到 UPLOAD_DIR）
    const storageKey = savedFileName;
    const isImage = IMAGE_TYPES.has(file.type);
    // MVP：图片缩略图直接用原图（后续可接入图片处理服务生成真正缩略图）
    const thumbnailKey = isImage ? savedFileName : null;

    // 可选的 folderId（从 formData 获取）
    const folderIdRaw = formData.get("folderId");
    const folderId =
      typeof folderIdRaw === "string" && folderIdRaw.length > 0
        ? folderIdRaw
        : null;

    // 校验 folderId 格式（若提供则必须是合法 UUID，防止注入非法值）
    if (folderId !== null) {
      const uuidResult = z.string().uuid().safeParse(folderId);
      if (!uuidResult.success) {
        return NextResponse.json(
          { code: 400, message: "Invalid folderId format", data: null },
          { status: 400 },
        );
      }
    }

    // 可选的版本说明（从 formData 获取）
    const messageRaw = formData.get("message");
    const versionMessage =
      typeof messageRaw === "string" && messageRaw.length > 0
        ? messageRaw
        : null;

    // 去重逻辑：同 workspace 内按 sha256 查找已有文件
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验文件夹归属（若指定了 folderId，必须属于当前工作区）
        if (folderId) {
          const folder = await tx.folder.findFirst({
            where: { id: folderId, workspaceId: wid },
            select: { id: true },
          });
          if (!folder) {
            return { kind: "folderNotFound" as const, assetId: "", version: 0, fileVersion: null };
          }
        }

        const existing = await tx.fileAsset.findFirst({
          where: { workspaceId: wid, sha256 },
          select: { id: true, currentVersion: true, fileName: true },
        });

        if (existing) {
          // 去重：创建新 FileVersion，更新 FileAsset 指向新版本
          const version = existing.currentVersion + 1;
          const fileVersion = await tx.fileVersion.create({
            data: {
              fileAssetId: existing.id,
              version,
              storageKey,
              fileSize: file.size,
              message: versionMessage,
              uploadedBy: ctx.payload.sub,
            },
          });
          await tx.fileAsset.update({
            where: { id: existing.id },
            data: {
              storageKey,
              fileSize: file.size,
              fileType: file.type,
              currentVersion: version,
              updatedAt: new Date(),
            },
          });
          return { kind: "dedup" as const, assetId: existing.id, version, fileVersion };
        }

        // 新文件：创建 FileAsset + 初始 FileVersion（version 1）
        const asset = await tx.fileAsset.create({
          data: {
            workspaceId: wid,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            storageKey,
            thumbnailKey,
            sha256,
            uploadedBy: ctx.payload.sub,
            folderId,
            currentVersion: 1,
          },
        });
        const fileVersion = await tx.fileVersion.create({
          data: {
            fileAssetId: asset.id,
            version: 1,
            storageKey,
            fileSize: file.size,
            message: versionMessage,
            uploadedBy: ctx.payload.sub,
          },
        });
        return { kind: "new" as const, assetId: asset.id, version: 1, fileVersion };
      },
      ctx.payload.sub,
    );

    // 文件夹归属校验失败：清理已写入磁盘的文件并返回 400
    if (result.kind === "folderNotFound") {
      if (savedPath) {
        try {
          await fs.unlink(savedPath);
        } catch {
          // 文件可能未写入或已删除，忽略清理错误
        }
      }
      return NextResponse.json(
        { code: 400, message: "Folder not found in this workspace", data: null },
        { status: 400 },
      );
    }

    // 查询完整 FileAsset 返回（含 uploader）
    const fileAsset = await runWithWorkspace(
      wid,
      (tx) =>
        tx.fileAsset.findUnique({
          where: { id: result.assetId },
          include: {
            uploader: { select: { id: true, name: true, email: true } },
            _count: { select: { versions: true } },
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json(
      {
        code: 201,
        data: fileAsset,
        message: result.kind === "dedup" ? "文件已去重，创建新版本" : undefined,
      },
      { status: 201 },
    );
  } catch (error) {
    // 清理已写入磁盘的文件（事务失败时避免磁盘泄漏）
    if (savedPath) {
      try {
        await fs.unlink(savedPath);
      } catch {
        // 文件可能未写入或已删除，忽略清理错误
      }
    }
    console.error("[POST file upload] error:", error);
    return handlePrismaError(error, req);
  }
}