import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";
import { checkDocumentPermission } from "@/lib/document-permission-check";

/**
 * POST /v1/workspaces/{wid}/documents/batch-permissions — 批量授权
 *
 * 阶段 6 · 任务 440：批量给多个文档添加权限。
 *
 * 请求体：
 *   {
 *     "documentIds": ["uuid1", "uuid2"],
 *     "granteeType": "user" | "role",
 *     "granteeId": "user-id-or-role-name",
 *     "permission": "view" | "comment" | "edit" | "manage"
 *   }
 *
 * 鉴权：调用者需对每个文档有 manage 权限或 owner/admin。
 * 响应：{ code: 201, data: { successCount, failedCount, failures: [{documentId, error}] } }
 */

const batchPermissionSchema = z.object({
  documentIds: z.array(z.string().min(1)).min(1).max(100),
  granteeType: z.enum(["user", "role"]),
  granteeId: z.string().min(1).max(255),
  permission: z.enum(["view", "comment", "edit", "manage"]),
});

/** 工作区中有效的角色名 */
const VALID_ROLES = new Set(["owner", "admin", "member", "viewer"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = batchPermissionSchema.parse(body);

    // owner/admin 全权，短路通过鉴权
    const isOwnerOrAdmin = ctx.member.role === "owner" || ctx.member.role === "admin";

    // granteeId 校验：
    // - granteeType="user"：验证该用户是当前工作区成员
    // - granteeType="role"：验证是有效角色名
    if (validated.granteeType === "role") {
      if (!VALID_ROLES.has(validated.granteeId)) {
        return NextResponse.json(
          { code: 400, message: apiMsg(req, "invalidGrantee"), data: null },
          { status: 400 },
        );
      }
    } else {
      const memberExists = await runWithWorkspace(
        wid,
        (tx) =>
          tx.member.findFirst({
            where: { workspaceId: wid, userId: validated.granteeId },
            select: { userId: true },
          }),
        ctx.payload.sub,
      );
      if (!memberExists) {
        return NextResponse.json(
          { code: 400, message: apiMsg(req, "granteeNotInWorkspace"), data: null },
          { status: 400 },
        );
      }
    }

    // 逐个文档处理：鉴权 + 创建权限记录
    const failures: { documentId: string; error: string }[] = [];
    let successCount = 0;

    for (const documentId of validated.documentIds) {
      try {
        // 鉴权：非 owner/admin 需检查 manage 权限
        if (!isOwnerOrAdmin) {
          const canManage = await checkDocumentPermission(
            ctx.payload.sub,
            documentId,
            "manage",
            wid,
            ctx.member.role,
            {
              member: ctx.member,
              permissions: ctx.permissions,
              temporaryGrant: ctx.temporaryGrant,
            },
          );
          if (!canManage) {
            failures.push({ documentId, error: "noManagePermission" });
            continue;
          }
        }

        // 确认文档存在且属于该工作区
        const docExists = await runWithWorkspace(
          wid,
          (tx) =>
            tx.document.findFirst({
              where: { id: documentId, workspaceId: wid },
              select: { id: true },
            }),
          ctx.payload.sub,
        );
        if (!docExists) {
          failures.push({ documentId, error: "documentNotFound" });
          continue;
        }

        // 创建权限记录（P2002 唯一约束冲突视为已存在，跳过但不计为失败）
        await runWithWorkspace(
          wid,
          (tx) =>
            tx.documentPermission.create({
              data: {
                documentId,
                workspaceId: wid,
                granteeType: validated.granteeType,
                granteeId: validated.granteeId,
                permission: validated.permission,
                grantedBy: ctx.payload.sub,
                source: "explicit",
              },
            }),
          ctx.payload.sub,
        );
        successCount++;
      } catch (error) {
        // P2002: 唯一约束冲突（同一 documentId+granteeType+granteeId 已存在）
        // 视为"已有该权限"，跳过但不计为失败
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          // 已存在相同权限记录，跳过（幂等语义）
          continue;
        }
        // 其他错误记录为失败
        const errorMsg = error instanceof Error ? error.message : apiMsg(req, "internalError");
        failures.push({ documentId, error: errorMsg });
      }
    }

    return NextResponse.json({
      code: 201,
      data: {
        successCount,
        failedCount: failures.length,
        failures,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.errors,
        },
        { status: 400 },
      );
    }
    console.error("[POST batch-permissions] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
