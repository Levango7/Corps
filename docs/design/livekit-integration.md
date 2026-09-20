# LiveKit 音视频集成架构设计

> **路线图**: P1-3  
> **状态**: 已实现（本文档为架构总结 + 未来规划）  
> **最后更新**: 2026-09-20

---

## 目录

1. [LiveKit 概述与选型](#1-livekit-概述与选型)
2. [架构设计](#2-架构设计)
3. [数据库模型设计](#3-数据库模型设计)
4. [API 端点设计](#4-api-端点设计)
5. [前端页面设计](#5-前端页面设计)
6. [与现有功能的集成](#6-与现有功能的集成)
7. [实施计划](#7-实施计划)
8. [运维与部署](#8-运维与部署)

---

## 1. LiveKit 概述与选型

### 1.1 为什么选择 LiveKit

LiveKit 是基于 WebRTC 的开源实时音视频通信平台，采用 SFU（Selective Forwarding Unit）架构。选择 LiveKit 的核心原因：

| 维度 | LiveKit | 自建 WebRTC | Zoom SDK | 飞书/钉钉 SDK |
|------|---------|-------------|----------|---------------|
| 开源协议 | Apache 2.0 | — | 闭源 | 闭源 |
| 部署方式 | 自托管 / Cloud | 全自建 | SaaS only | SaaS only |
| 数据主权 | 完全可控 | 完全可控 | 不可控 | 不可控 |
| 前端 SDK | `@livekit/components-react` | 需自研 | 有限定制 | 有限定制 |
| 录制能力 | 内置 Egress | 需自研 | 内置 | 内置 |
| NAT 穿透 | 内置 TURN | 需自建 | 内置 | 内置 |
| 端到端加密 | 支持 E2EE | 需自研 | 不支持 | 不支持 |
| 成本 | 自托管仅服务器成本 | 开发成本极高 | 按分钟付费 | 按席位付费 |

**核心决策因素**：
- **数据主权**：企业协作工具需要数据自主可控，自托管 LiveKit 保证音视频流不经过第三方
- **开发效率**：`@livekit/components-react` 提供预置的 `VideoConference`、`PreJoin` 组件，大幅降低前端开发成本
- **运维成本**：单个 Docker 容器即可运行，与现有 docker-compose 架构无缝集成
- **扩展性**：支持录制（Egress）、端到端加密（E2EE）、TURN 服务器，功能覆盖完整

### 1.2 SDK 依赖

```json
{
  "@livekit/components-react": "^2.9.24",  // 前端 React 组件库
  "livekit-client": "^2.22.3",              // 浏览器端 WebRTC 客户端
  "livekit-server-sdk": "^2.19.0"           // 服务端 SDK（Token 签发、Egress 录制、Webhook 验签）
}
```

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        浏览器（前端）                             │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ MeetingList │  │ MeetingLobby │  │ MeetingRoom            │ │
│  │             │  │ (PreJoin)    │  │ (LiveKitRoom +         │ │
│  │             │  │              │  │  VideoConference)      │ │
│  └──────┬──────┘  └──────┬───────┘  └───────┬────────────────┘ │
│         │                │                   │                  │
│         │   REST API      │   REST API        │  WebSocket +     │
│         │   (HTTP)        │   (HTTP)          │  WebRTC (UDP)    │
└─────────┼────────────────┼───────────────────┼──────────────────┘
          │                │                   │
          ▼                ▼                   ▼
┌─────────────────────────────────┐  ┌──────────────────────────┐
│      Next.js App (port 3000)    │  │  LiveKit Server          │
│                                 │  │  (port 7880 API/WS)      │
│  ┌───────────────────────────┐  │  │  (port 7881 UDP RTC)     │
│  │ API Routes                │  │  │  (port 7882 UDP TURN)    │
│  │                           │  │  │                          │
│  │ /v1/workspaces/{wid}/     │  │  │  ┌────────────────────┐  │
│  │   meetings (CRUD)         │  │  │  │ SFU 引擎           │  │
│  │ /v1/workspaces/{wid}/     │  │  │  │ - 媒体路由         │  │
│  │   meetings/{mid}/join     │  │  │  │ - NAT 穿透         │  │
│  │ /v1/workspaces/{wid}/     │  │  │  │ - TURN 中继        │  │
│  │   meetings/{mid}/leave    │  │  │  │ - 录制 Egress      │  │
│  │ /v1/webhooks/livekit      │  │  │  └────────────────────┘  │
│  └───────────┬───────────────┘  │  │                          │
│              │                  │  │  Webhook 回调            │
│              │                  │  │  → /v1/webhooks/livekit  │
│  ┌───────────▼───────────────┐  │  └──────────────────────────┘
│  │ Token 签发                │  │
│  │ (livekit-server-sdk       │  │
│  │  AccessToken)             │  │
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │ PostgreSQL (Prisma)       │  │
│  │ - Meeting                 │  │
│  │ - MeetingParticipant      │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

### 2.2 LiveKit Server 部署方式

**选型：自托管（Self-hosted）**

理由：
- 数据主权：音视频流不经过第三方云服务
- 成本可控：仅服务器资源成本，无按分钟/按席位计费
- 与现有基础设施一致：Docker Compose 中已有 PostgreSQL、Redis，LiveKit 作为第三个服务无缝加入

**部署配置**（`livekit.yaml`）：

```yaml
# API/WebSocket 接入
port: 7880
bind_addresses: ["0.0.0.0"]

# API 密钥对（与 .env 的 LIVEKIT_API_KEY/SECRET 一致）
keys:
  devkey: secret  # 生产环境必须替换为强随机值

# RTC 音视频媒体配置
rtc:
  tcp_port: 7881
  port_range: "50000-60000"
  use_external_ip: true
  enable_loopback_candidate: false
  jitter_buffer:
    enabled: true
    max_latency: 500

# 录制存储配置（S3 兼容）
recording:
  enabled: true
  bucket: "${S3_BUCKET}"
  endpoint: "${S3_ENDPOINT}"

# 端到端加密（默认关闭）
e2ee:
  enabled: "${LIVEKIT_E2EE_ENABLED:-false}"
  algorithm: aes-gcm

# Webhook 回调
webhook:
  api_key: devkey
  urls:
    - "http://app:3000/api/v1/webhooks/livekit"

log_level: info
```

**Docker Compose 集成**：

```yaml
livekit:
  image: livekit/livekit-server:latest
  container_name: corps-livekit
  restart: unless-stopped
  ports:
    - "7880:7880"       # API/WebSocket
    - "7881:7881/udp"   # RTC 媒体
    - "7882:7882/udp"   # TURN
  volumes:
    - ./livekit.yaml:/config.yaml:ro
  networks:
    - corps-net
```

### 2.3 NAT 穿透与 TURN 服务器

LiveKit Server 内置 TURN 服务（端口 7882），无需额外部署 coturn。`use_external_ip: true` 自动检测外部 IP 用于 ICE 候选地址。

**NAT 穿透策略**：
1. **优先 STUN**：LiveKit 自动收集 host/srflx 候选地址
2. **回退 TURN**：对称 NAT 场景下通过 7882 端口中继媒体流
3. **`enable_loopback_candidate: false`**：生产环境禁用 loopback，避免内网候选地址干扰

### 2.4 Token 生成机制

**选型：服务端签发 JWT（通过 `livekit-server-sdk` 的 `AccessToken`）**

```typescript
// 使用 livekit-server-sdk 的 AccessToken（非手动 jsonwebtoken）
const token = new AccessToken(apiKey, apiSecret, {
  identity: userId,
  name: userName,
  ttl: ttlSeconds,  // 默认 7200 秒（2 小时）
  metadata: e2eeEnabled ? JSON.stringify({ e2ee: true }) : undefined,
});

// 权限分层
token.addGrant({
  room: roomName,
  roomJoin: true,
  canPublish: true,      // 所有参与者可发布音视频
  canSubscribe: true,    // 所有参与者可订阅他人音视频
  roomRecord: isHost,    // 仅 host 有录制权限
});
```

**Token 生命周期**：
- 签发：用户点击"加入会议" → 前端 POST `/join` → 后端签发 JWT
- 使用：前端将 token 传入 `<LiveKitRoom token={token} serverUrl={url}>`
- 过期：TTL 到期后 LiveKit 自动断开，前端通过 `rejoin()` 重新获取新 token
- 撤销：会议结束（`status=ended`）后 `/join` 返回 409，token 无法续期

**关键设计决策**：使用 SDK 的 `AccessToken` 而非手动 `jsonwebtoken` 构造，确保 payload 字段（`video.room`/`roomJoin`/`canPublish`/`canSubscribe`）始终符合 LiveKit 最新规范。

---

## 3. 数据库模型设计

### 3.1 Meeting 模型

```prisma
model Meeting {
  id                 String    @id @default(uuid()) @db.Uuid
  workspaceId        String    @map("workspace_id") @db.Uuid
  title              String    @db.VarChar(200)
  description        String?   @db.VarChar(500)
  createdBy          String?   @map("created_by") @db.Uuid

  // LiveKit 房间标识（唯一）
  roomName           String    @unique @map("room_name") @db.VarChar(100)

  // 状态机：scheduled → active → ended | cancelled
  status             String    @default("scheduled") @db.VarChar(20)
  type               String    @default("instant") @db.VarChar(20)  // instant | scheduled | recurring

  // 重复会议（iCal RRULE 格式）
  recurringRule      String?   @map("recurring_rule") @db.VarChar(255)

  // 会议密码（设置后加入需验证）
  password           String?   @db.VarChar(100)

  // 时间线
  scheduledAt        DateTime? @map("scheduled_at") @db.Timestamptz
  startedAt          DateTime? @map("started_at") @db.Timestamptz
  endedAt            DateTime? @map("ended_at") @db.Timestamptz

  // 容量与录制
  maxParticipants    Int       @default(50) @map("max_participants")
  recordingEnabled   Boolean   @default(false) @map("recording_enabled")
  recordingUrl       String?   @map("recording_url") @db.Text
  recordingStartedAt DateTime? @map("recording_started_at") @db.Timestamptz
  recordingStoppedAt DateTime? @map("recording_stopped_at") @db.Timestamptz

  createdAt          DateTime  @default(now()) @db.Timestamptz
  updatedAt          DateTime  @updatedAt @db.Timestamptz

  participants       MeetingParticipant[]
  meetingMinutes     MeetingMinutes[]
  workspace          Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  creator            User?      @relation("MeetingCreator", fields: [createdBy], references: [id], onDelete: SetNull)

  @@index([workspaceId, status])
  @@index([workspaceId, scheduledAt])
  @@map("meetings")
}
```

**状态机**：

```
                    创建
                     │
                     ▼
              ┌─────────────┐
              │  scheduled  │ ← 预约会议初始状态
              └──────┬──────┘
                     │ 首位参与者加入
                     ▼
              ┌─────────────┐
              │   active    │ ← 即时会议创建后直接进入
              └──────┬──────┘
                     │ 所有参与者离开 / 手动结束
                     ▼
              ┌─────────────┐
              │   ended     │ ← 不可再加入（join 返回 409）
              └─────────────┘

              ┌─────────────┐
              │  cancelled  │ ← 手动取消（与 ended 区分：未实际开始）
              └─────────────┘
```

### 3.2 MeetingParticipant 模型

```prisma
model MeetingParticipant {
  id        String    @id @default(uuid()) @db.Uuid
  meetingId String    @map("meeting_id") @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  joinedAt  DateTime  @default(now()) @db.Timestamptz
  leftAt    DateTime? @map("left_at") @db.Timestamptz
  role      String    @default("guest") @db.VarChar(20)  // host | guest

  meeting   Meeting   @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([meetingId, userId])  // 同一用户在同一会议中只有一条记录
  @@index([userId])
  @@map("meeting_participants")
}
```

**关键设计**：
- `@@unique([meetingId, userId])`：同一用户在同一会议中只有一条记录，重复加入通过 `upsert` 重置 `joinedAt`/`leftAt`
- `leftAt = null` 表示仍在会议中（用于在线人数统计）
- `role = host` 仅授予会议创建者（`createdBy === userId`），host 有录制权限
- 参与者记录由 **LiveKit Webhook** 自动维护（`participant_joined`/`participant_left` 事件），而非前端 API 手动写入

---

## 4. API 端点设计

### 4.1 端点总览

| 方法 | 路径 | 功能 | 权限 |
|------|------|------|------|
| GET | `/v1/workspaces/{wid}/meetings` | 会议列表（分页 + 状态过滤） | 工作区成员 |
| POST | `/v1/workspaces/{wid}/meetings` | 创建会议 | 工作区成员 |
| GET | `/v1/workspaces/{wid}/meetings/{mid}` | 会议详情（含参与者） | 工作区成员 |
| PATCH | `/v1/workspaces/{wid}/meetings/{mid}` | 更新会议 | 创建者/admin |
| DELETE | `/v1/workspaces/{wid}/meetings/{mid}` | 结束会议 | 创建者/admin |
| POST | `/v1/workspaces/{wid}/meetings/{mid}/join` | 加入会议（获取 token） | 工作区成员 |
| POST | `/v1/workspaces/{wid}/meetings/{mid}/leave` | 离开会议 | 工作区成员 |
| POST | `/v1/workspaces/{wid}/meetings/{mid}/recording/start` | 启动录制 | 创建者/admin |
| POST | `/v1/workspaces/{wid}/meetings/{mid}/recording/stop` | 停止录制 | 创建者/admin |
| POST | `/v1/webhooks/livekit` | LiveKit 事件回调 | Webhook 签名验证 |

### 4.2 创建会议

```
POST /v1/workspaces/{wid}/meetings

Request Body:
{
  "title": "周会",                    // 必填，1-200 字符
  "description": "本周工作同步",       // 可选，最多 500 字符
  "type": "instant",                  // instant | scheduled | recurring
  "scheduledAt": "2026-09-20T10:00:00Z",  // scheduled/recurring 时必填
  "maxParticipants": 50,              // 可选，默认 50
  "recordingEnabled": false,          // 可选，默认 false
  "recurringRule": "FREQ=WEEKLY;INTERVAL=1",  // recurring 时使用 iCal RRULE
  "password": "secret123"             // 可选，设置后加入需验证
}

Response (201):
{
  "code": 201,
  "data": {
    "id": "uuid",
    "title": "周会",
    "roomName": "meeting-abc12345-1695...",
    "status": "scheduled",
    "type": "instant",
    "creator": { "id": "uuid", "name": "张三", "email": "zhang@example.com" }
  }
}
```

**roomName 生成规则**：`meeting-{wid前8位}-{时间戳}`，确保全局唯一。

### 4.3 加入会议（获取 LiveKit Token）

```
POST /v1/workspaces/{wid}/meetings/{mid}/join

Request Body (可选):
{
  "password": "secret123"  // 会议设置密码时必填（host 免密）
}

Response (200):
{
  "code": 200,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",  // LiveKit JWT
    "url": "ws://livekit:7880",           // LiveKit Server WebSocket 地址
    "roomName": "meeting-abc12345-1695...",
    "e2eeEnabled": false
  }
}

Error Responses:
- 404: 会议不存在
- 403: 密码错误
- 409: 会议已结束 / 人数已满
- 503: LiveKit 服务未配置
```

**Join 流程**：
1. 校验会议存在且属于当前工作区
2. 校验会议状态（`scheduled`/`active` 可加入，`ended` 不可）
3. 密码验证（设置密码且非 host 时需匹配）
4. 在线人数检查（`leftAt=null` 的数量 < `maxParticipants`）
5. `upsert` MeetingParticipant（`joinedAt=now`, `leftAt=null`）
6. `scheduled` 状态自动转为 `active`
7. 使用 `livekit-server-sdk` 的 `AccessToken` 签发 JWT
8. 返回 `{ token, url, roomName, e2eeEnabled }`

### 4.4 离开会议

```
POST /v1/workspaces/{wid}/meetings/{mid}/leave

Response (200):
{ "code": 200, "data": null }
```

**Leave 流程**：
1. 更新 `MeetingParticipant.leftAt = now`（仅当当前 `leftAt = null`）
2. 检查剩余在线参与者数；若为 0，自动将会议 `status` 设为 `ended`
3. 幂等：未加入或已离开均返回 200

**页面卸载处理**：
- `beforeunload` / `pagehide` 事件触发 `navigator.sendBeacon(leaveUrl)`，确保关闭标签页时也能通知后端
- 组件卸载时也调用 leave API（`useEffect` cleanup）

### 4.5 结束会议

```
DELETE /v1/workspaces/{wid}/meetings/{mid}

Response (200):
{ "code": 200, "data": null, "message": "会议已结束" }
```

设置 `status = "ended"`, `endedAt = now`。仅创建者或 admin/owner 可操作。

### 4.6 录制控制

```
POST /v1/workspaces/{wid}/meetings/{mid}/recording/start
POST /v1/workspaces/{wid}/meetings/{mid}/recording/stop
```

**录制启动流程**：
1. 前置条件：会议 `status = active`、`recordingEnabled = true`、操作者为 host/admin
2. 使用 `livekit-server-sdk` 的 `EgressClient.startRoomCompositeEgress` 启动房间合成录制
3. 录制文件上传到 S3 兼容存储（通过 `EncodedFileOutput` + `S3Upload` 配置）
4. 将 `egressId` 写入 `recordingUrl`（格式 `egress:{id}`），设置 `recordingStartedAt`
5. 录制完成后，LiveKit Webhook `egress_ended` 事件回填实际文件 URL

### 4.7 LiveKit Webhook

```
POST /v1/webhooks/livekit

处理的事件：
- room_started       → 会议状态改为 active
- room_finished      → 会议状态改为 ended
- participant_joined → upsert 参与者记录（role 由 createdBy 判断）
- participant_left   → 标记参与者 leftAt = now
- egress_ended       → 回填录制文件 URL（recordingUrl）
```

**签名验证**：使用 `livekit-server-sdk` 的 `WebhookReceiver` 验证 `Authorize` 头签名，确保请求来自 LiveKit Server。数据库操作通过 `runWithAuthOp("webhook")` 绕过 RLS（webhook 无用户上下文）。

---

## 5. 前端页面设计

### 5.1 页面路由

| 路由 | 组件 | 功能 |
|------|------|------|
| `/w/{wid}/meetings` | `MeetingList` | 会议列表页（按状态分组 + 创建按钮） |
| `/w/{wid}/meetings/{mid}` | `MeetingLobby` → `MeetingRoom` | 会议详情页（lobby → room 流程） |

### 5.2 会议列表页

**组件**：`components/meeting/MeetingList.tsx`

**功能**：
- 拉取 `GET /api/v1/workspaces/{wid}/meetings?page=1&limit=20`
- 按状态分组显示：进行中（active）/ 已预约（scheduled）/ 已结束（ended）
- 每条显示：标题、时间、参与人数（`_count.participants`）、创建者、状态标签
- 操作按钮：加入（跳转详情页）、结束（DELETE）、编辑（PATCH）
- 30 秒轮询刷新（实时更新状态和参与人数）
- 分页控件
- 创建会议弹窗（`MeetingCreate` 组件）

**关键字段映射**（来源：经验 `2026-09-19-livekit-integration-runtime-antipatterns`）：
- 后端返回 `_count.participants`（Prisma 聚合字段），而非 `participantCount`
- 前端 `interface MeetingItem` 中定义 `_count: { participants: number }`，与 API `select: { _count: { select: { participants: true } } }` 对齐

### 5.3 创建会议弹窗

**组件**：`components/meeting/MeetingCreate.tsx`

**表单字段**：
- 标题（必填，1-200 字符）
- 描述（可选，最多 500 字符）
- 类型：即时（instant）/ 预约（scheduled）/ 重复（recurring）
- 预约时间（scheduled/recurring 时必填）
- 重复频率（recurring 时显示：daily/weekly/monthly，生成 iCal RRULE）
- 最大参与人数（默认 50，最大 500）
- 允许录制（checkbox）
- 会议密码（可选）

**编辑模式**：传入 `meeting` prop 时切换为 PATCH 请求，回填已有值。

### 5.4 会议大厅（Lobby）

**组件**：`components/meetings/MeetingLobby.tsx`

**功能**：
- 使用 LiveKit 预置 `PreJoin` 组件进行设备检测与预览
- 显示会议标题 + 副标题
- 摄像头/麦克风设备选择
- "加入会议"按钮 → 触发 `onJoin` 回调（父组件切换到 `MeetingRoom`）
- 用户选择通过 `usePersistentUserChoices` 持久化，`MeetingRoom` 内的 `VideoConference` 自动继承

### 5.5 视频通话界面（MeetingRoom）

**组件**：`components/meetings/MeetingRoom.tsx`

**核心结构**：

```tsx
<LiveKitRoom
  token={token}
  serverUrl={serverUrl}
  connect={true}
  audio={true}
  video={true}
  onConnected={handleConnected}
  onDisconnected={handleDisconnected}
  onError={handleError}
>
  <VideoConference />          {/* LiveKit 预置：参与者网格 + 控制栏 */}
  <RoomAudioRenderer />        {/* 音频渲染 */}
  {/* 录制控制条（仅 host 可见） */}
</LiveKitRoom>
```

**连接状态机**：

```
joining → connected → disconnected
                ↓           ↓
          reconnecting  (intentional?)
                ↓        Yes → leave + onLeave
          (rejoin?)      No  → reconnecting
                ↓
          30s timeout → disconnected
```

**关键设计**（来源：经验 `2026-09-19-livekit-integration-runtime-antipatterns`）：

1. **disconnect handler 区分断开原因**：
   - 主动挂断（`intentionalLeaveRef = true`）→ 调用 leave API + `onLeave` 回调
   - 意外断开 → 显示"重连中..."，尝试 `rejoin()` 获取新 token，30s 超时才回 lobby

2. **beforeunload / pagehide 清理**：
   - `window.addEventListener("beforeunload", sendLeaveBeacon)`
   - `window.addEventListener("pagehide", sendLeaveBeacon)`
   - 使用 `navigator.sendBeacon(leaveUrl)` 发送（无需 await，页面卸载时可靠）

3. **录制控制**（仅 host 可见）：
   - host 判断：`detail.createdBy === me.id` 或 `participant.role === "host"`
   - 录制按钮调用 `/recording/start` 和 `/recording/stop` API
   - 录制状态指示器（红色脉冲圆点）

4. **错误处理**：
   - LiveKit 未配置（503）→ 显示"会议服务不可用"
   - 连接失败 → 显示错误信息 + "返回"按钮
   - 重连超时 → 显示"已断开" + "返回"按钮

### 5.6 会议详情页流程

**组件**：`app/[locale]/w/[wid]/meetings/[mid]/page.tsx`

**阶段流转**：

```
loading → lobby → room → (leave → lobby | ended)
```

1. **loading**：解包 `params`，并行获取会议详情 + 当前用户名
2. **lobby**：渲染 `MeetingLobby`（设备预览 + 加入按钮）
3. **room**：渲染 `MeetingRoom`（LiveKit 音视频会议）
4. **ended**：会议已结束页面 + "AI 会议流程"按钮（会后阶段）

---

## 6. 与现有功能的集成

### 6.1 与 IM 的集成

**当前状态**：IM 模块已有独立的会话系统（`Conversation`、`ConversationMember`），支持单聊/群聊。

**集成方案**：

| 场景 | 实现方式 | API |
|------|----------|-----|
| 在聊天中发起视频通话 | 在 `ChatWindow` / `ConversationItem` 中增加"视频通话"按钮，调用 `POST /meetings` 创建即时会议，将会话 ID 关联到会议 | 新增 `meetingId` 字段到 `Conversation` 或通过消息 metadata 关联 |
| 会议邀请链接 | 生成 `/w/{wid}/meetings/{mid}` 链接，在聊天消息中以卡片形式展示 | 消息 metadata 中存储 `{ type: "meeting_invite", meetingId }` |
| 会议中的聊天 | LiveKit DataChannel 支持实时消息，或复用现有 IM WebSocket | 短期用 LiveKit DataChannel，长期统一到 IM 系统 |

**建议实现路径**：
1. 在 `Conversation` 模型增加可选 `meetingId` 字段，关联到 `Meeting`
2. 在 `ChatWindow` 顶部工具栏增加"视频通话"按钮
3. 发起通话时创建即时会议 + 在会话中发送会议邀请卡片消息
4. 会议结束后在会话中自动发送"会议已结束"系统消息

### 6.2 与日历的集成

**当前状态**：已有 `CalendarEvent`、`CalendarConnection`（Google/Outlook）模型和双向同步机制。

**集成方案**：

| 场景 | 实现方式 |
|------|----------|
| 预约会议同步到日历 | 创建 `scheduled` 类型会议时，自动创建 `CalendarEvent`，通过现有日历同步推送到 Google/Outlook |
| 日历事件发起会议 | 在日历事件详情页增加"发起视频会议"按钮，创建 `Meeting` 并关联 `CalendarEvent` |
| 会议提醒 | `scheduled` 会议复用现有日历提醒机制（cron 作业 + 通知系统） |

**建议实现路径**：
1. 在 `CalendarEvent` 模型增加可选 `meetingId` 字段
2. 创建 `scheduled` 会议时自动创建对应 `CalendarEvent`
3. 日历同步时保持会议时间与日历事件双向同步
4. 会议开始前 5 分钟通过现有通知系统推送提醒

### 6.3 与任务的集成

**当前状态**：已有完整的 Task 系统（`Task`、`Comment`、`Milestone`）。

**集成方案**：

| 场景 | 实现方式 |
|------|----------|
| 任务相关会议 | 在 Task 详情页增加"发起会议"按钮，创建会议时关联 `taskId` |
| 会议中讨论的任务 | 会议纪要（`MeetingMinutes`）中可关联 Task ID，会后自动在 Task 评论中添加会议摘要 |
| 会议产生的新任务 | AI 会议流程（`MeetingFlowPanel`）自动从会议纪要提取行动项并创建 Task |

**建议实现路径**：
1. 在 `Meeting` 模型增加可选 `taskId` 字段（关联到 Task）
2. Task 详情页增加"发起会议"快捷操作
3. 会议结束后 AI 自动提取行动项创建 Task（已有 `MeetingFlowPanel` 组件）

### 6.4 与会议纪要的集成

**当前状态**：已有 `MeetingMinutes` 模型和 AI 会议流程面板（`MeetingFlowPanel`）。

**集成方案**：
- 会议结束后，`MeetingFlowPanel` 提供 AI 辅助的会议纪要生成
- 纪要可关联到 Task、Decision 等实体
- AI 自动提取行动项（`AiMeetingActionItem`）和决策（`AiMeetingDecision`）

---

## 7. 实施计划

### 7.1 已完成阶段

| 阶段 | 内容 | 状态 |
|------|------|------|
| L1 | LiveKit Server 部署 + 基础配置 | ✅ 完成 |
| L2 | Meeting/MeetingParticipant 数据模型 + 状态机 | ✅ 完成 |
| L3 | RTC 媒体配置（抖动缓冲、端口范围） | ✅ 完成 |
| L4 | E2EE 端到端加密占位 | ✅ 完成 |
| L5 | 会议列表 + 描述 + 创建者展示 | ✅ 完成 |
| L6 | 重复会议（iCal RRULE） | ✅ 完成 |
| L7 | 30 秒轮询刷新 | ✅ 完成 |
| L8 | 会议密码保护 | ✅ 完成 |
| M1 | 录制功能（EgressClient + S3 存储） | ✅ 完成 |
| M16 | 录制控制 UI（host 可见） | ✅ 完成 |
| M17 | Token 过期自动 rejoin | ✅ 完成 |
| M18 | PreJoin 用户名预填 | ✅ 完成 |
| M19 | 会议已结束页面 | ✅ 完成 |
| High #5 | beforeunload/pagehide 清理 | ✅ 完成 |
| High #6 | 主动挂断 vs 意外断开区分 | ✅ 完成 |

### 7.2 待实施阶段

| 阶段 | 内容 | 优先级 | 依赖 |
|------|------|--------|------|
| P2-1 | IM 集成：聊天中发起视频通话 | 高 | Conversation 模型扩展 |
| P2-2 | 日历集成：预约会议同步到外部日历 | 高 | CalendarEvent 模型扩展 |
| P2-3 | 任务集成：任务相关会议 | 中 | Meeting 模型增加 taskId |
| P3-1 | 会议邀请链接分享（外部用户加入） | 中 | 临时 token 签发机制 |
| P3-2 | 会议室布局自定义（画廊/演讲者模式） | 低 | 自定义 VideoConference |
| P3-3 | 虚拟背景 / 美颜滤镜 | 低 | LiveKit TrackProcessor |
| P4-1 | E2EE 端到端加密启用 | 中 | 密钥管理 UI |
| P4-2 | 大规模会议优化（100+ 参与者） | 低 | LiveKit Cluster 部署 |

### 7.3 建议的实施顺序

```
Phase 1 (当前已完成)：
  LiveKit 基础集成 → 会议 CRUD → 音视频通话 → 录制 → 断线重连

Phase 2 (下一步)：
  IM 集成 → 日历集成 → 任务集成 → 会议邀请链接

Phase 3 (增强)：
  E2EE 启用 → 布局自定义 → 虚拟背景

Phase 4 (规模化)：
  LiveKit Cluster → 大规模会议 → 跨区域部署
```

---

## 8. 运维与部署

### 8.1 环境变量配置

```env
# LiveKit 音视频（未配置时会议功能返回 503）
LIVEKIT_URL="ws://localhost:7880"          # WebSocket 接入地址
LIVEKIT_API_KEY="devkey"                    # 与 livekit.yaml keys 一致
LIVEKIT_API_SECRET="secret"                 # 与 livekit.yaml keys 一致
LIVEKIT_TOKEN_TTL="7200"                    # Token 有效期（秒），默认 2 小时

# E2EE（可选）
LIVEKIT_E2EE_ENABLED="false"                # 启用端到端加密

# S3 录制存储（未配置时录制功能返回 501）
S3_ENDPOINT="http://localhost:9000"
S3_BUCKET="corps-uploads"
S3_ACCESS_KEY="minioadmin"
S3_SECRET_KEY="minioadmin"
S3_REGION="us-east-1"
```

### 8.2 端口规划

| 端口 | 协议 | 用途 | 对外暴露 |
|------|------|------|----------|
| 7880 | TCP | HTTP/WebSocket（前端接入 + API） | 是 |
| 7881 | UDP | RTC 媒体（音视频流） | 是 |
| 7882 | UDP | TURN（NAT 穿透中继） | 是 |
| 50000-60000 | UDP | RTC 媒体端口范围 | 是 |

**生产环境注意**：
- 所有 UDP 端口必须在防火墙/安全组中开放
- `use_external_ip: true` 需要 LiveKit Server 能访问公网 STUN 服务获取外部 IP
- 如果部署在 NAT 后面，需要配置 `node_ip` 为公网 IP

### 8.3 降级策略

| 场景 | 降级行为 |
|------|----------|
| LiveKit Server 未配置（缺 API_KEY/SECRET/URL） | `/join` 返回 503，前端显示"会议服务不可用" |
| S3 存储未配置 | `/recording/start` 返回 501，录制按钮不显示 |
| LiveKit Server 不可达 | 前端 `MeetingRoom` 显示"连接失败" + 重连逻辑 |
| AI 服务未配置 | "AI 会议流程"按钮置灰 |

### 8.4 监控指标

建议监控以下指标：
- LiveKit Server 容器健康状态（Docker healthcheck）
- 会议创建/加入/离开 API 错误率
- LiveKit Webhook 接收频率与签名验证失败率
- 录制 Egress 任务成功率
- 前端 `MeetingRoom` 连接状态分布（joining/connected/reconnecting/error）

---

## 附录：关键文件索引

| 文件 | 职责 |
|------|------|
| `livekit.yaml` | LiveKit Server 配置（端口、密钥、RTC、录制、E2EE、Webhook） |
| `docker-compose.yml` | LiveKit 容器定义 + 环境变量注入 |
| `web/prisma/schema.prisma` | Meeting + MeetingParticipant 数据模型 |
| `web/app/api/v1/workspaces/[wid]/meetings/route.ts` | 会议列表 + 创建 API |
| `web/app/api/v1/workspaces/[wid]/meetings/[mid]/route.ts` | 会议详情 + 更新 + 结束 API |
| `web/app/api/v1/workspaces/[wid]/meetings/[mid]/join/route.ts` | 加入会议 + Token 签发 API |
| `web/app/api/v1/workspaces/[wid]/meetings/[mid]/leave/route.ts` | 离开会议 API |
| `web/app/api/v1/workspaces/[wid]/meetings/[mid]/recording/start/route.ts` | 启动录制 API |
| `web/app/api/v1/webhooks/livekit/route.ts` | LiveKit Webhook 处理 |
| `web/components/meeting/MeetingList.tsx` | 会议列表组件 |
| `web/components/meeting/MeetingCreate.tsx` | 创建/编辑会议弹窗 |
| `web/components/meetings/MeetingLobby.tsx` | 会议大厅（设备预览） |
| `web/components/meetings/MeetingRoom.tsx` | 视频通话界面（LiveKit SDK） |
| `web/app/[locale]/w/[wid]/meetings/page.tsx` | 会议列表页路由 |
| `web/app/[locale]/w/[wid]/meetings/[mid]/page.tsx` | 会议详情页路由（lobby → room 流程） |
| `web/lib/webrtc/signaling.ts` | 远程控制信令（独立于 LiveKit，用于远程控制功能） |