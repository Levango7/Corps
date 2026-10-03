# ADR-011: 写权限收敛到单一 choke point（default-deny）

> 状态：已采纳
> 日期：2026-10-03
> 关联：ADR-001（多租户隔离）、`lib/permissions.ts`、`scripts/check_permission_gates.py`、`scripts/check_write_access_registry.py`、`scripts/write-access-registry.txt`、`web/lib/write-policy.ts`

## 背景

`lib/permissions.ts` 声明了 owner/admin/member/viewer 的角色矩阵，其中 **viewer 全只读**。但
`scripts/check_permission_gates.py` 的实测口径是"handler 源码里有没有角色判断"，五档分布（2026-10-03）：

| 档 | 含义 | 数量 |
|---|---|---|
| T1 | 矩阵可判定域内、完全无角色判断 | 1 |
| T2 | 矩阵域内、只有 ad-hoc 比较 | 37 |
| **T3** | **矩阵域外、完全无角色判断** | **157** |
| T4 | 矩阵域外、ad-hoc | 32 |
| T5 | 声明了模块但零调用点（`databases`） | 1 |

**viewer 在这 157 个端点上可以改工作区内容**，矩阵的只读承诺没有执行点。注意这些 handler 并非没有认证——
它们绝大多数调用了 `getWorkspaceContext()`（成员资格 + RLS），缺的是"这个角色能不能写"这一步。
所以问题不是"门没锁"，是"门后有 157 条岔路没人查票"。

## 可选方案与本仓库的取舍

| 方案 | 成本 | 问题 |
|---|---|---|
| A. 逐个给 157 个 handler 补 `requirePermission` | 高（157 处改动 + 每处要选对 module/action） | 新增端点时仍需记得补；已确认的模式会在下一个功能里复发 |
| B. Node runtime middleware 里做角色裁决 | 中 | 需要 Next.js 的 Node middleware 支持；每个写请求多一轮 DB 查询；改变全局中间件语义 |
| C. **收敛到 `getWorkspaceContext()` 这一个 choke point** | 低（新增 1 个模块 + 改 1 处调用） | 拒绝时只能返回 null → handler 走既有 401 分支，**拿不到精确 403**（见后果 1） |
| D. 只做静态门禁，不动运行时 | 最低 | 回到"声明 ≠ 执行"，本 ADR 正是为解决这一点 |

选 **C + 静态补位**：运行时默认拒绝兜底，静态门禁保证"没人能绕过这道墙"（漏=D）。

## 决定

1. **新增 `web/lib/write-policy.ts`**：纯函数 `decideWorkspaceWrite()` 做裁决。
   - 写方法（POST/PUT/PATCH/DELETE）才裁决，GET 不介入。
   - owner/admin/member 放行；viewer 默认拒绝。
   - `SELF_SERVICE_WRITE_PATHS` 是唯一的例外表：自己的收藏 / 通知 / 推送设备 / 账号资料 /
     纯文本 AI（chat/completion/format/summarize/translate/feedback）。判据是
     **写的是用户自己的数据，且不影响他人**；每条都带 `why`，CR 时可追问。
   - 临时授权（TemporaryGrant）按 `expiresAt > now` 折算成生效角色；**过期不提权**。
2. **在 `getWorkspaceContext()` 内结算**：拿到 member 与 temporaryGrant 之后立刻裁决。
   不通过时 `console.error` 打日志（含 method/role/path/reason），然后 **return null（fail-closed）**。
3. **灰度开关 `WRITE_POLICY_MODE`**：`enforce`（默认）/ `shadow`（只记不拦）/ `off`。
   解析非法值（含空串与拼错）一律落到 `enforce`——env 拼错不能成为绕过安全性的方式。
4. **静态补位 `scripts/check_write_access_registry.py`**：C 方案有一个天然盲区——
   **handler 不经过 `getWorkspaceContext` 就完全不在墙内**，而五档门禁只看角色判断、看不见这条线，
   会给它记一个"本来也没有角色判断"，等于默认放行。因此断言每个写 handler 二选一：
   进墙（调用 `getWorkspaceContext`），或在 `write-access-registry.txt` 显式登记 reason + 复核截止日。
   三类红因：`UNGATED` / `REGISTRY_ROT` / `REVIEW_OVERDUE`，并带 `--self-test` 注入变异自检
   （本门禁自身也进 CI 跑）。
   实测：278 个写 handler 中 **250 个进墙**，28 个登记（认证自身、webhook、分享/邀请令牌、
   用户级自服务、创建工作区——这些本来就不存在成员上下文）。

## 后果与已知缺口

1. **viewer 的写响应码由 403 变成 401**：裁决点在 `getWorkspaceContext`（返回 null），handler 走既有
   未授权分支。`rbac.test.ts` 与 `e2e/viewer-readonly.spec.ts` 的断言相应改为 `[401, 403]`——
   断言的实质是"不许 2xx"，不是钉死状态码。**精确 403 需要一个统一的错误出口**（类似 NextResponse 的
   deny 通道），登记为下一步，不阻塞本次收口。
2. **`MemberPermission` 行级覆盖尚未接入裁决**：目前只看角色。给 viewer 显式开了某模块写权限的场景
   仍会被拦。这是一个**收严**（原先这些端点压根不校验），不是回归；需要在产品确认语义后接进
   `decideWorkspaceWrite()` 的输入。
3. **84% 的写 handler 一夜之间进入"禁止 viewer 写"状态**，这在语义上是产品的既有承诺，
   但可能踩到"viewer 实际在用某些写能力"的历史习惯。上线前建议先用 `WRITE_POLICY_MODE=shadow`
   跑一轮真实流量，看 `[write-policy] shadow-deny` 日志里有没有意料之外的路径，再切回 `enforce`。
4. `SELF_SERVICE_WRITE_PATHS` 是唯一的放宽面，加条目必须写 `why`。它是**逐条登记的白名单**，
   不是笼统的豁免；`/api/v1/favorites-evil` 这类前缀混淆已在单测里钉死（前缀匹配而非包含匹配）。

## 验证（实测，非推断）

- `npx vitest run tests/unit/write-policy.test.ts` → **15 passed**
- `npx vitest run tests/unit/auth-write-policy.test.ts` → **11 passed**（钉住"choke point 真的被调用"）
- `node node_modules/typescript/bin/tsc --noEmit` → 0 error
- `python scripts/check_write_access_registry.py` → PASS（scanned 278 / covered 250 / registered 28）
- `python scripts/check_write_access_registry.py --self-test` → 三类变异各自因正确红因变红
