// @vitest-environment node
/**
 * 权限矩阵页 · 两侧契约适配单测
 *
 * 背景（P0）：/w/[wid]/settings/permissions 一进就崩到路由级错误边界，
 *   TypeError: Cannot read properties of undefined (reading 'tasks')
 *   at matrixEqual … at PermissionsPage.useMemo[dirty]
 *
 * 根因：页面把 GET 的 data 直接当权限矩阵用，但真实 data 是
 *   { roles: { [role]: { [module]: Action[] } }, modules, total, hasMore }
 * 于是 matrix["owner"] === undefined，matrixEqual 里读 a["owner"]["tasks"] 抛异常。
 *
 * 本文件覆盖：
 *  a. 标准服务端响应 → 完整布尔矩阵；
 *  b. data 为 null / {} / roles 缺失 / 缺 role / 缺 module → 默认矩阵兜底且不抛；
 *  c. 适配结果与自身克隆 matrixEqual === true（不误报 dirty）；
 *  d. 写回：布尔矩阵差异 → 逐格 PATCH 体（只含 member/viewer），
 *     并用真实的 getMergedPermissions 走一遍服务端合并语义完成读写往返。
 */
import { describe, it, expect } from "vitest";
import {
  ACTIONS,
  MODULES,
  ROLES,
  cloneMatrix,
  defaultMatrix,
  isOverridable,
  matrixEqual,
  toPermissionMatrix,
  toPermissionPatches,
  type ActionKey,
  type ModuleKey,
  type PermissionMatrix,
} from "@/lib/permissions-matrix";
import { getMergedPermissions, type Action } from "@/lib/permissions";

// ─── 夹具：与 route.ts:99-112 的实际输出同形 ─────────────────

/** 某角色对页面 8 个模块的动作数组（默认给 crud，再按需覆盖单模块）。 */
function row(overrides: Partial<Record<ModuleKey, Action[]>> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  for (const mod of MODULES) {
    base[mod] = ["create", "read", "update", "delete"];
  }
  return { ...base, ...overrides };
}

/** 实测抓到的真实响应形状（外层 roles，模块值是动作数组）。 */
function serverPayload(): {
  roles: Record<string, Record<string, unknown>>;
  modules: string[];
  total: number;
  hasMore: boolean;
} {
  return {
    roles: {
      owner: row({ analytics: ["read"] }),
      admin: row({ billing: [], analytics: ["read"], settings: ["read"] }),
      member: row({
        decisions: ["create", "read"],
        documents: ["create", "read"],
        members: [],
        billing: [],
        analytics: [],
        settings: [],
      }),
      viewer: row({
        tasks: ["read"],
        decisions: ["read"],
        documents: ["read"],
        messages: ["read"],
        members: [],
        billing: [],
        analytics: [],
        settings: [],
      }),
    },
    modules: [...MODULES, "whiteboards", "timetrack", "announcements", "contacts"],
    total: 4,
    hasMore: false,
  };
}

/** 断言矩阵结构完整：4 角色 × 8 模块 × 4 动作，且每格都是布尔。 */
function expectCompleteMatrix(matrix: PermissionMatrix) {
  expect(Object.keys(matrix).sort()).toEqual([...ROLES].sort());
  for (const role of ROLES) {
    expect(Object.keys(matrix[role]).sort()).toEqual([...MODULES].sort());
    for (const mod of MODULES) {
      for (const act of ACTIONS) {
        expect(typeof matrix[role][mod][act]).toBe("boolean");
      }
    }
  }
  expect(Object.keys(matrix.owner.tasks).sort()).toEqual([...ACTIONS].sort());
}

// ─── a. 标准响应 → 完整布尔矩阵 ─────────────────────────────

