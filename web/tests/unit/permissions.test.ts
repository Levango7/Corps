import { describe, it, expect, vi } from "vitest";
import {
  checkPermission,
  checkTemporaryGrant,
  getMergedPermissions,
  getDefaultPermissions,
  MODULES,
  ROLES,
  type PermissionContext,
  type Action,
} from "@/lib/permissions";

// Mock apiMsg 以避免依赖 NextRequest
vi.mock("@/lib/api-messages", () => ({
  apiMsg: () => "Permission denied",
}));

function makeCtx(
  role: string,
  overrides?: Map<string, string>,
  temporaryGrant?: PermissionContext["temporaryGrant"],
): PermissionContext {
  return {
    member: { role, workspaceId: "ws-1" },
    permissions: overrides,
    temporaryGrant: temporaryGrant ?? null,
  };
}

describe("checkPermission - 默认权限矩阵", () => {
  it("owner 对任何模块任何动作都返回 true", async () => {
    for (const mod of MODULES) {
      for (const action of ["create", "read", "update", "delete"] as Action[]) {
        expect(await checkPermission(makeCtx("owner"), mod, action)).toBe(true);
      }
    }
  });

  it("admin 对 tasks 有全部权限", async () => {
    for (const action of ["create", "read", "update", "delete"] as Action[]) {
      expect(await checkPermission(makeCtx("admin"), "tasks", action)).toBe(true);
    }
  });

  it("admin 对 billing 无权限", async () => {
    for (const action of ["create", "read", "update", "delete"] as Action[]) {
      expect(await checkPermission(makeCtx("admin"), "billing", action)).toBe(false);
    }
  });

  it("admin 对 members 有全部权限（crud）", async () => {
    expect(await checkPermission(makeCtx("admin"), "members", "create")).toBe(true);
    expect(await checkPermission(makeCtx("admin"), "members", "read")).toBe(true);
    expect(await checkPermission(makeCtx("admin"), "members", "update")).toBe(true);
    expect(await checkPermission(makeCtx("admin"), "members", "delete")).toBe(true);
  });

  it("member 对 tasks 有全部权限", async () => {
    for (const action of ["create", "read", "update", "delete"] as Action[]) {
      expect(await checkPermission(makeCtx("member"), "tasks", action)).toBe(true);
    }
  });

  it("member 对 decisions 只有 create 和 read", async () => {
    expect(await checkPermission(makeCtx("member"), "decisions", "create")).toBe(true);
    expect(await checkPermission(makeCtx("member"), "decisions", "read")).toBe(true);
    expect(await checkPermission(makeCtx("member"), "decisions", "update")).toBe(false);
    expect(await checkPermission(makeCtx("member"), "decisions", "delete")).toBe(false);
  });

  it("member 对 billing 无权限", async () => {
    expect(await checkPermission(makeCtx("member"), "billing", "read")).toBe(false);
  });

  it("viewer 对 tasks 只有 read", async () => {
    expect(await checkPermission(makeCtx("viewer"), "tasks", "read")).toBe(true);
    expect(await checkPermission(makeCtx("viewer"), "tasks", "create")).toBe(false);
    expect(await checkPermission(makeCtx("viewer"), "tasks", "update")).toBe(false);
    expect(await checkPermission(makeCtx("viewer"), "tasks", "delete")).toBe(false);
  });

  it("viewer 对 billing 无权限", async () => {
    expect(await checkPermission(makeCtx("viewer"), "billing", "read")).toBe(false);
  });

  it("未知角色对所有模块无权限", async () => {
    expect(await checkPermission(makeCtx("unknown"), "tasks", "read")).toBe(false);
  });
});

describe("checkPermission - 自定义覆盖", () => {
  it("member 的覆盖可以放宽权限（如添加 billing read）", async () => {
    const overrides = new Map([["member:billing", "r"]]);
    expect(await checkPermission(makeCtx("member", overrides), "billing", "read")).toBe(true);
    // 覆盖只放宽不收紧：tasks 原有 crud 仍保留
    expect(await checkPermission(makeCtx("member", overrides), "tasks", "create")).toBe(true);
  });

  it("viewer 的覆盖可以添加 create 权限", async () => {
    const overrides = new Map([["viewer:tasks", "cr"]]);
    expect(await checkPermission(makeCtx("viewer", overrides), "tasks", "create")).toBe(true);
    expect(await checkPermission(makeCtx("viewer", overrides), "tasks", "read")).toBe(true);
  });

  it("admin 的覆盖也生效（代码未限制覆盖仅 member/viewer）", async () => {
    const overrides = new Map([["admin:billing", "crud"]]);
    // admin 默认对 billing 无权限，但覆盖可放宽
    expect(await checkPermission(makeCtx("admin", overrides), "billing", "read")).toBe(true);
  });
});

