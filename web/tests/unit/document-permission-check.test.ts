import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 文档权限判定的行为契约（lib/document-permission-check.ts）。
 *
 * 挑的都是"写错了也不会报错、只会静默放权"的分支：
 *  - owner/admin 必须短路，连库都不该查；
 *  - 作者自动拿到的是 manage，而层级是 view<comment<edit<manage<**share**，
 *    所以作者默认**没有** share（把 manage 当成最高级就会漏这一格）；
 *  - 显式授权过期后必须不放行；
 *  - 层级比较不能退化成"有记录就放行"；
 *  - RBAC 矩阵兜底只允许给 view，不能顺手把 comment/edit 也放出来；
 *    且没有 PermissionContext 时这条兜底根本不该参与。
 */

type Row = Record<string, unknown> | null;
const holder = vi.hoisted(() => ({ tx: null as Record<string, unknown> | null }));

vi.mock("@/lib/auth", () => ({
  runWithWorkspace: (_wid: string, fn: (tx: unknown) => Promise<unknown>) => fn(holder.tx),
}));

const checkPermissionMock = vi.hoisted(() => vi.fn(async () => false));
vi.mock("@/lib/permissions", () => ({
  checkPermission: checkPermissionMock,
  // 类型导出在运行时不存在，但源码只 import type，这里无需补
}));

import { checkDocumentPermission } from "@/lib/document-permission-check";

const USER = "u-1";
const DOC = "d-1";
const WID = "w-1";

interface Fixture {
  doc?: Row;
  docPerms?: Row[];
  folderPerms?: Row[];
  folders?: Row[];
}

function installTx(fx: Fixture) {
  const calls = { document: 0, documentPermission: 0, folderPermission: 0 };
  const pick = (rows: Row[] | undefined, where: Record<string, unknown>) =>
    (rows ?? []).find((r) =>
      Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
    ) ?? null;

  holder.tx = {
    calls,
    document: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        calls.document += 1;
        const d = fx.doc as Record<string, unknown> | undefined;
        return d && d.id === args.where.id ? d : null;
      },
    },
    documentPermission: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        calls.documentPermission += 1;
        return pick(fx.docPerms, args.where);
      },
    },
    folderPermission: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        calls.folderPermission += 1;
        return pick(fx.folderPerms, args.where);
      },
    },
    folder: {
      findFirst: async (args: { where: Record<string, unknown> }) => pick(fx.folders, args.where),
    },
    space: { findFirst: async () => null },
  };
  return calls;
}

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

beforeEach(() => {
  holder.tx = null;
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue(false);
});

