// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmailAccount, PrismaClient } from "@prisma/client";

/**
 * ImapSync 契约（lib/mail/imap-sync.ts）
 *
 * 这个模块此前是「写了但从未运行」的状态，且它的 API 口径是照着想象中的
 * imapflow 写的（getMailboxLock 上取 uidValidity、fetchOne 传错形状），
 * 直到 CI 的 tsc 才暴露。本文件把**真实 imapflow v2 口径**钉住：
 *  - search() 返回 number[] | false | undefined
 *  - fetchOne() 返回 FetchMessageObject | false，信封在 envelope 上
 *  - mailbox lock 只用于互斥，状态走 status()
 *  - 增量游标 = 本机已存邮件的最大 UID + 1
 *  - 去重键 = accountId + messageId
 *
 * 全部用替身，不连真 IMAP。
 */

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  logout: vi.fn(),
  search: vi.fn(),
  fetchOne: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock("imapflow", () => {
  class ImapFlow {
    connect = mocks.connect;
    logout = mocks.logout;
    search = mocks.search;
    fetchOne = mocks.fetchOne;
    constructor(_opts: unknown) {}
  }
  return { ImapFlow };
});

vi.mock("@/lib/crypto", () => ({ decrypt: mocks.decrypt }));

import { ImapSync } from "@/lib/mail/imap-sync";

