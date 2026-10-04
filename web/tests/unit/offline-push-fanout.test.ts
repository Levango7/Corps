import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 离线推送"扇出 / 落记录"拆分的语义单元测试。
 *
 * 为什么必须有：全仓 23 处 `tx.notification.create` 已经各自落通知记录，
 * 若让它们直接调用 dispatchOfflineNotification（它自己也会落一条），
 * 用户会在通知中心看到重复项。拆分后的约定是：
 *  - fanOutOfflineEmail：**只**判在线/偏好/DND 并发邮件，绝不写 Notification 行
 *  - dispatchOfflineNotification：先落记录，再做同一套扇出
 * 这两条边界只有断言"notification.create 有没有被调"才测得到，
 * 光看返回值或看邮件都测不出来。
 */

const h = vi.hoisted(() => {
  const calls: string[] = [];
  const tx = {
    chatPresence: { findFirst: vi.fn() },
    notification: { create: vi.fn() },
    emailAccount: { findFirst: vi.fn() },
  };
  return {
    calls,
    tx,
    sendMail: vi.fn(),
    transportClose: vi.fn(),
    getNotificationPreferences: vi.fn(),
    isDndActive: vi.fn(),
    decrypt: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({
  runWithWorkspace: vi.fn(async (_wid: string, fn: (tx: unknown) => Promise<unknown>) => {
    h.calls.push("runWithWorkspace");
    return fn(h.tx);
  }),
  runWithAuthOp: vi.fn(async (_op: string, fn: (tx: unknown) => Promise<unknown>) => {
    h.calls.push("runWithAuthOp");
    return fn(h.tx);
  }),
}));

vi.mock("@/lib/notification/preferences", () => ({
  getNotificationPreferences: h.getNotificationPreferences,
  isDndActive: h.isDndActive,
}));

vi.mock("@/lib/crypto", () => ({ decrypt: h.decrypt }));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: h.sendMail, close: h.transportClose })),
  },
}));

import { dispatchOfflineNotification, fanOutOfflineEmail } from "@/lib/notification/offline-push";

const OPTS = {
  userId: "u-1",
  workspaceId: "w-1",
  type: "task_assigned" as const,
  entityId: "t-1",
  entityTitle: "给 A 的任务",
};

const PREF_ON = {
  emailNotify: true,
  pushNotify: true,
  dndEnabled: false,
  dndStart: "22:00",
  dndEnd: "08:00",
};
const ACCOUNT = {
  email: "a@example.com",
  displayName: "A",
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpSecure: false,
  credential: "cipher",
};

beforeEach(() => {
  h.calls.length = 0;
  h.tx.chatPresence.findFirst.mockResolvedValue(null); // 默认离线
  h.tx.notification.create.mockResolvedValue({ id: "n-1" });
  h.tx.emailAccount.findFirst.mockResolvedValue(ACCOUNT);
  h.getNotificationPreferences.mockResolvedValue(PREF_ON);
  h.isDndActive.mockReturnValue(false);
  h.decrypt.mockReturnValue("pw");
  h.sendMail.mockResolvedValue({ messageId: "m-1" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("fanOutOfflineEmail —— 只扇出，不落记录", () => {
  it("离线且邮件偏好开启：发一封信，且绝不写 Notification 行", async () => {
    await fanOutOfflineEmail(OPTS);

    expect(h.sendMail).toHaveBeenCalledTimes(1);
    expect(h.tx.notification.create).not.toHaveBeenCalled();
    // 发信凭证走 decrypt，明文不外泄
    expect(h.decrypt).toHaveBeenCalledWith("cipher");
  });

  it("在线用户不补邮件（实时通道已送达）", async () => {
    h.tx.chatPresence.findFirst.mockResolvedValue({ id: "p-1" });

    await fanOutOfflineEmail(OPTS);

    expect(h.sendMail).not.toHaveBeenCalled();
    expect(h.tx.notification.create).not.toHaveBeenCalled();
  });

  it("DND 时段不补邮件", async () => {
    h.isDndActive.mockReturnValue(true);

    await fanOutOfflineEmail(OPTS);

    expect(h.sendMail).not.toHaveBeenCalled();
  });

  it("偏好关闭邮件时不补邮件", async () => {
    h.getNotificationPreferences.mockResolvedValue({ ...PREF_ON, emailNotify: false });

    await fanOutOfflineEmail(OPTS);

    expect(h.sendMail).not.toHaveBeenCalled();
  });

  it("用户没配默认邮箱账户时静默跳过（这是当前绝大多数用户的实况）", async () => {
    h.tx.emailAccount.findFirst.mockResolvedValue(null);

    await fanOutOfflineEmail(OPTS);

    expect(h.sendMail).not.toHaveBeenCalled();
    expect(h.tx.notification.create).not.toHaveBeenCalled();
  });

  it("SMTP 失败不抛出（调用方业务流程不能被发信拖死）", async () => {
    h.sendMail.mockRejectedValueOnce(new Error("smtp down"));

    await expect(fanOutOfflineEmail(OPTS)).resolves.toBeUndefined();
    expect(h.transportClose).toHaveBeenCalledTimes(1); // 失败也要关连接
  });
});

describe("dispatchOfflineNotification —— 落记录 + 扇出", () => {
  it("离线：先落 Notification 记录，再补邮件", async () => {
    await dispatchOfflineNotification(OPTS);

    expect(h.tx.notification.create).toHaveBeenCalledTimes(1);
    expect(h.sendMail).toHaveBeenCalledTimes(1);
    // 顺序断言：记录写在扇出之前，保证邮件失败也不丢站内通知
    expect(h.calls.indexOf("runWithWorkspace")).toBe(0);
  });

  it("在线：只落记录，不发邮件", async () => {
    h.tx.chatPresence.findFirst.mockResolvedValue({ id: "p-1" });

    await dispatchOfflineNotification(OPTS);

    expect(h.tx.notification.create).toHaveBeenCalledTimes(1);
    expect(h.sendMail).not.toHaveBeenCalled();
  });
});