describe("checkDocumentPermission", () => {
  it("owner 与 admin 短路：直接放行且不查库", async () => {
    const calls = installTx({
      doc: { id: DOC, authorId: "someone-else", folderId: null, spaceId: null },
    });
    expect(await checkDocumentPermission(USER, DOC, "share", WID, "owner")).toBe(true);
    expect(await checkDocumentPermission(USER, DOC, "manage", WID, "admin")).toBe(true);
    expect(calls.document).toBe(0); // 短路必须发生在任何查询之前
  });

  it("作者拿到 manage，但不因此获得 share", async () => {
    installTx({ doc: { id: DOC, authorId: USER, folderId: null, spaceId: null } });
    for (const lvl of ["view", "comment", "edit", "manage"] as const) {
      expect(await checkDocumentPermission(USER, DOC, lvl, WID, "member")).toBe(true);
    }
    expect(await checkDocumentPermission(USER, DOC, "share", WID, "member")).toBe(false);
  });

  it("显式授权按层级比较：低级别不能当高级用", async () => {
    installTx({
      doc: { id: DOC, authorId: "other", folderId: null, spaceId: null },
      docPerms: [
        {
          documentId: DOC,
          workspaceId: WID,
          granteeType: "user",
          granteeId: USER,
          source: "explicit",
          permission: "view",
          expiresAt: future(),
        },
      ],
    });
    expect(await checkDocumentPermission(USER, DOC, "view", WID, "member")).toBe(true);
    expect(await checkDocumentPermission(USER, DOC, "comment", WID, "member")).toBe(false);
  });

  it("显式授权过期即失效（未过期与已过期只差这一个条件）", async () => {
    const build = (expiresAt: Date) => ({
      doc: { id: DOC, authorId: "other", folderId: null, spaceId: null },
      docPerms: [
        {
          documentId: DOC,
          workspaceId: WID,
          granteeType: "user",
          granteeId: USER,
          source: "explicit",
          permission: "edit",
          expiresAt,
        },
      ],
    });
    installTx(build(future()));
    expect(await checkDocumentPermission(USER, DOC, "edit", WID, "member")).toBe(true);

    installTx(build(past()));
    expect(await checkDocumentPermission(USER, DOC, "edit", WID, "member")).toBe(false);
  });

  it("expiresAt 为 null 表示永不过期", async () => {
    installTx({
      doc: { id: DOC, authorId: "other", folderId: null, spaceId: null },
      docPerms: [
        {
          documentId: DOC,
          workspaceId: WID,
          granteeType: "user",
          granteeId: USER,
          source: "explicit",
          permission: "comment",
          expiresAt: null,
        },
      ],
    });
    expect(await checkDocumentPermission(USER, DOC, "comment", WID, "member")).toBe(true);
  });

  it("role 级授权只对 member/viewer 查询，且要匹配 granteeId", async () => {
    const calls = installTx({
      doc: { id: DOC, authorId: "other", folderId: null, spaceId: null },
      docPerms: [
        {
          documentId: DOC,
          workspaceId: WID,
          granteeType: "role",
          granteeId: "viewer",
          source: "explicit",
          permission: "view",
          expiresAt: null,
        },
      ],
    });
    expect(await checkDocumentPermission(USER, DOC, "view", WID, "viewer")).toBe(true);
    expect(calls.documentPermission).toBeGreaterThan(0);
  });

  it("文件夹继承：inheritable=true 的文件夹授权才向下生效，且只到该级别", async () => {
    const grant = (inheritable: boolean) => ({
      doc: { id: DOC, authorId: "other", folderId: "f-1", spaceId: "s-1" },
      folders: [{ id: "f-1", workspaceId: WID, spaceId: "s-1", parentId: null }],
      folderPerms: [
        {
          workspaceId: WID,
          targetType: "folder",
          targetId: "f-1",
          granteeType: "user",
          granteeId: USER,
          permission: "edit",
          inheritable,
        },
      ],
    });

    installTx(grant(true));
    expect(await checkDocumentPermission(USER, DOC, "edit", WID, "member")).toBe(true);
    // 层级不达标仍然不放行：继承不是"有记录就放行"
    expect(await checkDocumentPermission(USER, DOC, "manage", WID, "member")).toBe(false);

    // inheritable=false 的授权不该漏到子文档
    installTx(grant(false));
    expect(await checkDocumentPermission(USER, DOC, "edit", WID, "member")).toBe(false);
  });

  it("空间级继承：文件夹自己没授权时回退到所属空间", async () => {
    installTx({
      doc: { id: DOC, authorId: "other", folderId: "f-1", spaceId: "s-1" },
      folders: [{ id: "f-1", workspaceId: WID, spaceId: "s-1", parentId: null }],
      folderPerms: [
        {
          workspaceId: WID,
          targetType: "space",
          targetId: "s-1",
          granteeType: "user",
          granteeId: USER,
          permission: "comment",
          inheritable: true,
        },
      ],
    });
    expect(await checkDocumentPermission(USER, DOC, "comment", WID, "member")).toBe(true);
    expect(await checkDocumentPermission(USER, DOC, "edit", WID, "member")).toBe(false);
  });

  it("父文件夹递归：孙文档继承祖父级授权", async () => {
    installTx({
      doc: { id: DOC, authorId: "other", folderId: "f-2", spaceId: "s-1" },
      folders: [
        { id: "f-2", workspaceId: WID, spaceId: "s-1", parentId: "f-1" },
        { id: "f-1", workspaceId: WID, spaceId: "s-1", parentId: null },
      ],
      folderPerms: [
        {
          workspaceId: WID,
          targetType: "folder",
          targetId: "f-1",
          granteeType: "user",
          granteeId: USER,
          permission: "manage",
          inheritable: true,
        },
      ],
    });
    expect(await checkDocumentPermission(USER, DOC, "manage", WID, "member")).toBe(true);
    // 递归只认 inheritable=true 的父级授权
    expect(await checkDocumentPermission(USER, DOC, "share", WID, "member")).toBe(false);
  });

  it("RBAC 兜底只给 view；没有 ctx 时连 view 也不给", async () => {
    installTx({ doc: { id: DOC, authorId: "other", folderId: null, spaceId: null } });
    checkPermissionMock.mockResolvedValue(true);
    const ctx = { memberId: "m-1", role: "member", workspaceId: WID } as never;

    expect(await checkDocumentPermission(USER, DOC, "view", WID, "member", ctx)).toBe(true);
    expect(await checkDocumentPermission(USER, DOC, "comment", WID, "member", ctx)).toBe(false);
    // 不传 ctx：第 6 步整段不参与，兜底不该悄悄放人
    expect(await checkDocumentPermission(USER, DOC, "view", WID, "member")).toBe(false);
  });

  it("RBAC 兜底本身被否时不放行", async () => {
    installTx({ doc: { id: DOC, authorId: "other", folderId: null, spaceId: null } });
    checkPermissionMock.mockResolvedValue(false);
    const ctx = { memberId: "m-1", role: "member", workspaceId: WID } as never;
    expect(await checkDocumentPermission(USER, DOC, "view", WID, "member", ctx)).toBe(false);
  });

  it("文档不存在时不因缺行而抛错，返回不放行", async () => {
    installTx({});
    await expect(checkDocumentPermission(USER, "missing", "view", WID, "member")).resolves.toBe(
      false,
    );
  });
});
