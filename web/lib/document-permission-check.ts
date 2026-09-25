/**
 * 文档权限判定算法（设计文档 §2.2.3）
 *
 * 权限级别层级：view < comment < edit < manage < share
 * 判定顺序（短路求值，命中即返回）：
 *   1. 工作区角色（owner 短路全权，admin 全权）
 *   2. 文档作者（自动拥有 manage 权限）
 *   3. 文档级显式授权（DocumentPermission，source=explicit）
 *   4. 文件夹继承权限（向上递归查 FolderPermission，source=inherited）
 *   5. 工作区级文档模块权限（RBAC 矩阵）
 *
 * 来源：阶段 6 · 任务 440
 */

import { runWithWorkspace } from "./auth";
import { checkPermission, type PermissionContext } from "./permissions";

// ─── 权限级别常量 ───────────────────────────────────────────────

/** 权限级别层级：view < comment < edit < manage < share */
export const PERMISSION_LEVELS = ["view", "comment", "edit", "manage", "share"] as const;

export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/** 权限级别 → 数值映射（用于比较大小） */
const LEVEL_INDEX: Record<PermissionLevel, number> = {
  view: 0,
  comment: 1,
  edit: 2,
  manage: 3,
  share: 4,
};

/** 判断 required 是否 >= actual（即用户拥有的权限是否满足要求） */
function hasPermissionLevel(actual: PermissionLevel, required: PermissionLevel): boolean {
  return LEVEL_INDEX[actual] >= LEVEL_INDEX[required];
}

// ─── 权限来源标记 ───────────────────────────────────────────────

/** 权限来源类型 */
export type PermissionSource =
  | "workspace_role" // 工作区角色（owner/admin）
  | "author" // 文档作者
  | "explicit" // 文档级显式授权
  | "inherited" // 文件夹继承权限
  | "module"; // 工作区级模块权限（RBAC）

/** 权限信息（含来源标记） */
export interface PermissionInfo {
  permission: PermissionLevel;
  source: PermissionSource;
  /** 继承来源 ID（仅 source=inherited 时有值，指向 FolderPermission.id） */
  inheritedFromId?: string;
}

// ─── 核心函数 ───────────────────────────────────────────────────

/**
 * 检查用户对文档是否拥有指定级别的权限。
 *
 * 判定顺序（短路求值）：
 *   1. owner → 全权（短路）
 *   2. admin → 全权（短路）
 *   3. 文档作者 → manage 权限
 *   4. DocumentPermission（source=explicit）
 *   5. FolderPermission（source=inherited，向上递归）
 *   6. RBAC 模块权限矩阵（documents 模块 read 权限 → view）
 *
 * @param userId  用户 ID
 * @param documentId  文档 ID
 * @param requiredPermission  需要的权限级别
 * @param wid  工作区 ID
 * @param role  用户在工作区中的角色（owner/admin/member/viewer）
 * @param ctx  可选，权限上下文（含 MemberPermission 覆盖和临时授权）
 * @returns true 表示拥有足够权限
 */
