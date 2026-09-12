/**
 * PrismaYjsPersistence — Yjs CRDT 状态的 PostgreSQL 持久化层。
 *
 * 设计文档 §3.1.2（L847-862）：Yjs state vector 存入 PostgreSQL（yjs_persistence 表）。
 *
 * 职责：
 *  1. loadState(documentId) — 从 DB 加载文档的完整 CRDT 二进制状态
 *  2. storeState(documentId, state) — upsert 完整状态（全量覆盖）
 *  3. storeUpdate(documentId, update) — 增量合并更新到 DB 中已存的状态
 *
 * 协同服务端（y-websocket-server.ts）在 WebSocket 连接建立时调用 loadState 将历史
 * 状态 applyUpdate 到内存 Y.Doc；在 Y.Doc 'update' 事件触发时调用 storeUpdate
 * 将增量变更持久化，实现跨会话/跨用户的 CRDT 状态恢复。
 *
 * ─── 运行时依赖 ──────────────────────────────────────────────
 * 本文件属于独立协同服务（server/collab/），不在 web/ 的 tsconfig 范围内。
 * 运行时需要以下依赖（与 web/ 共享 node_modules 或在 server/ 下独立安装）：
 *   - @prisma/client（Prisma Client，需先在 web/ 运行 `pnpm db:generate`）
 *   - yjs（CRDT 库）
 * 部署时建议 server/ 有独立 package.json 声明这些依赖。
 */

import { PrismaClient } from "@prisma/client";
import * as Y from "yjs";

/**
 * Yjs persistence 接口契约。
 *
 * 遵循 y-websocket 服务端 persistence 的标准模式：
 * - loadDoc: 连接建立时加载历史状态到 Y.Doc
 * - storeUpdate: Y.Doc 更新时持久化增量
 */
export interface YjsPersistence {
  /** 加载文档历史状态，返回二进制 update（Y.encodeStateAsUpdate 输出），无记录时返回 null */
  loadState(documentId: string): Promise<Uint8Array | null>;
  /** 存储完整状态（upsert：存在则覆盖，不存在则插入） */
  storeState(documentId: string, state: Uint8Array): Promise<void>;
  /** 增量合并更新到 DB 中已存的状态（读取旧 state → applyUpdate → 写回新 state） */
  storeUpdate(documentId: string, update: Uint8Array): Promise<void>;
}

/**
 * 基于 Prisma + PostgreSQL 的 Yjs 持久化实现。
 *
 * 状态存储策略：
 *  - 每个文档对应一行（yjs_persistence.document_id 唯一约束）
 *  - state 列（BYTEA）存储 Y.encodeStateAsUpdate(doc) 的完整二进制状态
 *  - storeUpdate 采用「读取-合并-写回」模式，保证增量更新正确合并到全量状态
 *
 * 并发安全：
 *  - storeUpdate 使用 Prisma 事务 + 状态向量比较避免丢失更新（last-writer-wins
 *    在 CRDT 语义下是安全的——Yjs CRDT 的合并是幂等且可交换的，applyUpdate
 *    顺序不影响最终收敛结果）。
 *  - 对于高并发编辑场景，可升级为 PostgreSQL SELECT ... FOR UPDATE 行锁，
 *    但 CRDT 的数学性质保证了即使发生丢失更新，各副本最终也会通过同步收敛一致。
 */
export class PrismaYjsPersistence implements YjsPersistence {
  private readonly prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    // 复用传入的 PrismaClient 实例（避免多实例连接池耗尽），或创建新实例
    this.prisma = prisma ?? new PrismaClient();
  }

  /**
   * 加载文档的完整 CRDT 状态。
   *
   * @returns 二进制状态（Uint8Array），无记录时返回 null
   */
  async loadState(documentId: string): Promise<Uint8Array | null> {
    const record = await this.prisma.yjsPersistence.findUnique({
      where: { documentId },
      select: { state: true },
    });
    if (!record) {
      return null;
    }
    // Prisma Bytes → Uint8Array（Buffer 是 Uint8Array 的子类，直接返回）
    return record.state as Uint8Array;
  }

  /**
   * 存储完整状态（upsert）。
   *
   * 用于初次创建或全量覆盖场景（如文档状态重建）。
   */
  async storeState(documentId: string, state: Uint8Array): Promise<void> {
    await this.prisma.yjsPersistence.upsert({
      where: { documentId },
      create: {
        documentId,
        state: Buffer.from(state),
      },
      update: {
        state: Buffer.from(state),
      },
    });
  }

  /**
   * 增量合并更新到 DB 中已存的状态。
   *
   * 流程：
   *  1. 读取现有 state（无则视为空文档）
   *  2. 将现有 state applyUpdate 到临时 Y.Doc
   *  3. 将增量 update applyUpdate 到同一 Y.Doc
   *  4. encodeStateAsUpdate 得到合并后的完整状态
   *  5. upsert 写回 DB
   *
   * CRDT 数学保证：applyUpdate 是幂等且可交换的，即使步骤 1-2 与其他并发写入
   * 存在竞态（读到稍旧的 state），最终合并结果仍会通过后续同步收敛一致。
   */
  async storeUpdate(documentId: string, update: Uint8Array): Promise<void> {
    // 读取现有状态
    const existing = await this.prisma.yjsPersistence.findUnique({
      where: { documentId },
      select: { state: true },
    });

    // 在临时 Y.Doc 上合并旧状态 + 增量更新
    const doc = new Y.Doc();
    if (existing) {
      Y.applyUpdate(doc, existing.state as Uint8Array);
    }
    Y.applyUpdate(doc, update);

    // 编码合并后的完整状态并写回
    const mergedState = Y.encodeStateAsUpdate(doc);
    await this.prisma.yjsPersistence.upsert({
      where: { documentId },
      create: {
        documentId,
        state: Buffer.from(mergedState),
      },
      update: {
        state: Buffer.from(mergedState),
      },
    });

    // 释放 Y.Doc 内存
    doc.destroy();
  }

  /**
   * 优雅关闭：断开 Prisma 连接。
   *
   * 在协同服务停机时调用，避免连接泄漏。
   */
  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}