// 零覆盖清偿批 b4（AI 基础设施层）——覆盖 lib/ai 下最后四块纯/可 mock 设施：
// templates/seed-templates（种子数据不变量）、tools/registry（注册表行为）、
// tools/builtins（内置工具契约与参数校验）、shared（认证回退与统一错误出口）。
//
// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiQuotaExceededError } from "@/lib/ai/usage-limit";

const authMock = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<unknown>>(async () => null),
}));
const authenticateMock = vi.hoisted(() => vi.fn<() => Promise<unknown>>(async () => null));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: authMock.getSession } },
  authenticate: authenticateMock,
  // usage-limit.ts 模块级引用 runWithWorkspace，提供桩避免命名导出缺失
  runWithWorkspace: vi.fn(),
}));
vi.mock("@/lib/api-messages", () => ({
  apiMsg: (_req: unknown, key: string) => `MSG:${key}`,
}));

const {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
  aiQuotaExceededResponse,
  getUserIdAndWorkspaceId,
} = await import("@/lib/ai/shared");

const { SEED_TEMPLATES } = await import("@/lib/ai/templates/seed-templates");
const { ToolRegistry, toolRegistry } = await import("@/lib/ai/tools/registry");
const {
  searchTasksTool,
  createTaskTool,
  searchDocumentsTool,
  getWorkspaceStatsTool,
  registerBuiltinTools,
} = await import("@/lib/ai/tools/builtins");

function makeReq() {
  return new NextRequest("http://localhost/api/ai/test");
}

function makeTx() {
  return {
    task: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    document: { findMany: vi.fn(), count: vi.fn() },
    member: { count: vi.fn() },
  } as unknown as Parameters<typeof searchTasksTool.execute>[1]["tx"];
}

const ctx = { workspaceId: "ws-1", userId: "u-1", tx: makeTx() };

describe("seed-templates", () => {
  it("提供 6 个预置模板，名称唯一且分类合法", () => {
    expect(SEED_TEMPLATES).toHaveLength(6);
    const names = SEED_TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(6);
    for (const t of SEED_TEMPLATES) {
      expect(["project", "meeting", "review", "onboarding", "custom"]).toContain(t.category);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.steps.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("每个步骤都有 name / capability 与对象 config", () => {
    for (const t of SEED_TEMPLATES) {
      for (const s of t.steps) {
        expect(s.name.length).toBeGreaterThan(0);
        expect(s.capability.length).toBeGreaterThan(0);
        expect(typeof s.config).toBe("object");
        expect(s.config).not.toBeNull();
      }
    }
  });

  it("至少一个公开模板", () => {
    expect(SEED_TEMPLATES.some((t) => t.isPublic)).toBe(true);
  });
});

describe("ToolRegistry", () => {
  it("注册 / 覆盖 / 注销 / 查询 / 列表副本", () => {
    const reg = new ToolRegistry();
    const tool = {
      name: "demo",
      description: "d",
      parameters: { type: "object" as const },
      execute: vi.fn(async () => ({ success: true })),
    };
    reg.register(tool);
    expect(reg.get("demo")).toBe(tool);
    // list 返回副本，篡改不影响内部 Map
    const listed = reg.list();
    expect(listed).toHaveLength(1);
    listed.length = 0;
    expect(reg.list()).toHaveLength(1);
    // 同名覆盖
    reg.register({ ...tool, description: "v2" });
    expect(reg.get("demo")?.description).toBe("v2");
    expect(reg.unregister("demo")).toBe(true);
    expect(reg.get("demo")).toBeUndefined();
    expect(reg.unregister("demo")).toBe(false);
  });

  it("注册空 name 抛错", () => {
    const reg = new ToolRegistry();
    expect(() =>
      reg.register({
        name: "",
        description: "",
        parameters: {},
        execute: vi.fn(),
      }),
    ).toThrow("工具 name 不能为空");
  });

  it("执行不存在工具返回失败结果而非抛异常", async () => {
    const reg = new ToolRegistry();
    await expect(reg.execute("nope", {}, ctx)).resolves.toEqual({
      success: false,
      error: "工具不存在: nope",
    });
  });

  it("工具内部异常被捕获为失败结果", async () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "boom",
      description: "",
      parameters: {},
      async execute() {
        throw new Error("炸了");
      },
    });
    await expect(reg.execute("boom", {}, ctx)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("工具执行异常: 炸了"),
    });
    // 非 Error 值走 String()
    reg.register({
      name: "boom2",
      description: "",
      parameters: {},
      async execute() {
        throw "字符串错误";
      },
    });
    await expect(reg.execute("boom2", {}, ctx)).resolves.toMatchObject({
      success: false,
      error: "工具执行异常: 字符串错误",
    });
  });
});

