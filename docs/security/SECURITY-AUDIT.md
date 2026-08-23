# corps 安全审计报告

> 日期：2026-08-23 ｜ 审计范围：web/ 全目录 + db/schema.sql

---

## 1. 审计清单

### 1.1 Token 存储安全

| 项目 | 当前状态 | 风险等级 | 整改建议 |
|------|----------|----------|----------|
| Access Token 存储 | `localStorage`（`web/lib/api.ts` L3） | 🔴 高 | 迁移为 httpOnly secure cookie + CSRF token |
| Refresh Token | Better Auth session cookie（httpOnly） | ✅ 安全 | 保持 |
| Token 轮换 | 401 自动调用 `/auth/refresh` | ✅ 良好 | — |
| Token 过期 | access 15min / refresh 7d | ✅ 合理 | — |

**整改详情**：`web/lib/api.ts` 中 `localStorage.setItem("corps_access_token", t)` 易受 XSS 攻击。建议使用 httpOnly cookie + 服务端 `Set-Cookie` 方式传递，前端不再接触 token 明文。

### 1.2 CSRF 防护

| 项目 | 当前状态 | 风险等级 |
|------|----------|----------|
| CSRF Token | 未检测到 | � 中 |
| Same-Site Cookie | Better Auth 配置中 | ✅ |
| Origin/Referer 校验 | 未检测到 | � 中 |

### 1.3 输入校验

| 端点 | Zod Schema | 状态 |
|------|-----------|------|
| auth/register | ✅ email + password + workspaceName | 已校验 |
| auth/login | ✅ email + password | 已校验 |
| workspaces POST | ✅ workspaceName | 已校验 |
| tasks POST/PATCH | ✅ title + status + priority | 已校验 |
| members/invite | ✅ email | 已校验 |
| comments POST | ✅ body | 已校验 |

**结论**：所有公开端点均已 Zod 校验，无直接裸访问 `req.body`。

### 1.4 依赖安全

| 依赖 | 版本 | 已知CVE |
|------|------|---------|
| next | 16.2.6 | 需定期扫 |
| react | 19.2.0 | — |
| better-auth | 1.3.28 | — |
| stripe | 18.3.0 | — |
| argon2 | 0.41.1 | — |
| jsonwebtoken | 9.0.2 | — |

**建议**：CI 中加入 `npm audit` 步骤，警报 CVE ≥ high 时阻断 build。

### 1.5 SQL 注入

| 项目 | 状态 |
|------|------|
| Prisma 参数化查询 | ✅ 全覆盖 |
| `$executeRawUnsafe` | ⚠️ `lib/auth.ts` L83 使用，但参数由 `runWithWorkspace(wid, fn)` 内 JWT 解析的 UUID 传入，非用户可控 |

### 1.6 RLS 绕过风险

| 项目 | 状态 |
|------|------|
| `app_role` NOBYPASSRLS | ✅ `schema.sql` L53 |
| `app_role` NOINHERIT | ✅ `schema.sql` L56 |
| `app_role` 不拥有表 | ✅ `schema.sql` L296 |
| `app.auth_op` 逃生口 | � 有 `login` 和 `refresh` 两种逃生口，需审计确认不被滥用 |

### 1.7 CORS 配置

| 项目 | 状态 |
|------|------|
| CORS Headers | next.config.ts 中配置 |
| 允许源 | 需确认限制为特定域名 |

### 1.8 密码策略

| 项目 | 当前状态 |
|------|----------|
| 哈希算法 | argon2id（Better Auth 默认 scrypt，但 lib/argon2.ts 提供 argon2id） |
| 最小长度 | 由前端 + Zod 校验控制 |

---

## 2. 安全整改

### 2.1 Token 存储迁移方案

**当前**（`web/lib/api.ts`）：
```typescript
localStorage.setItem("corps_access_token", t);  // ❌ XSS 可达
```

**建议整改**：
1. 服务端 `/auth/login` 和 `/auth/refresh` 返回时通过 `Set-Cookie` 设置 httpOnly secure cookie
2. 前端 `api.ts` 不再手动管理 token，依赖 `credentials: "include"` 自动携带 cookie
3. CSRF 防护：加入 `X-CSRF-Token` 头校验

---

## 3. 安全评分

| 类别 | 评分 | 说明 |
|------|------|------|
| 认证 | 8/10 | Better Auth + argon2id + JWT 轮换，Token 存储需整改 |
| 授权 | 9/10 | RLS 引擎层强制 + RBAC 三层控制 |
| 数据隔离 | 10/10 | PostgreSQL RLS 双重保障（应用层 + 引擎层） |
| 输入校验 | 9/10 | Zod 全覆盖所有端点 |
| 依赖安全 | 7/10 | 版本已钉死，缺自动 CVE 扫描 |
| CSRF | 6/10 | 缺显式 CSRF 防护 |
| **综合** | **8.2/10** | 高安全基础，Token 存储是最大短板 |

---

## 4. 优先整改清单

| 优先级 | 整改项 | 预估工作量 |
|--------|--------|-----------|
| P0 | Access Token 迁移 httpOnly cookie | 0.5人天 |
| P0 | CI 加入 `npm audit` + CVE 阻断 | 0.2人天 |
| P1 | CSRF Token 机制 | 0.5人天 |
| P1 | CORS 源限制确认 | 0.2人天 |
| P2 | 定期安全扫描（Dependabot/Snyk） | 0.5人天 |