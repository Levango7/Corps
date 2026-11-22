// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * /api/health 的 503 响应体契约（可观测性门禁）。
 *
 * 这个端点被 Docker healthcheck 与 CI 启动等待依赖，503 是「真实探测失败」的唯一信号。
 * 2026-11-21 之前，route 内部已经算出 isTimeout / prismaCode（原本只用于脱敏日志），
 * 但 503 响应体只有 { status, db } —— 运维拿到 503 无法区分「DB 挂起超时」与
 * 「连接/鉴权失败」，只能去翻服务端日志。本测试钉住这两个诊断字段，
 * 同时守住「响应体不得出现原始错误消息」这条脱敏红线。
 *
 * 边界：health 是内部端点（`/api/health` 在 check_api_contract.py 的
 * INTERNAL_PREFIXES 内），不进 openapi 契约，所以用单测而非契约门禁守它。
 */

const h = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: h.queryRaw } }));
vi.mock("@/lib/logger", () => ({ logger: { error: h.logError } }));
vi.mock("@/lib/api-messages", () => ({
  apiMsg: (_req: unknown, key: string) => `msg:${key}`,
}));
// withRed 是度量包装器：本测试只关心 handler 行为，透传即可
vi.mock("@/lib/red-metrics", () => ({ withRed: (handler: unknown) => handler }));

import { GET } from "@/app/api/health/route";

const call = () =>
  (GET as unknown as (r: NextRequest) => Promise<Response>)(
    new NextRequest("http://localhost/api/health"),
  );

beforeEach(() => {
  h.queryRaw.mockReset();
  h.logError.mockReset();
});

describe("/api/health 503 响应体", () => {
  it("DB 正常：200 + status=ok + db=up + uptimeSec 为有限非负数", async () => {
    h.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(200);
    expect(body.data.status).toBe("ok");
    expect(body.data.db).toBe("up");
    expect(typeof body.data.uptimeSec).toBe("number");
    expect(Number.isFinite(body.data.uptimeSec)).toBe(true);
    expect(body.data.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it("Prisma 已知错误码：503 + isTimeout=false + prismaCode 原样透出", async () => {
    const err = Object.assign(new Error("Can't reach database server at db:5432"), {
      name: "PrismaClientInitializationError",
      code: "P1001",
    });
    h.queryRaw.mockRejectedValue(err);
    const res = await call();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe(503);
    expect(body.data.status).toBe("degraded");
    expect(body.data.db).toBe("down");
    expect(body.data.isTimeout).toBe(false);
    expect(body.data.prismaCode).toBe("P1001");
  });

  it("普通错误：503 + isTimeout=false，且不带 prismaCode 键", async () => {
    h.queryRaw.mockRejectedValue(new Error("boom"));
    const res = await call();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.data.isTimeout).toBe(false);
    expect("prismaCode" in body.data).toBe(false);
  });

  it("非白名单错误码不进入响应体（只认 P#### 形态）", async () => {
    const err = Object.assign(new Error("weird"), { code: "ECONNREFUSED" });
    h.queryRaw.mockRejectedValue(err);
    const res = await call();
    const body = await res.json();
    expect("prismaCode" in body.data).toBe(false);
  });

  it("脱敏红线：503 响应体不得出现原始错误消息 / 连接串 / stack", async () => {
    const secret = "postgresql://postgres:supersecret@db.internal:5432/corps";
    const err = Object.assign(new Error(`connect failed: ${secret}`), { code: "P1001" });
    h.queryRaw.mockRejectedValue(err);
    const res = await call();
    const raw = await res.text();
    expect(raw).not.toContain("supersecret");
    expect(raw).not.toContain("postgresql://");
    expect(raw).not.toContain("db.internal");
  });

  it("超时分支：2s 无响应 → isTimeout=true", async () => {
    vi.useFakeTimers();
    try {
      // $queryRaw 永不 resolve，只有 2s 超时竞速分支能结束请求
      h.queryRaw.mockReturnValue(new Promise(() => {}));
      const pending = call();
      await vi.advanceTimersByTimeAsync(2_001);
      const res = await pending;
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.data.isTimeout).toBe(true);
      expect("prismaCode" in body.data).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
