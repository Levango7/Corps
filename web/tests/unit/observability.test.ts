import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 错误上报单元测试（lib/observability.ts）
 *
 * 覆盖：
 *  - toError：Error / string / 普通对象 / 不可序列化对象的规范化
 *  - captureError：始终写结构化日志；无配置时**零网络调用**（关键：不影响生产）
 *  - Sentry sink：DSN 解析正确、Envelope 三段式格式、auth 头、非法 DSN 不发
 *  - Webhook sink：POST JSON、含 text 兼容字段
 *  - 脱敏：敏感键（password/token/secret/authorization…）被替换为 [REDACTED]
 *  - 防风暴：单 sink 每分钟超过上限后丢弃
 *  - installProcessErrorHandlers：幂等、注册两类进程级异常
 *
 * Mock 策略：mock @/lib/logger 避免污染测试输出并便于断言；用 vi.stubEnv 控制
 * 环境变量、vi.stubGlobal 替换 fetch。所有 env 读取都在函数内部（无模块级常量
 * 缓存），故 stubEnv 在每个用例中均生效。
 */

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { logger } from "@/lib/logger";
import {
  captureError,
  toError,
  isRemoteReportingEnabled,
  installProcessErrorHandlers,
  __resetRateLimit,
  __resetHandlersFlag,
} from "@/lib/observability";

/** 合法的测试 DSN（public key 用占位值） */
const TEST_DSN = "https://abc123publickey@o0.ingest.sentry.io/42";

/** 构造 fetch mock；返回 200 表示接收成功。
 *  显式声明参数签名，使 mock.calls[n] 为 [url, init] 元组，便于断言请求契约。 */
function mockFetch(ok = true, status = 200) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok, status }) as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  __resetRateLimit();
  __resetHandlersFlag();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("toError", () => {
  it("Error 实例原样返回", () => {
    const err = new Error("boom");
    expect(toError(err)).toBe(err);
  });

  it("字符串包装为 Error", () => {
    const result = toError("plain string");
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("plain string");
  });

  it("普通对象序列化为 message", () => {
    const result = toError({ code: "E1", detail: "x" });
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toContain("E1");
  });

  it("循环引用对象不抛错（回退 String()）", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => toError(circular)).not.toThrow();
    expect(toError(circular)).toBeInstanceOf(Error);
  });
});