describe("checkPermission - 临时授权", () => {
  it("临时授权未过期 → 使用 tempRole 的权限", async () => {
    const futureDate = new Date(Date.now() + 60_000);
    const ctx = makeCtx("member", undefined, {
      tempRole: "admin",
      originalRole: "member",
      expiresAt: futureDate,
    });
    // member 通常对 billing 无权限，但 tempRole=admin 也对 billing 无权限
    expect(await checkPermission(ctx, "billing", "read")).toBe(false);
    // admin 对 tasks 有全部权限
    expect(await checkPermission(ctx, "tasks", "delete")).toBe(true);
  });

  it("临时授权已过期 → 使用原角色权限", async () => {
    const pastDate = new Date(Date.now() - 60_000);
    const ctx = makeCtx("viewer", undefined, {
      tempRole: "admin",
      originalRole: "viewer",
      expiresAt: pastDate,
    });
    // viewer 对 tasks 只有 read
    expect(await checkPermission(ctx, "tasks", "create")).toBe(false);
    expect(await checkPermission(ctx, "tasks", "read")).toBe(true);
  });

  it("临时授权为 owner → 短路返回 true", async () => {
    const futureDate = new Date(Date.now() + 60_000);
    const ctx = makeCtx("member", undefined, {
      tempRole: "owner",
      originalRole: "member",
      expiresAt: futureDate,
    });
    expect(await checkPermission(ctx, "billing", "delete")).toBe(true);
  });

  it("无临时授权 → 使用原角色", async () => {
    const ctx = makeCtx("member");
    expect(await checkPermission(ctx, "billing", "read")).toBe(false);
  });
});

describe("checkTemporaryGrant", () => {
  it("未过期 → 返回 grant", () => {
    const futureDate = new Date(Date.now() + 60_000);
    const ctx = makeCtx("member", undefined, {
      tempRole: "admin",
      originalRole: "member",
      expiresAt: futureDate,
    });
    const grant = checkTemporaryGrant(ctx);
    expect(grant).not.toBeNull();
    expect(grant?.tempRole).toBe("admin");
  });

  it("已过期 → 返回 null", () => {
    const pastDate = new Date(Date.now() - 60_000);
    const ctx = makeCtx("member", undefined, {
      tempRole: "admin",
      originalRole: "member",
      expiresAt: pastDate,
    });
    expect(checkTemporaryGrant(ctx)).toBeNull();
  });

  it("无临时授权 → 返回 null", () => {
    const ctx = makeCtx("member");
    expect(checkTemporaryGrant(ctx)).toBeNull();
  });
});

describe("getMergedPermissions", () => {
  it("owner 合并后所有模块全部动作", () => {
    const merged = getMergedPermissions("owner", undefined);
    expect(merged.tasks).toContain("create");
    expect(merged.tasks).toContain("read");
    expect(merged.tasks).toContain("update");
    expect(merged.tasks).toContain("delete");
  });

  it("member + 覆盖 → 合并（默认 ∪ 覆盖）", () => {
    const overrides = new Map([["member:billing", "r"]]);
    const merged = getMergedPermissions("member", overrides);
    // billing 默认无，覆盖加 r
    expect(merged.billing).toEqual(["read"]);
    // tasks 默认 crud，无覆盖仍保留
    expect(merged.tasks).toEqual(["create", "read", "update", "delete"]);
  });

  it("未知角色 → 所有模块空数组", () => {
    const merged = getMergedPermissions("unknown", undefined);
    for (const mod of MODULES) {
      expect(merged[mod]).toEqual([]);
    }
  });
});

describe("getDefaultPermissions", () => {
  it("viewer 默认只有 tasks read", () => {
    const def = getDefaultPermissions("viewer");
    expect(def.tasks).toEqual(["read"]);
    expect(def.billing).toEqual([]);
  });

  it("admin 默认 members 有 crud", () => {
    const def = getDefaultPermissions("admin");
    expect(def.members).toEqual(["create", "read", "update", "delete"]);
  });

  it("所有角色都覆盖全部 MODULES", () => {
    for (const role of ROLES) {
      const def = getDefaultPermissions(role);
      for (const mod of MODULES) {
        expect(def).toHaveProperty(mod);
      }
    }
  });
});
