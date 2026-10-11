# 跨会话协作登记

> **为什么有这个文件**：本仓库会同时有多个会话 / Agent 在同一份工作树上作业。未登记的并发会造成三类事故——重复提交同一份改动、互相把对方未提交的半成品扫进自己的提交、以及误合他人 PR。本文件是**所有会话都能看见的唯一协调面**。
>
> **边界**：完整历史日志**不进仓库**（避免每次更新都产生一次提交噪音），由发起会话的本地 workspace 保存；本文件只放**规则 + 当前状态**。

## 1. 规则（动手前先读这段）

1. **开工登记、收工更新**：在 §2 追加/修改自己那一行。
2. **未提交的改动 = 无主 = 谁都可能捡走**。不要靠共享工作树保存半成品——要么立刻提交到自己的分支，要么在此登记说明。
3. **判断重复：比 blob hash，不要比标题**。`git hash-object <file>` 相等即同一份内容；标题相同但内容不同是常态。
4. **不要替别人合并 PR**。谁的分支谁处理。
5. **不要 `git checkout -b`，也不要动别人的分支**。主工作树是共享的，移动 HEAD 会打断他人。改用：
   ```
   git branch <name> <sha>                      # 创建分支，不移动 HEAD
   git push origin <sha>:refs/heads/<name>
   gh pr create --base main --head <name>
   ```
6. **HEAD 不在自己分支上时要提交**，用隔离索引，保持 HEAD、真实索引、工作树三者都不动：
   ```
   GIT_INDEX_FILE=$(mktemp) sh -c '
     git read-tree <base> && git add -- <files> &&
     git write-tree | xargs -I{} git commit-tree {} -p <base> -F msg'
   ```
   > ⚠️ **陷阱**：`GIT_INDEX_FILE` 仍生效时跑 `git status` / `git diff --cached`，会拿**隔离索引**去比 HEAD，得到「全已暂存 / 干净」的**假象**。判定前必须 `unset GIT_INDEX_FILE`，或另开一个干净 shell。
7. **`main` 受保护**：必须 PR + 12/12 必需检查全绿才能合；直接 push 会被 `GH006` 拒绝。
8. **绿灯是绑在 (head, base) 上的**：`main` 一前进，已有 PR 的绿灯即失效，表现为 `12 of 12 required status checks are expected`——这**不是**检查失败，用 `gh pr update-branch` 刷新后重判。
9. **Dependabot 的红绿灯不是信号**：它反映 PR 创建那一刻的 CI。判定前先比对 check 时间戳与 `main` 近期 CI 是否同源。不手工 rebase Dependabot 分支，也不擅自 `@dependabot rebase`。
10. **共享工作树随时可能被他人切分支或重置**（2026-10-11 实测）：某会话收工后把工作树切到 `main`，于是**他人未提交的改动连同暂存区一起消失**（已提交到分支的不受影响）。开工前先核对两件事：
    ```
    git rev-parse --abbrev-ref HEAD     # 当前 HEAD 在谁头上
    git status --short                  # 工作树是否与预期一致
    ```
    发现工作树停在旧版本时**不要直接改**——用 `git show origin/main:<path> > <path>` 做单文件对齐（不切分支、不动索引、不动其他文件），再在其上改。
11. **`origin/main` 可能在一次会话内前进多次**：本次 13:42→13:56 连进两次（#65、#66），导致 `git status`（比 HEAD）与 `git diff origin/main`（比远端）给出看似矛盾的结论。**每次提交前重新 `git rev-parse origin/main`，不要缓存这个值。**

## 2. 当前会话

| 会话 | 角色 | 分支 | 正在做 | 状态 |
| --- | --- | --- | --- | --- |
| `corps-maturity`（lead） | 本文件维护者 | `chore/coordination-board` 等 | major 依赖升级裁决 + 阶段二（Stripe 22.6.2） | 进行中 |
| `zcode` | 并行会话 | —（#47 已合并） | **UI / 默认布局**：`web/lib/default-layouts.ts`、`web/components/dashboard/default-layouts.ts`、`web/components/CommandPalette.tsx`、`web/app/[locale]/w/[wid]/layout.tsx`（当前工作树有 4 个文件未提交） | 进行中 |
<<<<<<< Updated upstream
| `nex` | 并行会话（审查 / 修复） | `fix/im-realtime-polling-fallback` | **IM 实时链路**：`web/components/im/useIM.ts`、`web/lib/im/ws-client.ts`、两个新单测。**明确避开** `web/prisma/**` 与 `CHANGELOG.md`（zcode 在飞） | 待合 |

> 2026-10-11 12:49 复核：上表 `zcode` 行已滞后——工作树当前改动为 `CHANGELOG.md`、
> `web/prisma/schema.prisma` 与未跟踪迁移 `20261007000000_dedup_task_conversations/migration.sql`，
> 已不是 UI 默认布局。该行由 zcode 自行更新，`nex` 未改动它。
=======
| `nex` | 并行会话（审查 / 修复） | `fix/im-realtime-polling-fallback`、`fix/im-realtime-notify` | **IM 实时链路**（已收工） | **已合并**：#65 / #67 |

