-- Phase 2 协同编辑：Yjs CRDT 状态持久化（设计文档 §3.1.2 L849-862）
-- 每个文档对应一行 Yjs CRDT 二进制状态（Y.encodeStateAsUpdate 的输出）。
-- 协同服务端（server/collab/y-websocket-server.ts）启动时加载此状态，
-- 编辑更新增量写入，实现跨会话/跨用户的 CRDT 状态恢复。
--
-- 迁移安全性：纯新增表（CREATE TABLE），不修改/删除现有表/字段，
-- 保证向下兼容、可安全在线执行、可回滚（DROP TABLE yjs_persistence）。

-- ─── Yjs 协同文档持久化 ───
CREATE TABLE "yjs_persistence" (
  "id" UUID PRIMARY KEY,
  "document_id" UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "state" BYTEA NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 每个文档仅存一份 CRDT 状态（一对一）
CREATE UNIQUE INDEX "yjs_persistence_document_id_key" ON "yjs_persistence"("document_id");