describe("toPermissionMatrix · 标准服务端响应", () => {
  it("解包 data.roles，把 Action[] 转成 4 个布尔", () => {
    const matrix = toPermissionMatrix(serverPayload());

    // tasks 全量：4 个动作全 true
    expect(matrix.owner.tasks).toEqual({
      read: true,
      create: true,
      update: true,
      delete: true,
    });
    // analytics 只有 read
    expect(matrix.owner.analytics).toEqual({
      read: true,
      create: false,
      update: false,
      delete: false,
    });
    // 空数组是合法语义（明确无权限），不是缺项
    expect(matrix.admin.billing).toEqual({
      read: false,
      create: false,
      update: false,
      delete: false,
    });
  });

  it("结果是完整矩阵（4 角色 × 8 模块 × 4 动作，无 undefined）", () => {
    expectCompleteMatrix(toPermissionMatrix(serverPayload()));
  });

  it("服务端多出来的模块（whiteboards 等 6 个）不会泄漏进页面矩阵", () => {
    const matrix = toPermissionMatrix(serverPayload());
    expect(Object.keys(matrix.owner)).toHaveLength(MODULES.length);
    expect(matrix.owner).not.toHaveProperty("whiteboards");
  });

  it("动作数组里的未知动作名被忽略，只认 R/C/U/D", () => {
    const payload = serverPayload();
    payload.roles.viewer.tasks = ["read", "approve", "share"];
    const matrix = toPermissionMatrix(payload);
    expect(matrix.viewer.tasks).toEqual({
      read: true,
      create: false,
      update: false,
      delete: false,
    });
  });
});

// ─── b. 缺项兜底：不抛、完整 ────────────────────────────────

describe("toPermissionMatrix · 缺项兜底", () => {
  const fallbackCases: [string, unknown][] = [
    ["null（未配置过）", null],
    ["undefined", undefined],
    ["空对象 {}", {}],
    ["roles 为 null", { roles: null }],
    ["roles 是数组", { roles: [] }],
    ["roles 是字符串", { roles: "owner" }],
    ["整个 data 是数组", []],
    ["整个 data 是字符串", "oops"],
  ];

  for (const [name, payload] of fallbackCases) {
    it(`${name} → 返回完整默认矩阵，不抛`, () => {
      let matrix: PermissionMatrix | undefined;
      expect(() => {
        matrix = toPermissionMatrix(payload);
      }).not.toThrow();
      expect(matrix).toEqual(defaultMatrix());
      expectCompleteMatrix(matrix!);
    });
  }

  it("缺某个 role → 该角色整行回落默认，其余角色用响应值", () => {
    const payload = serverPayload();
    delete payload.roles.viewer;
    const matrix = toPermissionMatrix(payload);

    expect(matrix.viewer).toEqual(defaultMatrix().viewer);
    expect(matrix.owner.analytics.read).toBe(true);
    expectCompleteMatrix(matrix);
  });

  it("缺某个 module / 值不是数组 → 仅该格回落默认", () => {
    const payload = serverPayload();
    delete payload.roles.member.billing; // 缺项
    payload.roles.member.documents = "create,read"; // 形状错误
    const matrix = toPermissionMatrix(payload);

    expect(matrix.member.billing).toEqual(defaultMatrix().member.billing);
    expect(matrix.member.documents).toEqual(defaultMatrix().member.documents);
    // 相邻模块仍取响应值（fixture 里 member.tasks 是 crud 全量，与页面默认矩阵不同）
    expect(matrix.member.tasks.delete).toBe(true);
    expectCompleteMatrix(matrix);
  });
});

// ─── c. matrixEqual：不误报 dirty，且对畸形输入不抛 ──────────

describe("matrixEqual · dirty 判定与纵深防御", () => {
  it("适配结果与自身克隆相等（未改动 → 不 dirty）", () => {
    const matrix = toPermissionMatrix(serverPayload());
    expect(matrixEqual(matrix, cloneMatrix(matrix))).toBe(true);
  });

  it("改一格后判定为 dirty", () => {
    const matrix = toPermissionMatrix(serverPayload());
    const clone = cloneMatrix(matrix);
    clone.member.tasks.delete = false;
    expect(matrixEqual(matrix, clone)).toBe(false);
  });

  it("传入崩溃现场的错误形状（{roles:{...}} 当矩阵）不抛，返回 false", () => {
    const wrapper = serverPayload() as unknown as PermissionMatrix;
    expect(() => matrixEqual(wrapper, defaultMatrix())).not.toThrow();
    expect(matrixEqual(wrapper, defaultMatrix())).toBe(false);
  });

  it("null / undefined / 缺格不抛，按不相等处理", () => {
    const matrix = defaultMatrix();
    expect(() => matrixEqual(null, undefined)).not.toThrow();
    expect(matrixEqual(matrix, null)).toBe(false);
    expect(matrixEqual(null, null)).toBe(true);

    const broken = cloneMatrix(matrix) as unknown as Record<string, unknown>;
    delete broken.member;
    expect(() => matrixEqual(broken as unknown as PermissionMatrix, matrix)).not.toThrow();
    expect(matrixEqual(broken as unknown as PermissionMatrix, matrix)).toBe(false);
  });
});

