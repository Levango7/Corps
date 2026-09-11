# 云文档在线编辑 — 功能设计方案

> **文档版本**: v1.0  
> **创建日期**: 2026-09-12  
> **技术栈**: Next.js 16 + React 19 + Tailwind v4 + Prisma + better-auth + Stripe  
> **状态**: 设计评审中  
> **关联文件**: `web/components/DocumentEditor.tsx` · `web/prisma/schema.prisma` · `api/openapi.yaml`

---

## 1. 概述

### 1.1 目标与愿景

当前 corps 平台的文档编辑器（`DocumentEditor.tsx`，1007 行）是一个**纯 textarea + Markdown 预览**方案，无富文本编辑、无实时协同、无知识库结构、无版本历史、无行内评论。该方案在 MVP 阶段验证了"决策记录 + Markdown"的可用性，但随着团队协作深化，已无法满足以下核心诉求：

| 痛点 | 现状 | 目标 |
|------|------|------|
| 编辑体验 | 纯 textarea，无格式化工具栏联动 | 富文本所见即所得 + Markdown 双模式 |
| 知识组织 | 文档平铺列表，无层级 | 空间 → 文件夹 → 文档树，拖拽排序 |
| 协同编辑 | 单人编辑，无冲突处理 | 多人实时协同，CRDT 自动合并 |
| 版本追溯 | 仅 publishedMarkdown 快照，无历史 | 完整版本历史 + 对比 + 回滚 |
| 行内讨论 | 无 | 行内批注 + 讨论 + 解决 |
| 多维数据 | 无 | Notion 式多维表格（表格/看板/甘特/日历） |
| 文件管理 | 仅消息附件 | 独立云盘 + 预览 + 版本管理 |

**愿景**: 将 corps 文档从"单人 Markdown 笔记"升级为"AI 原生的团队知识协作中枢"，形成 **文档 → 决策 → 任务** 的闭环。

### 1.2 差异化定位（vs 飞书）

飞书文档是成熟的团队协作工具，正面竞争无胜算。corps 的差异化在于三个维度：

#### 1.2.1 AI 原生 — 文档内嵌 AI 助手

corps 已有 AI 对话基础（`web/components/` 下已有 AI 对话组件）。将 AI 能力嵌入文档编辑器：

- **续写**: 光标处 AI 续写，Tab 接受 / Esc 拒绝
- **摘要**: 选中段落 → AI 生成摘要插入
- **翻译**: 选中文本 → AI 翻译（中/英/日）
- **格式化**: 选中杂乱文本 → AI 整理为结构化列表
- **问答**: 文档上下文感知的 AI 问答（"这段讲的什么？""帮我补充风险分析"）

飞书虽有 AI，但 corps 的优势在于 **AI 与决策系统联动**：AI 可从文档自动提取决策项、生成行动项、关联任务。

#### 1.2.2 决策驱动 — 文档 → 决策 → 任务闭环

corps 已有完整的决策系统（`Decision` + `DecisionVersion` + `DecisionActionItem` 模型）。文档与决策的闭环：

- 文档内 `> [decision]` 标记自动创建决策记录
- 决策的行动项自动关联到任务看板
- 文档可嵌入任务/决策的实时状态卡片
- 文档的"决策摘要"可一键同步到决策系统

这是飞书不具备的——飞书是通用文档工具，corps 是**决策驱动型协作平台**。

#### 1.2.3 Markdown + 富文本双模式 — 开发者友好

飞书是纯富文本，对开发者不友好。corps 提供：

- **富文本模式**（默认）: TipTap 所见即所得，适合非技术用户
- **Markdown 模式**: 纯文本编辑 + 实时预览（保留现有 textarea 体验），适合开发者
- **一键切换**: 两种模式共享同一 JSON doc 数据模型，切换无损
- **快捷键兼容**: Markdown 模式保留现有 `useEditorKeys`（Ctrl+B/I/K、列表续行、Tab 缩进）

### 1.3 技术选型

| 领域 | 选型 | 理由 |
|------|------|------|
| 富文本编辑器 | **TipTap v2** | 基于 ProseMirror，最成熟的 React 富文本框架；原生支持 Yjs 协同（`y-prosemirror`）；扩展生态丰富；JSON doc 数据模型便于存储 |
| CRDT | **Yjs** | 最成熟的 CRDT 库；`y-prosemirror` 与 TipTap 无缝集成；支持离线编辑 + 自动合并 |
| 协同服务端 | **y-websocket**（自托管） | 官方 WebSocket provider；可部署为独立 Node 服务；支持持久化到 PostgreSQL |
| 离线存储 | **IndexedDB**（via `y-indexeddb`） | 浏览器原生；离线编辑自动缓存；重连后自动合并 |
| 多维表格 | **自研** | 参考 Notion Database 设计；无成熟开源方案同时满足表格/看板/甘特/日历四视图 |
| 版本对比 | **diff-match-patch** + ProseMirror `diff` 插件 | 文本级 diff + 结构化 doc diff |
| 文件存储 | 复用现有 `/uploads` + S3 兼容 | 已有 `MessageAttachment` 存储方案，复用基础设施 |
| 实时通信 | **WebSocket**（y-websocket） | 已有 IM 轮询方案可过渡，Phase 2 统一升级为 WebSocket |

#### 依赖兼容性验证

| 依赖 | 版本 | 与现有栈兼容性 |
|------|------|----------------|
| `@tiptap/react` | ^2.6 | React 19 兼容（TipTap 2.6+ 官方支持 React 19） |
| `@tiptap/starter-kit` | ^2.6 | 无冲突 |
| `yjs` | ^13.6 | 无冲突 |
| `y-prosemirror` | ^1.2 | 与 TipTap 2.x 匹配 |
| `y-websocket` | ^2.0 | 服务端独立部署，不影响 Next.js |
| `y-indexeddb` | ^9.0 | 浏览器端，无冲突 |
| `lib0` | ^0.2 | Yjs 依赖，无冲突 |

---

## 2. Phase 1: 云文档基础增强（2-3 周）

### 2.1 富文本编辑器

#### 2.1.1 技术选型：TipTap v2 + 扩展

**核心包**:
```
@tiptap/react @tiptap/pm @tiptap/starter-kit
@tiptap/extension-image @tiptap/extension-table @tiptap/extension-task-list
@tiptap/extension-link @tiptap/extension-placeholder @tiptap/extension-mention
@tiptap/extension-code-block-lowlight @tiptap/extension-color @tiptap/extension-text-align
```

**自定义扩展**:
- `MermaidExtension`: 复用现有 `QuickDiagram` 的 Mermaid 渲染能力，在富文本中嵌入 ```mermaid 代码块并实时渲染
- `DecisionMarkExtension`: `> [decision]` 标记，点击可关联到决策系统
- `TaskEmbedExtension`: 嵌入任务实时状态卡片（复用现有 Task 模型）
- `MentionExtension`: @提及用户（复用现有 Comment mentions 机制）

#### 2.1.2 数据模型：JSON doc → Prisma 存储

TipTap 使用 ProseMirror JSON doc 作为内部数据模型。存储策略：

```prisma
model Document {
  // ... 现有字段保留 ...
  markdown        String   @default("") @db.Text    // 保留：Markdown 模式数据 + 向下兼容
  /// 富文本 JSON doc（TipTap ProseMirror 格式）；null = 纯 Markdown 文档（向下兼容）
  content         Json?    @map("content")          // 新增：富文本模式数据
  /// 编辑模式偏好：richtext | markdown；用户上次使用的模式
  editMode        String   @default("richtext") @map("edit_mode") @db.VarChar(20)  // 新增
}
```

**双模式数据同步策略**:

```
┌─────────────┐    serialize    ┌──────────────┐
│  RichText   │ ──────────────→ │  JSON doc    │ ──→ content (Json)
│  (TipTap)   │ ←────────────── │  (ProseMirror)│
└─────────────┘    deserialize   └──────────────┘
        │                                │
        │          markdownify           │ markdownSerialize
        │ ──────────────────────────────→ │ ──→ markdown (Text)
        │          parseMarkdown          │
        │ ←────────────────────────────── │
┌─────────────┐                  ┌──────────────┐
│  Markdown   │ ──── parse ─────→ │  JSON doc    │
│  (textarea) │ ←── serialize ─── │              │
└─────────────┘                  └──────────────┘
```

- **富文本 → Markdown**: `prosemirror-markdown` serializer，损失信息（颜色、对齐）存入 JSON doc 的 `attrs`，Markdown 仅保留语义结构
- **Markdown → 富文本**: 复用现有 `markdown-it` parser，映射到 ProseMirror doc
- **模式切换**: 切换时以 JSON doc 为单一数据源，Markdown 字段为派生缓存
- **向下兼容**: 现有文档 `content = null`，首次打开时自动从 `markdown` 字段 parse 为 JSON doc 并回写

#### 2.1.3 编辑器功能列表

| 功能 | TipTap 扩展 | 快捷键 | 说明 |
|------|-------------|--------|------|
| 标题 H1-H3 | StarterKit.Heading | Ctrl+Alt+1/2/3 | |
| 粗体/斜体/删除线 | StarterKit.BasicMarks | Ctrl+B/I/Shift+X | 复用现有 `useEditorKeys` |
| 有序/无序列表 | StarterKit.Lists | Ctrl+Shift+7/8 | |
| 任务列表 | TaskList + TaskItem | Ctrl+Shift+9 | 复选框可勾选 |
| 代码块 | CodeBlockLowlight | Ctrl+Alt+C | 语法高亮（lowlight） |
| 引用 | StarterKit.Blockquote | Ctrl+Shift+B | |
| 链接 | Link | Ctrl+K | 复用现有快捷键 |
| 图片 | Image | 拖拽粘贴 | 上传到 /uploads，复用现有附件存储 |
| 表格 | Table + TableRow + TableCell + TableHeader | 工具栏按钮 | 支持合并单元格 |
| 分割线 | StarterKit.HorizontalRule | --- | |
| 文字颜色 | Color + TextStyle | 工具栏 | |
| 对齐 | TextAlign | 工具栏 | left/center/right/justify |
| @提及 | Mention | @ | 弹出用户列表 |
| Mermaid 图表 | MermaidExtension（自定义） | 工具栏 | 复用现有 QuickDiagram |
| 决策标记 | DecisionMarkExtension（自定义） | > [decision] | 关联决策系统 |
| 任务嵌入 | TaskEmbedExtension（自定义） | /task | 嵌入任务卡片 |
| 撤销/重做 | StarterKit.History | Ctrl+Z/Y | |
| 搜索替换 | 自定义扩展 | Ctrl+F | |
| 占位提示 | Placeholder | — | "输入 / 唤起命令菜单" |

#### 2.1.4 Markdown 兼容策略（双模式切换）

**命令菜单（Slash Menu）**: 输入 `/` 唤起命令面板，复用现有 `--z-cmd` 层级：

```
/ heading    → 标题
/ table      → 表格
/ code       → 代码块
/ mermaid    → Mermaid 图表
/ task       → 任务嵌入
/ decision   → 决策标记
/ image      → 图片上传
/ divider    → 分割线
```

**Markdown 快捷输入**（TipTap InputRule）:
- `# ` → H1, `## ` → H2, `### ` → H3
- `- ` → 无序列表, `1. ` → 有序列表, `[] ` → 任务列表
- `> ` → 引用, ``` ``` → 代码块
- `---` → 分割线