describe("builtins 内置工具", () => {
  it("模块导入即注册四个内置工具，重复注册幂等", () => {
    for (const name of ["search_tasks", "create_task", "search_documents", "get_workspace_stats"]) {
      expect(toolRegistry.get(name)?.name).toBe(name);
    }
    registerBuiltinTools();
    expect(
      toolRegistry
        .list()
        .filter((t) =>
          ["search_tasks", "create_task", "search_documents", "get_workspace_stats"].includes(
            t.name,
          ),
        ),
    ).toHaveLength(4);
  });

  it("search_tasks：参数 schema 契约 + limit 钳制到 100", async () => {
    expect(searchTasksTool.parameters.type).toBe("object");
    expect(searchTasksTool.parameters.additionalProperties).toBe(false);
    (ctx.tx.task.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "t1" }]);
    const res = await searchTasksTool.execute({ title: "登录", limit: 150 }, ctx);
    expect(res).toEqual({ success: true, data: { tasks: [{ id: "t1" }], count: 1 } });
    expect(ctx.tx.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
        where: expect.objectContaining({ title: { contains: "登录", mode: "insensitive" } }),
      }),
    );
    // 默认 limit 20
    await searchTasksTool.execute({}, ctx);
    expect(ctx.tx.task.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        take: 20,
        where: expect.objectContaining({ workspaceId: "ws-1" }),
      }),
    );
  });

  it("create_task：title 校验（空 / 超长 / 非法 dueDate）", async () => {
    expect(await createTaskTool.execute({}, ctx)).toMatchObject({ success: false });
    expect((await createTaskTool.execute({ title: "   " }, ctx)).error).toContain("必填");
    expect((await createTaskTool.execute({ title: "x".repeat(256) }, ctx)).error).toContain("255");
    expect(
      (await createTaskTool.execute({ title: "ok", dueDate: "not-a-date" }, ctx)).error,
    ).toContain("ISO 8601");
  });

  it("create_task：合法输入写库并应用默认状态/优先级", async () => {
    (ctx.tx.task.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "t9" });
    const res = await createTaskTool.execute(
      { title: "  写报告  ", description: "desc", dueDate: "2026-09-20" },
      ctx,
    );
    expect(res).toEqual({ success: true, data: { task: { id: "t9" } } });
    expect(ctx.tx.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "ws-1",
        createdBy: "u-1",
        title: "写报告",
        status: "todo",
        priority: "medium",
        dueDate: new Date("2026-09-20"),
      }),
      select: { id: true, title: true, status: true, priority: true },
    });
  });

  it("search_documents：limit 钳制下限为 1", async () => {
    (ctx.tx.document.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await searchDocumentsTool.execute({ title: "规", limit: -3 }, ctx);
    expect(ctx.tx.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1, orderBy: { updatedAt: "desc" } }),
    );
  });

  it("get_workspace_stats：并行七路聚合计数", async () => {
    (ctx.tx.task.count as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(1) // todo
      .mockResolvedValueOnce(2) // in_progress
      .mockResolvedValueOnce(3) // review
      .mockResolvedValueOnce(4); // done
    (ctx.tx.document.count as ReturnType<typeof vi.fn>).mockResolvedValue(7);
    (ctx.tx.member.count as ReturnType<typeof vi.fn>).mockResolvedValue(5);
    const res = await getWorkspaceStatsTool.execute({}, ctx);
    expect(res).toEqual({
      success: true,
      data: {
        tasks: { total: 10, todo: 1, inProgress: 2, review: 3, done: 4 },
        documents: 7,
        members: 5,
      },
    });
    expect(ctx.tx.member.count).toHaveBeenCalledWith({ where: { workspaceId: "ws-1" } });
  });
});