describe("captureError — 无配置时降级", () => {
  it("始终写 logger.error", () => {
    captureError(new Error("kaboom"), { source: "unit-test" });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.error).mock.calls[0][0]).toContain("kaboom");
  });

  it("未配置任何 sink 时零网络调用", () => {
    const fetchMock = mockFetch();
    captureError(new Error("no sinks"), { source: "unit-test" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("isRemoteReportingEnabled 反映配置状态", () => {
    expect(isRemoteReportingEnabled()).toBe(false);
    vi.stubEnv("ERROR_WEBHOOK_URL", "https://example.com/hook");
    expect(isRemoteReportingEnabled()).toBe(true);
  });
});

describe("Sentry sink", () => {
  it("按 DSN 推导 endpoint 并发出三段式 Envelope", async () => {
    vi.stubEnv("SENTRY_DSN", TEST_DSN);
    const fetchMock = mockFetch();

    captureError(new Error("sentry test"), { source: "unit-test", route: "/api/x" });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://o0.ingest.sentry.io/api/42/envelope/");

    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-sentry-envelope");
    expect(headers["X-Sentry-Auth"]).toContain("sentry_key=abc123publickey");
    expect(headers["X-Sentry-Auth"]).toContain("sentry_version=7");

    // Envelope：信封头 / 条目头 / 条目体（换行分隔）
    const lines = String(init.body).split("\n");
    expect(lines).toHaveLength(3);

    const envelopeHeader = JSON.parse(lines[0]);
    const itemHeader = JSON.parse(lines[1]);
    const payload = JSON.parse(lines[2]);

    expect(envelopeHeader.dsn).toBe(TEST_DSN);
    expect(envelopeHeader.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(itemHeader.type).toBe("event");
    expect(payload.exception.values[0].value).toBe("sentry test");
    expect(payload.tags.source).toBe("unit-test");
    expect(payload.tags.route).toBe("/api/x");
    // event_id 在信封头与条目体中一致（Sentry 依靠它去重/关联）
    expect(payload.event_id).toBe(envelopeHeader.event_id);
  });

  it("非法 DSN 不发起请求，并记录一次 warn", async () => {
    vi.stubEnv("SENTRY_DSN", "not-a-valid-dsn");
    const fetchMock = mockFetch();

    captureError(new Error("bad dsn"), { source: "unit-test" });

    // 等一个宏任务，确保异步分支已执行完毕
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("DSN 缺少 projectId 时视为非法", async () => {
    vi.stubEnv("SENTRY_DSN", "https://abc123publickey@o0.ingest.sentry.io/");
    const fetchMock = mockFetch();

    captureError(new Error("no project"), { source: "unit-test" });

    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("NEXT_PUBLIC_SENTRY_DSN 作为浏览器端回退", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", TEST_DSN);
    const fetchMock = mockFetch();

    captureError(new Error("client dsn"), { source: "unit-test" });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toContain("/envelope/");
  });
});

describe("Webhook sink", () => {
  it("向 ERROR_WEBHOOK_URL POST JSON，含 text 兼容字段", async () => {
    vi.stubEnv("ERROR_WEBHOOK_URL", "https://example.com/alert");
    const fetchMock = mockFetch();

    captureError(new Error("webhook test"), { source: "cron", route: "/api/cron/x" });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/alert");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const body = JSON.parse(String(init.body));
    expect(body.text).toContain("webhook test");
    expect(body.name).toBe("Error");
    expect(body.message).toBe("webhook test");
    expect(body.tags.source).toBe("cron");
  });
});

describe("脱敏", () => {
  it("敏感键被替换为 [REDACTED]，普通键保留", async () => {
    vi.stubEnv("ERROR_WEBHOOK_URL", "https://example.com/alert");
    const fetchMock = mockFetch();

    captureError(new Error("pii test"), {
      source: "unit-test",
      userId: "user-1",
      password: "hunter2",
      accessToken: "tok-abc",
      Authorization: "Bearer xyz",
      nested: { secretKey: "s3cr3t", safe: "ok" },
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.extra.password).toBe("[REDACTED]");
    expect(body.extra.accessToken).toBe("[REDACTED]");
    expect(body.extra.Authorization).toBe("[REDACTED]");
    expect(body.extra.nested.secretKey).toBe("[REDACTED]");
    expect(body.extra.nested.safe).toBe("ok");
    expect(body.extra.userId).toBe("user-1");
  });
});

describe("防风暴限流", () => {
  it("单 sink 每分钟超过 30 条后丢弃", async () => {
    vi.stubEnv("ERROR_WEBHOOK_URL", "https://example.com/alert");
    const fetchMock = mockFetch();

    // 同步连续触发 35 次（限流判定在 async 函数体的首个 await 之前，故同步生效）
    for (let i = 0; i < 35; i++) {
      captureError(new Error(`storm-${i}`), { source: "unit-test" });
    }

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchMock).toHaveBeenCalledTimes(30);
  });

  it("限流按 sink 独立计数（webhook 耗尽不影响 sentry）", async () => {
    vi.stubEnv("ERROR_WEBHOOK_URL", "https://example.com/alert");
    vi.stubEnv("SENTRY_DSN", TEST_DSN);
    const fetchMock = mockFetch();

    for (let i = 0; i < 35; i++) {
      captureError(new Error(`mixed-${i}`), { source: "unit-test" });
    }

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    const webhookCalls = urls.filter((u) => u.includes("example.com")).length;
    const sentryCalls = urls.filter((u) => u.includes("sentry.io")).length;
    expect(webhookCalls).toBe(30);
    expect(sentryCalls).toBe(30);
  });
});

describe("失败降级（不影响业务）", () => {
  it("网络异常时不抛错，降级为本地 warn", async () => {
    vi.stubEnv("ERROR_WEBHOOK_URL", "https://example.com/alert");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    expect(() => captureError(new Error("net"), { source: "unit-test" })).not.toThrow();
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalled());
  });

  it("HTTP 非 2xx 时记录 warn 且不抛错", async () => {
    vi.stubEnv("ERROR_WEBHOOK_URL", "https://example.com/alert");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as Response));

    expect(() => captureError(new Error("bad status"), { source: "unit-test" })).not.toThrow();
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalled());
  });
});

describe("installProcessErrorHandlers", () => {
  it("注册 unhandledRejection 与 uncaughtException", () => {
    // mockImplementation 避免真的向测试进程注册（尤其 uncaughtException 会改变
    // vitest 自身对未捕获异常的处置行为）
    const onSpy = vi.spyOn(process, "on").mockReturnValue(process);

    installProcessErrorHandlers();

    const events = onSpy.mock.calls.map((c) => String(c[0]));
    expect(events).toContain("unhandledRejection");
    expect(events).toContain("uncaughtException");
    onSpy.mockRestore();
  });

  it("重复调用幂等（不重复注册）", () => {
    const onSpy = vi.spyOn(process, "on").mockReturnValue(process);

    installProcessErrorHandlers();
    installProcessErrorHandlers();
    installProcessErrorHandlers();

    const rejectionRegs = onSpy.mock.calls.filter((c) => c[0] === "unhandledRejection");
    const exceptionRegs = onSpy.mock.calls.filter((c) => c[0] === "uncaughtException");
    expect(rejectionRegs).toHaveLength(1);
    expect(exceptionRegs).toHaveLength(1);
    onSpy.mockRestore();
  });
});