这确保从 Markdown 模式切到富文本模式的用户无需学习新交互。

#### 2.1.5 与现有 DocumentEditor 的迁移方案

**渐进式迁移**（不破坏现有功能）:

```
Phase 1a（第 1 周）:
  ┌─ DocumentEditor.tsx（保留，加模式切换按钮）
  │   ├─ mode === "markdown" → 现有 textarea 逻辑（不动）
  │   └─ mode === "richtext" → <RichTextEditor />（新组件）
  └─ RichTextEditor.tsx（新增）

Phase 1b（第 2 周）:
  - 默认模式切换为 richtext
  - 现有 markdown 字段数据自动 parse 为 JSON doc
  - 分享/导出/模板插入等功能在新组件中重新实现

Phase 1c（第 3 周）:
  - 删除 textarea 分支（保留 markdown 模式但用 TipTap 的 codeView）
  - DocumentEditor.tsx 简化为薄封装
```

**保留的现有能力**（在新组件中重新实现）:
- 分享对话框（`openShareDialog` / `saveShareSettings` / `revokeShare`）→ 提取为 `useDocumentShare` hook
- 导出预览（`ExportPreview`）→ 复用
- 模板插入（`ACTION_TEMPLATES`）→ 适配富文本插入
- 快捷图表（`QuickDiagram`）→ 适配 MermaidExtension
- 自动保存（onBlur）→ 改为 debounce 500ms + onBlur 双触发

**Design Token 规范**（所有新组件强制使用，禁止裸 hex）:

```tsx
// ✅ 正确：使用 design token
<div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)]">

// ❌ 错误：裸 hex
<div className="rounded-[10px] border border-[#E5E5E0] bg-[#FEFEFC]">
```

编辑器工具栏样式规范：
```tsx
// 工具栏容器
<div className="sticky top-0 z-[var(--z-sticky)] flex items-center gap-[var(--space-1)] 
     border-b border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] 
     py-[var(--space-2)]">

// 工具栏按钮
<button className="inline-flex h-[var(--control-h-sm)] w-[var(--control-h-sm)] 
     items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] 
     hover:bg-[var(--surface-2)] hover:text-[var(--fg-2)] 
     transition-colors duration-[var(--motion-fast)]
     focus-visible:outline-none focus-visible:ring-[var(--focus-ring)]">
```

---

### 2.2 知识库结构

#### 2.2.1 数据模型：Space → Folder → Document 层级

```
Workspace
  └─ Space（空间）           # 知识库顶层容器，如"产品文档"、"技术文档"、"团队规范"
       └─ Folder（文件夹）    # 可嵌套（最多 5 层），支持拖拽排序
            └─ Document       # 现有 Document 模型，新增 folderId 关联
```

**设计决策**:
- **Space 而非多 root**: 一个 Workspace 可有多个 Space（如产品/技术/HR 各一个），Space 间隔离权限
- **Folder 可嵌套但限深**: 最多 5 层，防止无限嵌套导致 UI 崩溃和 URL 过长
- **Document 可跨 Folder 移动**: 支持拖拽移动文档到其他文件夹
- **排序用 sortOrder Float**: 复用现有 Task 的 `sortOrder` 方案，拖拽时取相邻均值

#### 2.2.2 Prisma schema 变更

```prisma
/// 知识库空间：Workspace 下的顶层文档容器
model Space {
  id          String   @id @default(uuid()) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  name        String   @db.VarChar(100)
  /// 空间图标（Lucide 图标名，如 "book" / "code" / "users"）
  icon        String   @default("book") @db.VarChar(50)
  /// 排序值（拖拽排序）
  sortOrder   Float    @default(0) @map("sort_order")
  /// 空间颜色（CSS 变量或 hex，用于图标着色）
  color       String   @default("var(--accent)") @db.VarChar(50)
  createdAt   DateTime @default(now()) @db.Timestamptz @map("created_at")
  updatedAt   DateTime @updatedAt @db.Timestamptz @map("updated_at")

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  folders   Folder[]
  documents Document[]  // 空间根目录下的文档（folderId = null）

  @@unique([workspaceId, name], name: "uq_spaces_workspace_name")
  @@index([workspaceId, sortOrder])
  @@map("spaces")
}

/// 文件夹：Space 下的文档组织单元，可嵌套（最多 5 层）
model Folder {
  id          String   @id @default(uuid()) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  spaceId     String   @map("space_id") @db.Uuid
  /// 父文件夹 ID（null = 空间根目录）；自关联，最多 5 层嵌套
  parentId    String?  @map("parent_id") @db.Uuid
  name        String   @db.VarChar(100)
  /// 图标（Lucide 图标名，默认 folder）
  icon        String   @default("folder") @db.VarChar(50)
  /// 排序值（同层级内拖拽排序）
  sortOrder   Float    @default(0) @map("sort_order")
  /// 是否默认展开（目录树 UI 状态）
  expanded    Boolean  @default(true)
  createdAt   DateTime @default(now()) @db.Timestamptz @map("created_at")
  updatedAt   DateTime @updatedAt @db.Timestamptz @map("updated_at")

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  space     Space     @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  parent    Folder?   @relation("FolderChildren", fields: [parentId], references: [id], onDelete: Cascade)
  children  Folder[]  @relation("FolderChildren")
  documents Document[]

  @@index([spaceId, parentId, sortOrder])
  @@index([workspaceId])
  @@map("folders")
}
```

**Document 模型变更**（增量字段，不破坏现有数据）:

```prisma
model Document {
  // ... 现有所有字段保留 ...
  
  /// 知识库空间 ID（新增；null = 迁移期未归类文档，UI 显示在"未分类"区）
  spaceId       String?  @map("space_id") @db.Uuid
  /// 所属文件夹 ID（新增；null = 空间根目录下的文档）
  folderId      String?  @map("folder_id") @db.Uuid
  /// 同层级排序值（新增；拖拽排序）
  sortOrder     Float    @default(0) @map("sort_order")
  /// 文档图标（新增；Lucide 图标名，默认 file-text）
  icon          String   @default("file-text") @db.VarChar(50)
  /// 文档 emoji 封面（新增；可选，用于文档列表视觉区分）
  emoji         String?  @db.VarChar(10)

  // ... 关联 ...
  space    Space?   @relation(fields: [spaceId], references: [id], onDelete: SetNull)
  folder   Folder?  @relation(fields: [folderId], references: [id], onDelete: SetNull)

  // ... 现有索引保留 ...
  /// 知识库目录树查询：按空间 + 文件夹 + 排序
  @@index([spaceId, folderId, sortOrder])
  @@map("documents")
}
```

**迁移策略**:
1. `prisma migrate dev` 生成迁移：`ALTER TABLE documents ADD COLUMN space_id UUID NULL`（可安全在线执行）
2. 现有文档 `spaceId = null`、`folderId = null`，UI 显示在"未分类"虚拟空间中
3. 提供批量归类工具：管理员可将未分类文档拖入 Space/Folder
4. **不破坏现有 API**: `GET /documents` 仍返回所有文档（含未分类），新增 `GET /spaces/{sid}/documents` 按空间筛选

#### 2.2.3 API 设计

遵循现有 OpenAPI 风格（`/api/v1/workspaces/{wid}/...`，`{ code, data, message }` envelope）:

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/workspaces/{wid}/spaces` | 列出工作区所有空间（含文件夹树） |
| POST | `/api/v1/workspaces/{wid}/spaces` | 创建空间 |
| PATCH | `/api/v1/workspaces/{wid}/spaces/{sid}` | 更新空间（名称/图标/颜色/排序） |
| DELETE | `/api/v1/workspaces/{wid}/spaces/{sid}` | 删除空间（文档移至未分类） |
| POST | `/api/v1/workspaces/{wid}/spaces/{sid}/folders` | 创建文件夹 |
| PATCH | `/api/v1/workspaces/{wid}/folders/{fid}` | 更新文件夹（名称/图标/排序/展开） |
| DELETE | `/api/v1/workspaces/{wid}/folders/{fid}` | 删除文件夹（子文件夹/文档移至父级） |
| PATCH | `/api/v1/workspaces/{wid}/folders/reorder` | 批量重排文件夹（拖拽） |
| PATCH | `/api/v1/workspaces/{wid}/documents/{id}/move` | 移动文档到指定空间/文件夹 |
| GET | `/api/v1/workspaces/{wid}/spaces/{sid}/tree` | 获取空间完整目录树（文件夹 + 文档） |

**请求/响应示例**（创建空间）:

```yaml
POST /api/v1/workspaces/{wid}/spaces
  requestBody:
    required: true
    content:
      application/json:
        schema:
          type: object
          required: [name]
          properties:
            name: { type: string, minLength: 1, maxLength: 100 }
            icon: { type: string, default: "book" }
            color: { type: string, default: "var(--accent)" }
  responses:
    '201':
      content:
        application/json:
          schema:
            type: object
            properties:
              code: { type: integer, example: 201 }
              data:
                type: object
                properties:
                  id: { type: string, format: uuid }
                  name: { type: string }
                  icon: { type: string }
                  color: { type: string }
                  sortOrder: { type: number }
```

**目录树响应**（`GET /spaces/{sid}/tree`）:

```json
{
  "code": 200,
  "data": {
    "space": { "id": "...", "name": "产品文档", "icon": "book", "color": "var(--accent)" },
    "tree": [
      {
        "type": "folder",
        "id": "...",
        "name": "需求文档",
        "icon": "folder",
        "expanded": true,
        "sortOrder": 0,
        "children": [
          {
            "type": "document",
            "id": "...",
            "title": "v1.0 需求规格",
            "icon": "file-text",
            "emoji": "📋",
            "sortOrder": 0,
            "updatedAt": "2026-09-12T..."
          }
        ]
      },
      {
        "type": "document",
        "id": "...",
        "title": "产品路线图",
        "sortOrder": 1
      }
    ]
  }
}
```

#### 2.2.4 UI 设计（目录树 + 拖拽排序）

**布局**（三栏式，复用现有 `--sidebar-w` token）:

```
┌─────────────┬──────────────────────────┬──────────────────┐
│  目录树      │  文档编辑区               │  右侧面板（可选）  │
│  (240px)    │  (flex-1)                │  (320px)         │
│             │                          │                  │
│  📁 产品文档  │  [富文本编辑器]            │  [文档信息]       │
│   📂 需求    │                          │  [版本历史]       │
│    📄 v1.0  │                          │  [评论列表]       │
│   📂 设计    │                          │                  │
│  📁 技术文档  │                          │                  │
│   📄 架构    │                          │                  │
│             │                          │                  │
│  ─────────  │                          │                  │
│  + 新建空间  │                          │                  │
└─────────────┴──────────────────────────┴──────────────────┘
```

**目录树组件**（`KnowledgeTree.tsx`）:

```tsx
<aside className="w-[var(--sidebar-w)] shrink-0 border-r border-[var(--border)] 
     bg-[var(--shell-sidebar)] overflow-y-auto">
  {/* 空间列表 */}
  <div className="p-[var(--space-2)]">
    {spaces.map(space => (
      <SpaceNode key={space.id} space={space} />
    ))}
  </div>
  {/* 新建空间按钮 */}
  <button className="w-full px-[var(--space-3)] py-[var(--space-2)] 
     text-[length:var(--text-sm)] text-[var(--muted)] 
     hover:bg-[var(--surface-2)] hover:text-[var(--fg-2)]">
    <Plus size={var(--icon-sm)} /> 新建空间
  </button>
