import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * sendInviteEmail — Resend 真实发送路径单测（RESEND_API_KEY 已配置时）
 *
 * 通过 vi.stubGlobal mock 全局 fetch，不发真实网络请求。
 * 覆盖：成功载荷/日志、HTML 转义防注入、非 2xx 容错、网络异常容错、MAIL_FROM 定制。
 */

import { sendInviteEmail, type InviteEmailParams } from "@/lib/email";

function makeParams(overrides: Partial<InviteEmailParams> = {}): InviteEmailParams {
  return {
    to: "invitee@example.com",
    workspaceName: "测试工作区",
    inviterName: "张三",
    ...overrides,
  };
}

let logSpy: ReturnType<typeof vi.fn>;
let errSpy: ReturnType<typeof vi.fn>;
const fetchMock = vi.fn();

beforeEach(() => {
  logSpy = vi.spyOn(console, "info").mockImplementation(() => undefined) as unknown as ReturnType<
    typeof vi.fn
  >;
  errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined) as unknown as ReturnType<
    typeof vi.fn
  >;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("RESEND_API_KEY", "re_test_key_123");
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendInviteEmail - Resend 真实发送路径（RESEND_API_KEY 已配置）", () => {
  it("成功：向 Resend API POST 正确载荷并记录一次 [email] 日志", async () => {
    // Arrange
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "email-123" }), { status: 200 }));

    // Act
    await expect(sendInviteEmail(makeParams())).resolves.toBeUndefined();

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer re_test_key_123",
    );
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.to).toBe("invitee@example.com");
    expect(body.subject).toContain("张三");
    expect(body.subject).toContain("测试工作区");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0][0])).toContain("[email]");
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("HTML 模板对用户可控字段做转义（防邮件内容注入）", async () => {
    // Arrange
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    // Act
    await sendInviteEmail(makeParams({ inviterName: "<b>Eve</b>", workspaceName: 'A"&B' }));

    // Assert
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as Record<
      string,
      string
    >;
    expect(body.html).not.toContain("<b>");
    expect(body.html).toContain("&lt;b&gt;");
    expect(body.html).toContain("&quot;");
  });

  it("非 2xx 响应：错误被捕获、console.error 记录、不 reject、无成功日志", async () => {
    // Arrange
    fetchMock.mockResolvedValue(new Response("invalid api key", { status: 401 }));

    // Act & Assert
    await expect(sendInviteEmail(makeParams())).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("网络异常（fetch reject）：同样被吞掉，调用方不受影响", async () => {
    // Arrange
    fetchMock.mockRejectedValue(new TypeError("network down"));

    // Act & Assert
    await expect(sendInviteEmail(makeParams())).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("MAIL_FROM 已配置时作为发件人地址", async () => {
    // Arrange
    vi.stubEnv("MAIL_FROM", "noreply@custom.dev");
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    // Act
    await sendInviteEmail(makeParams());

    // Assert
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as Record<
      string,
      string
    >;
    expect(body.from).toBe("noreply@custom.dev");
  });

  it("EMAIL_FROM 已配置时优先作为发件人地址（docker-compose/.env.example 定义的变量名）", async () => {
    // Arrange
    vi.stubEnv("EMAIL_FROM", "noreply@primary.dev");
    vi.stubEnv("MAIL_FROM", "noreply@legacy.dev");
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    // Act
    await sendInviteEmail(makeParams());

    // Assert
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as Record<
      string,
      string
    >;
    expect(body.from).toBe("noreply@primary.dev");
  });

  it("仅配置历史变量 MAIL_FROM 时兼容使用（EMAIL_FROM 未设置）", async () => {
    // Arrange
    vi.stubEnv("MAIL_FROM", "noreply@legacy.dev");
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    // Act
    await sendInviteEmail(makeParams());

    // Assert
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as Record<
      string,
      string
    >;
    expect(body.from).toBe("noreply@legacy.dev");
  });

  it("RESEND_API_KEY 为空字符串时回退占位路径（不调用 fetch）", async () => {
    // Arrange
    vi.stubEnv("RESEND_API_KEY", "");

    // Act
    await sendInviteEmail(makeParams());

    // Assert
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(logSpy.mock.calls[0][0])).toContain("[email-dev]");
  });
});
