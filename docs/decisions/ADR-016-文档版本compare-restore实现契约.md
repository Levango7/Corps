# ADR-016: 文档版本 compare/restore 实现契约

> 状态：已采纳（实现契约，backend 侧已按本契约施工）
> 日期：2026-10-13
> 关联：ADR-012（协同降级）、ADR-015（未接线组件登记）、`web/lib/auth.ts`、`web/components/DocumentVersionHistory.tsx`、`server/collab/ARCHIVE-NOTE.md`

## 背景

文档版本历史的前端组件**已写完但后端缺两个路由**：

- `web/components/DocumentVersionHistory.tsx`（约 26KB）已实现版本列表、创建版本、比对与回滚入口
- `web/app/api/v1/workspaces/[wid]/documents/[id]/versions/` 下**只有** `route.ts` 与 `[versionId]/route.ts`，组件调用的 `compare` 与 `{vid}/restore` **均不存在**

在补这两个路由之前，先发现一个**比 404 更严重的问题**：直接按字面实现 `restore`（覆盖 `documents.markdown`）会造成**不可恢复的数据丢失**。

### 丢失链路（逐环节已核实）

| # | 事实 | 证据 |
|---|---|---|
| 1 | 保存由**失焦**触发，非定时器 | `web/components/DocumentEditor.tsx:463` `onBlur={() => save()}`；`web/messages/zh.json:1503` `autosaveHint` = "自动保存：失焦后写入。" |
| 2 | `PATCH /documents/{id}` **不写版本行** | `web/app/api/v1/workspaces/[wid]/documents/[id]/route.ts` 全文 grep `documentVersion` **零命中** |
| 3 | 版本行仅在显式 POST 时创建 | `web/app/api/v1/workspaces/[wid]/documents/[id]/versions/route.ts:166` `tx.documentVersion.create()` |

于是用户「在编辑器里打字 → 直接点回滚」时：

1. 点击按钮**本身触发 blur** → `save()` 发出 PATCH
2. 同时前端发出 `POST versions/{vid}/restore`
3. 两个请求并发到达，谁先落库不确定
4. 无论谁先完成，**用户刚输入的内容都会被目标版本覆盖**
5. 而这段内容**从未写入任何 `document_version` 行** ⇒ 事后无法从版本历史找回

这不是「用户可能忘记保存」的概率风险，是**「打完字不回车就点回滚」必中的确定性丢失**。

## 决策

**`restore` 路由在覆盖内容之前，必须先在同一个事务内为「回滚前的当前内容」建一条自动快照。**

该路由本轮新建，快照逻辑写进去是**零边际成本**——这是根治而非补救。

### 对外契约

```
POST /api/v1/workspaces/{wid}/documents/{id}/versions/{vid}/restore

【全部步骤必须在同一个 runWithWorkspace 事务内，复用现有 GUC 注入与 RLS 上下文，
  不可拆成多个请求或多个事务】

① SELECT ... FOR UPDATE 锁定文档行
   （与 versions/route.ts:152 同款：tx.$queryRaw`SELECT id FROM "documents" WHERE id = ... FOR UPDATE`）
   取 markdown + currentVersion

② 校验目标版本存在且 documentId 匹配（防跨文档越权，参照 files 侧校验写法）

③ 三态判定：
   3a. targetVersion == docLocked.currentVersion
       → no-op，返回 200 { code: 0, data: { alreadyCurrent: true, currentVersion } }
       【不写任何行】
   3b. 否则：
       INSERT document_versions {
         version:      docLocked.currentVersion + 1,
         markdown:     docLocked.markdown,      // 回滚前的当前内容
         source:       "auto",
         snapshotType: "full",
         contentFull:  null,                     // Phase 1 恒为 NULL，见「已知坑」第 3 条
         message:      "回滚前自动快照",          // 让用户在历史里认得出这条
         workspaceId:  wid,
         authorId:     ctx.payload.sub,
       }

④ UPDATE documents SET markdown = targetVersion.markdown

⑤ UPDATE documents SET currentVersion = 新分配的版本号

返回 200 { code: 0, data: { restoredFrom, currentVersion, snapshotVersion } }
     其中 currentVersion 与 snapshotVersion 同为「新分配的那个号」
```

### 为什么不能照搬 files 侧的实现

`web/app/api/v1/workspaces/[wid]/files/[fid]/versions/[vid]/restore/route.ts` 的语义是**指针回退**——注释原文：「回滚不删除后续版本，仅将 FileAsset 指向目标版本的 storageKey，并将 currentVersion 设为目标版本号」。文件本体永不覆盖，因此天然无需快照。