</aside>
```

**拖拽排序**: 使用 `@dnd-kit/core` + `@dnd-kit/sortable`（React 19 兼容）:
- 文件夹/文档可拖拽改变层级和排序
- 跨空间拖拽文档（移动 spaceId + folderId）
- 拖拽时显示插入指示线（`border-t-2 border-[var(--accent)]`）
- 释放后调用 `PATCH /documents/{id}/move` 或 `PATCH /folders/reorder`

---

### 2.3 文档版本历史

#### 2.3.1 版本快照策略

参考现有 `DecisionVersion` 模型（决策版本留痕机制），为文档引入版本历史。

**快照触发策略**:

| 触发条件 | 说明 |
|----------|------|
| 手动发布 | `publish=true` 时创建版本快照（复用现有发布语义） |
| 显式创建版本 | 用户点击"创建版本"按钮，附版本说明 |
| 定时自动快照 | 每 30 分钟若有变更则自动创建（可配置） |
| 协同会话结束 | Phase 2：WebSocket 断开时创建快照 |

**存储优化**:
- 不存全量 JSON doc，而是存 **增量 diff**（基于上一个版本的 `diff-match-patch`）
- 首个版本存全量，后续版本存 diff
- 读取时从最近全量版本 + 增量 diff 重建
- 全量快照每 10 个版本强制一次（防止 diff 链过长）

#### 2.3.2 Prisma schema

```prisma
/// 文档版本历史快照
model DocumentVersion {
  id          String   @id @default(uuid()) @db.Uuid
  documentId  String   @map("document_id") @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  /// 版本号（递增）
  version     Int
  /// 版本类型：full（全量快照）| diff（增量差分）
  snapshotType String  @map("snapshot_type") @db.VarChar(10) // full | diff
  /// 全量快照（snapshotType=full 时）：完整 JSON doc
  contentFull  Json?   @map("content_full")
  /// 增量 diff（snapshotType=diff 时）：相对上一版本的 diff
  contentDiff  String? @map("content_diff") @db.Text
  /// 该版本的 Markdown 序列化（用于版本对比展示）
  markdown     String  @db.Text
  /// 版本说明（用户输入，可选）
  message      String? @db.VarChar(255)
  /// 版本来源：publish（发布）| manual（手动）| auto（自动）| collaborative（协同）
  source       String   @default("manual") @db.VarChar(20)
  authorId     String?  @map("author_id") @db.Uuid
  createdAt    DateTime @default(now()) @db.Timestamptz @map("created_at")

  document  Document  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  author    User?     @relation(fields: [authorId], references: [id], onDelete: SetNull)

  @@unique([documentId, version], name: "uq_doc_versions_doc_version")
  @@index([documentId, createdAt])
  @@index([workspaceId])
  @@map("document_versions")
}
```

Document 模型新增字段:
```prisma
model Document {
  // ... 现有字段 ...
  /// 当前版本号（新增；每次创建版本递增）
  currentVersion Int    @default(0) @map("current_version")
  
  versions DocumentVersion[]
}
```

#### 2.3.3 API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/workspaces/{wid}/documents/{id}/versions` | 列出版本历史（分页） |
| POST | `/api/v1/workspaces/{wid}/documents/{id}/versions` | 创建版本快照（手动） |
| GET | `/api/v1/workspaces/{wid}/documents/{id}/versions/{vid}` | 获取特定版本详情 |
| GET | `/api/v1/workspaces/{wid}/documents/{id}/versions/compare` | 对比两个版本（`?from=v1&to=v2`） |
| POST | `/api/v1/workspaces/{wid}/documents/{id}/versions/{vid}/restore` | 回滚到指定版本 |

**版本对比响应**:

```json
{
  "code": 200,
  "data": {
    "from": { "version": 3, "createdAt": "...", "author": { "name": "Alice" } },
    "to": { "version": 5, "createdAt": "...", "author": { "name": "Bob" } },
    "diff": {
      "added": ["## 新增章节\n\n这是 v5 新增的内容..."],
      "removed": ["这段在 v5 被删除了"],
      "modified": [
        { "before": "旧标题", "after": "新标题", "line": 12 }
      ]
    },
    "stats": { "additions": 15, "deletions": 3, "modifications": 2 }
  }
}
```

#### 2.3.4 UI 设计（版本对比/回滚）

**版本历史面板**（右侧面板，复用 `--z-modal` 层级）:

```tsx
<div className="fixed inset-y-0 right-0 w-[400px] border-l border-[var(--border)] 
     bg-[var(--surface)] shadow-[var(--elev-lg)] z-[var(--z-modal)]">
  <div className="border-b border-[var(--border)] px-[var(--space-4)] 
       py-[var(--space-3)]">
    <h3 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] 
         text-[var(--fg)]">版本历史</h3>
  </div>
  {/* 版本列表 */}
  <div className="overflow-y-auto">
    {versions.map(v => (
      <div className="border-b border-[var(--border-soft)] px-[var(--space-4)] 
           py-[var(--space-3)] hover:bg-[var(--surface-2)]">
        <div className="flex items-center justify-between">
          <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)]">
            v{v.version}
          </span>
          <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
            {formatRelative(v.createdAt)}
          </span>
        </div>
        <p className="text-[length:var(--text-xs)] text-[var(--muted)]">
          {v.author?.name} · {v.message || "无说明"}
        </p>
        <div className="mt-[var(--space-2)] flex gap-[var(--space-2)]">
          <button>查看</button>
          <button>对比</button>
          <button>回滚</button>
        </div>
      </div>
    ))}
  </div>
</div>
```

**版本对比视图**: 左右分栏 diff 展示，新增行 `bg-[var(--success-soft)]`，删除行 `bg-[var(--danger-soft)]`，修改行 `bg-[var(--warn-soft)]`。

---

### 2.4 文档评论

#### 2.4.1 行内批注数据模型

```prisma
/// 文档行内批注（评论）
model DocumentComment {
  id          String   @id @default(uuid()) @db.Uuid
  documentId  String   @map("document_id") @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  /// 批注锚点：ProseMirror 节点路径（如 "1.2.0"），定位到具体段落/文本
  anchorPath  String   @map("anchor_path") @db.VarChar(100)
  /// 批注锚点文本片段（用于锚点失效时模糊匹配）
  anchorText  String   @map("anchor_text") @db.Text
  /// 批注内容（Markdown）
  body        String   @db.Text
  /// @提及的用户 ID 列表
  mentions    String[] @default([])
  /// 父评论 ID（讨论线程：首条评论 + 回复）
  parentId    String?  @map("parent_id") @db.Uuid
  /// 是否已解决
  resolved    Boolean  @default(false)
  /// 解决者
  resolvedBy  String?  @map("resolved_by") @db.Uuid
  resolvedAt  DateTime? @map("resolved_at") @db.Timestamptz
  authorId    String?  @map("author_id") @db.Uuid
  createdAt   DateTime @default(now()) @db.Timestamptz @map("created_at")
  updatedAt   DateTime @updatedAt @db.Timestamptz @map("updated_at")

  document  Document  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  parent    DocumentComment? @relation("CommentReplies", fields: [parentId], references: [id], onDelete: Cascade)
  replies   DocumentComment[] @relation("CommentReplies")
  author    User?     @relation(fields: [authorId], references: [id], onDelete: SetNull)
  resolver  User?     @relation("CommentResolver", fields: [resolvedBy], references: [id], onDelete: SetNull)

  @@index([documentId, anchorPath])
  @@index([documentId, resolved])
  @@index([workspaceId])
  @@map("document_comments")
}
```

**锚点策略**:
- `anchorPath`: ProseMirror 节点路径（如 `1.2.0` 表示 doc → content[1] → content[2] → content[0]）
- `anchorText`: 锚点处文本片段（前 100 字符），用于文档编辑后锚点漂移时的模糊匹配
- **锚点漂移处理**: 文档编辑后，通过 ProseMirror `Mapping` 追踪位置变化，更新 `anchorPath`；若节点被删除，批注标记为"孤儿"（orphaned），UI 显示"原文已删除"

#### 2.4.2 API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/workspaces/{wid}/documents/{id}/comments` | 列出文档评论（含讨论线程） |
| POST | `/api/v1/workspaces/{wid}/documents/{id}/comments` | 创建批注（body + anchorPath + anchorText） |
| PATCH | `/api/v1/workspaces/{wid}/documents/{id}/comments/{cid}` | 编辑批注 / 回复 |
| POST | `/api/v1/workspaces/{wid}/documents/{id}/comments/{cid}/resolve` | 解决批注 |
| POST | `/api/v1/workspaces/{wid}/documents/{id}/comments/{cid}/reopen` | 重新打开批注 |
| DELETE | `/api/v1/workspaces/{wid}/documents/{id}/comments/{cid}` | 删除批注 |

#### 2.4.3 UI 设计

**行内批注高亮**: 选中文本 → 浮动工具栏出现"批注"按钮 → 创建批注后，被批注文本添加黄色背景标记:

```tsx
// ProseMirror Mark: comment
// 被批注的文本渲染为：
<span className="bg-[var(--warn-soft)] border-b-2 border-[var(--warn)] 
     cursor-pointer hover:bg-[color-mix(in_srgb,var(--warn)_20%,transparent)]">
  {text}
</span>
```

**批注侧边栏**（右侧面板，与版本历史互斥）:

```tsx
<div className="w-[320px] border-l border-[var(--border)] bg-[var(--surface)]">
  {/* 未解决批注 */}
  {comments.filter(c => !c.resolved).map(comment => (
    <div className="border-b border-[var(--border-soft)] p-[var(--space-3)]">
      {/* 头像 + 用户名 + 时间 */}
      <div className="flex items-center gap-[var(--space-2)]">
        <Avatar src={comment.author.image} size={var(--icon-md)} />
        <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)]">
          {comment.author.name}
        </span>
        <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
          {formatRelative(comment.createdAt)}
        </span>
      </div>
      {/* 批注引用的原文 */}
      <blockquote className="mt-[var(--space-2)] border-l-2 border-[var(--warn)] 
           pl-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--muted)]">
        {comment.anchorText}
      </blockquote>
      {/* 批注内容 */}
      <Markdown className="mt-[var(--space-2)] text-[length:var(--text-sm)]">
        {comment.body}
      </Markdown>
      {/* 回复线程 */}
      {comment.replies.map(reply => (
        <div className="ml-[var(--space-4)] mt-[var(--space-2)]">
          {/* ... */}
        </div>
      ))}
      {/* 操作按钮 */}
      <div className="mt-[var(--space-2)] flex gap-[var(--space-3)]">
        <button className="text-[length:var(--text-xs)] text-[var(--muted)] 
             hover:text-[var(--accent)]">回复</button>
        <button className="text-[length:var(--text-xs)] text-[var(--muted)] 
             hover:text-[var(--success)]">解决</button>
      </div>
    </div>
  ))}
</div>
```

---

## 3. Phase 2: 实时协同编辑（3-4 周）

### 3.1 CRDT 框架

#### 3.1.1 Yjs 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                    浏览器（客户端）                       │
│                                                          │
│  ┌──────────────┐     ┌──────────────┐                 │
│  │  TipTap      │ ←→  │  Yjs Doc     │                 │
│  │  Editor      │     │  (Y.XmlFrag) │                 │
│  └──────────────┘     └──────┬───────┘                 │
│                              │                          │
│              ┌───────────────┼───────────────┐         │
│              │               │               │         │
│     ┌────────┴──────┐ ┌─────┴──────┐ ┌──────┴──────┐  │
│     │ WebSocket     │ │ IndexedDB  │ │ Awareness   │  │
│     │ Provider      │ │ Provider   │ │ (光标/选区)  │  │
│     │ (y-websocket) │ │(y-indexeddb)│ │             │  │
│     └────────┬──────┘ └────────────┘ └─────────────┘  │
│              │                                          │
└──────────────┼──────────────────────────────────────────┘
               │ WSS
┌──────────────┼──────────────────────────────────────────┐
│              │          协同服务端（独立部署）             │
│     ┌────────┴──────┐                                   │
│     │ y-websocket   │                                   │
│     │ Server        │                                   │
│     └────────┬──────┘                                   │
│              │                                          │
│     ┌────────┴──────┐                                   │
│     │ Yjs Doc       │ ← 内存中的 CRDT 文档副本           │
│     │ (per document)│                                   │
│     └────────┬──────┘                                   │
│              │                                          │
│     ┌────────┴──────┐                                   │
│     │ PostgreSQL    │ ← 持久化 Yjs state vector         │
│     │ yjs_persistence│                                   │
│     └───────────────┘                                   │
└─────────────────────────────────────────────────────────┘
```

**Yjs 文档结构**:

```typescript
import * as Y from 'yjs';

const ydoc = new Y.Doc();

// 文档内容：ProseMirror JSON doc 的 CRDT 映射
const yFragment = ydoc.get('prosemirror', Y.XmlFragment);

// 元数据：文档标题、最后编辑者等
const yMeta = ydoc.getMap('meta');
yMeta.set('title', document.title);

// Awareness：在线用户状态（光标/选区/头像/颜色）
// 由 y-prosemirror 的 Awareness 管理自动同步
```

#### 3.1.2 服务端：y-websocket 部署

**独立 Node.js 服务**（不嵌入 Next.js，避免 Serverless 冷启动丢失内存状态）:

```typescript
// server/collab/y-websocket-server.ts
import { WebSocketServer } from 'ws';
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils';
import { PrismaYjsPersistence } from './persistence';

const wss = new WebSocketServer({ port: 1234 });
const persistence = new PrismaYjsPersistence(process.env.DATABASE_URL);

setPersistence(persistence);

wss.on('connection', (conn, req) => {
  // URL: /collab/{documentId}?wid={workspaceId}&token={jwt}
  const url = new URL(req.url, 'http://localhost');
  const documentId = url.pathname.split('/').pop();
  const token = url.searchParams.get('token');

  // 验证 JWT + 工作区成员权限
  if (!verifyAccess(token, documentId)) {
    conn.close(4001, 'Unauthorized');
    return;
  }

  setupWSConnection(conn, req, { docName: documentId });
});
```

**Prisma 持久化**（Yjs state vector 存入 PostgreSQL）:

```prisma
/// Yjs 协同文档持久化（CRDT state vector）
model YjsPersistence {
  id          String   @id @default(uuid()) @db.Uuid
  /// 文档 ID（关联 Document）
  documentId  String   @map("document_id") @db.Uuid
  /// Yjs 二进制状态（Y.encodeStateAsUpdate）
  state       Bytes    @db.Bytea
  /// 最后更新时间
  updatedAt   DateTime @updatedAt @db.Timestamptz @map("updated_at")

  @@unique([documentId])
  @@map("yjs_persistence")
}
```

**部署方案**:
- Docker Compose 新增 `collab` 服务（复用现有 `docker-compose.yml`）
- 端口 1234（内部），通过 Nginx 反代 `/collab` → `wss://collab:1234`
- 环境变量 `COLLAB_WS_URL` 供前端连接

#### 3.1.3 客户端：TipTap + y-prosemirror 集成

```typescript
// web/components/RichTextEditor/collab.ts
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCursor } from '@tiptap/extension-collaboration-cursor';

function createCollabExtensions(documentId: string, user: User) {
  const ydoc = new Y.Doc();

  // 离线持久化（IndexedDB）
  const indexeddbProvider = new IndexeddbPersistence(`doc-${documentId}`, ydoc);

  // WebSocket 协同
  const wsProvider = new WebsocketProvider(
    process.env.NEXT_PUBLIC_COLLAB_WS_URL,
    documentId,
    ydoc,
    { params: { token: getAccessToken() } }
  );

  return [
    // 协同编辑（CRDT 同步文档内容）
    Collaboration.configure({
      document: ydoc,
      field: 'prosemirror',
    }),
    // 协同光标（Awareness 同步光标/选区/用户信息）
    CollaborationCursor.configure({
      provider: wsProvider,
      user: {
        name: user.name,
        color: getUserColor(user.id), // 基于用户 ID 哈希生成稳定颜色
        avatar: user.image,
      },
    }),
  ];
}
```

### 3.2 协同编辑

#### 3.2.1 实时光标/选区

**光标颜色分配**: 基于用户 ID 哈希生成稳定颜色，复用 design token 色板:

```typescript
const CURSOR_COLORS = [
  'var(--accent)',      // 蓝
  'var(--success)',     // 绿
  'var(--warn)',        // 黄
  'var(--danger)',      // 红
  '#8B5CF6',            // 紫
  '#EC4899',            // 粉
  '#14B8A6',            // 青
  '#F97316',            // 橙
];

function getUserColor(userId: string): string {
  const hash = userId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}
```

**光标渲染**（TipTap CollaborationCursor 自动渲染）:

```css
/* 协同光标样式（使用 design token） */
.collaboration-cursor__caret {
  border-left: 2px solid;
  border-left-color: var(--user-color);
  margin-left: -1px;
  margin-right: -1px;
  pointer-events: none;
  position: relative;
  word-break: normal;
}

.collaboration-cursor__label {
  border-radius: var(--radius-sm) var(--radius-sm) var(--radius-sm) 0;
  border-color: var(--user-color);
  background: var(--user-color);
  color: var(--on-accent);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  left: -1px;
  padding: var(--space-1) var(--space-2);
  position: absolute;
  top: -1.4em;
  user-select: none;
  white-space: nowrap;
}
```

#### 3.2.2 冲突自动合并

Yjs CRDT 保证 **无冲突自动合并**，无需 OT（Operational Transformation）的中央服务器协调:

- **并发插入**: CRDT 保证两个并发插入最终收敛到相同状态
- **并发删除**: CRDT 保证删除幂等，不会"复活"已删除内容
- **并发修改同一字符**: CRDT 按 operation ID 的 timestamp + clientID 排序，最后写入胜出（LWW）

**无需额外冲突解决代码**——这是 CRDT 的数学保证。

#### 3.2.3 性能优化

| 优化项 | 方案 |
|--------|------|
| 大文档分块 | Yjs 自动分块，单次 sync 仅传 delta update |
| WebSocket 消息压缩 | 启用 `permessage-deflate` |
| 更新节流 | `y-prosemirror` 默认 100ms 合并编辑操作 |
| 惰性加载 | 文档打开时先从 IndexedDB 加载离线缓存，再 sync 增量 |
| 内存回收 | 服务端定期 `Y.encodeStateAsUpdate` + 清理旧 update log |
| 连接复用 | 同一用户多个文档共享 WebSocket 连接（y-websocket multiplexing） |

### 3.3 Presence

#### 3.3.1 在线状态/头像/光标颜色

**Awareness 协议**（Yjs 内置，无需自研）:

```typescript
// 客户端自动广播 awareness state
wsProvider.setAwarenessField('user', {
  name: user.name,
  color: getUserColor(user.id),
  avatar: user.image,
  // 光标位置由 CollaborationCursor 扩展自动维护
});

// 监听其他用户上下线
wsProvider.awareness.on('change', () => {
  const onlineUsers = Array.from(wsProvider.awareness.getStates().values())
    .filter(state => state.user);
  setOnlineUsers(onlineUsers);
});
```

**在线状态 UI**（编辑器右上角头像堆叠）:

```tsx
<div className="flex items-center gap-[var(--space-1)]">
  {onlineUsers.slice(0, 5).map(user => (
    <div className="relative">
      <Avatar src={user.avatar} size={28}
        className="ring-2 ring-[var(--surface)]" />
      {/* 在线指示点 */}
      <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 
           rounded-full bg-[var(--success)] ring-2 ring-[var(--surface)]" />
    </div>
  ))}
  {onlineUsers.length > 5 && (
    <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
      +{onlineUsers.length - 5}
    </span>
  )}
</div>
```

### 3.4 离线同步

#### 3.4.1 IndexedDB 本地缓存

```typescript
const indexeddbProvider = new IndexeddbPersistence(`doc-${documentId}`, ydoc);

// 离线时：编辑操作写入 IndexedDB
// 上线时：IndexedDB 数据自动与 WebSocket sync 合并
indexeddbProvider.on('synced', () => {
  console.log('离线数据已加载，耗时', performance.now() - start);
});
```

#### 3.4.2 重连合并策略

```
离线编辑流程:
1. 用户离线 → WebSocket 断开 → IndexedDB 持续接收编辑操作
2. 用户上线 → WebSocket 重连 → y-websocket 自动 sync
3. Yjs CRDT 自动合并离线/在线操作 → 无冲突收敛
4. 合并完成 → 广播 awareness "已同步"
```

**UI 状态指示**:

```tsx
{connectionStatus === 'offline' && (
  <span className="inline-flex items-center gap-[var(--space-1)] 
       text-[length:var(--text-xs)] text-[var(--warn)]">
    <WifiOff size={12} /> 离线编辑中，上线后自动同步
  </span>
)}
{connectionStatus === 'syncing' && (
  <span className="inline-flex items-center gap-[var(--space-1)] 
       text-[length:var(--text-xs)] text-[var(--muted)]">
    <Loader2 size={12} className="animate-spin" /> 同步中...
  </span>
)}
{connectionStatus === 'online' && (
  <span className="inline-flex items-center gap-[var(--space-1)] 
       text-[length:var(--text-xs)] text-[var(--success)]">
    <Check size={12} /> 已同步
  </span>
)}
```

---

## 4. Phase 3: 多维表格（2-3 周）

### 4.1 表格引擎

#### 4.1.1 数据模型

多维表格（Database）是 Notion 式的结构化数据容器，与文档平级存在于知识库中。

```prisma
/// 多维表格（Notion Database 式结构化数据）
model Database {
  id          String   @id @default(uuid()) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  spaceId     String?  @map("space_id") @db.Uuid
  folderId    String?  @map("folder_id") @db.Uuid
  title       String   @db.VarChar(255)
  icon        String   @default("table") @db.VarChar(50)
  emoji       String?  @db.VarChar(10)
  /// 表格描述（Markdown）
  description String?  @db.Text
  sortOrder   Float    @default(0) @map("sort_order")
  createdAt   DateTime @default(now) @db.Timestamptz @map("created_at")
  updatedAt   DateTime @updatedAt @db.Timestamptz @map("updated_at")

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  space     Space?    @relation(fields: [spaceId], references: [id], onDelete: SetNull)
  folder    Folder?   @relation(fields: [folderId], references: [id], onDelete: SetNull)
  fields    DatabaseField[]
  records   DatabaseRecord[]
  views     DatabaseView[]

  @@index([spaceId, folderId, sortOrder])
  @@index([workspaceId])
  @@map("databases")
}

/// 多维表格字段（列定义）
model DatabaseField {
  id          String   @id @default(uuid()) @db.Uuid
  databaseId  String   @map("database_id") @db.Uuid
  name        String   @db.VarChar(100)
  /// 字段类型：text|number|select|multiselect|date|checkbox|user|url|email|formula|relation|rollup
  type        String   @db.VarChar(20)
  /// 字段配置 JSON（选项列表/公式表达式/关联表 ID 等）
  options     Json     @default("{}")
  sortOrder   Float    @default(0) @map("sort_order")
  createdAt   DateTime @default(now) @db.Timestamptz @map("created_at")

  database Database @relation(fields: [databaseId], references: [id], onDelete: Cascade)

  @@index([databaseId, sortOrder])
  @@map("database_fields")
}

/// 多维表格记录（行数据）
model DatabaseRecord {
  id          String   @id @default(uuid()) @db.Uuid
  databaseId  String   @map("database_id") @db.Uuid
  /// 行数据 JSON：{ fieldId: value, ... }
  /// 值类型由 DatabaseField.type 决定
  data        Json     @default("{}")
  sortOrder   Float    @default(0) @map("sort_order")
  createdAt   DateTime @default(now) @db.Timestamptz @map("created_at")
  updatedAt   DateTime @updatedAt @db.Timestamptz @map("updated_at")

  database Database @relation(fields: [databaseId], references: [id], onDelete: Cascade)

  @@index([databaseId, sortOrder])
  @@map("database_records")
}

/// 多维表格视图
model DatabaseView {
  id          String   @id @default(uuid()) @db.Uuid
  databaseId  String   @map("database_id") @db.Uuid
  name        String   @db.VarChar(100)
  /// 视图类型：table|board|gallery|calendar|gantt
  type        String   @db.VarChar(20)
  /// 视图配置 JSON（筛选/排序/分组/字段显隐/甘特日期字段等）
  config      Json     @default("{}")
  sortOrder   Float    @default(0) @map("sort_order")
  createdAt   DateTime @default(now) @db.Timestamptz @map("created_at")

  database Database @relation(fields: [databaseId], references: [id], onDelete: Cascade)

  @@index([databaseId, sortOrder])
  @@map("database_views")
}
```

#### 4.1.2 字段类型

| 类型 | value 格式 | UI 控件 | 说明 |
|------|-----------|---------|------|
| `text` | `string` | 文本输入 | 单行文本 |
| `number` | `number` | 数字输入 | 支持小数/负数 |
| `select` | `{ id: string }` | 下拉选择 | 单选，选项在 field.options |
| `multiselect` | `{ id: string }[]` | 标签输入 | 多选 |
| `date` | `{ start: ISO, end?: ISO }` | 日期选择 | 支持日期范围 |
| `checkbox` | `boolean` | 复选框 | |
| `user` | `{ id: string }` | 用户选择 | 关联 User 表 |
| `url` | `string` | URL 输入 | 自动链接化 |
| `email` | `string` | 邮箱输入 | 格式校验 |
| `formula` | `string` | 只读 | 公式引擎计算结果 |
| `relation` | `{ id: string }[]` | 关联记录 | 关联到另一个 Database |
| `rollup` | `string` | 只读 | 从 relation 聚合（count/sum/avg/min/max） |

**公式引擎**: 使用 `formula-engine`（轻量 JS 表达式求值），支持字段引用 `{{fieldName}}`、数学运算、条件表达式:
```
公式示例: {{单价}} * {{数量}}
公式示例: {{状态}} == "done" ? "✅" : "⏳"
```

### 4.2 视图

#### 4.2.1 表格视图（Table）

默认视图，类似 Excel/Notion Table:

```
┌──────┬──────────┬──────────┬──────────┬──────────┐
│      │ 名称      │ 状态      │ 负责人    │ 截止日期  │
├──────┼──────────┼──────────┼──────────┼──────────┤
│  ⋮⋮  │ 需求分析  │ ● 进行中  │ 👤 Alice  │ 09-15    │
│  ⋮⋮  │ UI 设计   │ ● 待开始  │ 👤 Bob    │ 09-20    │
│  ⋮⋮  │ 前端开发  │ ● 进行中  │ 👤 Carol  │ 09-25    │
├──────┴──────────┴──────────┴──────────┴──────────┤
│  + 新增行                                         │
└───────────────────────────────────────────────────┘
```

#### 4.2.2 看板视图（Board）

复用现有 Task 看板设计（`--board-col-min-w` / `--board-col-min-h` token）:

```
┌──────────┬──────────┬──────────┬──────────┐
│ 待开始    │ 进行中    │ 已完成    │ 已阻塞    │
│          │          │          │          │
│ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │          │
│ │UI 设计│ │ │需求分析│ │ │立项    │ │          │
│ │Bob    │ │ │Alice  │ │ │Alice  │ │          │
│ │09-20  │ │ │09-15  │ │ │09-01  │ │          │
│ └──────┘ │ └──────┘ │ └──────┘ │          │
│          │ ┌──────┐ │          │          │
│          │ │前端开发│ │          │          │
│          │ │Carol  │ │          │          │
│          │ └──────┘ │          │          │
└──────────┴──────────┴──────────┴──────────┘
```

看板分组字段配置在 `DatabaseView.config.groupFieldId`。

#### 4.2.3 甘特图视图（Gantt）

```
09-10  09-12  09-14  09-16  09-18  09-20  09-22  09-24
│      │      │      │      │      │      │      │
├──────┤ 需求分析 (Alice)
       ├──────┤ UI 设计 (Bob)
              ├──────────┤ 前端开发 (Carol)
                    ├──────┤ 后端开发 (Dave)
                           ├─────────┤ 测试 (Eve)
```

甘特图配置在 `DatabaseView.config`:
```json
{
  "startDateField": "field_start_date",
  "endDateField": "field_end_date",
  "labelField": "field_name",
  "colorField": "field_status"
}
```

#### 4.2.4 日历视图（Calendar）

月/周/日三种粒度，复用现有日历集成基础（`CalendarConnection` 模型）:

```
┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│ 周一      │ 周二      │ 周三      │ 周四      │ 周五      │ 周六      │ 周日      │
├──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│          │          │ ┌──────┐ │          │ ┌──────┐ │          │          │
│          │          │ │需求分析│ │          │ │UI 设计 │ │          │          │
│          │          │ └──────┘ │          │ └──────┘ │          │          │
│          │          │          │          │          │          │          │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
```

### 4.3 筛选/排序/分组

**筛选**（`DatabaseView.config.filters`）:

```json
{
  "filters": [
    { "fieldId": "f_status", "operator": "equals", "value": { "id": "in_progress" } },
    { "fieldId": "f_assignee", "operator": "is", "value": "current_user" },
    { "fieldId": "f_due_date", "operator": "within", "value": "this_week" }
  ],
  "filterLogic": "AND"
}
```

筛选操作符: `equals` / `not_equals` / `contains` / `starts_with` / `is_empty` / `is_not_empty` / `before` / `after` / `within` / `is` / `is_not`

**排序**（`DatabaseView.config.sorts`）:

```json
{
  "sorts": [
    { "fieldId": "f_due_date", "direction": "asc" },
    { "fieldId": "f_priority", "direction": "desc" }
  ]
}
```

**分组**（`DatabaseView.config.groupFieldId`）:
- 看板视图：按 select/multiselect/user 字段分组
- 甘特图：不支持分组
- 表格视图：可选分组（分组行折叠/展开）

---

## 5. Phase 4: 文件管理增强（1-2 周）

### 5.1 云盘

#### 5.1.1 数据模型

```prisma
/// 云盘文件
model FileAsset {
  id          String   @id @default(uuid()) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  /// 文件名（原始）
  fileName    String   @map("file_name") @db.VarChar(255)
  /// 文件大小（字节）
  fileSize    Int      @map("file_size")
  /// MIME 类型
  fileType    String   @map("file_type") @db.VarChar(100)
  /// 存储路径（S3 key 或本地路径）
  storageKey  String   @map("storage_key") @db.Text
  /// 缩略图路径（图片/视频）
  thumbnailKey String? @map("thumbnail_key") @db.Text
  /// 文件 SHA-256 哈希（去重）
  sha256      String   @db.VarChar(64)
  /// 上传者
  uploadedBy  String?  @map("uploaded_by") @db.Uuid
  /// 所属文件夹（云盘目录，复用 Folder 模型或独立 FileFolder）
  folderId    String?  @map("folder_id") @db.Uuid
  sortOrder   Float    @default(0) @map("sort_order")
  /// 当前版本号
  currentVersion Int   @default(1) @map("current_version")
  createdAt   DateTime @default(now) @db.Timestamptz @map("created_at")
  updatedAt   DateTime @updatedAt @db.Timestamptz @map("updated_at")

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  uploader  User?     @relation(fields: [uploadedBy], references: [id], onDelete: SetNull)
  versions  FileVersion[]

  @@index([workspaceId, folderId, sortOrder])
  @@index([sha256])
  @@map("file_assets")
}

/// 文件版本历史
model FileVersion {
  id          String   @id @default(uuid()) @db.Uuid
  fileAssetId String   @map("file_asset_id") @db.Uuid
  version     Int
  storageKey  String   @map("storage_key") @db.Text
  fileSize    Int      @map("file_size")
  /// 变更说明
  message     String?  @db.VarChar(255)
  uploadedBy  String?  @map("uploaded_by") @db.Uuid
  createdAt   DateTime @default(now) @db.Timestamptz @map("created_at")

  fileAsset FileAsset @relation(fields: [fileAssetId], references: [id], onDelete: Cascade)
  uploader  User?     @relation(fields: [uploadedBy], references: [id], onDelete: SetNull)

  @@unique([fileAssetId, version])
  @@index([fileAssetId, createdAt])
  @@map("file_versions")
}
```