> 2026-10-11 14:25 复核：`zcode` 行已滞后——其工作已合入 `main`（PR **#66**，
> `fix/task-conversation-dedup`：任务会话并发竞态去重 + `task_id` 唯一约束，见 `3b1ab4f4`）。
> 该行由 zcode 自行更新，`nex` 未改动它。
>
> `nex` 已收工：轮询兜底（#65）与新消息通知（#67）均已合入，`main` 现为 `397d8822`。
> 该会话的领地（`web/components/im/**`、`web/lib/im/ws-client.ts`）**已释放**。
>>>>>>> Stashed changes

**两边方向的共同锚点是 `docs/decisions/ADR-014-三个major依赖升级.md`。**
它已裁定依赖升级的顺序与目标版本（TS 6.0.3 → Stripe 22.6.2 → Prisma 7.10.0），
任何与该 ADR 冲突的升级动作都应先改 ADR，而不是先改代码。

## 3. 在飞的 PR

| PR | 分支 | 内容 | 归属 | 状态 |
| --- | --- | --- | --- | --- |
| #15 | `dependabot/.../prisma-7.10.0` | `prisma` CLI 6.15.0 → 7.10.0 | Dependabot | ❌ **待关闭**——真红灯且结构性（见 Issue #32 §2） |
| #16 | `dependabot/.../prisma/client-7.10.0` | `@prisma/client` 6.15.0 → 7.10.0 | Dependabot | ❌ 同上 |
| #38 | `dependabot/.../stripe-23.0.0` | `stripe` 18.3.0 → 23.0.0 | Dependabot | ❌ **待关闭**——ADR-014 §4.2.4 已否决 23.0.0 |
| #48 | `chore/coordination-board` | 本文件 | lead | 待合 |
| #49 | `chore/adr014-rev-log` | ADR-014 §10 修订记录 + 勘误二 | lead | 待合 |

评估结论统一登记在 **Issue #32**；**该 issue 现在是这条线的唯一事实来源**。

## 4. 领地（避免同时改同一处）

| 文件 / 目录 | 占用或约束 | 说明 |
| --- | --- | --- |
| `web/lib/default-layouts.ts` 等 4 个 UI 文件 | **zcode** | 见 §2，未提交 |
| `web/lib/payments/**`、`web/tests/unit/stripe-api-version.test.ts` | lead（阶段二） | Stripe 升级只动这几个 |
| `web/package.json`、`web/pnpm-lock.yaml` | **改动前必须登记** | 两边都可能碰；锁文件冲突最难解 |
| `scripts/adr015-manifest.txt` | **不得删条目** | ADR-015 §5 已由 CI 门禁 `check_adr015_manifest.py` 强制 |
| `docs/ROADMAP-2026Q4.md` | 冻结 | 由 `scripts/check_burndown.py` / burndown workflow 消费 |
| `scripts/zero-coverage-baseline.txt` | 冻结 | 覆盖率棘轮基线 |
| `docs/decisions/ADR-*.md` | 改动需回写状态段 | ADR 一经落地即成为契约 |

## 5. 已定案 / 已消化的冲突

| 事项 | 结论 |
| --- | --- |
| #44 与 #46 内容逐字节相同 | 保留 #46（`test/auth-logout-semantics`，已合并），#44 关闭 |
| 跨租户越权的响应码 | viewer 写操作返回 **403**（不是 401）；401 仅指「未认证」。见 ADR-011 |
| 登出后旧 access token | 在剩余 TTL（15m，硬编码）内仍有效，属已知取舍；可续期窗口 = 0。**原记的「残余缺口：WebSocket 连接不随登出断开」前提不成立**——本部署跑 Next.js standalone server（`web/docker/entrypoint.sh:70` 的 `exec node server.js`），不处理 WS upgrade（实测部署产物 `.next/standalone/web/server.js` 里 `upgrade` 出现 **0** 次、`handleImUpgrade` **0** 次，`ws` 库未安装，源码零调用点），**根本没有 WS 连接**，所以不存在"登出时断不断"的问题。真实缺口是「**IM 无实时推送**」：服务端 `GET .../messages?after=` 增量游标早已就绪，客户端从未调用。已按 ADR-009 §2.1.1 补 5s 轮询兜底（`nex`，见 §2） |
| TypeScript 6.0.3 | 已合入（`75b80332`），ADR-014 阶段 1 完成。**CI 每次都在 TS 6.0.3 下编译**（`ci.yml:34` 的 `tsc --noEmit`），不存在"从未验证" |
| Prisma 7.10.0（#15/#16） | **不可合**。`P1012`：v7 不再支持 schema 里的 `datasource.url`，而本仓无 `prisma.config.ts` → `prisma generate` 立即失败。另带出 `mysql2` HIGH 审计失败。见 Issue #32 §2 |
| Stripe 23.0.0（#38） | **不合**。ADR-014 §4.2.4 否决（23.x 稳定版仅 1 个，触发条件 ≥3 未满足），目标改投 **22.6.2** |
| `desktop/src-tauri/resources/standalone/package.json` | **不是声明点**，是 `copy-standalone.mjs` 的生成物。不要手改，也不要为它加 CI 门禁 |