export async function checkDocumentPermission(
  userId: string,
  documentId: string,
  requiredPermission: PermissionLevel,
  wid: string,
  role: string,
  ctx?: PermissionContext,
): Promise<boolean> {
  // 1. owner 短路全权
  if (role === "owner") return true;

  // 2. admin 全权
  if (role === "admin") return true;

  return runWithWorkspace(
    wid,
    async (tx) => {
      // 3. 文档作者 → manage 权限（manage >= 任何 required）
      const doc = await tx.document.findFirst({
        where: { id: documentId, workspaceId: wid },
        select: { authorId: true, folderId: true, spaceId: true },
      });
      if (doc?.authorId === userId) {
        // 作者拥有 manage 权限，manage >= view/comment/edit/manage
        // 但 share 级别作者不一定拥有（share 是特殊权限）
        if (requiredPermission !== "share") return true;
      }

      // 4. 文档级显式授权（source=explicit）
      const explicitPerm = await tx.documentPermission.findFirst({
        where: {
          documentId,
          workspaceId: wid,
          granteeType: "user",
          granteeId: userId,
          source: "explicit",
        },
        select: { permission: true, expiresAt: true },
      });
      if (explicitPerm) {
        // 检查是否过期
        if (!explicitPerm.expiresAt || explicitPerm.expiresAt > new Date()) {
          if (hasPermissionLevel(explicitPerm.permission as PermissionLevel, requiredPermission)) {
            return true;
          }
        }
      }

      // 4b. 文档级显式授权（granteeType=role，匹配用户角色）
      if (role === "member" || role === "viewer") {
        const rolePerm = await tx.documentPermission.findFirst({
          where: {
            documentId,
            workspaceId: wid,
            granteeType: "role",
            granteeId: role,
            source: "explicit",
          },
          select: { permission: true, expiresAt: true },
        });
        if (rolePerm) {
          if (!rolePerm.expiresAt || rolePerm.expiresAt > new Date()) {
            if (hasPermissionLevel(rolePerm.permission as PermissionLevel, requiredPermission)) {
              return true;
            }
          }
        }
      }

      // 5. 文件夹继承权限（向上递归）
      if (doc) {
        const inheritedPerm = await getInheritedFolderPermissionInternal(
          tx,
          doc.folderId,
          doc.spaceId,
          userId,
          wid,
          role,
        );
        if (inheritedPerm) {
          if (hasPermissionLevel(inheritedPerm as PermissionLevel, requiredPermission)) {
            return true;
          }
        }
      }

      // 6. 工作区级文档模块权限（RBAC 矩阵）
      // member/viewer 通过 RBAC 矩阵检查 documents 模块的 read 权限 → 等价于 view
      if (ctx && (role === "member" || role === "viewer")) {
        const canRead = await checkPermission(ctx, "documents", "read");
        if (canRead && requiredPermission === "view") {
          return true;
        }
      }

      return false;
    },
    userId,
  );
}

/**
 * 获取用户对文档的有效权限列表（含来源标记）。
 *
 * 按判定顺序收集所有命中的权限，返回完整列表供前端展示。
 *
 * @param userId  用户 ID
 * @param documentId  文档 ID
 * @param wid  工作区 ID
 * @param role  用户在工作区中的角色
 * @param ctx  可选，权限上下文
 * @returns 权限信息列表
 */
export async function getEffectivePermissions(
  userId: string,
  documentId: string,
  wid: string,
  role: string,
  ctx?: PermissionContext,
): Promise<PermissionInfo[]> {
  const result: PermissionInfo[] = [];

  // 1. owner → 全权
  if (role === "owner") {
    for (const p of PERMISSION_LEVELS) {
      result.push({ permission: p, source: "workspace_role" });
    }
    return result;
  }

  // 2. admin → 全权
  if (role === "admin") {
    for (const p of PERMISSION_LEVELS) {
      result.push({ permission: p, source: "workspace_role" });
    }
    return result;
  }

  return runWithWorkspace(
    wid,
    async (tx) => {
      // 3. 文档作者 → manage
      const doc = await tx.document.findFirst({
        where: { id: documentId, workspaceId: wid },
        select: { authorId: true, folderId: true, spaceId: true },
      });
      if (doc?.authorId === userId) {
        result.push({ permission: "manage", source: "author" });
      }

      // 4. 文档级显式授权（user）
      const explicitUserPerms = await tx.documentPermission.findMany({
        where: {
          documentId,
          workspaceId: wid,
          granteeType: "user",
          granteeId: userId,
          source: "explicit",
        },
        select: { permission: true, expiresAt: true },
      });
      for (const p of explicitUserPerms) {
        if (!p.expiresAt || p.expiresAt > new Date()) {
          result.push({ permission: p.permission as PermissionLevel, source: "explicit" });
        }
      }

      // 4b. 文档级显式授权（role）
      if (role === "member" || role === "viewer") {
        const explicitRolePerms = await tx.documentPermission.findMany({
          where: {
            documentId,
            workspaceId: wid,
            granteeType: "role",
            granteeId: role,
            source: "explicit",
          },
          select: { permission: true, expiresAt: true },
        });
        for (const p of explicitRolePerms) {
          if (!p.expiresAt || p.expiresAt > new Date()) {
            result.push({ permission: p.permission as PermissionLevel, source: "explicit" });
          }
        }
      }

      // 5. 文件夹继承权限
      if (doc) {
        const inheritedPerm = await getInheritedFolderPermissionInternal(
          tx,
          doc.folderId,
          doc.spaceId,
          userId,
          wid,
          role,
        );
        if (inheritedPerm) {
          result.push({
            permission: inheritedPerm as PermissionLevel,
            source: "inherited",
          });
        }
      }

      // 6. RBAC 模块权限
      if (ctx && (role === "member" || role === "viewer")) {
        const canRead = await checkPermission(ctx, "documents", "read");
        if (canRead) {
          result.push({ permission: "view", source: "module" });
        }
      }

      return result;
    },
    userId,
  );
}

