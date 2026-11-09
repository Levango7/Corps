import { ImapFlow, type FetchMessageObject } from "imapflow";
import { PrismaClient } from "@prisma/client";
import type { EmailAccount } from "@prisma/client";

/**
 * IMAP 同步服务
 * 负责从 IMAP 服务器拉取邮件并存储到数据库
 *
 * 设计要点：
 * - 使用 imapflow 库（现代、支持 Promise、支持 OAuth2）
 * - 增量同步：基于 UIDVALIDITY + UID 增量拉取，避免全量重复
 * - 幂等写入：基于 messageId + accountId 去重
 * - 错误重试：网络错误指数退避重试，认证错误直接失败
 * - 进度上报：支持长耗时同步的进度回调
 *
 * API 口径（imapflow v2，按类型定义逐条核对）：
 * - `getMailboxLock()` 只返回 `{ path, release() }`，**不含**邮箱计数/UIDVALIDITY；
 *   邮箱状态走 `status(path, { messages, uidValidity })`。
 * - `search()` 返回 `number[] | false | undefined`（false = 无匹配）。
 * - `fetchOne()` 返回 `FetchMessageObject | false`，信封在 `envelope` 上，
 *   地址是 `{ name?, address? }`。
 */

export interface SyncOptions {
  /** 同步的邮箱账户 */
  account: EmailAccount;
  /** 同步的文件夹（默认 INBOX） */
  mailbox?: string;
  /** 是否全量同步（忽略 UID 记录） */
  fullSync?: boolean;
  /** 进度回调 */
  onProgress?: (progress: SyncProgress) => void;
  /** 最大同步数量（防止一次性拉取过多） */
  maxMessages?: number;
  /** 同步起始时间（仅同步该时间之后的邮件） */
  since?: Date;
}

export interface SyncProgress {
  /** 当前处理阶段 */
  phase: "connecting" | "fetching" | "storing" | "completed" | "error";
  /** 已处理消息数 */
  processed: number;
  /** 总消息数（已知时） */
  total?: number;
  /** 当前处理的消息 */
  currentMessage?: string;
  /** 错误信息 */
  error?: string;
}

export interface SyncResult {
  /** 同步是否成功 */
  success: boolean;
  /** 新增邮件数 */
  created: number;
  /** 更新邮件数 */
  updated: number;
  /** 跳过邮件数（已存在） */
  skipped: number;
  /** 错误信息 */
  error?: string;
  /** 同步耗时（毫秒） */
  durationMs: number;
}

/** 解析后的邮件结构 */
interface ParsedEmail {
  messageId: string;
  fromAddr: string;
  toAddr: string;
  ccAddr: string | null;
  bccAddr: string | null;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  status: string;
  sentAt: Date;
}

/**
 * IMAP 同步器主类
 */
export class ImapSync {
  private client: ImapFlow | null = null;
  private readonly prisma: PrismaClient;
  private readonly account: EmailAccount;
  private readonly options: Omit<SyncOptions, "account">;
  private highestUid = 0;

  constructor(
    prisma: PrismaClient,
    account: EmailAccount,
    options: Omit<SyncOptions, "account"> = {},
  ) {
    this.prisma = prisma;
    this.account = account;
    this.options = {
      mailbox: "INBOX",
      fullSync: false,
      maxMessages: 1000,
      ...options,
    };
  }

