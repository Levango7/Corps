# P1-4 审批流引擎 + 文档级权限架构设计

> **版本**: 1.0  
> **日期**: 2026-09-20  
> **作者**: 架构设计  
> **状态**: 设计稿  
> **关联路线图**: P1-4

---

## 目录

1. [审批流引擎](#1-审批流引擎)
2. [文档级权限](#2-文档级权限)
3. [实施计划](#3-实施计划)

---

## 1. 审批流引擎

### 1.1 业务场景

审批流引擎对标飞书/钉钉审批能力，覆盖以下核心业务场景：

| 场景 | 典型流程 | 特点 |
|------|---------|------|
| 请假审批 | 申请人 → 直属主管 → HR | 顺序审批，条件分支（天数 >3 加部门负责人） |
| 报销审批 | 申请人 → 直属主管 → 财务 | 顺序审批，金额条件路由（>5000 加 CFO） |
| 合同审批 | 申请人 → 法务 → 财务 → 总经理 | 会签审批，多角色并行 |
| 采购审批 | 申请人 → 部门负责人 → 采购部 | 条件审批，按采购类型选择路径 |
| 入职审批 | HR → 部门负责人 → IT | 并行审批（IT 准备设备 + 部门准备工位） |

### 1.2 现有实现分析

当前系统已有基础审批能力（阶段 6 已实现）：

**已有模型**：
- `ApprovalTemplate` — 审批模板，节点配置以 JSON 存储
- `ApprovalInstance` — 审批实例，含节点快照、状态、当前节点序号
- `ApprovalOperation` — 操作记录（approve/reject/withdraw/transfer/comment）

**已有审批模式**：
- `sequential` — 顺序审批（默认，一人审批即推进）
- `parallel` — 并行审批（所有审批人通过才推进）
- `countersign` — 会签（requiredCount 数量通过即推进）

**已有 API**：
- `GET/POST /approvals/templates` — 模板列表/创建
- `PATCH/DELETE /approvals/templates/{tid}` — 模板更新/删除
- `GET/POST /approvals/instances` — 实例列表/发起
- `GET/DELETE /approvals/instances/{aid}` — 详情/撤回
- `POST /approvals/instances/{aid}/approve` — 同意
- `POST /approvals/instances/{aid}/reject` — 拒绝
- `POST /approvals/instances/{aid}/withdraw` — 撤回

**已有前端组件**：
- `ApprovalList` / `ApprovalListPageClient` — 审批列表页
- `ApprovalDetail` — 审批详情（含流程图、操作区）
- `ApprovalFlowDiagram` — 流程图可视化
- `ApprovalSubmit` — 发起审批表单
- `ApprovalTemplateManage` — 模板管理
- `ApprovalAdvicePanel` — AI 审批建议面板

**现有局限性**：
1. 节点配置为扁平 JSON 数组，不支持条件分支/网关
2. 无表单字段定义机制（审批内容为自由 JSON）
3. 无审批委托/加签/转交的完整流程
4. 无超时自动处理/SLA 机制
5. 无审批催办功能
6. 节点类型单一（只有审批节点，无抄送/通知节点）

### 1.3 数据库模型设计

#### 1.3.1 增强现有模型

**ApprovalTemplate（增强）** — 增加表单定义和流程类型：

```prisma
model ApprovalTemplate {
  // ── 现有字段保持不变 ──
  id            String   @id @default(uuid()) @db.Uuid
  workspaceId   String   @map("workspace_id") @db.Uuid
  name          String   @db.VarChar(200)
  description   String?  @db.VarChar(500)
  nodes         Json     @db.JsonB          // 增强为支持条件分支的节点图
  createdBy     String?  @map("created_by") @db.Uuid
  active        Boolean  @default(true)
  createdAt     DateTime @default(now()) @db.Timestamptz @map("created_at")
  updatedAt     DateTime @updatedAt @db.Timestamptz @map("updated_at")

  // ── 新增字段 ──
  /// 流程类型：sequential | parallel | conditional | mixed
  flowType      String   @default("sequential") @map("flow_type") @db.VarChar(20)
  /// 表单字段定义（JSON Schema 格式，定义审批表单结构）
  formSchema    Json?    @map("form_schema") @db.JsonB
  /// 流程图标（Lucide 图标名）
  icon          String   @default("file-check") @db.VarChar(50)
  /// 分类标签（如 "人事" / "财务" / "法务"）
  category      String?  @db.VarChar(50)
  /// 是否为系统内置模板（不可删除）
  isBuiltin     Boolean  @default(false) @map("is_builtin")

  instances     ApprovalInstance[]
  workspace     Workspace          @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  creator       User?              @relation("ApprovalTemplateCreator", fields: [createdBy], references: [id], onDelete: SetNull)

  @@index([workspaceId, active])
  @@index([workspaceId, category])
  @@map("approval_templates")
}
```

**ApprovalInstance（增强）** — 增加条件路由和表单数据：

```prisma
model ApprovalInstance {
  // ── 现有字段保持不变 ──
  id            String   @id @default(uuid()) @db.Uuid
  workspaceId   String   @map("workspace_id") @db.Uuid
  templateId    String?  @map("template_id") @db.Uuid
  title         String   @db.VarChar(200)
  description   String?  @db.Text
  applicantId   String   @map("applicant_id") @db.Uuid
  content       Json     @db.JsonB          // 表单数据（按 formSchema 填写）
  status        String   @default("pending") @db.VarChar(20)
  currentNode   Int      @default(0) @map("current_node")
  nodes         Json     @db.JsonB          // 节点快照（增强为图结构）
  submittedAt   DateTime @default(now()) @db.Timestamptz @map("submitted_at")
  completedAt   DateTime? @map("completed_at") @db.Timestamptz
  createdAt     DateTime @default(now()) @db.Timestamptz @map("created_at")
  updatedAt     DateTime @updatedAt @db.Timestamptz @map("updated_at")

  // ── 新增字段 ──
  /// 当前激活的节点路径（条件分支时可能有多个并行节点）
  activeNodeIds  String[] @default([]) @map("active_node_ids")
  /// 条件分支求值结果缓存（避免重复计算）
  conditionCache Json?    @map("condition_cache") @db.JsonB
  /// 审批紧急程度：normal | urgent | critical
  priority       String   @default("normal") @db.VarChar(20)
  /// 期望完成时间（SLA）
  expectedAt     DateTime? @map("expected_at") @db.Timestamptz
  /// 关联实体类型（task | document | custom）
  entityType     String?  @map("entity_type") @db.VarChar(20)
  /// 关联实体 ID
  entityId       String?  @map("entity_id") @db.Uuid

  template      ApprovalTemplate?   @relation(fields: [templateId], references: [id], onDelete: SetNull)
  operations    ApprovalOperation[]
  workspace     Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  applicant     User                @relation("ApprovalApplicant", fields: [applicantId], references: [id], onDelete: Cascade)

  @@index([workspaceId, status])
  @@index([applicantId, status])
  @@index([workspaceId, priority, status])
  @@map("approval_instances")
}
```

**ApprovalOperation（增强）** — 增加加签/委托操作类型：

```prisma
model ApprovalOperation {
  // ── 现有字段保持不变 ──
  id            String   @id @default(uuid()) @db.Uuid
  instanceId    String   @map("instance_id") @db.Uuid
  workspaceId   String   @map("workspace_id") @db.Uuid
  operatorId    String   @map("operator_id") @db.Uuid
  action        String   @db.VarChar(20)     // 增强为：approve | reject | withdraw | transfer | comment | delegate | addSign | cc
  nodeIndex     Int      @map("node_index")
  comment       String?  @db.Text
  transferToId  String?  @map("transfer_to_id") @db.Uuid
  createdAt     DateTime @default(now()) @db.Timestamptz @map("created_at")

  // ── 新增字段 ──
  /// 操作的节点 ID（对应 nodes JSON 中的 nodeId，条件分支时区分）
  nodeId        String?  @map("node_id") @db.VarChar(100)
  /// 加签目标用户 ID（action=addSign 时）
  addSignToId   String?  @map("add_sign_to_id") @db.Uuid
  /// 委托目标用户 ID（action=delegate 时）
  delegateToId  String?  @map("delegate_to_id") @db.Uuid

  instance      ApprovalInstance @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  workspace     Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  operator      User             @relation("ApprovalOperator", fields: [operatorId], references: [id], onDelete: Cascade)
  transferTo    User?            @relation("ApprovalTransferTarget", fields: [transferToId], references: [id], onDelete: SetNull)

  @@index([instanceId, createdAt])
  @@index([instanceId, nodeId])
  @@map("approval_operations")
}
```

#### 1.3.2 新增模型

**ApprovalCcRecord** — 抄送记录：

```prisma
/// 审批抄送记录：通知非审批人查看审批进度
model ApprovalCcRecord {
  id          String   @id @default(uuid()) @db.Uuid
  instanceId  String   @map("instance_id") @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  userId      String   @map("user_id") @db.Uuid
  /// 抄送节点序号
  nodeIndex   Int      @map("node_index")
  /// 是否已读
  readAt      DateTime? @map("read_at") @db.Timestamptz
  createdAt   DateTime @default(now()) @db.Timestamptz @map("created_at")

  instance    ApprovalInstance @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  workspace   Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user        User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([instanceId, userId, nodeIndex])
  @@index([userId, readAt])
  @@map("approval_cc_records")
}
```

**ApprovalDelegate** — 审批委托设置：

```prisma
/// 审批委托：用户可设置出差/休假期间的审批代理人
model ApprovalDelegate {
  id           String   @id @default(uuid()) @db.Uuid
  workspaceId  String   @map("workspace_id") @db.Uuid
  delegatorId  String   @map("delegator_id") @db.Uuid    // 委托人（出差者）
  delegateToId String   @map("delegate_to_id") @db.Uuid  // 代理人（代审批者）
  /// 委托开始时间
  startAt      DateTime @map("start_at") @db.Timestamptz
  /// 委托结束时间
  endAt        DateTime @map("end_at") @db.Timestamptz
  /// 委托原因
  reason       String?  @db.Text
  /// 是否生效
  active       Boolean  @default(true)
  createdAt    DateTime @default(now()) @db.Timestamptz @map("created_at")

  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  delegator    User      @relation("ApprovalDelegator", fields: [delegatorId], references: [id], onDelete: Cascade)
  delegateTo   User      @relation("ApprovalDelegateTo", fields: [delegateToId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, delegatorId, startAt])
  @@index([delegateToId, active])
  @@map("approval_delegates")
}
```

### 1.4 审批流类型设计

#### 1.4.1 节点图结构（增强的 nodes JSON）

现有 nodes 为扁平数组，增强为支持条件分支的**有向图**结构：

```typescript
interface ApprovalNodeGraph {
  nodes: ApprovalGraphNode[];
  edges: ApprovalGraphEdge[];
  startNodeId: string;
}

interface ApprovalGraphNode {
  nodeId: string;                    // 唯一标识（如 "node_1", "node_2"）
  name: string;                      // 节点名称
  type: "approval" | "cc" | "condition" | "start" | "end";
  
  // 审批节点字段（type="approval"）
  approverRole?: string;             // 按角色指定审批人
  approverUserId?: string;           // 按用户指定审批人
  approverDeptId?: string;           // 按部门指定审批人（未来扩展）
  mode?: "sequential" | "parallel" | "countersign";
  requiredCount?: number;            // countersign 模式最少通过数
  
  // 抄送节点字段（type="cc"）
  ccUserIds?: string[];              // 抄送人列表
  ccRole?: string;                   // 抄送角色
  
  // 条件节点字段（type="condition"）
  conditions?: ConditionBranch[];    // 条件分支列表
  
  // 通用字段
  order: number;                     // 排序序号（兼容现有逻辑）
}

interface ApprovalGraphEdge {
  fromNodeId: string;
  toNodeId: string;
  /// 条件边：condition 节点的分支标签
  conditionLabel?: string;
}

interface ConditionBranch {
  label: string;                     // 分支标签（如 "金额>5000"）
  /// 条件表达式（JSON Logic 格式）
  expression: object;
  targetNodeId: string;              // 满足条件时跳转的节点
}
```

#### 1.4.2 顺序审批（逐级审批）

```
[开始] → [主管审批] → [HR审批] → [结束]
```

- 节点按 order 顺序执行
- 当前节点审批通过后自动推进到下一节点
- 任一节点拒绝则整个审批终止

**现有实现已支持**，保持兼容。

#### 1.4.3 并行审批（多人同时审批）

```
[开始] → [并行: 法务+财务] → [总经理审批] → [结束]
```

- 同一节点的所有审批人同时收到审批任务
- 所有审批人通过后才推进到下一节点
- 任一审批人拒绝则整个审批终止

**现有实现已支持**（mode="parallel"），保持兼容。

#### 1.4.4 会签审批（所有人都通过才生效）

```
[开始] → [会签: 3人至少2人通过] → [结束]
```

- 指定 requiredCount 数量，达到即推进
- 不需要所有人都审批
- 适用于 committee/评审场景

**现有实现已支持**（mode="countersign"），保持兼容。

#### 1.4.5 条件审批（根据条件选择审批路径）— **新增**

```
[开始] → [条件判断] →─ 金额≤5000 ─→ [主管审批] → [结束]
                   →─ 金额>5000  ─→ [主管审批] → [CFO审批] → [结束]
```

- 条件节点根据表单数据求值，选择分支
- 使用 JSON Logic 格式定义条件表达式
- 支持多分支（switch-case 语义）
- 条件求值结果缓存到 `conditionCache` 字段

**条件表达式示例**（JSON Logic）：

```json
{
  "if": [
    { ">": [{ "var": "amount" }, 5000] },
    "branch_high",
    "branch_low"
  ]
}
```

**条件求值流程**：

1. 审批提交时，遍历 nodes 找到 condition 类型节点
2. 对每个 condition 节点，用表单数据（content JSON）对条件表达式求值
3. 求值结果（选中的 targetNodeId）缓存到 `conditionCache`
4. 后续节点推进时，根据 conditionCache 确定路径

### 1.5 API 端点设计

#### 1.5.1 现有 API（保持兼容）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/workspaces/{wid}/approvals/templates` | 模板列表 |
| POST | `/v1/workspaces/{wid}/approvals/templates` | 创建模板 |
| PATCH | `/v1/workspaces/{wid}/approvals/templates/{tid}` | 更新模板 |
| DELETE | `/v1/workspaces/{wid}/approvals/templates/{tid}` | 删除模板 |
| GET | `/v1/workspaces/{wid}/approvals/instances` | 实例列表 |
| POST | `/v1/workspaces/{wid}/approvals/instances` | 发起审批 |
| GET | `/v1/workspaces/{wid}/approvals/instances/{aid}` | 审批详情 |
| DELETE | `/v1/workspaces/{wid}/approvals/instances/{aid}` | 撤回审批 |
| POST | `/v1/workspaces/{wid}/approvals/instances/{aid}/approve` | 同意 |
| POST | `/v1/workspaces/{wid}/approvals/instances/{aid}/reject` | 拒绝 |
| POST | `/v1/workspaces/{wid}/approvals/instances/{aid}/withdraw` | 撤回 |

#### 1.5.2 新增 API

| 方法 | 路径 | 说明 | Body |
|------|------|------|------|
| POST | `/v1/workspaces/{wid}/approvals/instances/{aid}/transfer` | 转交审批 | `{ transferToId, comment? }` |
| POST | `/v1/workspaces/{wid}/approvals/instances/{aid}/delegate` | 委托审批 | `{ delegateToId, comment? }` |
| POST | `/v1/workspaces/{wid}/approvals/instances/{aid}/add-sign` | 加签 | `{ addSignToId, comment? }` |
| POST | `/v1/workspaces/{wid}/approvals/instances/{aid}/cc` | 抄送 | `{ ccUserIds, nodeIndex? }` |
| POST | `/v1/workspaces/{wid}/approvals/instances/{aid}/urge` | 催办 | `{ comment? }` |
| GET | `/v1/workspaces/{wid}/approvals/cc` | 我的抄送列表 | — |
| GET | `/v1/workspaces/{wid}/approvals/delegates` | 委托设置列表 | — |
| POST | `/v1/workspaces/{wid}/approvals/delegates` | 创建委托 | `{ delegateToId, startAt, endAt, reason? }` |
| PATCH | `/v1/workspaces/{wid}/approvals/delegates/{did}` | 更新委托 | `{ active?, endAt? }` |
| DELETE | `/v1/workspaces/{wid}/approvals/delegates/{did}` | 删除委托 | — |
| GET | `/v1/workspaces/{wid}/approvals/stats` | 审批统计 | `?startDate=&endDate=` |

#### 1.5.3 API 详细设计

**转交审批** — `POST /approvals/instances/{aid}/transfer`

```typescript
// Request
{
  transferToId: string;   // 转交目标用户 ID
  comment?: string;        // 转交备注
}

// Response 200
{
  code: 200,
  data: {
    instance: ApprovalInstance,  // 更新后的实例
    operation: ApprovalOperation // 转交操作记录
  }
}
```

逻辑：
1. 验证当前用户是当前节点的审批人
2. 验证实例状态为 pending
3. 创建 ApprovalOperation(action="transfer", transferToId=目标用户)
4. 更新节点快照中当前节点的 approverUserId 为目标用户
5. 通知目标用户有新的审批任务

**加签** — `POST /approvals/instances/{aid}/add-sign`

```typescript
// Request
{
  addSignToId: string;    // 加签目标用户 ID
  comment?: string;
}

// Response 200
{
  code: 200,
  data: {
    instance: ApprovalInstance,
    operation: ApprovalOperation
  }
}
```

逻辑：
1. 验证当前用户是当前节点的审批人
2. 在当前节点追加一个审批人（修改 nodes 快照）
3. 如果当前节点是 sequential 模式，加签人也需要审批
4. 如果当前节点是 parallel/countersign 模式，加签人加入审批人集合
5. 创建 ApprovalOperation(action="addSign")

**条件路由求值** — 内部函数（非 API）

```typescript
function evaluateCondition(
  conditionNode: ApprovalGraphNode,
  formData: Record<string, unknown>,
): string {
  // 使用 json-logic-js 对条件表达式求值
  // 返回满足条件的 targetNodeId
  // 如果无匹配分支，返回默认分支
}
```

### 1.6 前端页面设计

#### 1.6.1 审批流定义页面（增强 ApprovalTemplateManage）

**模板列表页**：
- 按分类筛选（人事/财务/法务/自定义）
- 显示模板名称、流程类型图标、节点数、启用状态
- 操作：编辑、复制、删除、启用/停用

**模板编辑器**（新增）：
- **可视化流程编辑器**：拖拽式节点画布
  - 节点类型：审批节点、抄送节点、条件节点
  - 连线：拖拽连接节点，条件节点支持多分支连线
  - 节点配置面板：点击节点弹出配置抽屉
- **表单设计器**：定义审批表单字段
  - 字段类型：文本、数字、日期、单选、多选、附件、金额
  - 字段验证：必填、范围、格式
  - 字段映射：条件表达式引用字段名
- **预览模式**：模拟审批流程，测试条件分支

#### 1.6.2 审批列表页（增强 ApprovalListPageClient）

**标签页**：
- 待我审批（pendingMine=1）
- 我发起的（mine=1）
- 我抄送的（cc）
- 全部审批

**筛选**：
- 按状态筛选（pending/approved/rejected/withdrawn）
- 按优先级筛选（normal/urgent/critical）
- 按分类筛选
- 搜索（标题/申请人）

#### 1.6.3 审批详情页（增强 ApprovalDetail）

**信息区域**：
- 审批标题 + 状态徽章 + 优先级标识
- 申请人信息 + 申请时间 + 期望完成时间
- 关联实体链接（任务/文档）

**审批表单**：
- 按 formSchema 渲染表单数据（只读）
- 附件列表

**流程图**（增强 ApprovalFlowDiagram）：
- 支持条件分支可视化（分支线 + 标签）
- 并行节点显示为并排卡片
- 当前激活节点高亮（支持多激活节点）

**操作区域**：
- 同意 / 拒绝 / 转交 / 加签 / 委托 按钮
- 审批意见输入框
- 抄送人列表

**操作历史**：
- 时间线展示所有操作记录
- 每条记录显示：操作人、操作类型、节点、时间、备注

**AI 审批建议**（已有 ApprovalAdvicePanel）：
- 风险评估、审批建议、附加条件

#### 1.6.4 委托设置页面（新增）

- 委托列表：显示当前生效的委托和历史委托
- 创建委托：选择代理人、起止时间、原因
- 委托生效期间，审批任务自动转发给代理人

---

## 2. 文档级权限

### 2.1 权限模型概述

#### 2.1.1 当前文档权限的实现方式

**工作区级 RBAC（已有）**：
- 4 种角色：owner / admin / member / viewer
- 8 个模块：tasks / decisions / documents / messages / members / billing / analytics / settings
- `MemberPermission` 模型支持角色+模块粒度的权限覆盖
- `TemporaryGrant` 模型支持限时角色提升
- 权限矩阵在代码内常量定义（`permissions.ts`），零 DB 查询

**文档级权限（已有，阶段 6 实现）**：
- `DocumentPermission` 模型：按文档+用户/角色授权
- 权限级别：view / comment / edit / manage / transfer
- 授权对象：user（指定用户）/ role（按角色）
- 文档可见性：private / workspace / shared
- 分享链接：shareToken / sharePassword / shareExpiresAt / shareSlug
- API：GET/POST /documents/{id}/permissions，PATCH/DELETE /documents/{id}/permissions/{pid}

**现有局限性**：
1. 无文件夹级权限继承机制
2. 文档权限检查未集成到文档访问中间件（仅在 permissions API 内检查）
3. 无权限继承链（文件夹 → 子文件夹 → 文档）
4. 无权限批量操作（如批量授权/撤销）
5. 无权限变更审计日志
6. 无外部用户（非工作区成员）的文档分享权限

### 2.2 权限层级设计

#### 2.2.1 三层权限体系

```
┌─────────────────────────────────────────────┐
│  工作区级权限（RBAC）                        │
│  owner / admin / member / viewer             │
│  → 决定用户能否进入工作区、访问哪些模块       │
├─────────────────────────────────────────────┤
│  文件夹级权限（继承机制）                     │
│  Space → Folder → SubFolder                  │
│  → 决定用户能否看到/操作某个文件夹及其内容    │
│  → 权限向下继承，子项默认继承父项权限         │
├─────────────────────────────────────────────┤
│  文档级权限（细粒度）                         │
│  view / comment / edit / manage / share      │
│  → 决定用户对单个文档的具体操作权限           │
│  → 可覆盖文件夹继承的权限                     │
└─────────────────────────────────────────────┘
```

#### 2.2.2 权限优先级规则

1. **工作区级**：owner 短路（永远全权），admin 次之
2. **文档作者**：自动拥有 manage 权限（不需显式授权）
3. **文件夹继承**：子项默认继承父文件夹权限
4. **文档级覆盖**：文档级权限可覆盖文件夹继承的权限（只能放宽，不能收紧）
5. **显式授权**：DocumentPermission 记录优先于继承权限
6. **分享链接**：外部用户通过分享链接访问，权限为 view（或 link 配置的权限）

#### 2.2.3 权限判定算法

```typescript
async function checkDocumentPermission(
  userId: string,
  documentId: string,
  requiredPermission: "view" | "comment" | "edit" | "manage" | "share"
): Promise<boolean> {
  // 1. 查工作区角色
  const role = await getWorkspaceRole(userId, workspaceId);
  if (role === "owner") return true;
  if (role === "admin") return true;

  // 2. 查文档作者
  const doc = await getDocument(documentId);
  if (doc.authorId === userId) return true;

  // 3. 查文档级显式授权（DocumentPermission）
  const docPerm = await getDocumentPermission(documentId, userId);
  if (docPerm && hasPermissionLevel(docPerm.permission, requiredPermission)) {
    return true;
  }

  // 4. 查文件夹继承权限（向上递归）
  if (doc.folderId) {
    const folderPerm = await getInheritedFolderPermission(doc.folderId, userId);
    if (folderPerm && hasPermissionLevel(folderPerm, requiredPermission)) {
      return true;
    }
  }

  // 5. 查工作区级文档模块权限
  const modulePerm = await checkModulePermission(role, "documents", actionForPermission(requiredPermission));
  return modulePerm;
}
```

权限级别层级：`view < comment < edit < manage < share`

### 2.3 数据库模型设计

#### 2.3.1 增强现有 DocumentPermission

```prisma
model DocumentPermission {
  // ── 现有字段保持不变 ──
  id          String   @id @default(uuid()) @db.Uuid
  documentId  String   @map("document_id") @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  granteeType String   @map("grantee_type") @db.VarChar(20)  // user | role | dept | link
  granteeId   String   @map("grantee_id") @db.VarChar(100)
  permission  String   @db.VarChar(20)                       // view | comment | edit | manage | transfer
  grantedBy   String?  @map("granted_by") @db.Uuid
  createdAt   DateTime @default(now()) @db.Timestamptz @map("created_at")

  // ── 新增字段 ──
  /// 权限来源：explicit（显式授权）| inherited（文件夹继承）| author（作者自动）
  source      String   @default("explicit") @db.VarChar(20)
  /// 继承来源文件夹 ID（source=inherited 时）
  inheritedFromId String? @map("inherited_from_id") @db.Uuid
  /// 过期时间（null = 永不过期）
  expiresAt   DateTime? @map("expires_at") @db.Timestamptz

  document    Document  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  granter     User?     @relation("DocumentPermissionGranter", fields: [grantedBy], references: [id], onDelete: SetNull)

  @@unique([documentId, granteeType, granteeId])
  @@index([documentId])
  @@index([workspaceId, granteeType, granteeId])
  @@map("document_permissions")
}
```

#### 2.3.2 新增模型

**FolderPermission** — 文件夹级权限：

```prisma
/// 文件夹级权限：控制对 Space/Folder 的访问权限
/// 权限向下继承：子文件夹和文档默认继承父文件夹的权限
model FolderPermission {
  id          String   @id @default(uuid()) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  /// 授权目标：folder 或 space（space 是顶层容器，也需权限控制）
  targetType  String   @map("target_type") @db.VarChar(10)  // folder | space
  targetId    String   @map("target_id") @db.Uuid
  granteeType String   @map("grantee_type") @db.VarChar(20)  // user | role | dept
  granteeId   String   @map("grantee_id") @db.VarChar(100)
  /// 权限级别：view | edit | manage
  permission  String   @db.VarChar(20)
  grantedBy   String?  @map("granted_by") @db.Uuid
  /// 是否向下继承（默认 true，子项继承此权限）
  inheritable Boolean  @default(true)
  createdAt   DateTime @default(now()) @db.Timestamptz @map("created_at")
  updatedAt   DateTime @updatedAt @db.Timestamptz @map("updated_at")

  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  granter     User?     @relation("FolderPermissionGranter", fields: [grantedBy], references: [id], onDelete: SetNull)

  @@unique([targetType, targetId, granteeType, granteeId])
  @@index([targetType, targetId])
  @@index([workspaceId, granteeType, granteeId])
  @@map("folder_permissions")
}
```

**ShareLinkPermission** — 分享链接权限（增强现有分享）：

```prisma
/// 分享链接权限：外部用户通过链接访问文档的权限配置
/// 与 Document.shareToken 配合使用，支持多种权限级别
model ShareLinkPermission {
  id          String   @id @default(uuid()) @db.Uuid
  documentId  String   @map("document_id") @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  /// 分享链接 token（与 Document.shareToken 关联）
  shareToken  String   @unique @map("share_token") @db.VarChar(64)
  /// 链接权限级别：view | comment | edit
  permission  String   @default("view") @db.VarChar(20)
  /// 是否允许下载
  allowDownload Boolean @default(false) @map("allow_download")
  /// 是否允许打印
  allowPrint  Boolean  @default(false) @map("allow_print")
  /// 是否允许复制内容
  allowCopy   Boolean  @default(true) @map("allow_copy")
  /// 访问密码 hash（null = 无密码）
  passwordHash String? @map("password_hash") @db.VarChar(100)
  /// 过期时间（null = 永不过期）
  expiresAt   DateTime? @map("expires_at") @db.Timestamptz
  /// 访问次数限制（null = 不限）
  maxViews    Int?     @map("max_views")
  /// 当前访问次数
  viewCount   Int      @default(0) @map("view_count")
  /// 创建者
  createdBy   String?  @map("created_by") @db.Uuid
  createdAt   DateTime @default(now()) @db.Timestamptz @map("created_at")

  document    Document  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([documentId])
  @@map("share_link_permissions")
}
```

**PermissionAuditLog** — 权限变更审计日志：

```prisma
/// 权限变更审计日志：记录所有权限授予/撤销/修改操作
model PermissionAuditLog {
  id          String   @id @default(uuid()) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  /// 操作类型：grant | revoke | update
  action      String   @db.VarChar(20)
  /// 权限目标类型：document | folder | space
  targetType  String   @map("target_type") @db.VarChar(20)
  targetId    String   @map("target_id") @db.Uuid
  /// 被授权对象
  granteeType String   @map("grantee_type") @db.VarChar(20)
  granteeId   String   @map("grantee_id") @db.VarChar(100)
  /// 变更前权限（action=update/revoke 时）
  oldPermission String? @map("old_permission") @db.VarChar(20)
  /// 变更后权限（action=grant/update 时）
  newPermission String? @map("new_permission") @db.VarChar(20)
  /// 操作人
  operatorId  String   @map("operator_id") @db.Uuid
  /// 操作原因
  reason      String?  @db.Text
  createdAt   DateTime @default(now()) @db.Timestamptz @map("created_at")

  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([targetType, targetId, createdAt])
  @@index([workspaceId, granteeType, granteeId])
  @@map("permission_audit_logs")
}
```

### 2.4 API 端点设计

#### 2.4.1 现有 API（保持兼容）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/workspaces/{wid}/documents/{id}/permissions` | 文档权限列表 |
| POST | `/v1/workspaces/{wid}/documents/{id}/permissions` | 添加文档权限 |
| PATCH | `/v1/workspaces/{wid}/documents/{id}/permissions/{pid}` | 更新文档权限 |
| DELETE | `/v1/workspaces/{wid}/documents/{id}/permissions/{pid}` | 删除文档权限 |

#### 2.4.2 新增 API

| 方法 | 路径 | 说明 | Body |
|------|------|------|------|
| GET | `/v1/workspaces/{wid}/folders/{fid}/permissions` | 文件夹权限列表 | — |
| POST | `/v1/workspaces/{wid}/folders/{fid}/permissions` | 添加文件夹权限 | `{ granteeType, granteeId, permission, inheritable? }` |
| PATCH | `/v1/workspaces/{wid}/folders/{fid}/permissions/{pid}` | 更新文件夹权限 | `{ permission?, inheritable? }` |
| DELETE | `/v1/workspaces/{wid}/folders/{fid}/permissions/{pid}` | 删除文件夹权限 | — |
| GET | `/v1/workspaces/{wid}/spaces/{sid}/permissions` | 空间权限列表 | — |
| POST | `/v1/workspaces/{wid}/spaces/{sid}/permissions` | 添加空间权限 | `{ granteeType, granteeId, permission, inheritable? }` |
| PATCH | `/v1/workspaces/{wid}/spaces/{sid}/permissions/{pid}` | 更新空间权限 | `{ permission?, inheritable? }` |
| DELETE | `/v1/workspaces/{wid}/spaces/{sid}/permissions/{pid}` | 删除空间权限 | — |
| GET | `/v1/workspaces/{wid}/documents/{id}/permissions/check` | 检查当前用户权限 | `?permission=view\|comment\|edit\|manage\|share` |
| POST | `/v1/workspaces/{wid}/documents/{id}/permissions/batch` | 批量授权 | `{ grants: [{ granteeType, granteeId, permission }] }` |
| GET | `/v1/workspaces/{wid}/share-links` | 分享链接列表 | — |
| POST | `/v1/workspaces/{wid}/documents/{id}/share-links` | 创建分享链接 | `{ permission, allowDownload?, allowPrint?, password?, expiresAt?, maxViews? }` |
| PATCH | `/v1/workspaces/{wid}/share-links/{sid}` | 更新分享链接 | `{ permission?, allowDownload?, ... }` |
| DELETE | `/v1/workspaces/{wid}/share-links/{sid}` | 删除分享链接 | — |
| GET | `/v1/workspaces/{wid}/permissions/audit` | 权限审计日志 | `?targetType=&targetId=&page=&limit=` |

#### 2.4.3 API 详细设计

**权限检查** — `GET /documents/{id}/permissions/check`

```typescript
// Request: ?permission=view
// Response 200
{
  code: 200,
  data: {
    permission: "view",          // 请求的权限
    granted: true,               // 是否拥有
    source: "explicit",          // 权限来源：explicit | inherited | author | workspace
    effectivePermission: "edit"  // 当前用户实际拥有的最高权限
  }
}
```

**批量授权** — `POST /documents/{id}/permissions/batch`

```typescript
// Request
{
  grants: [
    { granteeType: "user", granteeId: "uuid-1", permission: "view" },
    { granteeType: "user", granteeId: "uuid-2", permission: "edit" },
    { granteeType: "role", granteeId: "member", permission: "view" }
  ]
}

// Response 201
{
  code: 201,
  data: {
    created: 3,
    skipped: 0,   // 已存在的授权被跳过
    errors: []
  }
}
```

**文件夹权限继承计算** — 内部函数

```typescript
async function computeInheritedPermissions(
  folderId: string,
  userId: string
): Promise<string | null> {
  // 从当前文件夹开始向上递归
  let currentFolder = await getFolder(folderId);
  while (currentFolder) {
    // 查当前文件夹的显式权限
    const perm = await getFolderPermission(currentFolder.id, userId);
    if (perm && perm.inheritable) {
      return perm.permission;
    }
    // 向上递归到父文件夹
    if (currentFolder.parentId) {
      currentFolder = await getFolder(currentFolder.parentId);
    } else {
      // 到达 Space 层级
      const spacePerm = await getSpacePermission(currentFolder.spaceId, userId);
      if (spacePerm && spacePerm.inheritable) {
        return spacePerm.permission;
      }
      break;
    }
  }
  return null;
}
```

### 2.5 前端页面设计

#### 2.5.1 权限管理面板（新增组件 DocumentPermissionPanel）

**触发方式**：文档详情页右上角"分享"按钮 → 弹出权限管理面板

**面板布局**：

```
┌──────────────────────────────────────────────┐
│  📄 文档权限管理                              │
│  ─────────────────────────────────────────   │
│                                              │
│  🔗 分享链接                                  │
│  ┌────────────────────────────────────────┐  │
│  │ [开启链接分享]  权限: [查看 ▾]         │  │
│  │ □ 允许下载  □ 允许打印  □ 允许复制     │  │
│  │ 过期: [永不过期 ▾]  密码: [设置]       │  │
│  │ 链接: https://...                      │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  👥 协作者                                    │
│  ┌────────────────────────────────────────┐  │
│  │ 👤 张三  edit  [更改 ▾]  [移除]        │  │
│  │ 👤 李四  view  [更改 ▾]  [移除]        │  │
│  │ 🏷️ member角色  view  [更改 ▾]  [移除]  │  │
│  └────────────────────────────────────────┘  │
│  [+ 添加协作者]                               │
│                                              │
│  📁 继承权限                                  │
│  ┌────────────────────────────────────────┐  │
│  │ 来自文件夹「产品文档」: view (继承)     │  │
│  │ 来自空间「技术文档」: edit (继承)       │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  📊 权限审计                                  │
│  [查看审计日志 →]                             │
└──────────────────────────────────────────────┘
```

#### 2.5.2 分享对话框（增强现有分享功能）

**分享对话框** — 简化版（快速分享）：

```
┌────────────────────────────────────────┐
│  🔗 分享文档                            │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │  链接分享                         │  │
│  │  [开启] → 生成链接                │  │
│  │  权限: [查看 ▾]                   │  │
│  │  [复制链接]                       │  │
│  └──────────────────────────────────┘  │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │  邀请协作者                       │  │
│  │  [输入姓名或邮箱...] [添加]       │  │
│  │  权限: [查看 ▾]                   │  │
│  └──────────────────────────────────┘  │
│                                        │
│  [高级设置 →]                          │
└────────────────────────────────────────┘
```

#### 2.5.3 文件夹权限管理面板

**触发方式**：文件夹右键菜单 → "权限管理"

**面板内容**：
- 协作者列表（与文档权限面板类似）
- 继承设置：是否向下继承
- 子项影响预览：显示受影响的文档/子文件夹数量

#### 2.5.4 权限审计日志页面

**触发方式**：权限管理面板 → "查看审计日志"

**日志列表**：
- 时间线展示权限变更记录
- 每条记录：操作人、操作类型（授予/撤销/修改）、目标、变更前后
- 筛选：按操作类型、按目标、按时间范围

---

## 3. 实施计划

### 3.1 分阶段实施

#### Phase 1: 审批流引擎增强（优先级：高）

| 步骤 | 任务 | 依赖 | 预估工作量 |
|------|------|------|-----------|
| 1.1 | Prisma schema 更新：ApprovalTemplate/Instance/Operation 增强字段 | — | 0.5 天 |
| 1.2 | 数据库迁移 + 现有数据兼容验证 | 1.1 | 0.5 天 |
| 1.3 | 条件审批引擎：JSON Logic 求值 + 条件路由 | 1.1 | 2 天 |
| 1.4 | 转交/加签/委托 API 实现 | 1.1 | 1.5 天 |
| 1.5 | 抄送功能：ApprovalCcRecord + API + 通知 | 1.1 | 1 天 |
| 1.6 | 审批委托设置：ApprovalDelegate + API | 1.1 | 1 天 |
| 1.7 | 催办功能 + SLA 超时检测 | 1.4 | 0.5 天 |
| 1.8 | 前端：审批列表标签页增强（待审批/发起/抄送） | 1.5 | 1 天 |
| 1.9 | 前端：审批详情页增强（转交/加签/委托按钮） | 1.4 | 1.5 天 |
| 1.10 | 前端：模板编辑器（可视化流程设计） | 1.3 | 3 天 |
| 1.11 | 前端：委托设置页面 | 1.6 | 1 天 |
| 1.12 | 前端：流程图增强（条件分支可视化） | 1.3 | 2 天 |

**Phase 1 合计**：约 16 天

#### Phase 2: 文档级权限增强（优先级：高）

| 步骤 | 任务 | 依赖 | 预估工作量 |
|------|------|------|-----------|
| 2.1 | Prisma schema 更新：DocumentPermission 增强 + FolderPermission + ShareLinkPermission + PermissionAuditLog | — | 1 天 |
| 2.2 | 数据库迁移 + 现有数据兼容验证 | 2.1 | 0.5 天 |
| 2.3 | 文件夹权限 API（CRUD + 继承计算） | 2.1 | 2 天 |
| 2.4 | 空间权限 API（CRUD + 继承计算） | 2.3 | 1 天 |
| 2.5 | 权限检查中间件：集成到文档/文件夹访问路由 | 2.3 | 2 天 |
| 2.6 | 批量授权 API | 2.1 | 0.5 天 |
| 2.7 | 分享链接增强 API（ShareLinkPermission） | 2.1 | 1.5 天 |
| 2.8 | 权限审计日志 API | 2.1 | 1 天 |
| 2.9 | 前端：文档权限管理面板 | 2.5 | 2 天 |
| 2.10 | 前端：分享对话框增强 | 2.7 | 1 天 |
| 2.11 | 前端：文件夹权限管理面板 | 2.3 | 1.5 天 |
| 2.12 | 前端：权限审计日志页面 | 2.8 | 1 天 |

**Phase 2 合计**：约 15 天

#### Phase 3: 集成与优化（优先级：中）

| 步骤 | 任务 | 依赖 | 预估工作量 |
|------|------|------|-----------|
| 3.1 | 审批流 + 文档权限联动（审批通过自动授权/撤销文档权限） | Phase 1 + 2 | 2 天 |
| 3.2 | 审批统计仪表盘 | Phase 1 | 1.5 天 |
| 3.3 | 权限缓存优化（Redis 缓存权限判定结果） | Phase 2 | 1 天 |
| 3.4 | 审批模板分类管理 + 系统内置模板 | Phase 1 | 1 天 |
| 3.5 | 文档可见性策略增强（private/workspace/shared 联动权限） | Phase 2 | 1 天 |
| 3.6 | E2E 测试 + 集成测试 | Phase 1 + 2 | 2 天 |

**Phase 3 合计**：约 8.5 天

### 3.2 优先级排序

```
P0（必须先做）:
  1.1 Prisma schema 更新（审批流）
  2.1 Prisma schema 更新（文档权限）
  1.2 数据库迁移
  2.2 数据库迁移

P1（核心功能）:
  1.3 条件审批引擎
  2.3 文件夹权限 API
  2.5 权限检查中间件集成
  1.4 转交/加签 API
  1.9 审批详情页增强

P2（重要功能）:
  1.5 抄送功能
  1.6 委托设置
  2.7 分享链接增强
  2.9 文档权限管理面板
  1.10 模板编辑器

P3（增强功能）:
  3.1 审批+权限联动
  3.2 审批统计
  3.3 权限缓存优化
  1.12 流程图增强
  2.11 文件夹权限面板
  3.6 E2E 测试
```

### 3.3 技术选型

| 领域 | 选型 | 理由 |
|------|------|------|
| 条件表达式引擎 | json-logic-js | 标准格式、安全求值、无 eval 注入风险 |
| 流程图可视化 | React Flow | 成熟的开源流程图库、支持自定义节点 |
| 权限缓存 | Redis（可选） | 减少权限判定的 DB 查询，TTL 自动失效 |
| 表单渲染 | React Hook Form + Zod | 与现有项目技术栈一致 |
| 审计日志 | PostgreSQL + 时间分区 | 利用现有 PG 基础设施，分区管理大日志表 |

### 3.4 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 条件表达式求值性能 | 条件节点多时可能慢 | 求值结果缓存到 conditionCache 字段 |
| 文件夹权限继承递归 | 深层嵌套文件夹权限计算慢 | 限制文件夹嵌套层数（已有 5 层限制）+ 缓存 |
| 现有审批流兼容 | 增强后可能破坏现有数据 | nodes JSON 保持向后兼容，新字段可选 |
| 权限检查中间件改造 | 可能影响现有文档访问 | 分阶段迁移，先新增再替换，保留旧逻辑兜底 |
| 分享链接安全 | 外部用户访问可能泄露数据 | 密码保护 + 过期时间 + 访问次数限制 + 水印 |

---

## 附录 A: 现有代码索引

### 审批流相关文件

| 文件 | 说明 |
|------|------|
| `web/prisma/schema.prisma` (L1488-1565) | ApprovalTemplate/Instance/Operation 模型定义 |
| `web/app/api/v1/workspaces/[wid]/approvals/templates/route.ts` | 模板列表/创建 API |
| `web/app/api/v1/workspaces/[wid]/approvals/templates/[tid]/route.ts` | 模板更新/删除 API |
| `web/app/api/v1/workspaces/[wid]/approvals/instances/route.ts` | 实例列表/发起 API |
| `web/app/api/v1/workspaces/[wid]/approvals/instances/[aid]/route.ts` | 实例详情/撤回 API |
| `web/app/api/v1/workspaces/[wid]/approvals/instances/[aid]/approve/route.ts` | 同意审批 API |
| `web/app/api/v1/workspaces/[wid]/approvals/instances/[aid]/reject/route.ts` | 拒绝审批 API |
| `web/app/api/v1/workspaces/[wid]/approvals/instances/[aid]/withdraw/route.ts` | 撤回审批 API |
| `web/components/approval/ApprovalList.tsx` | 审批列表组件 |
| `web/components/approval/ApprovalListPageClient.tsx` | 审批列表页客户端组件 |
| `web/components/approval/ApprovalDetail.tsx` | 审批详情组件 |
| `web/components/approval/ApprovalFlowDiagram.tsx` | 审批流程图组件 |
| `web/components/approval/ApprovalSubmit.tsx` | 发起审批组件 |
| `web/components/approval/ApprovalTemplateManage.tsx` | 模板管理组件 |
| `web/components/ai/ApprovalAdvicePanel.tsx` | AI 审批建议面板 |
| `web/app/[locale]/w/[wid]/approvals/page.tsx` | 审批列表页路由 |
| `web/app/[locale]/w/[wid]/approvals/[aid]/page.tsx` | 审批详情页路由 |

### 权限相关文件

| 文件 | 说明 |
|------|------|
| `web/lib/permissions.ts` | 权限检查中间件（RBAC + 模块权限矩阵 + 临时授权） |
| `web/prisma/schema.prisma` (L1060-1074) | MemberPermission 模型 |
| `web/prisma/schema.prisma` (L1117-1139) | TemporaryGrant 模型 |
| `web/prisma/schema.prisma` (L1568-1591) | DocumentPermission 模型 |
| `web/app/api/v1/workspaces/[wid]/documents/[id]/permissions/route.ts` | 文档权限列表/创建 API |
| `web/app/api/v1/workspaces/[wid]/documents/[id]/permissions/[pid]/route.ts` | 文档权限更新/删除 API |

### 文档相关文件

| 文件 | 说明 |
|------|------|
| `web/prisma/schema.prisma` (L612-691) | Document 模型（含 visibility、shareToken 等字段） |
| `web/prisma/schema.prisma` (L1147-1171) | Space 模型 |
| `web/prisma/schema.prisma` (L1174-1202) | Folder 模型 |