/**
 * 检查用户对文件夹是否拥有指定级别的权限（含向上递归继承）。
 *
 * 判定顺序：
 *   1. owner/admin → 全权
 *   2. 文件夹直接权限（FolderPermission，targetType=folder）
 *   3. 空间级权限（FolderPermission，targetType=space）
 *   4. 向上递归父文件夹权限（inheritable=true 的记录）
 *
 * @param userId  用户 ID
 * @param folderId  文件夹 ID
 * @param requiredPermission  需要的权限级别
 * @param wid  工作区 ID
 * @param role  用户角色
 * @returns true 表示拥有足够权限
 */
export async function checkFolderPermission(
  userId: string,
  folderId: string,
  requiredPermission: PermissionLevel,
  wid: string,
  role: string,
): Promise<boolean> {
  // 1. owner/admin → 全权
  if (role === "owner" || role === "admin") return true;

  return runWithWorkspace(
    wid,
    async (tx) => {
      // 查询文件夹信息（含 spaceId 和 parentId 用于向上递归）
      const folder = await tx.folder.findFirst({
        where: { id: folderId, workspaceId: wid },
        select: { spaceId: true, parentId: true },
      });
      if (!folder) return false;

      // 2. 文件夹直接权限
      const folderPerm = await tx.folderPermission.findFirst({
        where: {
          targetType: "folder",
          targetId: folderId,
          granteeType: "user",
          granteeId: userId,
          inheritable: true,
        },
        select: { permission: true },
      });
      if (
        folderPerm &&
        hasPermissionLevel(folderPerm.permission as PermissionLevel, requiredPermission)
      ) {
        return true;
      }

      // 2b. 文件夹直接权限（role）
      if (role === "member" || role === "viewer") {
        const folderRolePerm = await tx.folderPermission.findFirst({
          where: {
            targetType: "folder",
            targetId: folderId,
            granteeType: "role",
            granteeId: role,
            inheritable: true,
          },
          select: { permission: true },
        });
        if (
          folderRolePerm &&
          hasPermissionLevel(folderRolePerm.permission as PermissionLevel, requiredPermission)
        ) {
          return true;
        }
      }

      // 3. 空间级权限
      const spacePerm = await tx.folderPermission.findFirst({
        where: {
          targetType: "space",
          targetId: folder.spaceId,
          granteeType: "user",
          granteeId: userId,
          inheritable: true,
        },
        select: { permission: true },
      });
      if (
        spacePerm &&
        hasPermissionLevel(spacePerm.permission as PermissionLevel, requiredPermission)
      ) {
        return true;
      }

      // 3b. 空间级权限（role）
      if (role === "member" || role === "viewer") {
        const spaceRolePerm = await tx.folderPermission.findFirst({
          where: {
            targetType: "space",
            targetId: folder.spaceId,
            granteeType: "role",
            granteeId: role,
            inheritable: true,
          },
          select: { permission: true },
        });
        if (
          spaceRolePerm &&
          hasPermissionLevel(spaceRolePerm.permission as PermissionLevel, requiredPermission)
        ) {
          return true;
        }
      }

      // 4. 向上递归父文件夹权限
      if (folder.parentId) {
        return checkParentFolderPermissionInternal(
          tx,
          folder.parentId,
          userId,
          wid,
          role,
          requiredPermission,
        );
      }

      return false;
    },
    userId,
  );
}