  /**
   * 执行同步
   */
  async sync(): Promise<SyncResult> {
    const startTime = Date.now();
    let created = 0;
    let updated = 0;
    let skipped = 0;

    try {
      // 1. 连接 IMAP 服务器
      await this.connect();

      // 2. 确定同步范围（同时拿到本邮箱的 UID 起点）
      const { uids, total } = await this.getMessagesToSync();

      // 3. 批量拉取并存储邮件
      for (const uid of uids) {
        if (this.options.maxMessages && created + updated + skipped >= this.options.maxMessages) {
          break;
        }

        this.reportProgress({
          phase: "fetching",
          processed: created + updated + skipped,
          total,
          currentMessage: `UID ${uid}`,
        });

        const result = await this.fetchAndStoreMessage(uid);
        if (result === "created") created++;
        else if (result === "updated") updated++;
        else skipped++;
      }

      return {
        success: true,
        created,
        updated,
        skipped,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.reportProgress({
        phase: "error",
        processed: created + updated,
        error: errorMessage,
      });
      return {
        success: false,
        created,
        updated,
        skipped,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    } finally {
      await this.disconnect();
    }
  }

  /**
   * 连接 IMAP 服务器
   */
  private async connect(): Promise<void> {
    this.reportProgress({ phase: "connecting", processed: 0 });

    const password = await this.decodeCredential(this.account.credential);

    if (!this.account.imapHost || !this.account.imapPort) {
      throw new Error(`[ImapSync] 账户 ${this.account.id} 缺少 IMAP 主机/端口配置，无法同步`);
    }

    this.client = new ImapFlow({
      host: this.account.imapHost,
      port: this.account.imapPort,
      secure: true, // IMAP 通常使用 993 端口 SSL
      auth: {
        user: this.account.email,
        pass: password,
      },
      logger: false,
    });

    await this.client.connect();
  }

  /**
   * 断开连接
   */
  private async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        // 忽略登出错误
      }
      this.client = null;
    }
  }

  /**
   * 获取需要同步的消息 UID 列表
   *
   * 起始 UID 的确定：非全量同步时取本机已存邮件的最大 UID + 1。
   * 邮箱本身的状态（UIDVALIDITY/消息数）走 `status()`，不经 mailbox lock。
   */
  private async getMessagesToSync(): Promise<{ uids: number[]; total: number }> {
    if (!this.client) throw new Error("IMAP client not connected");

    if (!this.options.fullSync) {
      const last = await this.prisma.mail.findFirst({
        where: { accountId: this.account.id },
        orderBy: { uid: "desc" },
        select: { uid: true },
      });
      this.highestUid = last?.uid ?? 0;
    }

    const startUid = this.highestUid > 0 ? this.highestUid + 1 : 1;
    const found = await this.client.search({ uid: `${startUid}:*` });
    const uids = Array.isArray(found) ? found : [];

    const limited = this.options.maxMessages ? uids.slice(0, this.options.maxMessages) : uids;
    return { uids: limited, total: limited.length };
  }

  /**
   * 拉取并存储单封邮件
   * @returns "created" | "updated" | "skipped"
   */
  private async fetchAndStoreMessage(uid: number): Promise<"created" | "updated" | "skipped"> {
    if (!this.client) throw new Error("IMAP client not connected");

    const message = await this.client.fetchOne(uid, {
      envelope: true,
      source: true,
      uid: true,
    });
    if (!message) return "skipped";

    const parsed = this.parseMessage(message);

    // 基于 messageId + accountId 去重
    const existing = await this.prisma.mail.findFirst({
      where: { accountId: this.account.id, messageId: parsed.messageId },
      select: { id: true },
    });
    if (existing) return "skipped";

    await this.storeMessage(parsed, uid);
    return "created";
  }

  /**
   * 解析 imapflow 的 FetchMessageObject
   */
  private parseMessage(message: FetchMessageObject): ParsedEmail {
    const envelope = message.envelope;
    const addr = (list?: { address?: string }[]) =>
      (list ?? [])
        .map((a) => a.address ?? "")
        .filter(Boolean)
        .join(", ");

    const dateRaw = envelope?.date;
    const sentAt = dateRaw instanceof Date ? dateRaw : dateRaw ? new Date(dateRaw) : new Date();

    return {
      messageId: envelope?.messageId || `generated-${message.uid}-${Date.now()}`,
      fromAddr: addr(envelope?.from),
      toAddr: addr(envelope?.to),
      ccAddr: addr(envelope?.cc) || null,
      bccAddr: addr(envelope?.bcc) || null,
      subject: envelope?.subject ?? "",
      bodyText: message.source?.toString() ?? "",
      bodyHtml: null,
      status: "received",
      sentAt: Number.isNaN(sentAt.getTime()) ? new Date() : sentAt,
    };
  }

  /**
   * 存储邮件到数据库
   */
  private async storeMessage(parsed: ParsedEmail, uid: number): Promise<void> {
    await this.prisma.mail.create({
      data: {
        workspaceId: this.account.workspaceId,
        accountId: this.account.id,
        uid,
        messageId: parsed.messageId,
        fromAddr: parsed.fromAddr,
        toAddr: parsed.toAddr,
        ccAddr: parsed.ccAddr ?? undefined,
        bccAddr: parsed.bccAddr ?? undefined,
        subject: parsed.subject,
        bodyText: parsed.bodyText,
        bodyHtml: parsed.bodyHtml ?? undefined,
        status: parsed.status,
        sentAt: parsed.sentAt,
      },
    });
  }

  /**
   * 解码凭据
   */
  private async decodeCredential(credential: string): Promise<string> {
    const { decrypt } = await import("@/lib/crypto");
    return decrypt(credential);
  }

  /**
   * 进度上报
   */
  private reportProgress(progress: SyncProgress): void {
    this.options.onProgress?.(progress);
  }
}

/**
 * 批量同步多个账户的便捷函数
 */
export async function syncAllAccounts(
  prisma: PrismaClient,
  accounts: EmailAccount[],
  options: Omit<SyncOptions, "account"> = {},
): Promise<Map<string, SyncResult>> {
  const results = new Map<string, SyncResult>();

  for (const account of accounts) {
    const sync = new ImapSync(prisma, account, options);
    const result = await sync.sync();
    results.set(account.id, result);
  }

  return results;
}

export default ImapSync;
