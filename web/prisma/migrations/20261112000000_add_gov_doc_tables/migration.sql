-- P1 公文 A1（任务 #83）：四对象模型 additive 建表。
--
-- gov_docs / gov_doc_opinions / gov_doc_exchanges / gov_doc_attachments，
-- 对应 schema.prisma 的 GovDoc / GovDocOpinion / GovDocExchange / GovDocAttachment
-- （设计文档 GOV-DOC-P1-design-v0.md §4）。
--
-- 全 additive：只新建 4 张表 + 索引 + 外键，不改任何既有对象；
-- 存量行零影响，无需 backfill。
--
-- DDL 由 `prisma migrate diff --from-empty --to-schema prisma/schema.prisma
-- --script` 的产物逐字抽取本批 4 表（与 20260929000000 同口径）。
--
-- OFD 预览选型待核（设计文档 §8-1）：附件表只登记版本/哈希/预览产物引用，
-- 本期不做任何 OFD 解析/渲染。

-- CreateTable
CREATE TABLE "gov_docs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "doc_no" VARCHAR(64),
    "title" VARCHAR(200) NOT NULL,
    "direction" VARCHAR(20) NOT NULL DEFAULT 'incoming',
    "secret_level" VARCHAR(20) NOT NULL DEFAULT 'internal',
    "urgency" VARCHAR(20) NOT NULL DEFAULT 'normal',
    "source" VARCHAR(200),
    "destination" VARCHAR(200),
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "created_by" UUID,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gov_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gov_doc_opinions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "gov_doc_id" UUID NOT NULL,
    "author_id" UUID,
    "conclusion" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gov_doc_opinions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gov_doc_exchanges" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "gov_doc_id" UUID NOT NULL,
    "direction" VARCHAR(20) NOT NULL DEFAULT 'incoming',
    "channel" VARCHAR(50) NOT NULL,
    "operator_id" UUID,
    "exchanged_at" TIMESTAMPTZ NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gov_doc_exchanges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gov_doc_attachments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "gov_doc_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "file_hash" VARCHAR(128) NOT NULL,
    "preview_ref" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gov_doc_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gov_docs_workspace_id_direction_status_idx" ON "gov_docs"("workspace_id", "direction", "status");

-- CreateIndex
CREATE INDEX "gov_docs_workspace_id_updated_at_idx" ON "gov_docs"("workspace_id", "updated_at");

-- CreateIndex
CREATE INDEX "gov_doc_opinions_workspace_id_gov_doc_id_idx" ON "gov_doc_opinions"("workspace_id", "gov_doc_id");

-- CreateIndex
CREATE INDEX "gov_doc_exchanges_workspace_id_gov_doc_id_idx" ON "gov_doc_exchanges"("workspace_id", "gov_doc_id");

-- CreateIndex
CREATE INDEX "gov_doc_attachments_workspace_id_gov_doc_id_idx" ON "gov_doc_attachments"("workspace_id", "gov_doc_id");

-- AddForeignKey
ALTER TABLE "gov_docs" ADD CONSTRAINT "gov_docs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gov_docs" ADD CONSTRAINT "gov_docs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gov_doc_opinions" ADD CONSTRAINT "gov_doc_opinions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gov_doc_opinions" ADD CONSTRAINT "gov_doc_opinions_gov_doc_id_fkey" FOREIGN KEY ("gov_doc_id") REFERENCES "gov_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gov_doc_opinions" ADD CONSTRAINT "gov_doc_opinions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gov_doc_exchanges" ADD CONSTRAINT "gov_doc_exchanges_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gov_doc_exchanges" ADD CONSTRAINT "gov_doc_exchanges_gov_doc_id_fkey" FOREIGN KEY ("gov_doc_id") REFERENCES "gov_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gov_doc_exchanges" ADD CONSTRAINT "gov_doc_exchanges_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gov_doc_attachments" ADD CONSTRAINT "gov_doc_attachments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gov_doc_attachments" ADD CONSTRAINT "gov_doc_attachments_gov_doc_id_fkey" FOREIGN KEY ("gov_doc_id") REFERENCES "gov_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
