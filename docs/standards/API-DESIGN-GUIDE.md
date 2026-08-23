# corps API 设计规范

> 版本：v1.0 ｜ 日期：2026-08-23 ｜ 适用范围：所有 /api/v1/ 端点

---

## 第1章 响应信封规范

### 1.1 统一格式

所有 API 响应使用统一信封格式（与 SPEC.md §5 对齐）：

```json
{
  "code": 200,
  "data": { ... },
  "message": "ok"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | number | 是 | 业务状态码，与HTTP状态码保持一致 |
| data | any | 是 | 响应数据体，无数据时为 `null` |
| message | string | 是 | 人可读的描述信息 |

### 1.2 HTTP 状态码映射

| HTTP Status | code | 使用场景 |
|-------------|------|----------|
| 200 | 200 | GET 成功 |
| 201 | 201 | POST 创建成功 |
| 400 | 400 | 请求参数校验失败（如 zod schema 不通过） |
| 401 | 401 | 未认证（无 Bearer Token 或 Token 过期/无效） |
| 403 | 403 | 已认证但无权限（RBAC 拒绝） |
| 404 | 404 | 资源不存在（含 RLS 过滤后的"看不见"场景） |
| 409 | 409 | 资源冲突（如邮箱已注册、超过 seat_limit） |
| 500 | 500 | 服务器内部错误（不暴露细节给客户端） |

### 1.3 错误响应示例

```json
// 400 - 参数校验失败
{
  "code": 400,
  "data": null,
  "message": "密码长度至少 8 位"
}

// 401 - 未认证
{
  "code": 401,
  "data": null,
  "message": "Unauthorized"
}

// 403 - 无权限
{
  "code": 403,
  "data": null,
  "message": "Forbidden"
}

// 409 - 冲突
{
  "code": 409,
  "data": null,
  "message": "该邮箱已被注册"
}
```

---

## 第2章 错误码体系

### 2.1 业务错误码

除 HTTP 状态码外，可扩展详细业务错误码（`code` 字段 > 1000）：

| code | 含义 | HTTP |
|------|------|------|
| 1001 | 邮箱格式无效 | 400 |
| 1002 | 密码强度不足 | 400 |
| 1003 | 工作区名称过长 | 400 |
| 2001 | 邮箱已注册 | 409 |
| 2002 | 超过席位上限 | 409 |
| 2003 | 已是成员 | 409 |
| 3001 | Token 过期 | 401 |
| 3002 | Token 无效 | 401 |
| 4001 | 角色权限不足 | 403 |
| 4002 | 不能移除最后一个 Owner | 400 |

### 2.2 消息语言

- MVP 阶段：中文简体
- v2 阶段：根据 `Accept-Language` 请求头选择中/英

---

## 第3章 分页规范

### 3.1 游标分页

列表类接口采用游标分页：

**请求参数**：

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| cursor | string | 无 | 上一页最后一条的 id |
| limit | number | 20 | 每页条数（最大 100） |

**响应格式**：

```json
{
  "code": 200,
  "data": {
    "items": [...],
    "nextCursor": "uuid-or-null",
    "hasMore": true
  },
  "message": "ok"
}
```

---

## 第4章 API 版本策略

### 4.1 版本前缀

所有 API 端点统一使用 `/api/v1/` 前缀。

### 4.2 版本升级

1. 新增字段：直接追加，不升版本
2. 修改字段语义：升 `/api/v2/`，同时保留 `/api/v1/` 至少 6 个月
3. 废弃端点：先标记 `Deprecated` 响应头，6 个月后移除

---

## 第5章 命名约定

### 5.1 RESTful 资源命名

- 资源名用**复数**：`/workspaces`、`/tasks`、`/members`
- 嵌套资源表示归属：`/workspaces/:wid/tasks`、`/workspaces/:wid/tasks/:id/comments`
- 路径全部**小写**，多词用**短横线**（kebab-case）

### 5.2 HTTP 方法约定

| 方法 | 用途 | 幂等性 |
|------|------|--------|
| GET | 查询资源 | 是 |
| POST | 创建资源 | 否 |
| PATCH | 部分更新 | 否 |
| DELETE | 删除资源 | 是 |

### 5.3 路径参数命名

| 参数 | 含义 | 类型 |
|------|------|------|
| `:wid` | workspace_id | UUID |
| `:id` | 资源主键 | UUID |
| `:uid` | user_id | UUID |
| `:did` | decision_id | UUID |

---

## 第6章 安全约束

1. **认证**：所有 `/api/v1/` 端点（除 auth/register 和 auth/login）必须校验 Bearer Token
2. **RLS**：所有租户数据操作必须经 `runWithWorkspace(wid, fn)` 包裹
3. **RBAC**：Owner/Admin/Member 权限在 Route Handler 层强制校验
4. **参数校验**：所有请求体必须经 zod schema 校验后再使用
5. **跨租户红线**：`workspace_id` 仅从 JWT 解析，绝不信任客户端传入