import { describe, it, expect } from "vitest";

/**
 * 统一写策略单元测试（lib/write-policy.ts）
 *
 * 这是 viewer「只读」承诺目前唯一的下游执行点，测试的意义不在覆盖率数字，
 * 而在于：**任何把 fail-closed 改成 fail-open 的改动都必须在这里变红**。
 *
 * 覆盖：
 *  - 非写方法不裁决
 *  - owner/admin/member 放行；viewer 默认拒绝
 *  - 自助类端点（自己的收藏/通知/设备/资料/纯文本 AI）对 viewer 放行
 *  - 未知角色 fail-closed
 *  - shadow 模式：记录 shadowDenied 但仍放行
 *  - off 模式：完全不介入
 *  - env 解析：空串/拼错 → enforce（fail-closed）
 *
 * Mock 策略：纯函数，不需要任何 mock，也不连 DB。
 */

import {
  decideWorkspaceWrite,
  parseWritePolicyMode,
  pathToWriteModule,
  SELF_SERVICE_WRITE_PATHS,
  WRITE_METHODS,
} from "@/lib/write-policy";

const WS = "/api/v1/workspaces/w-1";

describe("parseWritePolicyMode", () => {
  it("已知值原样解析", () => {
    expect(parseWritePolicyMode("enforce")).toBe("enforce");
    expect(parseWritePolicyMode("shadow")).toBe("shadow");
    expect(parseWritePolicyMode("off")).toBe("off");
  });

  it("空串 / 拼错 / undefined 一律 fail-closed 到 enforce", () => {
    for (const raw of ["", "  ", undefined, null, "ENFORCE ", "enforc", "disable", "0"]) {
      expect(parseWritePolicyMode(raw as string | undefined)).toBe("enforce");
    }
  });
});

describe("decideWorkspaceWrite — 方法口径", () => {
  it("GET 等读方法不进入裁决", () => {
    const d = decideWorkspaceWrite({ method: "GET", pathname: `${WS}/tasks`, role: "viewer" });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("not-a-write");
  });

  it("四个写方法全部会被裁决（viewer 一律被拒）", () => {
    for (const m of WRITE_METHODS) {
      const d = decideWorkspaceWrite({ method: m, pathname: `${WS}/tasks`, role: "viewer" });
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe("viewer-readonly");
    }
  });

  it("方法大小写不敏感", () => {
    const d = decideWorkspaceWrite({ method: "post", pathname: `${WS}/tasks`, role: "viewer" });
    expect(d.allowed).toBe(false);
  });
});

describe("decideWorkspaceWrite — 角色口径", () => {
  it("owner / admin / member 放行", () => {
    for (const role of ["owner", "admin", "member"]) {
      const d = decideWorkspaceWrite({ method: "POST", pathname: `${WS}/tasks`, role });
      expect(d.allowed).toBe(true);
      expect(d.reason).toBe("role-allowed");
    }
  });

  it("viewer 写工作区内容被拒", () => {
    for (const p of [`${WS}/tasks`, `${WS}/documents`, `${WS}/decisions/d-1`, `${WS}/members`]) {
      const d = decideWorkspaceWrite({ method: "POST", pathname: p, role: "viewer" });
      expect(d.allowed).toBe(false);
    }
  });

  it("未知角色 fail-closed，且与 viewer 区分红因", () => {
    const d = decideWorkspaceWrite({ method: "POST", pathname: `${WS}/tasks`, role: "guest" });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("unknown-role");
  });
});

