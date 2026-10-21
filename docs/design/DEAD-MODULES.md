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
| `/w/{wid}/ai-usage`（AI 用量/限额） | 仅 `e2e/route-health.spec.ts` 列举，无 UI 引用 | 接进「设置」或删除（AI 限额属于运营信息，建议放设置页） |
| `/w/{wid}/settings/calendar`（日历同步设置） | 零引用 | 接进「设置」或删除 |
| `/w/{wid}/assistant`（AI 助理对话） | 无 UI 引用（仅 e2e 列举） | 与「AI 五页并一」一起处理：并入 `/ai` 或删除 |

## 3. 为什么写这张表

- 这些目录此前只在"功能域数量"里被计数，却在真实使用中不存在——**能力清单会因此虚高**；
- 它们各自还带 API、i18n 词条与零覆盖基线行，继续保留会让覆盖/契约/词条三类棘轮都背着无效债务；
- 用户 2026-10-03 的方向是"功能不做减法、做整合"，本表给出的是**整合后再删**的路径，不是直接砍能力。

## 4. 建议顺序

1. P1：把 `settings/permissions`、`ai-usage` 接进入口（这两个是"已经能用却被藏起来"）；
2. P1：旧聊天树按 ADR-013 迁移后删除；
3. P2：`mail` / `todo` / `remote-control` / `sync` 逐项裁决（补页面 or 删除）；
4. 每删一项，同步摘除零覆盖基线与相关 i18n 键，并跑 `scripts/check_zero_coverage_ratchet.py` 自证。
