// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { applyPermissionOnApproval } from "@/lib/approval/permission-linkage";

/**
 * 审批→文档权限联动（lib/approval/permission-linkage.ts）契约。
 *
 * 联动规则：仅 document 类型审批、仅全部节点通过后触发一次。
 * 默认给申请人 view；模板可配 permissionGrant 授不同人/角色不同权限。
 * 幂等：已有同级或更高权限 → 跳过；已有更低权限 → 升级并记审计；
 * 并发唯一冲突 P2002 视为成功，其他错误上抛。
 */

let existing: { id: string; permission: string } | null;
let created: unknown[];
let updated: unknown[];
let audits: unknown[];
let createError: unknown;

const tx = {
  documentPermission: {
    findFirst: vi.fn(async () => existing),
    update: vi.fn(async ({ data }: { data: unknown }) => {
      updated.push(data);
      return undefined;
    }),
    create: vi.fn(async ({ data }: { data: unknown }) => {
      if (createError) throw createError;
      created.push(data);
      return undefined;
    }),
  },
  permissionAuditLog: {
    create: vi.fn(async ({ data }: { data: unknown }) => {
      audits.push(data);
      return undefined;
    }),
  },
} as unknown as Prisma.TransactionClient;

function instance(overrides: Record<string, unknown> = {}) {
  return {
    entityType: "document",
    entityId: "doc-1",
    applicantId: "u-applicant",
    nodes: [],
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  existing = null;
  created = [];
  updated = [];
  audits = [];
  createError = null;
});

describe("applyPermissionOnApproval —— 前置过滤", () => {
  it("无 entityType/entityId → 直接返回，不碰任何表", async () => {
    await applyPermissionOnApproval(tx, instance({ entityType: null }), "w-1");
    await applyPermissionOnApproval(tx, instance({ entityId: null }), "w-1");
    expect(tx.documentPermission.findFirst).not.toHaveBeenCalled();
  });

  it("非 document 类型（folder/space）→ 跳过（权限模型不同，暂不联动）", async () => {
    await applyPermissionOnApproval(tx, instance({ entityType: "folder" }), "w-1");
    expect(tx.documentPermission.findFirst).not.toHaveBeenCalled();
  });

  it("nodes 非数组（旧数据可能存 JSON 字符串/null）→ 走默认授权，不抛错", async () => {
    await applyPermissionOnApproval(tx, instance({ nodes: "garbage" }), "w-1");
    expect(created).toHaveLength(1);
  });
});

describe("applyPermissionOnApproval —— 默认授权", () => {
  it("节点无 permissionGrant → 给申请人授 view（user）", async () => {
    await applyPermissionOnApproval(
      tx,
      instance({ nodes: [{ name: "主管", order: 0, approverRole: "manager" }] }),
      "w-1",
    );
    expect(tx.documentPermission.findFirst).toHaveBeenCalledWith({
      where: { documentId: "doc-1", granteeType: "user", granteeId: "u-applicant" },
      select: { id: true, permission: true },
    });
    expect(created).toEqual([
      {
        documentId: "doc-1",
        workspaceId: "w-1",
        granteeType: "user",
        granteeId: "u-applicant",
        permission: "view",
        grantedBy: "u-applicant",
        source: "explicit",
      },
    ]);
  });

  it("写审计日志：action=grant + reason=审批通过自动授权", async () => {
    await applyPermissionOnApproval(tx, instance(), "w-1");
    expect(audits).toEqual([
      {
        workspaceId: "w-1",
        action: "grant",
        targetType: "document",
        targetId: "doc-1",
        granteeType: "user",
        granteeId: "u-applicant",
        newPermission: "view",
        operatorId: "u-applicant",
        reason: "审批通过自动授权",
      },
    ]);
  });
});

