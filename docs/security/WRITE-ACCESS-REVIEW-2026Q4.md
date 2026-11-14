# 写接口豁免复核台账（2026 Q4）

> **状态：待办台账，不是复核完成记录。**
> 本文件记录 `scripts/write-access-registry.txt` 在 `review_by` 到期前必须完成的逐条论证，
> 供 owner / 安全负责人签字。它不改变任何运行时行为，也不是门禁的豁免依据。

## 1. 到期机制与冻结风险

`scripts/check_write_access_registry.py` 挂在 `.github/workflows/ci.yml` 的 required
`Permission Gate Coverage` job（`Check write-access registry (covered-or-registered)` 与
`Mutation-check the write-access registry itself` 两个 step）。`check_raw()` 对
`review_by < date.today()` 判 `REVIEW_OVERDUE` 红。

当前登记表 **28 条全部 `review_by=2026-12-31`**，因此 **2027-01-01 起该 job 必红、
全仓合并冻结**。集中到期不是 bug：`docs/ROADMAP-2026Q4.md` 的对应条款是
「28 条，不缩量，按 `review_by` 到期复核」，与 90 天冻结验收日对齐，是刻意安排的复核节点。

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

## 4. 到期前必须完成（2026-12-31 之前）

1. 逐条重新论证 28 个写接口「为什么不进墙」，由 owner / 安全负责人逐条签字。
2. 重签后把 `review_by` **错开**到不同日期，避免下一次集中到期再次冻结全仓。
3. 对 §5 的开放项给出产品裁决；裁决为「进墙」的端点改调用 `getWorkspaceContextV2`
   后删除对应登记行（真正缩量），而不是改日期。
4. 更新本台账状态为「已复核」，并附签核记录。

## 5. 待 owner / 产品裁决的开放项

- **6 条 AI 生成端点是否必须绑定工作区**：这是唯一可能把 28 → 22 的清偿路径。
  仓内已有进墙先例 `v1/ai/approval-advice/route.ts:140`、`daily-report/route.ts:84`、
  `project-insight/route.ts:88`（均 `getWorkspaceContextV2(req, body.wid)` +
  `assertAiUsageQuota`）。代价：破坏「BA 纯会话无 wid 也能用 AI」，前端需传
  `body.wid`，API 契约变更 ⇒ **必须等产品决策**。
- 若裁决「维持现状」，需在台账里明确接受「wid 直取 JWT、无成员复核，但 usage 写入
  工作区范围 `aiUsageLog`」这一风险，而不是继续用「不直接写业务对象」含糊带过。
- `PUSH_ADMIN_USER_IDS` 白名单长期化、匿名埋点去留、用户级端点无 `workspaceId` 模型。

## 6. 红线

- **禁止**批量把 28 条 `review_by` 推到 2027 —— 那是绕过复核的刷绿，违反
  「登记表不是终身豁免书」的设计意图。
- **禁止**把 `--emit` 当作续期工具；它只补齐缺失条目。
- `ENTRY_RE` 是 `reason=(\S+)`，reason 内不得含空格；文中的 `-` 是格式产物，不是占位符。

## 7. 可复跑命令

```bash
python scripts/check_write_access_registry.py             # 主门禁
python scripts/check_write_access_registry.py --self-test   # 三种红因 + emit 不变式
python scripts/check_write_access_registry.py --emit        # 补齐缺失条目后仍需人工复核
```
