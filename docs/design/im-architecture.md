# 独立 IM 会话体系架构设计

> 路线图 P0-1 | 日期：2026-09-20 | 作者：架构设计师  
> 状态：设计文档（只读输出，不含代码修改）

---

## 目录

1. [现状分析](#1-现状分析)
2. [目标架构](#2-目标架构)
3. [数据库模型设计](#3-数据库模型设计)
4. [API 端点设计](#4-api-端点设计)
5. [前端页面设计](#5-前端页面设计)
6. [与现有任务聊天的兼容方案](#6-与现有任务聊天的兼容方案)
7. [迁移策略](#7-迁移策略)
8. [安全与多租户隔离](#8-安全与多租户隔离)
9. [实时通信架构](#9-实时通信架构)

---

## 1. 现状分析

### 1.1 双轨并存的 IM 实现

项目当前存在**两套并行的聊天系统**：

| 维度 | 任务内嵌聊天（旧） | 独立 IM 会话（新） |
|------|-------------------|-------------------|
| **数据模型** | `Message.taskId` 非 null | `Message.conversationId` 非 null |
| **实时通信** | SSE（`chat-events.ts` EventEmitter） | WebSocket（`lib/im/ws-server.ts`） |
| **API 路由** | `/v1/workspaces/{wid}/tasks/{id}/messages/*` | `/v1/workspaces/{wid}/conversations/*` |
| **前端组件** | 任务详情页内嵌聊天面板 | `/w/[wid]/im` 独立页面 + `components/im/*` |
| **已读回执** | `MessageRead` + SSE read 事件 | `ConversationMember.lastReadAt` + WS read 事件 |
| **在线状态** | `ChatPresence.taskId` + SSE presence | `ChatPresence.conversationId` + WS presence |
| **消息搜索** | `/v1/workspaces/{wid}/tasks/{id}/messages/search` | `/v1/im/search`（跨会话全文搜索） |
| **附件支持** | `MessageAttachment`（任务消息） | `MessageAttachment`（会话消息） |
| **编辑/撤回** | ❌ 不支持 | ✅ PATCH/DELETE + WS 广播 |
| **回复/提及** | ❌ 不支持 | ✅ `replyToId` + `mentions` |
| **群聊** | ❌ 不支持 | ✅ `type=group` |

### 1.2 已实现的独立 IM 基础设施

项目已具备相当完善的独立 IM 基础（2026-09-13 迁移 `add_im_conversations` 之后）：

**数据库层**（Prisma schema 第 488-754 行）：
- `Conversation`：会话主表（type=direct/group，title/avatar/description）
- `ConversationMember`：成员关系（role=owner/admin/member，lastReadAt，muted）
- `Message`：统一消息表（taskId + conversationId 双可选外键）
- `MessageRead`：已读记录（messageId + userId 唯一约束）
- `MessageAttachment`：文件附件（workspaceId 租户归属）
- `ChatPresence`：在线状态（taskId + conversationId 双可选）

**API 层**（已实现 7 个路由文件）：
- `GET/POST /v1/workspaces/{wid}/conversations` — 会话列表 + 创建
- `GET/PATCH/DELETE /v1/workspaces/{wid}/conversations/{cid}` — 会话详情/更新/删除
- `GET/POST /v1/workspaces/{wid}/conversations/{cid}/messages` — 消息列表 + 发送
- `PATCH/DELETE /v1/workspaces/{wid}/conversations/{cid}/messages/{mid}` — 编辑/撤回
- `GET/POST /v1/workspaces/{wid}/conversations/{cid}/members` — 成员管理
- `DELETE/PATCH /v1/workspaces/{wid}/conversations/{cid}/members/{uid}` — 移除/角色变更
- `POST /v1/workspaces/{wid}/conversations/{cid}/read` — 标记已读
- `GET /v1/im/search` — 全文搜索
- `GET /v1/im/ws` — WebSocket upgrade 端点

**前端层**（`components/im/` 目录 15 个文件）：
- `IMClient.tsx` — 容器组件（左侧列表 + 右侧聊天窗口）
- `useIM.ts` — 主 Hook（会话/消息状态管理 + WS 订阅）
- `ConversationList.tsx` / `ConversationItem.tsx` — 会话列表
- `ChatWindow.tsx` — 聊天窗口
- `MessageList.tsx` / `MessageItem.tsx` — 消息列表
- `MessageInput.tsx` — 输入框（含附件、@提及、回复）
- `MessageSearch.tsx` — 搜索面板
- `ConversationCreate.tsx` — 创建会话弹窗
- `ConversationSettings.tsx` — 会话设置
- `MentionPopover.tsx` — @提及弹窗
- `FilePreview.tsx` — 文件预览

**实时通信层**：
- `lib/im/ws-server.ts` — WebSocket 连接管理器（单例，455 行）
- `lib/im/types.ts` — WS 消息协议（ClientMessage/ServerMessage 判别联合）
- `lib/chat-events.ts` — SSE EventEmitter（旧任务聊天专用，196 行）

### 1.3 关键缺失与问题

| 问题 | 严重性 | 说明 |
|------|--------|------|
| **conversations 表无 RLS 策略** | 🔴 高 | `db/rls-activate.sql` 未为 `conversations` 和 `conversation_members` 配置 RLS 策略，仅靠应用层 `workspaceId` 过滤，SQL 层无强制隔离 |
| **chat_presences RLS 仅覆盖 task_id 路径** | 🔴 高 | RLS 策略 `p_chat_presences_rls` 仅通过 `task_id → tasks → workspace_id` 路径隔离，`conversation_id` 路径未覆盖 |
| **任务聊天与独立 IM 割裂** | 🟡 中 | 两套系统并存，用户在任务页聊天和 IM 页聊天是分离的，消息无法互通 |
| **SSE 与 WebSocket 双协议维护成本** | 🟡 中 | 任务聊天用 SSE（EventEmitter），独立 IM 用 WebSocket，两套实时推送逻辑需分别维护 |
| **单实例限制** | 🟡 中 | `chat-events.ts` 和 `ws-server.ts` 均为进程内 EventEmitter/Map，多实例部署需 Redis Pub/Sub |
| **消息表 body_tsv 全文索引未覆盖会话消息** | 🟡 中 | `messages_body_tsv` GIN 索引存在，但搜索 API 的 RLS 仅通过 `workspace_id` 过滤，未校验会话成员资格 |
| **Conversation 创建者注销后会话无 owner** | 🟢 低 | `createdBy` 为 nullable，owner 注销后 `SetNull`，但 `ConversationMember.role=owner` 的成员仍在 |

---

## 2. 目标架构

### 2.1 架构愿景

对标飞书/钉钉，构建**统一的 IM 会话体系**，使所有聊天（任务关联、一对一、群组）都在同一套会话框架下运行：

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 IM 模块                              │
│  /w/[wid]/im  ←→  IMClient (ConversationList + ChatWindow)      │
│  /w/[wid]/tasks/[id]  ←→  TaskDetail (内嵌 ChatPanel)           │
│       ↓ 共享 useIM Hook + WS 连接 ↓                              │
├─────────────────────────────────────────────────────────────────┤
│                        API 层                                    │
│  /v1/workspaces/{wid}/conversations/*  ←  统一会话 API           │
│  /v1/workspaces/{wid}/tasks/{id}/messages/*  ←  兼容旧 API       │
│  /v1/im/ws  ←  WebSocket 端点                                    │
│  /v1/im/search  ←  全文搜索                                      │
├─────────────────────────────────────────────────────────────────┤
│                        实时通信层                                 │
│  WebSocket (ws-server.ts)  ←  统一实时推送                        │
│  Redis Pub/Sub (未来)  ←  多实例水平扩展                          │
├─────────────────────────────────────────────────────────────────┤
│                        数据层                                     │
│  Conversation + ConversationMember + Message (统一)              │
│  MessageRead + MessageAttachment + ChatPresence                  │
│  RLS: workspace_id 谓词强制隔离                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心设计原则

1. **会话统一**：所有聊天（任务关联、单聊、群聊）都基于 `Conversation` 模型，通过 `type` 和可选的 `taskId` 外键区分来源
2. **实时统一**：所有聊天实时推送走 WebSocket（`ws-server.ts`），SSE 仅作为兼容降级
3. **API 统一**：任务内嵌聊天页面调用 `/conversations/{cid}/messages` API（而非 `/tasks/{id}/messages`），通过 `Conversation.taskId` 关联任务
4. **RLS 强制**：`conversations`、`conversation_members` 表配置 RLS 策略，SQL 层强制 workspace 隔离
5. **渐进迁移**：保留旧 API 路由兼容现有任务页面，新功能在统一 IM 框架上开发

---

## 3. 数据库模型设计

### 3.1 现有模型（已实现，无需修改）

以下模型已在 `20260913000000_add_im_conversations` 迁移中创建，设计合理，保持不变：

```prisma
// 会话主表 — 单聊/群聊统一模型
model Conversation {
  id            String   @id @default(uuid()) @db.Uuid
  workspaceId   String   @map("workspace_id") @db.Uuid
  type          String   @db.VarChar(20)       // "direct" | "group"
  title         String?  @db.VarChar(200)      // 群名；单聊为 null
  avatar        String?  @db.Text
  description   String?  @db.VarChar(500)
  createdBy     String?  @map("created_by") @db.Uuid
  createdAt     DateTime @default(now()) @db.Timestamptz
  updatedAt     DateTime @updatedAt @db.Timestamptz
  lastMessageAt DateTime? @map("last_message_at") @db.Timestamptz
  // ... relations
}

// 会话成员关系
model ConversationMember {
  id             String   @id @default(uuid()) @db.Uuid
  conversationId String   @map("conversation_id") @db.Uuid
  userId         String   @map("user_id") @db.Uuid
  role           String   @default("member") @db.VarChar(20) // owner|admin|member
  joinedAt       DateTime @default(now()) @db.Timestamptz
  lastReadAt     DateTime? @map("last_read_at") @db.Timestamptz
  muted          Boolean  @default(false)
  // ... relations
}

// 统一消息表 — taskId 和 conversationId 双可选
model Message {
  id             String   @id @default(uuid()) @db.Uuid
  taskId         String?  @map("task_id") @db.Uuid       // 旧：任务内嵌聊天
  conversationId String?  @map("conversation_id") @db.Uuid // 新：独立 IM
  workspaceId    String   @map("workspace_id") @db.Uuid
  authorId       String?  @map("author_id") @db.Uuid
  body           String   @db.Text
  type           String   @default("text") @db.VarChar(20) // text|system|call_*
  isRecalled     Boolean  @default(false)
  editedAt       DateTime? @db.Timestamptz
  revokedAt      DateTime? @db.Timestamptz
  revokedBy      String?   @db.Uuid
  replyToId      String?   @db.Uuid
  mentions       String[]  @default([])
  createdAt      DateTime  @default(now()) @db.Timestamptz
  // ... relations
}

// 已读记录
model MessageRead {
  id        String   @id @default(uuid()) @db.Uuid
  messageId String   @map("message_id") @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  readAt    DateTime @default(now()) @db.Timestamptz
  // ... relations
}

// 文件附件
model MessageAttachment {
  id           String   @id @default(uuid()) @db.Uuid
  messageId    String   @map("message_id") @db.Uuid
  workspaceId  String   @map("workspace_id") @db.Uuid
  fileName     String   @db.VarChar(255)
  fileSize     Int
  fileType     String   @db.VarChar(100)
  url          String   @db.Text
  thumbnailUrl String?  @db.Text
  createdAt    DateTime @default(now()) @db.Timestamptz
  // ... relations
}

// 在线状态
model ChatPresence {
  id             String   @id @default(uuid()) @db.Uuid
  taskId         String?  @map("task_id") @db.Uuid
  conversationId String?  @map("conversation_id") @db.Uuid
  userId         String   @map("user_id") @db.Uuid
  lastSeen       DateTime @default(now()) @db.Timestamptz
  // ... relations
}
```

### 3.2 需要新增的模型字段

#### Conversation 表新增字段

```prisma
model Conversation {
  // ... 现有字段 ...

  // 🆕 关联任务（可选）：type=task 时指向关联的任务
  // 用于任务内嵌聊天迁移到独立 IM 后，保留任务↔会话的关联关系
  taskId         String?  @map("task_id") @db.Uuid

  // 🆕 会话来源标记：区分会话创建来源
  // "manual"=用户手动创建 | "task"=从任务聊天自动迁移 | "system"=系统创建
  source         String   @default("manual") @db.VarChar(20)

  // ... 现有 relations ...
  task           Task?     @relation("TaskConversations", fields: [taskId], references: [id], onDelete: SetNull)
}
```

**设计说明**：
- `taskId`：当任务内嵌聊天迁移到独立 IM 时，每个任务的聊天会创建一个 `type=group`（或 `type=task`）的 Conversation，并通过 `taskId` 关联回任务。这样任务详情页可以嵌入 IM 组件而非独立的聊天面板。
- `source`：标记会话来源，便于迁移期间区分原生 IM 会话和从任务聊天迁移来的会话。
- `onDelete: SetNull`：任务删除时会话保留（与现有 `Message.taskId` 的 `onDelete: Cascade` 不同——迁移后消息挂在 Conversation 上而非 Task 上，所以任务删除不应级联删除会话）。

#### ConversationMember 新增字段（可选，P2 考虑）

```prisma
model ConversationMember {
  // ... 现有字段 ...

  // 🆕 邀请人（可选）：记录是谁邀请此成员加入
  invitedBy      String?  @map("invited_by") @db.Uuid
}
```

### 3.3 需要修改的模型

#### Message 表 — 增加任务关联会话的支持

`Message` 表当前 `taskId` 和 `conversationId` 是互斥的（任务聊天用 taskId，独立 IM 用 conversationId）。迁移后，任务聊天的消息也会挂在 `conversationId` 上，同时保留 `taskId` 作为来源标记（用于在任务详情页筛选关联消息）。

**无需修改 schema**——现有的双可选外键设计已经支持这种模式。迁移后的消息将同时设置 `conversationId`（指向任务关联的 Conversation）和 `taskId`（指向源任务），实现双向关联。

### 3.4 RLS 策略补齐（关键缺失修复）

当前 `conversations` 和 `conversation_members` 表**没有 RLS 策略**，仅靠应用层 `workspaceId` 过滤。需要补齐 SQL 层强制隔离：

```sql
-- conversations: 按 workspace_id 隔离
DROP POLICY IF EXISTS p_conversations_rls ON conversations;
CREATE POLICY p_conversations_rls ON conversations FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- conversation_members: 经 conversation 关联套 workspace_id 谓词
DROP POLICY IF EXISTS p_conversation_members_rls ON conversation_members;
CREATE POLICY p_conversation_members_rls ON conversation_members FOR ALL
  USING (
    conversation_id IN (SELECT c.id FROM conversations c
                        WHERE c.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  )
  WITH CHECK (
    conversation_id IN (SELECT c.id FROM conversations c
                        WHERE c.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  );

-- chat_presences: 扩展 RLS 覆盖 conversation_id 路径
-- 当前仅通过 task_id → tasks → workspace_id 路径隔离
-- 需增加 conversation_id → conversations → workspace_id 路径
DROP POLICY IF EXISTS p_chat_presences_rls ON chat_presences;
CREATE POLICY p_chat_presences_rls ON chat_presences FOR ALL
  USING (
    task_id IN (SELECT t.id FROM tasks t
                WHERE t.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
    OR conversation_id IN (SELECT c.id FROM conversations c
                           WHERE c.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  )
  WITH CHECK (
    task_id IN (SELECT t.id FROM tasks t
                WHERE t.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
    OR conversation_id IN (SELECT c.id FROM conversations c
                           WHERE c.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  );
```

### 3.5 Prisma Schema 变更汇总

| 变更类型 | 模型 | 字段 | 说明 |
|----------|------|------|------|
| 🆕 新增 | Conversation | `taskId String?` | 关联任务（迁移用） |
| 🆕 新增 | Conversation | `source String @default("manual")` | 会话来源标记 |
| 🆕 新增 | Conversation | `task Task? @relation("TaskConversations")` | 任务关系 |
| 🆕 新增 | ConversationMember | `invitedBy String?` | 邀请人（P2） |
| ✏️ 修改 | Task | `conversations Conversation[] @relation("TaskConversations")` | 反向关系 |
| 🔧 RLS | conversations | — | 补齐 workspace_id 谓词 |
| 🔧 RLS | conversation_members | — | 补齐经 conversation 套 workspace_id |
| 🔧 RLS | chat_presences | — | 扩展覆盖 conversation_id 路径 |

---

## 4. API 端点设计

### 4.1 已实现的 API 端点（保持不变）

| 方法 | 路径 | 功能 | 状态 |
|------|------|------|------|
| GET | `/v1/workspaces/{wid}/conversations` | 会话列表（游标分页） | ✅ |
| POST | `/v1/workspaces/{wid}/conversations` | 创建会话（单聊/群聊） | ✅ |
| GET | `/v1/workspaces/{wid}/conversations/{cid}` | 会话详情（含成员+最近消息） | ✅ |
| PATCH | `/v1/workspaces/{wid}/conversations/{cid}` | 更新会话（owner/admin） | ✅ |
| DELETE | `/v1/workspaces/{wid}/conversations/{cid}` | 删除/退出会话 | ✅ |
| GET | `/v1/workspaces/{wid}/conversations/{cid}/messages` | 消息列表（游标分页） | ✅ |
| POST | `/v1/workspaces/{wid}/conversations/{cid}/messages` | 发送消息 | ✅ |
| PATCH | `/v1/workspaces/{wid}/conversations/{cid}/messages/{mid}` | 编辑消息 | ✅ |
| DELETE | `/v1/workspaces/{wid}/conversations/{cid}/messages/{mid}` | 撤回消息 | ✅ |
| GET/POST | `/v1/workspaces/{wid}/conversations/{cid}/members` | 成员列表/添加 | ✅ |
| DELETE/PATCH | `/v1/workspaces/{wid}/conversations/{cid}/members/{uid}` | 移除/角色变更 | ✅ |
| POST | `/v1/workspaces/{wid}/conversations/{cid}/read` | 标记已读 | ✅ |
| GET | `/v1/im/search` | 全文搜索 | ✅ |
| GET | `/v1/im/ws` | WebSocket upgrade | ✅ |

### 4.2 需要新增的 API 端点

#### 4.2.1 任务关联会话 — 自动创建/获取

```
POST /v1/workspaces/{wid}/tasks/{id}/conversation
```

**功能**：为指定任务创建或获取关联的 Conversation。  
**行为**：
- 若任务已有关联的 Conversation（`Conversation.taskId = id`），直接返回
- 若没有，创建一个 `type=group`、`source=task` 的 Conversation，自动将任务指派人 + 创建者加入为成员
- 会话标题默认为任务标题

**请求体**：无（自动从任务信息生成）  
**响应**：`{ code: 201, data: Conversation }`

**设计理由**：任务详情页内嵌聊天迁移到统一 IM 框架后，需要一个 API 来桥接任务↔会话的关联。前端在打开任务详情页时调用此 API 获取/创建关联会话，然后用 `/conversations/{cid}/messages` API 加载消息。

#### 4.2.2 会话未读总数

```
GET /v1/workspaces/{wid}/conversations/unread-count
```

**功能**：获取当前用户在所有会话中的未读消息总数。  
**用途**：顶部导航栏的 IM 图标显示未读徽标（如飞书/钉钉的红色数字）。

**响应**：`{ code: 200, data: { totalUnread: number, byConversation: [{ conversationId, unreadCount }] } }`

#### 4.2.3 附件上传

```
POST /v1/workspaces/{wid}/conversations/{cid}/messages/attachments
```

**功能**：上传文件/图片附件，返回 URL 后再随消息发送。  
**请求体**：`multipart/form-data`（文件 + 可选 thumbnail）  
**响应**：`{ code: 201, data: { id, fileName, url, fileType, fileSize, thumbnailUrl } }`

**设计理由**：当前附件上传逻辑内嵌在消息发送 API 中（`POST /messages` 的 `attachments` 字段传 URL），缺少独立的文件上传端点。前端需要先上传文件获取 URL，再在消息中引用。

#### 4.2.4 会话消息流（SSE 兼容降级）

```
GET /v1/workspaces/{wid}/conversations/{cid}/messages/stream
```

**功能**：为不支持 WebSocket 的环境（如 Serverless 部署）提供 SSE 降级方案。  
**设计**：复用 `chat-events.ts` 的 EventEmitter 模式，但通道命名改为 `conversation:${cid}`。

**设计理由**：当前任务聊天用 SSE、独立 IM 用 WebSocket。统一后，SSE 作为 WebSocket 的降级备选，确保部署灵活性。

### 4.3 API 端点变更汇总

| 状态 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 🆕 新增 | POST | `/v1/workspaces/{wid}/tasks/{id}/conversation` | 任务关联会话获取/创建 |
| 🆕 新增 | GET | `/v1/workspaces/{wid}/conversations/unread-count` | 未读总数 |
| 🆕 新增 | POST | `/v1/workspaces/{wid}/conversations/{cid}/messages/attachments` | 附件上传 |
| 🆕 新增 | GET | `/v1/workspaces/{wid}/conversations/{cid}/messages/stream` | SSE 降级 |
| ✏️ 修改 | POST | `/v1/workspaces/{wid}/conversations` | 增加 `taskId` + `source` 字段 |
| ✏️ 修改 | GET | `/v1/workspaces/{wid}/conversations` | 增加 `type=task` 过滤参数 |

---

## 5. 前端页面设计

### 5.1 已实现的前端页面

**独立 IM 页面**（`/w/[wid]/im` 和 `/w/[wid]/im/[cid]`）：

```
┌──────────────────────────────────────────────────────────┐
│  顶栏（工作区切换 + 导航）                                 │
├────────────────┬─────────────────────────────────────────┤
│                │                                         │
│  会话列表       │  聊天窗口                                │
│  (左侧 280px)  │  (右侧 flex-1)                           │
│                │                                         │
│  ┌──────────┐  │  ┌─────────────────────────────────┐    │
│  │ 搜索按钮  │  │  │ 会话标题栏（成员/设置）          │    │
│  │ 创建按钮  │  │  ├─────────────────────────────────┤    │
│  └──────────┘  │  │                                 │    │
│                │  │  消息列表（正序时间线）          │    │
│  ┌──────────┐  │  │  - 消息气泡（头像/名字/时间）    │    │
│  │ 会话 1   │  │  │  - 回复引用                      │    │
│  │ 未读 3   │  │  │  - @提及高亮                     │    │
│  ├──────────┤  │  │  - 编辑/撤回标记                 │    │
│  │ 会话 2   │  │  │  - 附件预览                      │    │
│  │          │  │  │  - 正在输入指示                  │    │
│  ├──────────┤  │  │                                 │    │
│  │ 会话 3   │  │  ├─────────────────────────────────┤    │
│  │ 未读 1   │  │  │  输入框（附件/提及/回复）        │    │
│  └──────────┘  │  └─────────────────────────────────┘    │
│                │                                         │
└────────────────┴─────────────────────────────────────────┘
```

### 5.2 需要新增/修改的前端组件

#### 5.2.1 任务详情页内嵌 IM 组件

当前任务详情页使用独立的聊天面板（SSE 轮询），需要改为嵌入统一 IM 组件：

```tsx
// 新组件：TaskChatPanel.tsx
// 替换任务详情页中的旧聊天面板

interface TaskChatPanelProps {
  workspaceId: string;
  taskId: string;
  currentUserId: string;
}

// 内部逻辑：
// 1. 调用 POST /tasks/{id}/conversation 获取/创建关联会话
// 2. 用 useIM hook 的 selectConversation 加载消息
// 3. 复用 ChatWindow + MessageList + MessageInput 组件
// 4. 不显示会话列表（单会话模式）
```

**布局**：

```
任务详情页
┌──────────────────────────────────────────────────────────┐
│  任务标题 / 状态 / 指派人                                  │
├──────────────────────────────┬───────────────────────────┤
│                              │                           │
│  任务内容 / 描述 / 子任务     │  TaskChatPanel            │
│                              │  (嵌入 ChatWindow)        │
│                              │                           │
│                              │  ┌─────────────────────┐  │
│                              │  │ 消息列表            │  │
│                              │  │ ...                 │  │
│                              │  ├─────────────────────┤  │
│                              │  │ 输入框              │  │
│                              │  └─────────────────────┘  │
│                              │                           │
└──────────────────────────────┴───────────────────────────┘
```

#### 5.2.2 顶栏 IM 未读徽标

```tsx
// 新组件：IMBadge.tsx
// 在顶栏导航中显示 IM 未读总数

// 轮询 GET /conversations/unread-count（30s 间隔）
// 或通过 WebSocket 实时更新（收到非当前会话消息时 +1）
// 显示：红色圆点（有未读）或数字（未读 > 0）
// 点击跳转 /w/[wid]/im
```

#### 5.2.3 前端组件变更汇总

| 状态 | 组件 | 路径 | 说明 |
|------|------|------|------|
| 🆕 新增 | `TaskChatPanel` | `components/im/TaskChatPanel.tsx` | 任务详情页内嵌 IM |
| 🆕 新增 | `IMBadge` | `components/shell/IMBadge.tsx` | 顶栏未读徽标 |
| ✏️ 修改 | `useIM` | `components/im/useIM.ts` | 增加 `selectTaskConversation` 方法 |
| ✏️ 修改 | `IMClient` | `components/im/IMClient.tsx` | 支持 `singleConversation` 模式 |
| 🗑️ 废弃 | 旧任务聊天面板 | 任务详情页内嵌组件 | 迁移后移除 |

---

## 6. 与现有任务聊天的兼容方案

### 6.1 兼容策略：双写过渡 + 读取统一

迁移采用**双写过渡**策略，确保零停机迁移：

```
阶段 1（当前）：任务聊天用 taskId，独立 IM 用 conversationId
阶段 2（迁移期）：新消息同时写入 taskId + conversationId（双写）
阶段 3（迁移后）：任务聊天消息仅写 conversationId，taskId 保留为来源标记
```

### 6.2 任务↔会话关联映射

每个有聊天记录的任务，在迁移时自动创建一个关联的 Conversation：

```
Task (id: task-123)
  ↓ POST /tasks/{id}/conversation
Conversation (id: conv-456, type: "group", source: "task", taskId: task-123)
  ↓ ConversationMember (任务指派人 + 创建者)
  ↓ Message (conversationId: conv-456, taskId: task-123) ← 双写
```

### 6.3 旧 API 兼容

保留 `/v1/workspaces/{wid}/tasks/{id}/messages/*` API 路由，内部改为代理到 `/conversations/{cid}/messages`：

```
GET /tasks/{id}/messages
  → 内部查找 Conversation where taskId = id
  → 代理到 GET /conversations/{cid}/messages
  → 返回格式不变（向后兼容）

POST /tasks/{id}/messages
  → 内部查找/创建 Conversation where taskId = id
  → 代理到 POST /conversations/{cid}/messages
  → 同时写入 taskId（双写标记）
```

### 6.4 SSE → WebSocket 迁移

任务聊天的 SSE 端点（`/tasks/{id}/messages/stream`）保留但标记为 deprecated。新前端代码统一使用 WebSocket：

```
旧路径：任务详情页 → SSE /tasks/{id}/messages/stream → chat-events EventEmitter
新路径：任务详情页 → WebSocket /im/ws → ws-server.ts → subscribe(cid)
```

`chat-events.ts` 的 EventEmitter 保留作为 SSE 降级方案，但所有新功能开发基于 WebSocket。

---

## 7. 迁移策略

### 7.1 分阶段实施计划

#### 阶段 0：安全补齐（P0，1-2 天）

**目标**：补齐 RLS 策略，消除数据隔离漏洞。

| 步骤 | 内容 | 影响范围 |
|------|------|----------|
| 0.1 | 为 `conversations` 表添加 RLS 策略 | `db/rls-activate.sql` |
| 0.2 | 为 `conversation_members` 表添加 RLS 策略 | `db/rls-activate.sql` |
| 0.3 | 扩展 `chat_presences` RLS 覆盖 `conversation_id` 路径 | `db/rls-activate.sql` |
| 0.4 | 将 `conversations`、`conversation_members` 加入 `FORCE RLS` 表列表 | `db/rls-activate.sql` |

**验证**：跨工作区查询 conversations/conversation_members 返回空结果。

#### 阶段 1：Schema 扩展 + 任务关联会话 API（P0，3-5 天）

**目标**：扩展 Conversation 模型支持任务关联，实现桥接 API。

| 步骤 | 内容 | 影响范围 |
|------|------|----------|
| 1.1 | Prisma schema 添加 `Conversation.taskId` + `source` 字段 | `web/prisma/schema.prisma` |
| 1.2 | 生成 + 执行 Prisma migration | `web/prisma/migrations/` |
| 1.3 | 实现 `POST /tasks/{id}/conversation` API | 新 route 文件 |
| 1.4 | 修改 `POST /conversations` 支持 `taskId` + `source` 参数 | 现有 route 文件 |
| 1.5 | 修改 `GET /conversations` 支持 `type=task` 过滤 | 现有 route 文件 |

**验证**：调用 `POST /tasks/{id}/conversation` 能创建/返回关联会话。

#### 阶段 2：前端任务详情页迁移（P0，5-7 天）

**目标**：任务详情页内嵌聊天从旧 SSE 方案迁移到统一 IM 组件。

| 步骤 | 内容 | 影响范围 |
|------|------|----------|
| 2.1 | 实现 `TaskChatPanel` 组件 | `components/im/TaskChatPanel.tsx` |
| 2.2 | 修改 `useIM` 增加 `selectTaskConversation` 方法 | `components/im/useIM.ts` |
| 2.3 | 修改 `IMClient` 支持 `singleConversation` 模式 | `components/im/IMClient.tsx` |
| 2.4 | 替换任务详情页中的旧聊天面板 | 任务详情页组件 |
| 2.5 | 实现 `IMBadge` 顶栏未读徽标 | `components/shell/IMBadge.tsx` |

**验证**：任务详情页聊天功能与独立 IM 页面体验一致（WebSocket 实时推送、编辑/撤回、@提及、附件）。

#### 阶段 3：历史数据迁移（P1，2-3 天）

**目标**：将现有任务聊天历史消息迁移到关联的 Conversation。

| 步骤 | 内容 | 影响范围 |
|------|------|----------|
| 3.1 | 编写迁移脚本：为每个有聊天记录的任务创建关联 Conversation | `scripts/migrate-task-chats.ts` |
| 3.2 | 迁移脚本：将 `Message.taskId` 非 null 且 `conversationId` 为 null 的消息，设置 `conversationId` 为关联会话 ID | 同上 |
| 3.3 | 迁移脚本：将任务指派人 + 创建者加入为 ConversationMember | 同上 |
| 3.4 | 迁移脚本：回填 `Conversation.lastMessageAt` | 同上 |
| 3.5 | 迁移脚本验证：对比迁移前后消息总数、会话数 | 同上 |

**迁移脚本伪代码**：

```typescript
// scripts/migrate-task-chats.ts
async function migrateTaskChats() {
  // 1. 查找所有有聊天记录的任务
  const tasksWithChats = await prisma.task.findMany({
    where: { messages: { some: { conversationId: null } } },
    include: { _count: { select: { messages: true } } },
  });

  for (const task of tasksWithChats) {
    // 2. 为每个任务创建关联 Conversation
    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: task.workspaceId,
        type: "group",
        title: task.title,
        source: "task",
        taskId: task.id,
        createdBy: task.createdBy,
        members: {
          create: [
            { userId: task.assigneeId, role: "member" },
            { userId: task.createdBy, role: "owner" },
          ].filter(m => m.userId),
        },
      },
    });

    // 3. 将该任务的消息关联到 Conversation
    await prisma.message.updateMany({
      where: { taskId: task.id, conversationId: null },
      data: { conversationId: conversation.id },
    });

    // 4. 更新 Conversation.lastMessageAt
    const lastMessage = await prisma.message.findFirst({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
    });
    if (lastMessage) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: lastMessage.createdAt },
      });
    }
  }
}
```

#### 阶段 4：旧 API 代理 + SSE 废弃（P1，3-5 天）

**目标**：旧 API 内部代理到新 API，SSE 标记 deprecated。

| 步骤 | 内容 | 影响范围 |
|------|------|----------|
| 4.1 | 修改 `GET /tasks/{id}/messages` 内部代理到 `/conversations/{cid}/messages` | 现有 route 文件 |
| 4.2 | 修改 `POST /tasks/{id}/messages` 内部代理 + 双写 taskId | 现有 route 文件 |
| 4.3 | 修改 `PATCH /tasks/{id}/messages/read` 代理到 `/conversations/{cid}/read` | 现有 route 文件 |
| 4.4 | SSE 端点 `/tasks/{id}/messages/stream` 标记 deprecated header | 现有 route 文件 |
| 4.5 | 实现 `GET /conversations/{cid}/messages/stream` SSE 降级端点 | 新 route 文件 |

#### 阶段 5：清理 + 移除旧代码（P2，2-3 天）

**目标**：移除旧的任务聊天代码路径。

| 步骤 | 内容 | 影响范围 |
|------|------|----------|
| 5.1 | 移除旧任务聊天前端组件 | 任务详情页 |
| 5.2 | 移除 `chat-events.ts`（SSE EventEmitter） | `web/lib/chat-events.ts` |
| 5.3 | 移除 `/tasks/{id}/messages/stream` SSE 端点 | 现有 route 文件 |
| 5.4 | 移除 `/tasks/{id}/messages/send` 独立发送端点 | 现有 route 文件 |
| 5.5 | 更新文档和 API 规范 | `docs/` |

### 7.2 迁移时间线

```
阶段 0 (安全补齐)     ──── 1-2 天 ────→  ✅ 完成
阶段 1 (Schema+API)   ──── 3-5 天 ────→  ✅ 完成
阶段 2 (前端迁移)     ──── 5-7 天 ────→  ✅ 完成
阶段 3 (数据迁移)     ──── 2-3 天 ────→  ✅ 完成
阶段 4 (旧API代理)    ──── 3-5 天 ────→  ✅ 完成
阶段 5 (清理移除)     ──── 2-3 天 ────→  ✅ 完成
                                        总计：16-25 天
```

### 7.3 回滚方案

每个阶段都有独立的回滚路径：

| 阶段 | 回滚方法 |
|------|----------|
| 0 | 移除新增的 RLS 策略（`DROP POLICY`） |
| 1 | Prisma migration down（回滚 `taskId`/`source` 字段） |
| 2 | 恢复旧任务聊天组件（git revert） |
| 3 | 将消息的 `conversationId` 设回 null（`UPDATE messages SET conversation_id = NULL WHERE task_id IS NOT NULL`） |
| 4 | 恢复旧 API 的原始实现（git revert） |
| 5 | 不可回滚（旧代码已移除）——需确保阶段 1-4 充分验证后再执行 |

---

## 8. 安全与多租户隔离

### 8.1 RLS 策略覆盖矩阵

| 表 | 当前 RLS | 需要补齐 | 隔离路径 |
|----|----------|----------|----------|
| `messages` | ✅ 已有 | — | `workspace_id` 直接谓词 |
| `message_attachments` | ✅ 已有 | — | `workspace_id` 直接谓词 |
| `message_reads` | ✅ 已有 | — | 经 `message_id → messages → workspace_id` |
| `chat_presences` | ✅ 已有（仅 task 路径） | 🔴 需扩展 | 需增加 `conversation_id → conversations → workspace_id` |
| `conversations` | ❌ 缺失 | 🔴 需新增 | `workspace_id` 直接谓词 |
| `conversation_members` | ❌ 缺失 | 🔴 需新增 | 经 `conversation_id → conversations → workspace_id` |

### 8.2 应用层安全

现有 API 路由的安全模式（保持不变）：

1. **认证**：`getWorkspaceContext(req, wid)` 验证 JWT + 工作区成员资格
2. **授权**：`runWithWorkspace(wid, fn, userId)` 注入 GUC（`app.workspace_id` + `app.user_id`）
3. **成员校验**：每个会话操作前验证 `ConversationMember` 存在性
4. **角色校验**：owner/admin 操作（更新会话、移除成员）前验证角色
5. **限流**：SSE 连接建立限流（20 次/分钟）+ 单用户并发上限（5 连接）

### 8.3 WebSocket 安全

`ws-server.ts` 的安全机制（保持不变）：

1. **Upgrade 认证**：从 httpOnly cookie 提取 `access_token` 验证 JWT
2. **订阅校验**：`handleSubscribe` 查 `ConversationMember` 表确认成员资格
3. **跨会话防护**：订阅前 DB 校验，防止跨会话窃听
4. **消息排除**：广播时排除发送者（`excludeUserId`），避免回声

---

## 9. 实时通信架构

### 9.1 当前双协议状态

```
任务聊天：客户端 ←SSE→ chat-events.ts (EventEmitter) ←→ /tasks/{id}/messages/stream
独立 IM：客户端 ←WS→  ws-server.ts (IMConnectionManager) ←→ /im/ws
```

### 9.2 目标统一架构

```
所有聊天：客户端 ←WS→ ws-server.ts (IMConnectionManager) ←→ /im/ws
  ↓ 降级
所有聊天：客户端 ←SSE→ conversation-events.ts (EventEmitter) ←→ /conversations/{cid}/messages/stream
```

### 9.3 WebSocket 连接管理器（已实现，保持不变）

`IMConnectionManager`（`lib/im/ws-server.ts`）的核心设计：

- **三张映射表**：`userSockets`（userId → sockets）、`socketConversations`（socket → cids）、`conversationSockets`（cid → sockets）
- **预认证**：WebSocket upgrade 时从 cookie 验证 JWT，跳过 auth 消息步骤
- **订阅模型**：客户端 `subscribe(cid)` → 服务端验证成员资格 → 加入双向索引
- **广播模型**：`broadcastToConversation(cid, msg, excludeUserId)` → 遍历订阅者推送
- **在线状态**：`broadcastPresence(userId, online)` → 向用户参与的所有会话广播

### 9.4 多实例扩展路径

当前单实例限制（`EventEmitter` + 进程内 `Map`），升级路径明确：

```
单实例（当前）                    多实例（未来）
EventEmitter → Redis Pub/Sub
Map<userId, sockets> → Redis Hash + 本地 Map（本地连接 + Redis 跨实例广播）
broadcastToConversation → redis.publish(`conversation:${cid}`, msg)
```

接口设计已预留升级路径（`emitChatEvent`/`broadcastToConversation` 的调用方无需改动）。

### 9.5 chat-events.ts 的未来角色

迁移完成后，`chat-events.ts` 的 EventEmitter 不再用于任务聊天 SSE。但它可以改造为**会话级 SSE 降级方案**的基础：

```
当前：chatChannel(taskId) → `chat:${taskId}`
未来：conversationChannel(cid) → `conversation:${cid}`
```

SSE 降级端点 `/conversations/{cid}/messages/stream` 的实现将复用 `chat-events.ts` 的模式（EventEmitter + RAII acquireSseSlot + subscribeChatEvents），但通道命名改为 `conversation:${cid}`。

---

## 附录 A：文件清单

### 已实现的关键文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `web/prisma/schema.prisma` (L488-754) | ~270 | IM 相关 Prisma 模型定义 |
| `web/lib/chat-events.ts` | 196 | SSE EventEmitter（旧任务聊天） |
| `web/lib/im/ws-server.ts` | 455 | WebSocket 连接管理器（独立 IM） |
| `web/lib/im/types.ts` | 138 | WS 消息协议类型定义 |
| `web/app/api/v1/workspaces/[wid]/conversations/route.ts` | 283 | 会话列表 + 创建 API |
| `web/app/api/v1/workspaces/[wid]/conversations/[cid]/route.ts` | 262 | 会话详情/更新/删除 API |
| `web/app/api/v1/workspaces/[wid]/conversations/[cid]/messages/route.ts` | 383 | 消息列表 + 发送 API |
| `web/app/api/v1/workspaces/[wid]/conversations/[cid]/messages/[mid]/route.ts` | 283 | 编辑/撤回消息 API |
| `web/app/api/v1/workspaces/[wid]/conversations/[cid]/members/route.ts` | ~220 | 成员列表/添加 API |
| `web/app/api/v1/workspaces/[wid]/conversations/[cid]/members/[uid]/route.ts` | ~270 | 移除/角色变更 API |
| `web/app/api/v1/workspaces/[wid]/conversations/[cid]/read/route.ts` | ~96 | 标记已读 API |
| `web/app/api/v1/im/search/route.ts` | 216 | 全文搜索 API |
| `web/app/api/v1/im/ws/route.ts` | 260 | WebSocket upgrade 端点 |
| `web/components/im/IMClient.tsx` | 278 | IM 容器组件 |
| `web/components/im/useIM.ts` | ~500 | IM 主 Hook |
| `web/components/im/types.ts` | 119 | 前端类型定义 |
| `web/app/[locale]/w/[wid]/im/page.tsx` | 21 | IM 主页面 |
| `web/app/[locale]/w/[wid]/im/[cid]/page.tsx` | — | IM 会话详情页面 |
| `web/app/api/v1/workspaces/[wid]/tasks/[id]/messages/route.ts` | 146 | 旧任务聊天消息 API |
| `web/app/api/v1/workspaces/[wid]/tasks/[id]/messages/stream/route.ts` | 237 | 旧任务聊天 SSE 端点 |
| `web/app/api/v1/workspaces/[wid]/tasks/[id]/messages/read/route.ts` | 106 | 旧任务聊天已读 API |
| `web/prisma/migrations/20260913000000_add_im_conversations/migration.sql` | ~130 | IM 会话模型迁移 |
| `db/rls-activate.sql` (L134-185) | — | messages/message_attachments/chat_presences RLS |

### 需要新增的文件

| 文件 | 职责 |
|------|------|
| `web/app/api/v1/workspaces/[wid]/tasks/[id]/conversation/route.ts` | 任务关联会话 API |
| `web/app/api/v1/workspaces/[wid]/conversations/unread-count/route.ts` | 未读总数 API |
| `web/app/api/v1/workspaces/[wid]/conversations/[cid]/messages/attachments/route.ts` | 附件上传 API |
| `web/app/api/v1/workspaces/[wid]/conversations/[cid]/messages/stream/route.ts` | SSE 降级端点 |
| `web/components/im/TaskChatPanel.tsx` | 任务详情页内嵌 IM |
| `web/components/shell/IMBadge.tsx` | 顶栏未读徽标 |
| `scripts/migrate-task-chats.ts` | 历史数据迁移脚本 |

---

## 附录 B：与飞书/钉钉的功能对标

| 功能 | 飞书 | 钉钉 | corps 现状 | corps 目标 |
|------|------|------|-----------|-----------|
| 独立会话列表 | ✅ | ✅ | ✅ 已实现 | ✅ |
| 一对一聊天 | ✅ | ✅ | ✅ 已实现 | ✅ |
| 群组聊天 | ✅ | ✅ | ✅ 已实现 | ✅ |
| 任务关联聊天 | ✅ | ✅ | ⚠️ 旧 SSE 方案 | ✅ 统一到 IM |
| 已读回执 | ✅ ✓✓ | ✅ ✓✓ | ✅ 已实现 | ✅ |
| 消息搜索 | ✅ | ✅ | ✅ 已实现 | ✅ |
| 文件/图片附件 | ✅ | ✅ | ✅ 已实现 | ✅ |
| 消息编辑/撤回 | ✅ | ✅ | ✅ 已实现 | ✅ |
| @提及 | ✅ | ✅ | ✅ 已实现 | ✅ |
| 正在输入 | ✅ | ✅ | ✅ 已实现 | ✅ |
| 在线状态 | ✅ | ✅ | ✅ 已实现 | ✅ |
| 回复引用 | ✅ | ✅ | ✅ 已实现 | ✅ |
| 顶栏未读徽标 | ✅ | ✅ | ❌ 缺失 | 🆕 阶段 2 |
| 消息免打扰 | ✅ | ✅ | ✅ `muted` 字段 | ✅ |
| 多端同步 | ✅ | ✅ | ✅ WS 多设备 | ✅ |
| 通话邀请 | ✅ | ✅ | ⚠️ `type=call_*` 预留 | P2 |

---

> **文档结束** | 本设计文档基于对项目代码库的全面分析（Prisma schema、API 路由、前端组件、WS 服务器、RLS 策略、迁移历史），输出为只读设计文档，不含代码修改。