documents 侧是 **`markdown` 原地覆盖**。若照搬指针回退语义：快照 v(N+1) 已建、`currentVersion` 却被设回 N ⇒ 列表按 `orderBy: { version: "desc" }` 排序后 v(N+1) 仍在首条，但语义上它不再被「当前版本」引用，成为 **UI 永远到不了的孤儿行**。

故 documents 侧语义为：**内容覆盖为 v(N)，`currentVersion` 推进到新分配的号，不回退**。这也符合用户心智——「回滚」是内容回到某状态、历史继续向前，不是撤销历史。

## 已知坑（内嵌为硬约束）

以下四条是复核既有实现时发现的、**不写清楚就会实现错**的点：

### 坑 1 · 版本号是 `currentVersion + 1`，不是 `max(version) + 1`

`versions/route.ts:163` `const version = docLocked.currentVersion + 1;`
`:183` `await tx.document.update({ where: { id }, data: { currentVersion: version } });`

**只建快照行而不推进 `currentVersion` 会造成延迟故障**：快照占了 v(N+1) 但计数器仍停在 N，用户下次手动创建版本时又分配 N+1 ⇒ 撞 `web/prisma/schema.prisma:1261` 的 `@@unique([documentId, version], name: "uq_doc_versions_doc_version")`。该故障**只在用户下一次操作时暴露**，不在回滚当场，排查成本高。

### 坑 2 · `source: "auto"` 字段已支持，但前端徽章判据是位置判定

`web/prisma/schema.prisma:1251-1252` 的 `source` 注释已列出 `auto`，`web/messages/zh.json:1587` 的 `sourceAuto` = "自动" 也已存在，`DocumentVersionHistory.tsx:80-81` 已有对应 case ⇒ **自动快照在 UI 上会显示「自动」来源标签，无需新增 i18n 键**。

但 `DocumentVersionHistory.tsx:334` 的徽章判据是 `isLatest={idx === 0}`——**纯列表位置判定**，与 `currentVersion` 和 `source` 都无关。回滚后列表首条是自动快照 v(N+1)，而用户看到的当前内容其实是 v(N) ⇒ **`versionLatest` 徽章会标错行**。

因此本契约附带一项前端修正：**徽章判据改用版本号比对**（`v.version === currentVersion`），并要求 `GET versions` 与 `restore` 响应都带上 `currentVersion`。这不是新增能力——未发生回滚时 `currentVersion` 恰好等于列表首条的 `version`，位置巧合与真实语义一致；修正是把巧合变成语义。

### 坑 3 · `contentFull` 在 Phase 1 恒为 NULL

`versions/route.ts:164-166` 注释：「Phase 1 简化：所有版本存全量快照（snapshotType=full）；contentFull 不传（Json? 字段默认 SQL NULL）；Phase 1 不存 JSON doc（富文本编辑器未集成）」。

自动快照沿用同样处理，**不要试图在自动快照里补 `contentFull`**——富文本编辑器未集成 CRDT，存了也是空。

### 坑 4 · 不可逆迁移与回滚的关系

`prisma migrate deploy` 只前滚不回退。本路由**不引入 schema 变更**（复用既有 `document_versions` 表），故不受此限；但若后续为协同能力改动 schema，须遵守 ADR-014 的拆分发布约束。

## 本次不做（out-of-scope）

- **`compare` 路由**：纯读操作、无数据丢失风险，但本轮不实现。前端对应按钮**必须不渲染**（不是 disabled / 置灰）
- **前端挂载 `DocumentVersionHistory` 入口**：属接线工作，与后端路由**必须同一次上线**
- **协同能力复活**：`server/collab/` 仍为「保留但断开」，见 ADR-012 与其 `ARCHIVE-NOTE.md`
- **`document_versions` 表结构变更**：不新增列、不改类型

## 影响

- 用户点回滚时，回滚前的内容会被自动留存为一个新版本，可在版本历史中回到它
- 版本历史中会出现用户未主动创建的版本（`source: "auto"`，message「回滚前自动快照」）——这是**有意的可见副作用**，确认框文案必须如实说明，不得写成「会丢失且无法恢复」（采用自动快照后内容不会丢，那样写是说谎）
- 新路由必须同步进 `api/openapi.yaml`，否则 `scripts/check_api_contract.py` 会因未声明路由报红

## 验收

```bash
cd web
node node_modules/typescript/bin/tsc --noEmit
npx eslint .
npx vitest run tests/integration          # 既有 [401,403] 断言不得变化
cd .. && for s in check_permission_gates check_write_access_registry \
  check_rls_coverage check_api_contract check_schema_migration_drift; do
  python scripts/$s.py || echo "FAILED: $s"; done
```

另需覆盖三态各自的用例：`alreadyCurrent` no-op 不写行；正常路径建快照 + 覆盖 + 推进；目标版本不存在/不属于该文档时拒绝且不写行。