describe("applyPermissionOnApproval —— 显式 permissionGrant", () => {
  it("按节点配置授权：可给其他人授 edit", async () => {
    await applyPermissionOnApproval(
      tx,
      instance({
        nodes: [
          { name: "主管", order: 0, permissionGrant: { permission: "edit", granteeId: "u-other" } },
        ],
      }),
      "w-1",
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ granteeId: "u-other", permission: "edit" });
    expect(audits[0]).toMatchObject({ action: "grant", newPermission: "edit" });
  });

  it("多节点多条 grant → 逐条授权（支持同批给不同人不同权限）", async () => {
    await applyPermissionOnApproval(
      tx,
      instance({
        nodes: [
          { name: "节点A", order: 0, permissionGrant: { permission: "view", granteeId: "u-a" } },
          { name: "节点B", order: 1, permissionGrant: { permission: "manage", granteeId: "u-b" } },
          { name: "节点C", order: 2 },
        ],
      }),
      "w-1",
    );
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ granteeId: "u-a", permission: "view" });
    expect(created[1]).toMatchObject({ granteeId: "u-b", permission: "manage" });
  });

  it("granteeType 缺省 user；granteeId 缺省=申请人", async () => {
    await applyPermissionOnApproval(
      tx,
      instance({ nodes: [{ name: "x", order: 0, permissionGrant: { permission: "comment" } }] }),
      "w-1",
    );
    expect(created[0]).toMatchObject({ granteeType: "user", granteeId: "u-applicant" });
  });

  it("role 类型授权（granteeType: role 存角色名）", async () => {
    await applyPermissionOnApproval(
      tx,
      instance({
        nodes: [
          {
            name: "x",
            order: 0,
            permissionGrant: { permission: "edit", granteeType: "role", granteeId: "admin" },
          },
        ],
      }),
      "w-1",
    );
    expect(created[0]).toMatchObject({ granteeType: "role", granteeId: "admin" });
  });
});

describe("applyPermissionOnApproval —— 幂等与升级", () => {
  it("已有同级或更高权限 → 跳过（不 update、不 create、不写审计）", async () => {
    existing = { id: "dp-1", permission: "edit" };
    await applyPermissionOnApproval(
      tx,
      instance({ nodes: [{ name: "x", order: 0, permissionGrant: { permission: "view" } }] }),
      "w-1",
    );
    expect(updated).toHaveLength(0);
    expect(created).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("已有更低权限 → 升级：update + 审计 action=update（含 oldPermission）", async () => {
    existing = { id: "dp-1", permission: "view" };
    await applyPermissionOnApproval(
      tx,
      instance({ nodes: [{ name: "x", order: 0, permissionGrant: { permission: "edit" } }] }),
      "w-1",
    );
    expect(updated).toEqual([{ permission: "edit", source: "explicit", grantedBy: "u-applicant" }]);
    expect(audits).toEqual([
      {
        workspaceId: "w-1",
        action: "update",
        targetType: "document",
        targetId: "doc-1",
        granteeType: "user",
        granteeId: "u-applicant",
        oldPermission: "view",
        newPermission: "edit",
        operatorId: "u-applicant",
        reason: "审批通过自动授权（权限升级）",
      },
    ]);
    expect(created).toHaveLength(0);
  });

  it("已有 manage（rank 4）时任何 grant 都跳过（顶格权限不可再升）", async () => {
    existing = { id: "dp-1", permission: "manage" };
    await applyPermissionOnApproval(
      tx,
      instance({ nodes: [{ name: "x", order: 0, permissionGrant: { permission: "manage" } }] }),
      "w-1",
    );
    expect(updated).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });
});

describe("applyPermissionOnApproval —— 错误处理", () => {
  it("create 抛 P2002（并发唯一冲突）→ 视为幂等成功，不写审计不抛错", async () => {
    createError = new Prisma.PrismaClientKnownRequestError("unique violation", {
      code: "P2002",
      clientVersion: "6.0.0",
    });
    await expect(applyPermissionOnApproval(tx, instance(), "w-1")).resolves.toBeUndefined();
    expect(audits).toHaveLength(0);
  });

  it("create 抛其他错误 → 向上抛出（由调用方决定回滚还是重试）", async () => {
    createError = new Error("connection lost");
    await expect(applyPermissionOnApproval(tx, instance(), "w-1")).rejects.toThrow(
      "connection lost",
    );
  });
});
