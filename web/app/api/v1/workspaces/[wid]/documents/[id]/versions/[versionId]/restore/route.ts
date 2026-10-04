import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";

/**
 * 文档版本回滚 API · /api/v1/workspaces/{wid}/documents/{id}/versions/{versionId}/restore
 * 设计文档 §2.3.3
 *
 * ## 为什么必须有这条路由（不可逆数据丢失的修复）
 *
 * 丢数据时序（已核实）：
 *   1. `DocumentEditor` 的保存由 **blur** 触发（DocumentEditor.tsx:463 `onBlur={() => save()}`）；
 *   2. `save()` 是防抖的（`:200` `if (busy) return`），无参调用时 `publish:false`（`:209`）；
 *   3. 用户点「回滚」→ 触发 blur → **PATCH 已在路上**（携带只在内存里的新内容）；
 *   4. restore 覆盖 markdown → 用户刚输入的内容被覆盖，
 *      而它**从未存在于任何版本行**（PATCH 只覆盖 markdown，不建版本行）→ 事后无法补救。
 *
 * 本路由的强制约束（不可协商、不可由请求参数关闭）：
 *   在**同一个事务内**，先把当前 markdown 无条件快照为
 *   `source:"auto" / message:"回滚前自动快照"` 的新版本行，再覆盖 markdown。
 *   快照失败 → 整体回滚（同一事务自然保证），绝不出现"覆盖了但没快照"。
 *
 * 与既有 `versions/[versionId]/route.ts` 的 POST 的区别：
 *   那条路由在覆盖**之后**才创建快照，且快照内容是**目标版本**的内容，
 *   因此回滚前的当前内容仍会丢失。此路由是唯一正确的回滚入口。
 *
 * 鉴权：getWorkspaceContext（身份 + 成员资格） + requirePermission 角色门禁
 *       （documents 模块的 update 动作）—— viewer 对 documents 只有 "r"，
 *       必然 403，绝不 2xx。
 */

type RestoreResult =
  | { kind: "docNotFound" }
  | { kind: "versionNotFound" }
  | { kind: "ok"; snapshotVersion: number; document: unknown };

/** POST /v1/workspaces/{wid}/documents/{id}/versions/{versionId}/restore — 回滚（先强制快照） */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; versionId: string }> },
) {
  const { wid, id, versionId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  // 角色门禁：viewer 对 documents 仅 "r"，无写权限者在此 403（AC-17）
  const deniedRole = await requirePermission(ctx, "documents", "update", req);
  if (deniedRole) return deniedRole;

  try {
    const result = await runWithWorkspace<RestoreResult>(
      wid,
      async (tx) => {
        // 1) 校验文档存在且属于本工作区
        const docExists = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true },
        });
        if (!docExists) return { kind: "docNotFound" };

        // 2) 校验目标版本存在且属于该文档（防跨文档/跨租户回滚）
        const targetVersion = await tx.documentVersion.findFirst({
          where: { id: versionId, documentId: id, workspaceId: wid },
          select: { id: true, version: true, markdown: true },
        });
        if (!targetVersion) return { kind: "versionNotFound" };

        // 3) 并发保护：对 Document 行加 FOR UPDATE 行锁
        await tx.$queryRaw`SELECT id FROM "documents" WHERE id = ${id}::uuid FOR UPDATE`;

        // 4) 锁后重读当前内容与版本号。
        //    必须锁后读：blur 触发的 PATCH 可能与本事务并发，
        //    锁前读到的 markdown 会是旧值，快照就存不回真实内容。
        const current = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { markdown: true, title: true, currentVersion: true },
        });
        if (!current) return { kind: "docNotFound" };

        // 5) 【强制】无条件快照当前内容 —— 不接受任何请求参数控制。
        //    这是"回滚前用户刚输入的内容"唯一的救命稻草，必须先于覆盖落库。
        //    快照内容 = 当前 markdown；快照与目标版本内容相同时仍要建
        //    （版本号必须单调递增，且"回滚动作本身"需要可追溯记录）。
        const snapshotVersion = current.currentVersion + 1;
        await tx.documentVersion.create({
          data: {
            documentId: id,
            workspaceId: wid,
            version: snapshotVersion,
            snapshotType: "full",
            contentDiff: null,
            markdown: current.markdown,
            message: "回滚前自动快照",
            source: "auto",
            authorId: ctx.payload.sub,
          },
        });

        // 6) 再把 markdown 覆盖为目标版本内容
        await tx.document.update({
          where: { id },
          data: { markdown: targetVersion.markdown, currentVersion: snapshotVersion },
        });

        const { sharePassword: _stripped, ...docSafe } = await tx.document.findUniqueOrThrow({
          where: { id },
        });

        return { kind: "ok", snapshotVersion, document: docSafe };
      },
      ctx.payload.sub,
    );

    if (result.kind === "docNotFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.kind === "versionNotFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({
      code: 200,
      data: {
        document: result.document,
        snapshotVersion: result.snapshotVersion,
        restoredFromVersionId: versionId,
      },
    });
  } catch (error) {
    // 快照 create 失败会连带整体回滚（同一事务），绝不会出现"覆盖了但没快照"
    console.error("[POST document version restore] error:", error);
    return handlePrismaError(error, req);
  }
}