#### 5.1.2 API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/workspaces/{wid}/files` | 列出文件（分页/筛选/排序） |
| POST | `/api/v1/workspaces/{wid}/files/upload` | 上传文件（multipart/form-data） |
| GET | `/api/v1/workspaces/{wid}/files/{fid}` | 获取文件元信息 |
| GET | `/api/v1/workspaces/{wid}/files/{fid}/download` | 下载文件 |
| DELETE | `/api/v1/workspaces/{wid}/files/{fid}` | 删除文件 |
| PATCH | `/api/v1/workspaces/{wid}/files/{fid}/move` | 移动文件到指定文件夹 |
| GET | `/api/v1/workspaces/{wid}/files/{fid}/versions` | 列出文件版本 |
| POST | `/api/v1/workspaces/{wid}/files/{fid}/versions/{vid}/restore` | 回滚文件版本 |

**上传去重**: 上传前计算 SHA-256，若已存在同 hash 文件，创建新 FileVersion 而非重复存储。

### 5.2 文件预览

| 文件类型 | 预览方案 | 说明 |
|----------|----------|------|
| 图片 (png/jpg/gif/webp/svg) | `<img>` / `<picture>` | 直接渲染，支持缩放 |
| PDF | `react-pdf`（pdf.js） | 逐页渲染，支持跳页/缩放 |
| Word (.docx) | `mammoth.js` → HTML | 转换为 HTML 预览 |
| Excel (.xlsx) | SheetJS → HTML table | 转换为表格预览 |
| PowerPoint (.pptx) | 提取文本 + 缩略图 | 降级预览 |
| 视频 (mp4/webm) | `<video>` | 原生播放 |
| 音频 (mp3/wav) | `<audio>` | 原生播放 |
| 代码 (js/ts/py/go...) | `highlight.js` | 语法高亮 |
| Markdown | 复用现有 `Markdown` 组件 | |
| 其他 | 下载链接 | 无法预览的提供下载 |

**预览组件**（`FilePreview.tsx`）:

```tsx
<div className="fixed inset-0 z-[var(--z-modal)] flex items-center 
     justify-center bg-black/60 backdrop-blur-sm">
  <div className="relative max-h-[90vh] w-[90vw] max-w-[1200px] 
       rounded-[var(--radius-xl)] bg-[var(--surface)] shadow-[var(--elev-lg)]">
    {/* 工具栏 */}
    <div className="flex items-center justify-between border-b 
         border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
      <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)]">
        {file.fileName}
      </span>
      <div className="flex gap-[var(--space-2)]">
        <button onClick={download}><Download size={16} /></button>
        <button onClick={onClose}><X size={16} /></button>
      </div>
    </div>
    {/* 预览内容 */}
    <div className="max-h-[calc(90vh-60px)] overflow-auto p-[var(--space-4)]">
      <PreviewContent file={file} />
    </div>
  </div>
</div>
```

### 5.3 版本管理

复用 Phase 1 的版本历史 UI 模式:

- 文件每次上传新版本 → 创建 FileVersion 记录
- 版本列表展示：版本号 + 上传者 + 时间 + 变更说明 + 大小
- 支持回滚到历史版本（`storageKey` 指向历史版本的 S3 key）
- 支持版本对比（文档类文件用 diff，二进制文件仅展示元信息差异）

---

## 6. 数据模型汇总

### 6.1 Prisma schema 变更（所有 Phase）

#### 新增模型

| Phase | 模型 | 说明 | 表名 |
|-------|------|------|------|
| 1 | `Space` | 知识库空间 | `spaces` |
| 1 | `Folder` | 文件夹（可嵌套） | `folders` |
| 1 | `DocumentVersion` | 文档版本历史 | `document_versions` |
| 1 | `DocumentComment` | 文档行内批注 | `document_comments` |
| 2 | `YjsPersistence` | Yjs CRDT 持久化 | `yjs_persistence` |
| 3 | `Database` | 多维表格 | `databases` |
| 3 | `DatabaseField` | 表格字段 | `database_fields` |
| 3 | `DatabaseRecord` | 表格记录 | `database_records` |
| 3 | `DatabaseView` | 表格视图 | `database_views` |
| 4 | `FileAsset` | 云盘文件 | `file_assets` |
| 4 | `FileVersion` | 文件版本 | `file_versions` |

#### Document 模型变更（增量字段）

| Phase | 字段 | 类型 | 说明 |
|-------|------|------|------|
| 1 | `content` | `Json?` | 富文本 JSON doc |
| 1 | `editMode` | `String` | 编辑模式 richtext/markdown |
| 1 | `spaceId` | `String?` | 知识库空间 ID |
| 1 | `folderId` | `String?` | 文件夹 ID |
| 1 | `sortOrder` | `Float` | 排序值 |
| 1 | `icon` | `String` | 图标 |
| 1 | `emoji` | `String?` | emoji 封面 |
| 1 | `currentVersion` | `Int` | 当前版本号 |

#### 迁移安全性

所有变更均为**增量字段**（`ADD COLUMN`）或**新增表**（`CREATE TABLE`），不修改/删除现有字段，保证:
- ✅ 向下兼容：现有 API 不受影响（新字段有默认值或 nullable）
- ✅ 可安全在线执行：`ALTER TABLE ADD COLUMN` 不锁表（PostgreSQL 11+）
- ✅ 可回滚：每个迁移有对应的 down migration（`DROP COLUMN` / `DROP TABLE`）
- ✅ 不破坏 RLS：新表需在 `db/rls-activate.sql` 中添加 RLS 策略（workspace 谓词）

### 6.2 索引策略

```sql
-- 知识库目录树查询（高频）
CREATE INDEX idx_documents_space_folder_sort ON documents (space_id, folder_id, sort_order);

-- 文档版本历史（按文档 + 时间倒序）
CREATE INDEX idx_document_versions_doc_created ON document_versions (document_id, created_at DESC);

-- 文档评论（按文档 + 锚点路径）
CREATE INDEX idx_document_comments_doc_anchor ON document_comments (document_id, anchor_path);

-- 多维表格（按表格 + 排序）
CREATE INDEX idx_database_fields_db_sort ON database_fields (database_id, sort_order);
CREATE INDEX idx_database_records_db_sort ON database_records (database_id, sort_order);

-- 云盘文件（按工作区 + 文件夹 + 排序）
CREATE INDEX idx_file_assets_ws_folder_sort ON file_assets (workspace_id, folder_id, sort_order);

-- 文件去重（按 SHA-256）
CREATE INDEX idx_file_assets_sha256 ON file_assets (sha256);
```

---

## 7. API 设计汇总

### 7.1 新增端点列表

遵循现有 OpenAPI 风格：`/api/v1/workspaces/{wid}/...`，统一 envelope `{ code, data, message }`，多租户通过 `{wid}` 路径参数 + RLS 隔离。

#### Phase 1: 云文档基础增强

| 方法 | 路径 | operationId | 说明 |
|------|------|-------------|------|
| GET | `/workspaces/{wid}/spaces` | listSpaces | 列出空间 |
| POST | `/workspaces/{wid}/spaces` | createSpace | 创建空间 |
| PATCH | `/workspaces/{wid}/spaces/{sid}` | updateSpace | 更新空间 |
| DELETE | `/workspaces/{wid}/spaces/{sid}` | deleteSpace | 删除空间 |
| GET | `/workspaces/{wid}/spaces/{sid}/tree` | getSpaceTree | 空间目录树 |
| POST | `/workspaces/{wid}/spaces/{sid}/folders` | createFolder | 创建文件夹 |
| PATCH | `/workspaces/{wid}/folders/{fid}` | updateFolder | 更新文件夹 |
| DELETE | `/workspaces/{wid}/folders/{fid}` | deleteFolder | 删除文件夹 |
| PATCH | `/workspaces/{wid}/folders/reorder` | reorderFolders | 批量重排 |
| PATCH | `/workspaces/{wid}/documents/{id}/move` | moveDocument | 移动文档 |
| GET | `/workspaces/{wid}/documents/{id}/versions` | listDocumentVersions | 版本列表 |
| POST | `/workspaces/{wid}/documents/{id}/versions` | createDocumentVersion | 创建版本 |
| GET | `/workspaces/{wid}/documents/{id}/versions/{vid}` | getDocumentVersion | 版本详情 |
| GET | `/workspaces/{wid}/documents/{id}/versions/compare` | compareVersions | 版本对比 |
| POST | `/workspaces/{wid}/documents/{id}/versions/{vid}/restore` | restoreVersion | 回滚版本 |
| GET | `/workspaces/{wid}/documents/{id}/comments` | listDocumentComments | 评论列表 |
| POST | `/workspaces/{wid}/documents/{id}/comments` | createDocumentComment | 创建批注 |
| PATCH | `/workspaces/{wid}/documents/{id}/comments/{cid}` | updateDocumentComment | 编辑批注 |
| POST | `/workspaces/{wid}/documents/{id}/comments/{cid}/resolve` | resolveComment | 解决批注 |
| POST | `/workspaces/{wid}/documents/{id}/comments/{cid}/reopen` | reopenComment | 重开批注 |
| DELETE | `/workspaces/{wid}/documents/{id}/comments/{cid}` | deleteDocumentComment | 删除批注 |

#### Phase 2: 实时协同编辑

| 协议 | 路径 | 说明 |
|------|------|------|
| WSS | `/collab/{documentId}` | Yjs WebSocket 协同端点 |
| GET | `/workspaces/{wid}/documents/{id}/collaborators` | 获取当前在线协作者 |

#### Phase 3: 多维表格