// ─── d. 写回：布尔矩阵 → 逐格 PATCH → 再适配（往返） ─────────

/** 动作名 → 单字符代码（与 route.ts 的 ACTION_TO_CODE 一致）。 */
const ACTION_CODE: Record<ActionKey, string> = {
  create: "c",
  read: "r",
  update: "u",
  delete: "d",
};

/**
 * 模拟服务端写路径：PATCH 体 → MemberPermission 覆盖 Map → getMergedPermissions。
 * 这是 route.ts:34-48 + 99-102 的同构复刻（复用真实服务端函数，不是另写一套语义）。
 */
function serverRolesAfterPatches(
  patches: { role: string; module: string; actions: ActionKey[] }[],
  overrides = new Map<string, string>(),
): Record<string, Record<string, Action[]>> {
  for (const p of patches) {
    overrides.set(`${p.role}:${p.module}`, p.actions.map((a) => ACTION_CODE[a]).join(""));
  }
  const roles: Record<string, Record<string, Action[]>> = {};
  for (const role of ROLES) roles[role] = getMergedPermissions(role, overrides);
  return roles;
}

describe("toPermissionPatches · 写回方向", () => {
  it("未改动 → 空补丁；只对 member/viewer 产出，owner/admin 差异被丢弃", () => {
    const matrix = toPermissionMatrix(serverPayload());
    expect(toPermissionPatches(matrix, cloneMatrix(matrix))).toEqual([]);

    const changed = cloneMatrix(matrix);
    changed.owner.tasks.read = false;
    changed.admin.billing.create = true;
    expect(toPermissionPatches(changed, matrix)).toEqual([]);

    changed.member.tasks.delete = false;
    expect(toPermissionPatches(changed, matrix)).toEqual([
      { role: "member", module: "tasks", actions: ["read", "create", "update"] },
    ]);
  });

  it("请求体形状与 PATCH 契约一致（role/module/actions 三键，无整张矩阵）", () => {
    const matrix = toPermissionMatrix(serverPayload());
    const changed = cloneMatrix(matrix);
    changed.viewer.settings.read = true;
    const [patch] = toPermissionPatches(changed, matrix);

    expect(Object.keys(patch).sort()).toEqual(["actions", "module", "role"]);
    expect(patch.role).toBe("viewer");
    expect(patch.module).toBe("settings");
    expect(patch.actions).toEqual(["read"]);
    expect(isOverridable(patch.role)).toBe(true);
  });

  it("往返：适配 → 改一格（放开）→ 服务端合并 → 再适配 = 改动后的矩阵", () => {
    const original = toPermissionMatrix(serverPayload());
    const changed = cloneMatrix(original);
    // viewer.settings 在默认/服务端响应里是空数组，放开 read 属于"放宽"，
    // 与服务端 默认 ∪ 覆盖 的并集语义一致。
    changed.viewer.settings = { read: true, create: false, update: false, delete: false };
    expect(matrixEqual(changed, original)).toBe(false);

    const patches = toPermissionPatches(changed, original);
    expect(patches).toEqual([{ role: "viewer", module: "settings", actions: ["read"] }]);

    const readBack = toPermissionMatrix({ roles: serverRolesAfterPatches(patches) });
    expect(readBack.viewer.settings).toEqual(changed.viewer.settings);
    expect(matrixEqual(readBack, changed)).toBe(true);
    expectCompleteMatrix(readBack);
  });

  it("已知限制（服务端并集语义）：取消默认授予的动作无法落库，补丁体本身仍正确", () => {
    // route.ts → lib/permissions.ts getMergedPermissions：默认 ∪ 覆盖，覆盖只能放宽。
    // 因此本页"取消勾选"对默认已授予的动作是 no-op —— 本次修复只对齐形状，不改该语义。
    const original = toPermissionMatrix(serverPayload());
    const changed = cloneMatrix(original);
    changed.member.tasks.delete = false;

    const patches = toPermissionPatches(changed, original);
    // 请求体正确：不再包含 delete
    expect(patches).toEqual([
      { role: "member", module: "tasks", actions: ["read", "create", "update"] },
    ]);

    // 但服务端合并后 delete 依然为 true（默认 "crud" ∪ 覆盖 "cru"）
    const readBack = toPermissionMatrix({ roles: serverRolesAfterPatches(patches) });
    expect(readBack.member.tasks.delete).toBe(true);
    expect(matrixEqual(readBack, changed)).toBe(false);
  });
});