/**
 * 向上递归查找继承的文件夹权限。
 *
 * 从文档所属的 folderId 开始，逐级向上查找 FolderPermission（inheritable=true），
 * 返回第一个命中的权限级别。如果 folderId 为 null，则直接查 space 级权限。
 *
 * @param folderId  文档所属文件夹 ID（null = 空间根目录）
 * @param userId  用户 ID
 * @param wid  工作区 ID
 * @returns 继承的权限级别字符串，或 null（无继承权限）
 */
export async function getInheritedFolderPermission(
  folderId: string | null,
  userId: string,
  wid: string,
): Promise<string | null> {
  return runWithWorkspace(
    wid,
    async (tx) => {
      // folderId 为 null 时，无法确定 spaceId，需要调用方传入或从文档查询
      // 此处仅处理 folderId 非 null 的情况；null 返回 null（由调用方在 checkDocumentPermission 中处理）
      if (!folderId) return null;

      const folder = await tx.folder.findFirst({
        where: { id: folderId, workspaceId: wid },
        select: { spaceId: true, parentId: true },
      });
      if (!folder) return null;

      return getInheritedFolderPermissionInternal(
        tx,
        folderId,
        folder.spaceId,
        userId,
        wid,
        "member",
      );
    },
    userId,
  );
}

// ─── 内部辅助函数（事务内调用，不创建新事务）─────────────────────

/**
 * 事务内递归查找继承的文件夹权限。
 * 查找顺序：当前文件夹 → 空间级 → 父文件夹（递归）
 */
async function getInheritedFolderPermissionInternal(
  tx: Parameters<Parameters<typeof runWithWorkspace>[1]>[0],
  folderId: string | null,
  spaceId: string | null,
  userId: string,
  wid: string,
  role: string,
): Promise<string | null> {
  // folderId 为 null 时，查空间级权限
  if (!folderId) {
    if (!spaceId) return null;

    // 空间级权限（user）
    const spacePerm = await tx.folderPermission.findFirst({
      where: {
        targetType: "space",
        targetId: spaceId,
        granteeType: "user",
        granteeId: userId,
        inheritable: true,
      },
      select: { permission: true },
    });
    if (spacePerm) return spacePerm.permission;

    // 空间级权限（role）
    if (role === "member" || role === "viewer") {
      const spaceRolePerm = await tx.folderPermission.findFirst({
        where: {
          targetType: "space",
          targetId: spaceId,
          granteeType: "role",
          granteeId: role,
          inheritable: true,
        },
        select: { permission: true },
      });
      if (spaceRolePerm) return spaceRolePerm.permission;
    }

    return null;
  }

  // 查当前文件夹的权限
  const folderPerm = await tx.folderPermission.findFirst({
    where: {
      targetType: "folder",
      targetId: folderId,
      granteeType: "user",
      granteeId: userId,
      inheritable: true,
    },
    select: { permission: true },
  });
  if (folderPerm) return folderPerm.permission;

  // 查当前文件夹的权限（role）
  if (role === "member" || role === "viewer") {
    const folderRolePerm = await tx.folderPermission.findFirst({
      where: {
        targetType: "folder",
        targetId: folderId,
        granteeType: "role",
        granteeId: role,
        inheritable: true,
      },
      select: { permission: true },
    });
    if (folderRolePerm) return folderRolePerm.permission;
  }

  // 查文件夹的 spaceId 和 parentId
  const folder = await tx.folder.findFirst({
    where: { id: folderId, workspaceId: wid },
    select: { spaceId: true, parentId: true },
  });
  if (!folder) return null;

  // 空间级权限（作为 fallback，与文件夹同级查找）
  const spacePerm = await tx.folderPermission.findFirst({
    where: {
      targetType: "space",
      targetId: folder.spaceId,
      granteeType: "user",
      granteeId: userId,
      inheritable: true,
    },
    select: { permission: true },
  });
  if (spacePerm) return spacePerm.permission;

  if (role === "member" || role === "viewer") {
    const spaceRolePerm = await tx.folderPermission.findFirst({
      where: {
        targetType: "space",
        targetId: folder.spaceId,
        granteeType: "role",
        granteeId: role,
        inheritable: true,
      },
      select: { permission: true },
    });
    if (spaceRolePerm) return spaceRolePerm.permission;
  }

  // 向上递归父文件夹
  if (folder.parentId) {
    return getInheritedFolderPermissionInternal(
      tx,
      folder.parentId,
      folder.spaceId,
      userId,
      wid,
      role,
    );
  }

  return null;
}