describe("shared AI 路由工具", () => {
  beforeEach(() => {
    authMock.getSession.mockReset();
    authenticateMock.mockReset();
  });

  it("isAiConfigured：任一 API key 非空即为已配置", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(isAiConfigured()).toBe(false);
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-x");
    expect(isAiConfigured()).toBe(true);
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-y");
    expect(isAiConfigured()).toBe(true);
    vi.unstubAllEnvs();
  });

  it("getUserId：Better Auth session 优先", async () => {
    authMock.getSession.mockResolvedValue({ user: { id: "u-session" } });
    await expect(getUserId(makeReq())).resolves.toBe("u-session");
    expect(authenticateMock).not.toHaveBeenCalled();
  });

  it("getUserId：session 缺失/异常时回退 JWT", async () => {
    authMock.getSession.mockResolvedValue(null);
    authenticateMock.mockResolvedValue({ sub: "u-jwt" });
    await expect(getUserId(makeReq())).resolves.toBe("u-jwt");
    authMock.getSession.mockRejectedValue(new Error("expired"));
    await expect(getUserId(makeReq())).resolves.toBe("u-jwt");
  });

  it("getUserId：双路径皆空返回 null", async () => {
    authMock.getSession.mockResolvedValue(null);
    authenticateMock.mockResolvedValue(null);
    await expect(getUserId(makeReq())).resolves.toBeNull();
  });

  it("unauthorizedResponse：401 信封", async () => {
    const res = unauthorizedResponse(makeReq());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 401, message: "MSG:unauthorized", data: null });
  });

  it("aiNotConfiguredResponse：503 信封", async () => {
    const res = aiNotConfiguredResponse(makeReq());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: 503, message: "MSG:aiNotConfigured", data: null });
  });

  it("aiQuotaExceededResponse：仅配额错误返回 429，其余 null", async () => {
    expect(aiQuotaExceededResponse(makeReq(), new Error("其他错误"))).toBeNull();
    const res = aiQuotaExceededResponse(
      makeReq(),
      new AiQuotaExceededError({ ok: false, reason: "额度已用尽", usagePercent: 95 }),
    );
    expect(res?.status).toBe(429);
    expect(await res?.json()).toEqual({
      code: 429,
      message: "MSG:aiQuotaExceeded",
      data: { reason: "额度已用尽", usagePercent: 95 },
    });
  });

  it("getUserIdAndWorkspaceId：workspaceId 取自 JWT wid，无 JWT 则 null", async () => {
    authMock.getSession.mockResolvedValue({ user: { id: "u-session" } });
    authenticateMock.mockResolvedValue({ sub: "u-session", wid: "w-1" });
    await expect(getUserIdAndWorkspaceId(makeReq())).resolves.toEqual({
      userId: "u-session",
      workspaceId: "w-1",
    });
    authenticateMock.mockResolvedValue(null);
    await expect(getUserIdAndWorkspaceId(makeReq())).resolves.toEqual({
      userId: "u-session",
      workspaceId: null,
    });
    authMock.getSession.mockResolvedValue(null);
    await expect(getUserIdAndWorkspaceId(makeReq())).resolves.toBeNull();
  });
});