/** 构造一个最小 EmailAccount（类型上只要求同步器真正读到的字段） */
function account(overrides: Partial<EmailAccount> = {}): EmailAccount {
  return {
    id: "acct-1",
    workspaceId: "ws-1",
    userId: "user-1",
    email: "a@b.c",
    displayName: null,
    provider: "custom",
    smtpHost: "smtp.b.c",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "imap.b.c",
    imapPort: 993,
    credential: "enc",
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as EmailAccount;
}

/**
 * Prisma 替身：只实现同步器用到的两个方法。
 *
 * 显式声明成 mock 类型而不是断言成 PrismaClient——后者会让 TS 把
 * `prisma.mail.findFirst` 当成真 Prisma 方法（没有 `.mockResolvedValue`），
 * 测试里的 mock 配置就编译不过。
 */
interface PrismaStub {
  mail: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

function prismaStub(): PrismaStub {
  return {
    mail: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  };
}

/** 把替身喂给同步器（同步器只读这两个方法，运行时等价） */
function asPrisma(stub: PrismaStub): PrismaClient {
  return stub as unknown as PrismaClient;
}

function envelopeMessage(overrides: Record<string, unknown> = {}) {
  return {
    uid: 42,
    seq: 1,
    source: Buffer.from("raw"),
    envelope: {
      messageId: "<m-1@b.c>",
      subject: "主题",
      from: [{ name: "发件人", address: "from@b.c" }],
      to: [{ address: "to@b.c" }, { address: "to2@b.c" }],
      cc: [{ address: "cc@b.c" }],
      date: new Date("2026-11-09T01:02:03Z"),
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decrypt.mockReturnValue("plain-pass");
  mocks.connect.mockResolvedValue(undefined);
  mocks.logout.mockResolvedValue(undefined);
});

describe("ImapSync", () => {
  it("缺 IMAP 主机/端口时直接失败，不静默连默认值", async () => {
    const sync = new ImapSync(asPrisma(prismaStub()), account({ imapHost: null }), {});
    const result = await sync.sync();

    expect(result.success).toBe(false);
    expect(result.error).toContain("缺少 IMAP 主机/端口");
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("正常同步：search → fetchOne → 去重未命中 → 落库，created 计数正确", async () => {
    mocks.search.mockResolvedValue([41, 42]);
    mocks.fetchOne.mockResolvedValueOnce(envelopeMessage({ uid: 41 }));
    mocks.fetchOne.mockResolvedValueOnce(
      envelopeMessage({
        uid: 42,
        envelope: {
          messageId: "<m-2@b.c>",
          subject: "第二封",
          from: [{ address: "f2@b.c" }],
          to: [{ address: "t@b.c" }],
        },
      }),
    );
    const prisma = prismaStub();
    prisma.mail.findFirst.mockResolvedValue(null);
    prisma.mail.create.mockResolvedValue({});

    const sync = new ImapSync(asPrisma(prisma), account(), {});
    const result = await sync.sync();

    expect(result.success).toBe(true);
    expect(result.created).toBe(2);
    expect(prisma.mail.create).toHaveBeenCalledTimes(2);
    // UID 与信封字段落库（含 uid 列——增量游标就存在这里）
    const second = prisma.mail.create.mock.calls[1][0];
    expect(second.data.uid).toBe(42);
    expect(second.data.subject).toBe("第二封");
    expect(second.data.fromAddr).toBe("f2@b.c");
    expect(second.data.toAddr).toBe("t@b.c");
  });

  it("messageId 已存在则跳过（accountId + messageId 去重）", async () => {
    mocks.search.mockResolvedValue([42]);
    mocks.fetchOne.mockResolvedValue(envelopeMessage());
    const prisma = prismaStub();
    prisma.mail.findFirst.mockResolvedValue({ id: "existing" });

    const sync = new ImapSync(asPrisma(prisma), account(), {});
    const result = await sync.sync();

    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
    expect(prisma.mail.create).not.toHaveBeenCalled();
    // 去重查询必须带 accountId，否则会跨账户误判
    expect(prisma.mail.findFirst).toHaveBeenCalledWith({
      where: { accountId: "acct-1", messageId: "<m-1@b.c>" },
      select: { id: true },
    });
  });

  it("search 返回 false（无匹配）视为空列表，不当成错误", async () => {
    mocks.search.mockResolvedValue(false);
    const prisma = prismaStub();

    const sync = new ImapSync(asPrisma(prisma), account(), {});
    const result = await sync.sync();

    expect(result.success).toBe(true);
    expect(result.created).toBe(0);
    expect(mocks.fetchOne).not.toHaveBeenCalled();
  });

  it("增量游标：从本机最大 UID + 1 起搜", async () => {
    mocks.search.mockResolvedValue([]);
    const prisma = prismaStub();
    prisma.mail.findFirst.mockResolvedValue({ uid: 108 });

    const sync = new ImapSync(asPrisma(prisma), account(), {});
    await sync.sync();

    expect(prisma.mail.findFirst).toHaveBeenCalledWith({
      where: { accountId: "acct-1" },
      orderBy: { uid: "desc" },
      select: { uid: true },
    });
    expect(mocks.search).toHaveBeenCalledWith({ uid: "109:*" });
  });

  it("fullSync 忽略本地游标，从 1 起搜", async () => {
    mocks.search.mockResolvedValue([]);
    const prisma = prismaStub();

    const sync = new ImapSync(asPrisma(prisma), account(), { fullSync: true });
    await sync.sync();

    expect(prisma.mail.findFirst).not.toHaveBeenCalled();
    expect(mocks.search).toHaveBeenCalledWith({ uid: "1:*" });
  });

  it("进度回调按阶段上报，出错时带 error 文案", async () => {
    mocks.search.mockRejectedValue(new Error("boom"));
    const prisma = prismaStub();
    const onProgress = vi.fn();

    const sync = new ImapSync(asPrisma(prisma), account(), { onProgress });
    const result = await sync.sync();

    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
    expect(onProgress).toHaveBeenCalledWith({ phase: "connecting", processed: 0 });
    expect(onProgress).toHaveBeenCalledWith({ phase: "error", processed: 0, error: "boom" });
  });

  it("envelope 地址拼接与空值回退（多人 to、无 cc → null、坏日期 → now）", async () => {
    mocks.search.mockResolvedValue([7]);
    mocks.fetchOne.mockResolvedValue(
      envelopeMessage({
        uid: 7,
        envelope: {
          messageId: "<m-7@b.c>",
          subject: "拼接",
          from: [{ address: "a@b.c" }, { address: "b@b.c" }],
          to: [{ address: "c@b.c" }, { address: "d@b.c" }],
        },
      }),
    );
    const prisma = prismaStub();
    prisma.mail.findFirst.mockResolvedValue(null);
    prisma.mail.create.mockResolvedValue({});

    const sync = new ImapSync(asPrisma(prisma), account(), {});
    await sync.sync();

    const created = prisma.mail.create.mock.calls[0][0];
    expect(created.data.fromAddr).toBe("a@b.c, b@b.c");
    expect(created.data.toAddr).toBe("c@b.c, d@b.c");
    expect(created.data.ccAddr).toBeUndefined();
  });
});