| 方法 | 路径 | operationId | 说明 |
|------|------|-------------|------|
| GET | `/workspaces/{wid}/databases` | listDatabases | 列出多维表格 |
| POST | `/workspaces/{wid}/databases` | createDatabase | 创建表格 |
| GET | `/workspaces/{wid}/databases/{dbid}` | getDatabase | 获取表格详情 |
| PATCH | `/workspaces/{wid}/databases/{dbid}` | updateDatabase | 更新表格 |
| DELETE | `/workspaces/{wid}/databases/{dbid}` | deleteDatabase | 删除表格 |
| GET | `/workspaces/{wid}/databases/{dbid}/fields` | listFields | 列出字段 |
| POST | `/workspaces/{wid}/databases/{dbid}/fields` | createField | 创建字段 |
| PATCH | `/workspaces/{wid}/databases/{dbid}/fields/{fid}` | updateField | 更新字段 |
| DELETE | `/workspaces/{wid}/databases/{dbid}/fields/{fid}` | deleteField | 删除字段 |
| GET | `/workspaces/{wid}/databases/{dbid}/records` | listRecords | 列出记录（支持筛选/排序/分页） |
| POST | `/workspaces/{wid}/databases/{dbid}/records` | createRecord | 创建记录 |
| PATCH | `/workspaces/{wid}/databases/{dbid}/records/{rid}` | updateRecord | 更新记录 |
| DELETE | `/workspaces/{wid}/databases/{dbid}/records/{rid}` | deleteRecord | 删除记录 |
| GET | `/workspaces/{wid}/databases/{dbid}/views` | listViews | 列出视图 |
| POST | `/workspaces/{wid}/databases/{dbid}/views` | createView | 创建视图 |
| PATCH | `/workspaces/{wid}/databases/{dbid}/views/{vid}` | updateView | 更新视图 |
| DELETE | `/workspaces/{wid}/databases/{dbid}/views/{vid}` | deleteView | 删除视图 |

#### Phase 4: 文件管理增强

| 方法 | 路径 | operationId | 说明 |
|------|------|-------------|------|
| GET | `/workspaces/{wid}/files` | listFiles | 列出文件 |
| POST | `/workspaces/{wid}/files/upload` | uploadFile | 上传文件 |
| GET | `/workspaces/{wid}/files/{fid}` | getFile | 文件元信息 |
| GET | `/workspaces/{wid}/files/{fid}/download` | downloadFile | 下载文件 |
| DELETE | `/workspaces/{wid}/files/{fid}` | deleteFile | 删除文件 |
| PATCH | `/workspaces/{wid}/files/{fid}/move` | moveFile | 移动文件 |
| GET | `/workspaces/{wid}/files/{fid}/versions` | listFileVersions | 文件版本列表 |
| POST | `/workspaces/{wid}/files/{fid}/versions/{vid}/restore` | restoreFileVersion | 回滚文件版本 |

### 7.2 OpenAPI 规范更新

所有新增端点需同步更新 `api/openapi.yaml`，遵循现有规范:
- 统一 envelope: `{ code: integer, data: object, message?: string }`
- 分页响应: `data: { items: array, page: int, limit: int, total: int, hasMore: boolean }`
- 错误响应: 复用 `#/components/responses/BadRequest` / `Unauthorized` / `NotFound`
- 安全: 复用 `bearerAuth` security scheme
- 标签: 新增 `spaces` / `folders` / `document-versions` / `document-comments` / `databases` / `files` tags

---

## 8. 风险评估

### 8.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| TipTap v2 与 React 19 兼容性问题 | 低 | 高 | TipTap 2.6+ 官方支持 React 19；开发前先在隔离环境验证；保留 textarea fallback |
| Yjs 大文档性能退化（>10MB） | 中 | 中 | 分块加载；限制单文档 5MB；超大文档降级为 Markdown 模式 |
| y-websocket 服务端内存泄漏 | 中 | 高 | 定期 `Y.encodeStateAsUpdate` 压缩；监控内存；设置连接超时自动清理 |
| ProseMirror Markdown 双向转换信息丢失 | 高 | 低 | JSON doc 为单一数据源，Markdown 为派生缓存；切换时提示用户可能丢失格式 |
| 多维表格公式引擎安全（XSS/注入） | 中 | 高 | 公式引擎沙箱隔离（无 `eval`/`Function`）；仅允许字段引用 + 数学运算 |
| 文件预览 XSS（SVG/HTML 注入） | 中 | 高 | SVG 预览禁用 `<script>`；HTML 预览用 DOMPurify 清洗；iframe sandbox |

### 8.2 性能风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| TipTap bundle 体积增大（~200KB gzipped） | 高 | 中 | 按需加载扩展（`next/dynamic`）；Markdown 模式不加载 TipTap |
| 协同 WebSocket 连接数过多 | 中 | 高 | 连接复用（multiplexing）；空闲 5 分钟自动断开；限制单用户最多 10 个活跃文档 |
| 版本历史存储膨胀 | 中 | 中 | 增量 diff 存储；每 10 版本强制全量；定时清理 > 90 天的自动版本 |
| 多维表格大量记录渲染卡顿 | 中 | 中 | 虚拟滚动（`@tanstack/react-virtual`）；分页加载（默认 50 行/页） |
| 文件上传大文件超时 | 低 | 中 | 分片上传（> 50MB）；S3 multipart upload；进度条展示 |

### 8.3 安全风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 协同 WebSocket 未授权访问 | 中 | 高 | 连接时验证 JWT + 工作区成员权限；token 过期自动断开 |
| 文档分享链接被遍历 | 低 | 高 | shareToken 使用 crypto.randomUUID（不可预测）；支持密码保护 + 过期时间 |
| 文件上传恶意文件 | 中 | 高 | MIME 类型白名单；文件大小限制；病毒扫描（ClamAV 可选） |
| 多维表格 relation 字段跨工作区泄露 | 低 | 高 | relation 字段值在 API 层校验目标记录属于同一 workspace |
| Yjs 持久化数据被篡改 | 低 | 中 | Yjs update 二进制存 Bytea；RLS 策略限制仅服务端可写 |

### 8.4 回滚方案

| Phase | 回滚策略 |
|-------|----------|
| Phase 1 | `editMode` 默认值改回 `markdown` → 所有文档回退 textarea；`content` 字段保留但不使用；新增表可 `DROP TABLE` |
| Phase 2 | 前端禁用协同扩展 → 回退单人编辑；y-websocket 服务端可停止；`yjs_persistence` 表可保留（不影响） |
| Phase 3 | 多维表格入口隐藏 → `databases` 表数据保留但不展示；可 `DROP TABLE` |
| Phase 4 | 云盘入口隐藏 → `file_assets` 表数据保留；可 `DROP TABLE` |

**数据库迁移回滚**:
- 每个迁移生成对应的 down migration
- 回滚顺序：Phase 4 → Phase 3 → Phase 2 → Phase 1（逆序）
- 回滚前备份：`pg_dump --table=documents --table=spaces ...`

**代码回滚**:
- 所有新组件独立文件（`RichTextEditor/`、`KnowledgeTree.tsx`、`DatabaseView/` 等）
- DocumentEditor.tsx 保留原始版本在 git 历史，可 `git revert`
- Feature flag 控制：`NEXT_PUBLIC_FEATURE_RICHTEXT` / `NEXT_PUBLIC_FEATURE_COLLAB` 等

---

## 9. 实施计划

### 9.1 工作包拆分

#### Phase 1: 云文档基础增强（2-3 周）

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 1 工作包（WP = Work Package）                         │
├──────────┬────────────────────────┬────────┬────────────────┤
│  WP-ID   │  工作包                 │  工时  │  依赖           │
├──────────┼────────────────────────┼────────┼────────────────┤
│  1A      │  TipTap 基础集成        │  3d    │  -              │
│          │  - 安装依赖             │        │                 │
│          │  - RichTextEditor 组件  │        │                 │
│          │  - 基础扩展配置         │        │                 │
│          │  - JSON doc 存储        │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  1B      │  双模式切换             │  2d    │  1A             │
│          │  - Markdown ↔ RichText │        │                 │
│          │  - 数据互转             │        │                 │
│          │  - 模式持久化           │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  1C      │  自定义扩展             │  3d    │  1A             │
│          │  - MermaidExtension    │        │                 │
│          │  - DecisionMark        │        │                 │
│          │  - TaskEmbed           │        │                 │
│          │  - Slash Menu          │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  1D      │  知识库数据模型         │  2d    │  -              │
│          │  - Space/Folder schema │        │                 │
│          │  - Document 字段变更    │        │                 │
│          │  - 迁移脚本             │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  1E      │  知识库 API            │  2d    │  1D             │
│          │  - Space/Folder CRUD   │        │                 │
│          │  - 目录树 API          │        │                 │
│          │  - 文档移动 API        │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  1F      │  知识库 UI             │  3d    │  1E             │
│          │  - KnowledgeTree 组件  │        │                 │
│          │  - 拖拽排序（dnd-kit）  │        │                 │
│          │  - 三栏布局             │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  1G      │  版本历史               │  3d    │  1A             │
│          │  - DocumentVersion     │        │                 │
│          │  - 快照 + diff 存储    │        │                 │
│          │  - 版本对比 UI         │        │                 │
│          │  - 回滚 API + UI       │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  1H      │  文档评论               │  3d    │  1A             │
│          │  - DocumentComment     │        │                 │
│          │  - 行内批注锚点         │        │                 │
│          │  - 讨论 + 解决 UI      │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  1I      │  迁移现有功能           │  2d    │  1A, 1B, 1C     │
│          │  - 分享 hook 提取       │        │                 │
│          │  - 导出适配             │        │                 │
│          │  - 模板插入适配         │        │                 │
│          │  - 自动保存改造         │        │                 │
└──────────┴────────────────────────┴────────┴────────────────┘

可并行: 1A ∥ 1D ∥ 1G(数据) ∥ 1H(数据)
串行依赖: 1A → 1B → 1I; 1D → 1E → 1F; 1A → 1C; 1A → 1G(UI) → 1H(UI)
```

#### Phase 2: 实时协同编辑（3-4 周）

```
┌──────────┬────────────────────────┬────────┬────────────────┐
│  WP-ID   │  工作包                 │  工时  │  依赖           │
├──────────┼────────────────────────┼────────┼────────────────┤
│  2A      │  y-websocket 服务端     │  3d    │  -              │
│          │  - Node.js WS 服务      │        │                 │
│          │  - JWT 鉴权             │        │                 │
│          │  - Prisma 持久化        │        │                 │
│          │  - Docker 部署          │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  2B      │  客户端协同集成         │  3d    │  1A, 2A         │
│          │  - Yjs Doc 初始化       │        │                 │
│          │  - WebSocket Provider   │        │                 │
│          │  - Collaboration ext   │        │                 │
│          │  - CollaborationCursor │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  2C      │  Presence UI           │  2d    │  2B             │
│          │  - 在线用户头像         │        │                 │
│          │  - 光标颜色分配         │        │                 │
│          │  - 连接状态指示         │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  2D      │  离线同步               │  2d    │  2B             │
│          │  - IndexedDB 持久化     │        │                 │
│          │  - 重连合并             │        │                 │
│          │  - 离线状态 UI          │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  2E      │  协同版本快照           │  2d    │  2B, 1G         │
│          │  - WS 断开自动快照      │        │                 │
│          │  - 定时快照             │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  2F      │  性能优化 + 压测        │  3d    │  2B, 2C, 2D     │
│          │  - 大文档测试           │        │                 │
│          │  - 多人压测             │        │                 │
│          │  - 内存监控             │        │                 │
└──────────┴────────────────────────┴────────┴────────────────┘