describe("decideWorkspaceWrite — 自助类白名单", () => {
  it("每条白名单都写清了为什么（防随意加条目）", () => {
    for (const entry of SELF_SERVICE_WRITE_PATHS) {
      expect(entry.why.length).toBeGreaterThan(0);
    }
  });

  it("个人数据的写操作对 viewer 放行", () => {
    for (const p of [
      "/api/v1/favorites",
      "/api/v1/favorites/f-1",
      "/api/v1/notifications/n-1",
      "/api/v1/push/register",
      "/api/v1/users/me",
      "/api/v1/users/me/account",
      "/api/v1/ai/chat",
      "/api/v1/ai/feedback",
    ]) {
      const d = decideWorkspaceWrite({ method: "POST", pathname: p, role: "viewer" });
      expect(d.allowed, p).toBe(true);
      expect(d.reason, p).toBe("self-service");
    }
  });

  it("白名单是前缀匹配而非包含匹配（/api/v1/favorites-evil 不该命中）", () => {
    const d = decideWorkspaceWrite({
      method: "POST",
      pathname: "/api/v1/favorites-evil/x",
      role: "viewer",
    });
    expect(d.allowed).toBe(false);
  });

  it("AI 的落位类端点不在自助白名单内（viewer 不得改业务对象）", () => {
    for (const p of [
      "/api/v1/ai/task-breakdown",
      "/api/v1/ai/workflow-build",
      "/api/v1/ai/push/schedules",
    ]) {
      const d = decideWorkspaceWrite({ method: "POST", pathname: p, role: "viewer" });
      expect(d.allowed, p).toBe(false);
    }
  });
});

describe("decideWorkspaceWrite — 灰度与开关", () => {
  it("shadow：本会被拒但放行，并标记 shadowDenied", () => {
    const d = decideWorkspaceWrite(
      { method: "DELETE", pathname: `${WS}/tasks/t-1`, role: "viewer" },
      "shadow",
    );
    expect(d.allowed).toBe(true);
    expect(d.shadowDenied).toBe(true);
    expect(d.reason).toBe("viewer-readonly");
  });

  it("shadow 下被允许的请求不产生 shadowDenied", () => {
    const d = decideWorkspaceWrite(
      { method: "POST", pathname: `${WS}/tasks`, role: "member" },
      "shadow",
    );
    expect(d.allowed).toBe(true);
    expect(d.shadowDenied).toBe(false);
  });

  it("off：完全不介入", () => {
    const d = decideWorkspaceWrite(
      { method: "DELETE", pathname: `${WS}/tasks/t-1`, role: "viewer" },
      "off",
    );
    expect(d.allowed).toBe(true);
    expect(d.shadowDenied).toBe(false);
  });
});

describe("pathToWriteModule — 路径→模块映射", () => {
  // 有 requirePermission 实参背书的部分（2026-10-03 全量核对）
  it("核心映射与 requirePermission 实参一致", () => {
    expect(pathToWriteModule(`${WS}/tasks`)).toBe("tasks");
    expect(pathToWriteModule(`${WS}/tasks/t-1`)).toBe("tasks");
    expect(pathToWriteModule(`${WS}/tasks/t-1/comments`)).toBe("messages");
    expect(pathToWriteModule(`${WS}/tasks/t-1/decisions`)).toBe("decisions");
    expect(pathToWriteModule(`${WS}/documents/d-1/comments`)).toBe("messages");
    expect(pathToWriteModule(`${WS}/documents/d-1/versions`)).toBe("documents");
    expect(pathToWriteModule(`${WS}/conversations/c-1/messages`)).toBe("messages");
    expect(pathToWriteModule(`${WS}/databases/db-1/records`)).toBe("databaseRecords");
    expect(pathToWriteModule(`${WS}/databases`)).toBe("databases");
    expect(pathToWriteModule(`${WS}/time-entries`)).toBe("timetrack");
    expect(pathToWriteModule(`${WS}/dashboard/widgets/w-1`)).toBe("analytics");
    expect(pathToWriteModule(`${WS}/permissions`)).toBe("settings");
    // 语义归类（任务标签/里程碑归属 tasks 域）
    expect(pathToWriteModule(`${WS}/labels`)).toBe("tasks");
    expect(pathToWriteModule(`${WS}/milestones`)).toBe("tasks");
  });

  it("MODULES 之外的域映射不到（fail-closed：不享受覆盖放行）", () => {
    for (const p of [
      `${WS}/okr/objectives`,
      `${WS}/meetings/m-1`,
      `${WS}/wiki/pages`,
      `${WS}/forms`,
      "/api/v1/users/me",
      "/api/v1/favorites",
    ]) {
      expect(pathToWriteModule(p), p).toBeNull();
    }
  });

  it("相似前缀不做子串误配", () => {
    expect(pathToWriteModule(`${WS}/taskforce`)).toBeNull();
    expect(pathToWriteModule(`${WS}/timetravel`)).toBeNull();
  });
});

