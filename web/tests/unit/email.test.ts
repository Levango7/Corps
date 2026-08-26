import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * 邮件工具单元测试
 *
 * 覆盖 web/lib/email.ts 的 sendInviteEmail：
 *  - 正确拼接邮件内容（开发模式 / 生产模式）
 *  - 处理发送失败情况（当前实现为 console.log 占位，不抛错）
 *  - 环境变量缺失时的行为（NODE_ENV / SMTP_HOST 组合）
 *
 * 通过 vi.spyOn(console, "log") 捕获输出，不依赖真实 SMTP 服务。
 * 用 vi.stubEnv 安全修改环境变量（绕过 @types/node 的 readonly 限制），
 * afterEach 中 vi.unstubAllEnvs 自动恢复。
 */

import { sendInviteEmail, type InviteEmailParams } from "@/lib/email";

let logSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined) as unknown as ReturnType<
    typeof vi.fn
  >;
});

afterEach(() => {
  logSpy.mockRestore();
  vi.unstubAllEnvs();
});

/** 安全设置环境变量（绕过 readonly 限制） */
function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    // stubEnv 不接受 undefined，用空字符串模拟"缺失"
    // 代码中对 SMTP_HOST 用 falsy 判断，空字符串等同于缺失
    vi.stubEnv(key, "");
  } else {
    vi.stubEnv(key, value);
  }
}

/** 构造一个完整的邀请邮件参数 */
function makeParams(overrides: Partial<InviteEmailParams> = {}): InviteEmailParams {
  return {
    to: "invitee@example.com",
    workspaceName: "测试工作区",
    inviterName: "张三",
    ...overrides,
  };
}

describe("sendInviteEmail - 开发模式（NODE_ENV !== production）", () => {
  beforeEach(() => {
    setEnv("NODE_ENV", "development");
    setEnv("SMTP_HOST", undefined);
  });

  it("输出 [email-dev] 前缀的调试日志，包含 to / workspace / inviter", async () => {
    // Arrange
    const params = makeParams();

    // Act
    await sendInviteEmail(params);

    // Assert
    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain("[email-dev]");
    expect(output).toContain("to=invitee@example.com");
    expect(output).toContain("workspace=测试工作区");
    expect(output).toContain("inviter=张三");
  });

  it("不同参数正确反映在日志中", async () => {
    // Arrange
    const params = makeParams({
      to: "another@test.com",
      workspaceName: "产品团队",
      inviterName: "李四",
    });

    // Act
    await sendInviteEmail(params);

    // Assert
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain("to=another@test.com");
    expect(output).toContain("workspace=产品团队");
    expect(output).toContain("inviter=李四");
  });

  it("NODE_ENV 未设置时也走开发模式", async () => {
    // Arrange：stub 为空字符串模拟未设置
    setEnv("NODE_ENV", undefined);
    const params = makeParams();

    // Act
    await sendInviteEmail(params);

    // Assert
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain("[email-dev]");
  });
});

describe("sendInviteEmail - 生产模式（NODE_ENV=production 且配置 SMTP_HOST）", () => {
  beforeEach(() => {
    setEnv("NODE_ENV", "production");
    setEnv("SMTP_HOST", "smtp.example.com");
  });

  it("输出 [email] 前缀的发送日志，包含 to / workspace / inviter", async () => {
    // Arrange
    const params = makeParams();

    // Act
    await sendInviteEmail(params);

    // Assert
    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain("[email]");
    expect(output).toContain("invitee@example.com");
    expect(output).toContain("测试工作区");
    expect(output).toContain("张三");
  });

  it("生产日志格式为 'invite sent to {to} for workspace {ws} by {inviter}'", async () => {
    // Arrange
    const params = makeParams();

    // Act
    await sendInviteEmail(params);

    // Assert
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toBe(
      "[email] invite sent to invitee@example.com for workspace 测试工作区 by 张三",
    );
  });
});

describe("sendInviteEmail - 环境变量缺失时的行为", () => {
  it("NODE_ENV=production 但 SMTP_HOST 缺失时回退到开发模式", async () => {
    // Arrange
    setEnv("NODE_ENV", "production");
    setEnv("SMTP_HOST", undefined);
    const params = makeParams();

    // Act
    await sendInviteEmail(params);

    // Assert：应走开发分支，输出 [email-dev]
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain("[email-dev]");
  });

  it("NODE_ENV=production 且 SMTP_HOST 为空字符串时回退到开发模式", async () => {
    // Arrange：空字符串在 falsy 判断中等同于缺失
    setEnv("NODE_ENV", "production");
    setEnv("SMTP_HOST", "");
    const params = makeParams();

    // Act
    await sendInviteEmail(params);

    // Assert
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain("[email-dev]");
  });

  it("NODE_ENV 非 production（如 test）时无论 SMTP_HOST 如何均走开发模式", async () => {
    // Arrange
    setEnv("NODE_ENV", "test");
    setEnv("SMTP_HOST", "smtp.example.com");
    const params = makeParams();

    // Act
    await sendInviteEmail(params);

    // Assert
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain("[email-dev]");
  });
});

describe("sendInviteEmail - 发送失败与边界情况", () => {
  beforeEach(() => {
    setEnv("NODE_ENV", "development");
    setEnv("SMTP_HOST", undefined);
  });

  it("当前实现不会抛错（console.log 占位，尽力而为语义）", async () => {
    // Arrange
    const params = makeParams();

    // Act & Assert：不应 reject
    await expect(sendInviteEmail(params)).resolves.toBeUndefined();
  });

  it("包含特殊字符的参数不导致异常", async () => {
    // Arrange
    const params = makeParams({
      to: "user+tag@example.com",
      workspaceName: "团队 <重要>",
      inviterName: "O'Brien",
    });

    // Act & Assert
    await expect(sendInviteEmail(params)).resolves.toBeUndefined();
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain("user+tag@example.com");
    expect(output).toContain("团队 <重要>");
    expect(output).toContain("O'Brien");
  });

  it("空字符串参数不导致异常", async () => {
    // Arrange
    const params = makeParams({ to: "", workspaceName: "", inviterName: "" });

    // Act & Assert
    await expect(sendInviteEmail(params)).resolves.toBeUndefined();
  });

  it("多次调用均正常输出（无状态累积）", async () => {
    // Arrange
    const params = makeParams();

    // Act
    await sendInviteEmail(params);
    await sendInviteEmail(params);
    await sendInviteEmail(params);

    // Assert
    expect(logSpy).toHaveBeenCalledTimes(3);
    for (const call of logSpy.mock.calls) {
      expect(call[0] as string).toContain("[email-dev]");
    }
  });
});

describe("sendInviteEmail - 返回值与副作用", () => {
  beforeEach(() => {
    setEnv("NODE_ENV", "development");
    setEnv("SMTP_HOST", undefined);
  });

  it("返回 Promise<void>，resolve 值为 undefined", async () => {
    // Arrange
    const params = makeParams();

    // Act
    const result = await sendInviteEmail(params);

    // Assert
    expect(result).toBeUndefined();
  });

  it("仅调用 console.log 一次，无其他副作用", async () => {
    // Arrange
    const params = makeParams();

    // Act
    await sendInviteEmail(params);

    // Assert：恰好一次 console.log
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});
