# 死模块登记（2026-10-20）

> 性质：**登记表**，不是删除动作。用于回答"这些代码到底有没有在跑、下一步怎么办"。
> 口径：`零挂载` = 在 `web/app` + `web/components` 里没有 importer（命令见每行）；`无入口` = 有页面但没有任何导航/链接指向它。
> 与「功能上不做减法」的关系：**这些不是功能，是未挂载的实现**。删除不会让用户少任何一个能用的功能；保留则继续占维护、测试与 i18n 成本。

## 1. 零挂载实现

| 模块 | 规模 | 判据（应输出 0） | 处置 |
| --- | --- | --- | --- |
| 旧聊天树 `components/ChatPanel.tsx` + `components/chat/*` | 8 文件 / 2,109 行 | `grep -rn '@/components/ChatPanel' web/app web/components --include='*.tsx' \| wc -l` | 按 ADR-013：先把 `MessageInput` 的输入隔离等有价值部分迁进 `components/im/*`，完成迁移后整棵删除 |
| `components/mail` | 3 文件 | `grep -rn '@/components/mail' web/app web/components --include='*.tsx' \| wc -l` | 二选一：作为可选模块补页面（P2 之后）或删除；**不建议继续悬空** |
| `components/todo` | 2 文件 | `grep -rn '@/components/todo' web/app web/components --include='*.tsx' \| wc -l` | 当前只有 AI 工具箱的 `TodoExtractDialog` 在提供相近能力；若无"独立待办页"计划则删除 |
| `components/remote-control` | 3 文件 | `grep -rn '@/components/remote-control' web/app web/components --include='*.tsx' \| wc -l` | 与产品定位无关（办公系统），建议删除 |
| `components/sync`（含 `OfflineIndicator`） | 1 文件 | `grep -rn '@/components/sync' web/app web/components --include='*.tsx' \| wc -l` | PWA 已有离线兜底页；该指示器零引用，删除或并入 PWA 状态条 |

## 2. 有页面、无入口

| 页面 | 判据 | 处置 |
| --- | --- | --- |
| `/w/{wid}/settings/permissions`（权限矩阵） | 仅自身文件引用；导航无入口 | **应接进「成员」或「设置」**——权限矩阵是对外卖点之一，现在 owner 根本到不了 |
| `/w/{wid}/settings/calendar`（日历同步设置） | 零引用 | 接进「设置」或删除 |

> **2026-11-08 订正**：`/w/{wid}/ai-usage` 与 `/w/{wid}/assistant` 原先登记在本表，
> 现已通过 Cmd+K（`web/components/CommandPalette.tsx` 的 `navItems` 末尾两项）接入，
> 不再属于「无入口」。两者沿用既有页面与 API，未新增能力域；侧栏注册表
> `WORKSPACE_MODULES` 仍为 31 项 —— 改注册表会连带 16 处单测断言与
> `dashboard-chromium-linux.png` 视觉基线，本轮按「零行为变更」原则不动侧栏。

## 3. 为什么写这张表

- 这些目录此前只在"功能域数量"里被计数，却在真实使用中不存在——**能力清单会因此虚高**；
- 它们各自还带 API、i18n 词条与零覆盖基线行，继续保留会让覆盖/契约/词条三类棘轮都背着无效债务；
- 用户 2026-10-03 的方向是"功能不做减法、做整合"，本表给出的是**整合后再删**的路径，不是直接砍能力。

## 4. 建议顺序

1. P1：把 `settings/permissions` 接进入口（"已经能用却被藏起来"；`ai-usage` / `assistant` 已于 2026-11-08 经 Cmd+K 接线，见 §2 订正）；
2. P1：旧聊天树按 ADR-013 迁移后删除；
3. P2：`mail` / `todo` / `remote-control` / `sync` 逐项裁决（补页面 or 删除）；
4. 每删一项，同步摘除零覆盖基线与相关 i18n 键，并跑 `scripts/check_zero_coverage_ratchet.py` 自证。

## 5. 2026-11-08 补：顶层页导航覆盖率门禁

`scripts/check_nav_coverage.py` 已在 CI 的 `api-contract` job 挂载（含 `--self-test`）：
扫描 `web/app/[locale]/w/[wid]/<segment>/page.tsx` 的**顶层静态**路由段，要求每一段
都能从三份壳层入口清单到达 —— `web/lib/modules/registry.ts`（侧栏注册表）、
`web/components/CommandPalette.tsx`（Cmd+K）、`web/app/[locale]/w/[wid]/layout.tsx`
（顶栏铃铛等硬链接）。main 现状 33/33 全覆盖、孤儿 0，故零存量硬失败，没有基线文件。

**口径边界，别误读**：

- 本门禁**不覆盖二级页**。§2 登记的 `settings/permissions` 与 `settings/calendar`
  仍是无导航入口的人工 P1 项；门禁绿灯只说明顶层页没新增孤儿，不等于全站没有
  藏起来的页面。二级页要接进父页 Tab / 组件链接，判定口径不同，需另立门禁。
- `notifications` 不算孤儿：它走 `layout.tsx` 的顶栏铃铛入口。只认注册表 + Cmd+K
  的窄口径会把它误报成孤儿，进而把一个本来可达的页面钉成永久豁免。
- 新增顶层页必须同步挂进三份清单之一，否则 CI 判红；确属不该有壳层入口的页面
  （如 OAuth 回跳落地页）在脚本的 `ALLOWED_ORPHANS` 显式登记并写明理由，不要删门禁。