/**
 * 事务内递归检查父文件夹权限（用于 checkFolderPermission 的向上递归）。
 */
async function checkParentFolderPermissionInternal(
  tx: Parameters<Parameters<typeof runWithWorkspace>[1]>[0],
  parentId: string,
  userId: string,
  wid: string,
  role: string,
  requiredPermission: PermissionLevel,
): Promise<boolean> {
  // 查父文件夹的权限（user）
  const parentPerm = await tx.folderPermission.findFirst({
    where: {
      targetType: "folder",
      targetId: parentId,
      granteeType: "user",
      granteeId: userId,
      inheritable: true,
    },
    select: { permission: true },
  });
  if (
    parentPerm &&
    hasPermissionLevel(parentPerm.permission as PermissionLevel, requiredPermission)
  ) {
    return true;
  }

  // 查父文件夹的权限（role）
  if (role === "member" || role === "viewer") {
    const parentRolePerm = await tx.folderPermission.findFirst({
      where: {
        targetType: "folder",
        targetId: parentId,
        granteeType: "role",
        granteeId: role,
        inheritable: true,
      },
      select: { permission: true },
    });
    if (
      parentRolePerm &&
      hasPermissionLevel(parentRolePerm.permission as PermissionLevel, requiredPermission)
    ) {
      return true;
    }
  }

  // 查父文件夹的 spaceId 和 parentId
  const parentFolder = await tx.folder.findFirst({
    where: { id: parentId, workspaceId: wid },
    select: { spaceId: true, parentId: true },
  });
  if (!parentFolder) return false;

  // 空间级权限
  const spacePerm = await tx.folderPermission.findFirst({
    where: {
      targetType: "space",
      targetId: parentFolder.spaceId,
      granteeType: "user",
      granteeId: userId,
      inheritable: true,
    },
    select: { permission: true },
  });
  if (
    spacePerm &&
    hasPermissionLevel(spacePerm.permission as PermissionLevel, requiredPermission)
  ) {
    return true;
  }

  if (role === "member" || role === "viewer") {
    const spaceRolePerm = await tx.folderPermission.findFirst({
      where: {
        targetType: "space",
        targetId: parentFolder.spaceId,
        granteeType: "role",
        granteeId: role,
        inheritable: true,
      },
      select: { permission: true },
    });
    if (
      spaceRolePerm &&
      hasPermissionLevel(spaceRolePerm.permission as PermissionLevel, requiredPermission)
    ) {
      return true;
    }
  }

  // 继续向上递归
  if (parentFolder.parentId) {
    return checkParentFolderPermissionInternal(
      tx,
      parentFolder.parentId,
      userId,
      wid,
      role,
      requiredPermission,
    );
  }

  return false;
}
