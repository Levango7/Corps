# 写接口豁免复核台账（2026 Q4）

> **状态：已复核并重签（2026-11-21）。**
> 裁决来源：项目 owner 2026-11-21 授权 1B 方案（详见 §7）。6 条 AI 端点经产品裁决
> **维持现状 + 明确接受风险**（§5），28 条按复核结论分四档错开 `review_by`（§7），
> 消除 2027-01-01 集中到期导致的全仓冻结。本文件不改变运行时行为，也不是门禁豁免依据。

## 1. 到期机制与冻结风险

`scripts/check_write_access_registry.py` 挂在 `.github/workflows/ci.yml` 的 required
`Permission Gate Coverage` job（`Check write-access registry (covered-or-registered)` 与
`Mutation-check the write-access registry itself` 两个 step）。`check_raw()` 对
`review_by < date.today()` 判 `REVIEW_OVERDUE` 红。

原状：**28 条全部 `review_by=2026-12-31`**，若不变则 **2027-01-01 起该 job 必红、
全仓合并冻结**。集中到期不是 bug：`docs/ROADMAP-2026Q4.md` 的对应条款是
「28 条，不缩量，按 `review_by` 到期复核」，与 90 天冻结验收日对齐，是刻意安排的复核节点。

2026-11-21 已按复核结论把 28 条错开到 2027 年四个复核批次（03-31 / 06-30 /
09-30 / 12-31），不再集中到期。依据与逐条分档见 §7。

## 2. 现状盘点（2026-11-15，只读复核）

```text
python scripts/check_write_access_registry.py
Write handlers scanned: 288 / Covered by choke point: 260 / Registered explicitly: 28 / PASS
```

**零 `REGISTRY_ROT`**：28 条全部对应仍在、且确实未调用 `getWorkspaceContext` 的活 handler，
不存在「删掉陈旧行」的刷绿空间。字面 `TO_BE_CLASSIFIED` 0 条。

| 分桶 | 条数 | 结论 |
| --- | --- | --- |
| A 可立即清偿（陈旧 / 已进墙） | 0 | 无 |
| B 需补论证（reason 与事实不符） | 7 | 本批已订正，见 §3 |
| C 合理豁免 | 21 | 认证、webhook、令牌授权、用户级账号、建区与埋点等；到期仍需逐条重签 |

## 3. 本批做了什么（纯工程，零行为变更）

- 修 `emit()` 三缺陷：年末生成「次日即过期」的复核日；重刷销毁既有 `reason`；
  重刷等于批量续期。现在 `--emit` 只补齐缺失条目，既有 `reason` / `review_by` 原样保留，
  新条目的默认复核日保证剩余窗口 ≥30 天（不足则顺延次年年底）。
- `--self-test` 新增冻结日期的 emit 不变式断言（不次日过期 / 不销毁 reason /
  不批量续期 / 按现状重生成幂等），与原有三种红因自检并存；**判据未改**。
- 订正 7 条 B 类 reason，另补 2 条 C 类 ad-hoc 说明，全部经源码回查：
  - 6 条 AI 端点 `/api/v1/ai/{chat,completion,format,summarize,task-breakdown,translate}`
    原只说「不直接写业务对象」，但 usage 实际经 `runWithWorkspace` 写入工作区范围
    `aiUsageLog`，且 `web/lib/ai/shared.ts` 的 `getUserIdAndWorkspaceId` 把 `workspaceId`
    直取 JWT `payload.wid`、无成员复核。`task-breakdown` 原有的「待复核：若开启自动落位
    必须进墙」已结案：落位端点 `v1/workspaces/[wid]/tasks/route.ts:101` 与
    `v1/ai/tools/execute/route.ts:79` 均已 `getWorkspaceContextV2`。
  - `/api/v1/auth/refresh` 原「与角色无关」与事实不符：`route.ts:135` 读 `target.role`
    编入 JWT，只是不经 choke point 裁决。
  - `/api/v1/events` 补 `ALLOWED_EVENT_NAMES` 白名单 + `member.findMany` 归属校验；
    `/api/v1/push/send` 补 `PUSH_ADMIN_USER_IDS` 未配置即 fail-closed。
- **明确没做**：不批量改 28 条 `review_by`、不删任何条目、不动 `check_raw()` 判据、
  不动 CI 接线、不用 `--emit` 续期。

## 4. 复核进展

- 2026-11-15：逐条源码回查 + 7 条 B 类 reason 订正（§3），零 `REGISTRY_ROT`。
- 2026-11-21：owner 授权 1B 方案，6 条 AI 端点产品裁决为「维持现状 + 接受风险」，
  28 条按结论错开复核日并重签（§7）。§5 三条开放项仍需 owner / 产品按期跟进，
  但**不再构成全仓冻结**：错开后每个批次只涉及对应日期的条目。

## 5. 产品裁决与残余开放项

