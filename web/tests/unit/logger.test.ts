import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger, generateRequestId } from "@/lib/logger";

describe("logger", () => {
  let consoleSpy: {
    debug: ReturnType<typeof vi.spyOn>;
    info: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("info 级别日志调用 console.info", () => {
    logger.info("test message");
    expect(consoleSpy.info).toHaveBeenCalledTimes(1);
    const output = consoleSpy.info.mock.calls[0][0] as string;
    expect(output).toContain("test message");
    expect(output).toContain("INFO");
  });

  it("warn 级别日志调用 console.warn", () => {
    logger.warn("warning message");
    expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
    const output = consoleSpy.warn.mock.calls[0][0] as string;
    expect(output).toContain("warning message");
    expect(output).toContain("WARN");
  });

  it("error 级别日志调用 console.error", () => {
    logger.error("error message");
    expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    const output = consoleSpy.error.mock.calls[0][0] as string;
    expect(output).toContain("error message");
    expect(output).toContain("ERROR");
  });

  it("debug 级别日志在默认 info 级别下不输出", () => {
    // 默认 LOG_LEVEL=info，debug < info，不应输出
    logger.debug("debug message");
    expect(consoleSpy.debug).not.toHaveBeenCalled();
  });

  it("context 对象包含在日志中", () => {
    logger.info("msg", { userId: "u1", action: "login" });
    const output = consoleSpy.info.mock.calls[0][0] as string;
    expect(output).toContain("userId");
    expect(output).toContain("u1");
    expect(output).toContain("login");
  });

  it("requestId 包含在日志中（截取前8位）", () => {
    const reqId = "abcdef1234567890";
    logger.info("msg", undefined, reqId);
    const output = consoleSpy.info.mock.calls[0][0] as string;
    expect(output).toContain("abcdef12");
  });

  it("无 context 和 requestId 时日志格式正确", () => {
    logger.info("simple");
    const output = consoleSpy.info.mock.calls[0][0] as string;
    expect(output).toContain("simple");
    expect(output).toContain("INFO");
  });
});

describe("generateRequestId", () => {
  it("返回 UUID 格式字符串", () => {
    const id = generateRequestId();
    // UUID v4 格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("每次调用产生不同 ID", () => {
    const a = generateRequestId();
    const b = generateRequestId();
    expect(a).not.toBe(b);
  });
});