describe("decideWorkspaceWrite — MemberPermission 行级覆盖", () => {
  const ov = new Map([
    ["viewer:tasks", "cru"],
    ["viewer:messages", "r"],
  ]);

  it("viewer + 模块覆盖含本方法写码 → 放行（module-override）", () => {
    const d = decideWorkspaceWrite({
      method: "POST",
      pathname: `${WS}/tasks`,
      role: "viewer",
      overrides: ov,
    });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("module-override");
  });

  it("写码逐方法对应：DELETE 要 d、PATCH 要 u", () => {
    // "cru" 不含 d → DELETE 仍拒；含 u → PATCH 放行
    const del = decideWorkspaceWrite({
      method: "DELETE",
      pathname: `${WS}/tasks/t-1`,
      role: "viewer",
      overrides: ov,
    });
    expect(del.allowed).toBe(false);
    const patch = decideWorkspaceWrite({
      method: "PATCH",
      pathname: `${WS}/tasks/t-1`,
      role: "viewer",
      overrides: ov,
    });
    expect(patch.allowed).toBe(true);
  });

  it("覆盖串只有读码 → 写仍拒（覆盖不越权）", () => {
    const d = decideWorkspaceWrite({
      method: "POST",
      pathname: `${WS}/conversations/c-1/messages`,
      role: "viewer",
      overrides: ov,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("viewer-readonly");
  });

  it("覆盖是模块级的：tasks 的覆盖放不了 members 的写", () => {
    const d = decideWorkspaceWrite({
      method: "POST",
      pathname: `${WS}/members`,
      role: "viewer",
      overrides: ov,
    });
    expect(d.allowed).toBe(false);
  });

  it("路径映射不到模块（MODULES 之外）→ 有覆盖也不放行", () => {
    const d = decideWorkspaceWrite({
      method: "POST",
      pathname: `${WS}/okr/objectives`,
      role: "viewer",
      overrides: new Map([["viewer:tasks", "cru"]]),
    });
    expect(d.allowed).toBe(false);
  });

  it("key 不含该角色（覆盖配错角色）→ 拒绝（fail-closed）", () => {
    const d = decideWorkspaceWrite({
      method: "POST",
      pathname: `${WS}/tasks`,
      role: "ghost",
      overrides: new Map([["viewer:tasks", "cru"]]),
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("unknown-role");
  });

  it("不传 overrides（undefined / null）→ 维持 viewer 只读", () => {
    for (const overrides of [undefined, null]) {
      const d = decideWorkspaceWrite({
        method: "POST",
        pathname: `${WS}/tasks`,
        role: "viewer",
        overrides,
      });
      expect(d.allowed).toBe(false);
    }
  });

  it("member 角色不查覆盖（本就允许写，reason 恒为 role-allowed）", () => {
    const d = decideWorkspaceWrite({
      method: "POST",
      pathname: `${WS}/tasks`,
      role: "member",
      overrides: new Map([["member:tasks", ""]]),
    });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("role-allowed");
  });

  it("shadow 下覆盖放行的请求不产生 shadowDenied", () => {
    const d = decideWorkspaceWrite(
      { method: "POST", pathname: `${WS}/tasks`, role: "viewer", overrides: ov },
      "shadow",
    );
    expect(d.allowed).toBe(true);
    expect(d.shadowDenied).toBe(false);
  });

  it("工作区级自助端点（通知已读 / 在线状态）对 viewer 放行——choke point 误杀面修正", () => {
    for (const p of [`${WS}/notifications`, `${WS}/presence`]) {
      const d = decideWorkspaceWrite({ method: "PATCH", pathname: p, role: "viewer" });
      expect(d.allowed, p).toBe(true);
      expect(d.reason, p).toBe("self-service");
    }
  });
});