- **6 条 AI 生成端点（chat/completion/format/summarize/task-breakdown/translate）：已裁决维持现状。**
  owner 2026-11-21 按 1B 方案接受以下风险，不进墙、不改 API 契约：
  `getUserIdAndWorkspaceId`（`web/lib/ai/shared.ts:73-90`）把 `workspaceId` 直取 JWT
  `payload.wid`，**无成员角色 / 归属复核**；usage 经 `runWithWorkspace` 写入工作区范围
  `aiUsageLog`（`web/lib/ai/usage-tracker.ts:42-57`）。即 JWT 里带哪个 `wid` 就计入哪个
  工作区的用量，无独立成员授权判断。这是已知且被接受的残余风险，不再用「不直接写
  业务对象」含糊带过。复核期缩短至 2027-03-31（首批），若届时产品要求进墙，按 A 方案
  改 `getWorkspaceContextV2` + `assertAiUsageQuota` 后删除登记行，走真正缩量。
- `PUSH_ADMIN_USER_IDS` 白名单长期化、匿名埋点去留、用户级端点无 `workspaceId` 模型：
  仍为开放项，随各自批次复核日跟进，不阻塞当前重签。

## 6. 红线

- **禁止**把全部 28 条 `review_by` 推到**同一个** 2027 日期来绕过复核 —— 那是刷绿，
  违反「登记表不是终身豁免书」的设计意图。本次重签按风险等级分四档错开（§7），
  每档都有可追溯的复核结论，且 AI 端点被缩到最早批次而非一刀切延后，不属于此列。
- **禁止**把 `--emit` 当作续期工具；它只补齐缺失条目。本次错开是人工逐条改
  `review_by`，reason 与条目集合一字未动。
- `ENTRY_RE` 是 `reason=(\S+)`，reason 内不得含空格；文中的 `-` 是格式产物，不是占位符。

## 7. 2026-11-21 重签记录（四档错开）

裁决来源：owner 授权 1B 方案（维持现状 + 接受风险 + 按复核结论错开）。
复核依据：§3 的逐条源码回查结论 + 2026-11-21 对 6 条 AI 端点与 refresh 的二次事实核验
（全部与 reason 描述一致）。**reason 文本与 28 条条目集合未改动，只改 `review_by`。**

分档原则（风险越高复核越早，越稳定越靠后）：

| 批次 `review_by` | 条数 | 分档依据 | 条目 |
| --- | --- | --- | --- |
| 2027-03-31 | 6 | AI 端点：已接受残余风险（wid 直取 JWT / 无成员复核 / usage 写工作区），需最早回看产品是否改判进墙 | `/api/v1/ai/{chat,completion,format,summarize,task-breakdown,translate}` 6 条 POST |
| 2027-06-30 | 3 | 语义敏感但当前实现已核实：refresh 读 role 编 JWT、events 埋点白名单归属校验、push/send 管理员白名单 fail-closed | `auth/refresh`、`events`、`push/send` |
| 2027-09-30 | 9 | 授权边界清晰的令牌/签名/认证端点：分享令牌、邀请令牌、三条支付 webhook、livekit 回调、login/logout/register | `documents/share/{token}/verify`、`invitations/{token}/accept`、`billing/webhook{,/alipay,/wechat}`、`webhooks/livekit`、`auth/{login,logout,register}` |
| 2027-12-31 | 10 | 稳定账号级 / 用户自身数据操作：注销、偏好、设备推送注册订阅、建区、第三方解绑 | `users/me/account`、`ai/voice/preferences`、`notifications/preferences`、`users/me`、`push/register`(DELETE/POST)、`push/subscribe`、`push/unsubscribe`、`workspaces`、`auth/calendar/disconnect/{provider}` |

合计 6+3+9+10 = **28 条**，无遗漏、无重复、无新增。

不变式（本次重签刻意保持，便于未来审计）：

- 条目数 28 不变；`check_write_access_registry.py` 主门禁 `--self-test` 全过。
- 每条 `reason` 逐字未动（错开只改日期，不重写论证）。
- `--emit` 未用于续期；生成头注释里的日期仍是 2026-11-15（工具只补齐，不重写）。
- 未触发 `REGISTRY_ROT`（无条目被删）、未触发 `REVIEW_OVERDUE`（全部 > 今天）。
- 下次集中到期风险已消除：四个批次分散在 2027 Q1/Q2/Q3/Q4。

## 8. 可复跑命令

```bash
python scripts/check_write_access_registry.py             # 主门禁
python scripts/check_write_access_registry.py --self-test   # 三种红因 + emit 不变式
python scripts/check_write_access_registry.py --emit        # 补齐缺失条目后仍需人工复核
python scripts/check_picomatch_fix.py                       # picomatch 豁免到期探测（联网）
python scripts/check_picomatch_fix.py --self-test           # 注入式自测（离线）
```
