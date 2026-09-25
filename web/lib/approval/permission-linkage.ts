/**
 * 审批+权限联动 — 审批通过后自动授权文档权限
 *
 * 设计原则：
 * - 审批最终通过（所有节点完成）后才触发联动，不是每个节点审批通过都触发
 * - 默认行为：审批通过后自动给申请人授予文档 view 权限
 * - 可选行为：审批模板节点中配置 permissionGrant 字段，按配置授权
 * - 幂等：已存在相同权限记录时跳过（P2002 视为成功）
 * - 所有授权操作写入 PermissionAuditLog 审计日志
 *
 * @module permission-linkage
 */

import { Prisma } from "@prisma/client";

// ─── 类型定义 ───────────────────────────────────────────────

/**
 * 权限授予配置 — 嵌入审批节点 JSON 中的可选字段
 * 用于审批通过后自动授权文档权限
 */
export interface PermissionGrant {
  /** 授予的权限级别 */
  permission: "view" | "comment" | "edit" | "manage";
  /** 授权对象类型：user | role（默认 user） */
  granteeType?: "user" | "role";
  /** 授权对象 ID：用户 ID（granteeType=user）或角色名（granteeType=role） */
  granteeId?: string;
}

/**
 * 审批节点（含可选 permissionGrant 字段）
 * 扩展自 approve/route.ts 中的 ApprovalNode，增加 permissionGrant
 */
export interface ApprovalNodeWithPermissionGrant {
  approverRole?: string;
  approverUserId?: string;
  name: string;
  order: number;
  mode?: "sequential" | "parallel" | "countersign";
  requiredCount?: number;
  /** 审批通过后自动授权的权限配置（可选） */
  permissionGrant?: PermissionGrant;
}

// ─── 核心函数 ───────────────────────────────────────────────

/**
 * 审批实例完成（status=approved）后，根据模板配置自动授权文档权限
 *
 * 联动逻辑：
 * 1. 检查审批实例的 entityType/entityId，无关联文档则跳过
 * 2. 解析 nodes JSON，收集所有节点中的 permissionGrant 配置
 * 3. 若无 permissionGrant 配置，默认给申请人授予 view 权限
 * 4. 若有 permissionGrant 配置，按每条配置授权（支持给不同用户/角色授予不同权限）
 * 5. 每条授权写入 PermissionAuditLog 审计日志
 * 6. 幂等：已存在相同权限记录时跳过（P2002 视为成功）
 *
 * @param tx - Prisma 事务客户端
 * @param instance - 审批实例（需包含 entityType, entityId, applicantId, nodes 字段）
 * @param workspaceId - 工作区 ID
 */
export async function applyPermissionOnApproval(
  tx: Prisma.TransactionClient,
  instance: {
    entityType: string | null;
    entityId: string | null;
    applicantId: string;
    nodes: unknown;
  },
  workspaceId: string,
): Promise<void> {
  // 仅处理关联文档的审批实例
  if (!instance.entityType || !instance.entityId) {
    return;
  }

  // 仅处理 document 类型（folder/space 的权限模型不同，暂不联动）
  if (instance.entityType !== "document") {
    return;
  }

  const documentId = instance.entityId;

  // 解析 nodes JSON，收集 permissionGrant 配置
  const nodes = instance.nodes as unknown as ApprovalNodeWithPermissionGrant[];
  const grants: PermissionGrant[] = [];

  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      if (node.permissionGrant) {
        grants.push(node.permissionGrant);
      }
    }
  }

  // 若无 permissionGrant 配置，默认给申请人授予 view 权限
  if (grants.length === 0) {
    grants.push({
      permission: "view",
      granteeType: "user",
      granteeId: instance.applicantId,
    });
  }

  // 逐条授权
  for (const grant of grants) {
    const granteeType = grant.granteeType ?? "user";
    const granteeId = grant.granteeId ?? instance.applicantId;

    // 检查是否已有相同权限记录（幂等处理）
    const existing = await tx.documentPermission.findFirst({
      where: {
        documentId,
        granteeType,
        granteeId,
      },
      select: { id: true, permission: true },
    });

    if (existing) {
      // 已有权限记录：如果权限级别相同或更高，跳过；否则更新
      const permissionRank: Record<string, number> = {
        view: 1,
        comment: 2,
        edit: 3,
        manage: 4,
      };
      if (permissionRank[existing.permission] >= permissionRank[grant.permission]) {
        // 已有权限 >= 拟授予权限，无需操作
        continue;
      }

      // 更新权限级别（升级）
      await tx.documentPermission.update({
        where: { id: existing.id },
        data: {
          permission: grant.permission,
          source: "explicit",
          grantedBy: instance.applicantId,
        },
      });

      // 写入审计日志
      await tx.permissionAuditLog.create({
        data: {
          workspaceId,
          action: "update",
          targetType: "document",
          targetId: documentId,
          granteeType,
          granteeId,
          oldPermission: existing.permission,
          newPermission: grant.permission,
          operatorId: instance.applicantId,
          reason: "审批通过自动授权（权限升级）",
        },
      });
      continue;
    }

    // 创建新的权限记录
    try {
      await tx.documentPermission.create({
        data: {
          documentId,
          workspaceId,
          granteeType,
          granteeId,
          permission: grant.permission,
          grantedBy: instance.applicantId,
          source: "explicit",
        },
      });

      // 写入审计日志
      await tx.permissionAuditLog.create({
        data: {
          workspaceId,
          action: "grant",
          targetType: "document",
          targetId: documentId,
          granteeType,
          granteeId,
          newPermission: grant.permission,
          operatorId: instance.applicantId,
          reason: "审批通过自动授权",
        },
      });
    } catch (error) {
      // P2002: 唯一约束冲突 — 并发场景下可能已由其他事务创建，视为幂等成功
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        continue;
      }
      // 其他错误向上抛出，由调用方处理
      throw error;
    }
  }
}