可并行: 2A ∥ (1G 数据准备)
串行依赖: 2A → 2B → 2C ∥ 2D → 2E → 2F
```

#### Phase 3: 多维表格（2-3 周）

```
┌──────────┬────────────────────────┬────────┬────────────────┐
│  WP-ID   │  工作包                 │  工时  │  依赖           │
├──────────┼────────────────────────┼────────┼────────────────┤
│  3A      │  表格数据模型 + API     │  3d    │  -              │
│          │  - Database schema     │        │                 │
│          │  - Field/Record/View   │        │                 │
│          │  - CRUD API            │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  3B      │  表格视图 UI           │  3d    │  3A             │
│          │  - Table 视图          │        │                 │
│          │  - 字段类型控件         │        │                 │
│          │  - 虚拟滚动             │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  3C      │  看板/甘特/日历视图     │  4d    │  3A             │
│          │  - Board 视图          │        │                 │
│          │  - Gantt 视图          │        │                 │
│          │  - Calendar 视图       │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  3D      │  筛选/排序/分组         │  2d    │  3A             │
│          │  - 筛选器 UI + 逻辑     │        │                 │
│          │  - 排序 UI + 逻辑       │        │                 │
│          │  - 分组 UI + 逻辑       │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  3E      │  公式引擎               │  2d    │  3A             │
│          │  - 表达式解析           │        │                 │
│          │  - 字段引用求值         │        │                 │
│          │  - 沙箱隔离             │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  3F      │  relation/rollup 字段  │  2d    │  3A, 3E         │
│          │  - 跨表关联             │        │                 │
│          │  - 聚合计算             │        │                 │
└──────────┴────────────────────────┴────────┴────────────────┘

可并行: 3B ∥ 3C ∥ 3D ∥ 3E
串行依赖: 3A → (3B ∥ 3C ∥ 3D ∥ 3E) → 3F
```

#### Phase 4: 文件管理增强（1-2 周）

```
┌──────────┬────────────────────────┬────────┬────────────────┐
│  WP-ID   │  工作包                 │  工时  │  依赖           │
├──────────┼────────────────────────┼────────┼────────────────┤
│  4A      │  云盘数据模型 + API     │  2d    │  -              │
│          │  - FileAsset schema    │        │                 │
│          │  - 上传/下载 API       │        │                 │
│          │  - SHA-256 去重         │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  4B      │  云盘 UI               │  2d    │  4A             │
│          │  - 文件浏览器           │        │                 │
│          │  - 拖拽上传             │        │                 │
│          │  - 文件列表/网格切换    │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  4C      │  文件预览               │  3d    │  4A             │
│          │  - 图片/PDF 预览        │        │                 │
│          │  - Office 预览          │        │                 │
│          │  - 代码/Markdown 预览   │        │                 │
├──────────┼────────────────────────┼────────┼────────────────┤
│  4D      │  文件版本管理           │  2d    │  4A             │
│          │  - FileVersion         │        │                 │
│          │  - 版本列表 UI          │        │                 │
│          │  - 回滚 UI              │        │                 │
└──────────┴────────────────────────┴────────┴────────────────┘

可并行: 4B ∥ 4C ∥ 4D
串行依赖: 4A → (4B ∥ 4C ∥ 4D)
```

### 9.2 依赖关系图

```
Phase 1
  1A (TipTap 基础) ──┬──→ 1B (双模式) ──→ 1I (迁移现有功能)
                     ├──→ 1C (自定义扩展) ──→ 1I
                     ├──→ 1G (版本历史) ──────┐
                     └──→ 1H (文档评论) ──────┤
                                            ├──→ Phase 2
  1D (知识库模型) ──→ 1E (知识库 API) ──→ 1F (知识库 UI)
                                            └──→ Phase 3, 4

Phase 2 (依赖 Phase 1 的 1A + 1G)
  2A (WS 服务端) ──→ 2B (客户端协同) ──┬──→ 2C (Presence UI)
                                        ├──→ 2D (离线同步)
                                        └──→ 2E (协同快照) ──→ 2F (压测)

Phase 3 (依赖 Phase 1 的知识库结构)
  3A (表格模型+API) ──┬──→ 3B (表格视图 UI)
                       ├──→ 3C (看板/甘特/日历)
                       ├──→ 3D (筛选/排序/分组)
                       └──→ 3E (公式引擎) ──→ 3F (relation/rollup)

Phase 4 (依赖 Phase 1 的知识库结构)
  4A (云盘模型+API) ──┬──→ 4B (云盘 UI)
                       ├──→ 4C (文件预览)
                       └──→ 4D (版本管理)
```

### 9.3 里程碑

| 里程碑 | 日期 | 交付物 |
|--------|------|--------|
| M1: 富文本编辑器可用 | 第 1 周末 | TipTap 集成 + 双模式切换 + 基础扩展 |
| M2: 知识库结构 | 第 2 周末 | Space/Folder + 目录树 UI + 拖拽排序 |
| M3: Phase 1 完成 | 第 3 周末 | 版本历史 + 文档评论 + 现有功能迁移 |
| M4: 协同编辑 MVP | 第 5 周末 | y-websocket + 实时光标 + Presence |
| M5: Phase 2 完成 | 第 6 周末 | 离线同步 + 协同快照 + 压测通过 |
| M6: 多维表格 MVP | 第 8 周末 | 表格/看板视图 + 筛选/排序 |
| M7: Phase 3 完成 | 第 9 周末 | 甘特/日历视图 + 公式 + relation |
| M8: Phase 4 完成 | 第 11 周末 | 云盘 + 文件预览 + 版本管理 |

### 9.4 质量保障

| 保障项 | 方案 |
|--------|------|
| 单元测试 | 每个新组件/工具函数配套 `.test.tsx`；覆盖率 ≥ 80% |
| 集成测试 | API 端点配套集成测试；复用现有测试框架 |
| E2E 测试 | 关键流程 E2E：创建文档 → 编辑 → 发布 → 分享 → 协同 |
| 协同压测 | 10 人同时编辑同一文档，验证 CRDT 收敛 + 性能 |
| 设计走查 | 所有新 UI 走 design token，禁止裸 hex（ESLint 规则强制） |
| 安全审计 | 文件上传 MIME 校验；公式引擎沙箱；XSS 清洗 |
| 迁移验证 | 每个迁移在 staging 环境验证；down migration 可回滚 |

---

## 附录 A: Design Token 使用规范

> 来源：`web/app/design-tokens.css`（已确认可用 token，非假设）

### A.1 颜色 Token

| Token | 用途 |
|-------|------|
| `var(--bg)` | 页面背景 |
| `var(--surface)` / `--surface-2` / `--surface-3` | 卡片/面板表面三级 |
| `var(--fg)` / `--fg-2` / `--muted` / `--meta` | 文字四级 |
| `var(--border)` / `--border-soft` | 边框两级 |
| `var(--accent)` / `--accent-hover` / `--accent-active` / `--accent-soft` / `--accent-fg` | 强调色五级 |
| `var(--success)` / `--success-soft` | 成功色 |
| `var(--warn)` / `--warn-soft` | 警告色 |
| `var(--danger)` / `--danger-soft` | 危险色 |
| `var(--accent-ring)` / `--focus-ring` | 焦点环 |

### A.2 排版 Token

| Token | 值 |
|-------|-----|
| `var(--font-display)` / `--font-body` / `--font-mono` | 字体族 |
| `var(--text-xs)` ~ `--text-4xl` | 字号 8 级 |
| `var(--leading-tight)` ~ `--leading-relaxed` | 行高 4 级 |
| `var(--weight-regular)` / `--weight-medium` / `--weight-semibold` | 字重 3 级 |

### A.3 间距/圆角/阴影/动效

| Token | 说明 |
|-------|------|
| `var(--space-1)` ~ `--space-20` | 间距（4px 网格） |
| `var(--radius-sm)` / `--radius-md` / `--radius-lg` / `--radius-xl` / `--radius-pill` | 圆角 |
| `var(--elev-flat)` / `--elev-ring` / `--elev-sm` / `--elev-md` / `--elev-lg` / `--elev-hover` | 阴影 |
| `var(--motion-fast)` / `--motion-base` / `--motion-slow` / `--motion-enter` | 动效时长 |
| `var(--ease-standard)` / `--ease-out` | 缓动函数 |

### A.4 层级/布局

| Token | 说明 |
|-------|------|
| `var(--z-base)` / `--z-dropdown` / `--z-sticky` / `--z-modal` / `--z-toast` / `--z-cmd` | 层级 |
| `var(--sidebar-w)` / `--topbar-h` / `--container-max` / `--prose-max` | 布局尺寸 |
| `var(--icon-sm)` / `--icon-md` / `--icon-lg` / `--icon-xl` | 图标尺寸 |
| `var(--control-h)` / `--control-h-sm` | 控件高度 |

---

## 附录 B: 与现有代码的兼容性矩阵

| 现有功能 | 影响 | 兼容方案 |
|----------|------|----------|
| `DocumentEditor.tsx`（textarea） | 重构 | 保留 markdown 模式分支；富文本模式为新组件 |
| `Document.markdown` 字段 | 保留 | 富文本模式派生 Markdown 写入此字段；向下兼容 |
| `GET/PATCH /documents/{id}` API | 扩展 | 新增 `content`/`editMode` 字段；不传则保持原行为 |
| `publishedMarkdown` 发布机制 | 保留 | 发布时从 JSON doc 序列化 Markdown 写入 |
| `shareToken` 分享机制 | 保留 | 分享页根据 `editMode` 选择渲染方式 |
| `ExportPreview` 导出 | 适配 | 富文本模式从 JSON doc 生成 HTML/PDF |
| `MarkdownToolbar` / `useEditorKeys` | 保留 | Markdown 模式继续使用；富文本模式用 TipTap 快捷键 |
| `QuickDiagram` Mermaid | 适配 | 封装为 MermaidExtension |
| `ACTION_TEMPLATES` 模板 | 适配 | 富文本模式插入为 ProseMirror 节点 |
| `Decision` / `DecisionVersion` | 不影响 | 文档版本独立模型，不复用 |
| `Comment`（任务评论） | 不影响 | 文档评论独立模型 `DocumentComment` |
| `ShareAccessLog` | 复用 | 文档分享日志继续使用此模型 |
| RLS 策略 | 扩展 | 新表在 `db/rls-activate.sql` 添加 workspace 谓词 |

---

*文档结束。本设计方案基于对现有代码架构（`DocumentEditor.tsx`、`schema.prisma`、`openapi.yaml`、`design-tokens.css`）的深入分析，确保所有变更向下兼容、可迁移、可回滚。*