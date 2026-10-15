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
12. **提交前先扫冲突标记**（2026-10-12 实测）：一次 `git stash pop` 的冲突曾被直接提交进 `main`，`docs/COORDINATION.md` 里留下了 `<<<<<<< / ======= / >>>>>>>` 三行。提交前跑一次：
    ```
    git grep -nE '^(<<<<<<<|=======|>>>>>>>)' -- .    # 必须为空
    ```

## 2. 当前会话

| 会话 | 角色 | 分支 | 正在做 | 状态 |
| --- | --- | --- | --- | --- |
| `corps-maturity`（lead） | 本文件维护者 | — | 成熟度收尾：依赖升级、ADR 勘误、协作机制 | **三个依赖升级阶段全部完成**（见 §5） |
| `zcode` | 并行会话 | `fix/task-conversation-dedup`（#66）等 | UI 修复批次（#50）+ 任务会话并发竞态去重（#66） | 均已合入 `main` |
| `nex` | 并行会话（审查 / 修复） | `fix/im-realtime-polling-fallback`、`fix/im-realtime-notify` | IM 实时链路：5s 轮询兜底 + 新消息通知 | **已收工**：#65 / #67 已合入，领地已释放 |
| `cline-coord` | 并行会话 | `chore/coordination-claim`（#96）、`chore/coordination-state`（#98）、`chore/coordination-claims-store` | 协作机制：§6 认领协议 → 认领存储搬分支（合并前可见）→ §3 / §4 防腐 | **#96 / #98 已合**；本分支见本 PR |

**两边方向的共同锚点是 `docs/decisions/ADR-014-三个major依赖升级.md`。**
任何与该 ADR 冲突的升级动作都应先改 ADR，而不是先改代码。

## 3. 当前状态（里程碑；**刻意不写易变值**）

> **本节只放慢变量**：线级进展与已定案的处置。
> `main` tip / 开放 PR / 最近 CI / burn-down 这类值**刻意不写进表**——
> 依据（2026-10-15 实测）：上一版把它们写成表行，刷新后**同一天内**就全错
> （#96 上午还开着、中午就合并、`main` 又前进一次）。
> **一个只在「开会话 / 收工」时才被刷新的文件，装不住小时级变化的数字。**
>
> 要当前值，直接问源头：
>
> ```bash
> git fetch origin main && git log -1 --oneline origin/main   # main 的 tip
> gh pr list --state open                                     # 在飞 PR
> gh run list --workflow=ci.yml --limit 3                     # 最近 CI
> gh run list --workflow=burndown.yml --limit 3               # burn-down 门禁
> ```

| 线 | 状态（里程碑，只增不改） |
| --- | --- |
| 依赖升级（ADR-014） | 三阶段全部落地（结论逐条见 §5） |
| a11y | #94 立静态门禁（jsx-a11y + 基线棘轮 + 防豁免腐烂）；其后 #95 / #97 分两批还存量共 **62 条**（28 + 34），基线同步收缩 |
| 协作机制 | §6 认领协议 + 执行器 `scripts/check_coordination_claims.py`（已接进 Lint job） |

**Dependabot 侧的处置**：#15 / #16 / #38 均已关闭（依据分别是 ADR-014 §4.3 的 P1012 结构性失败、§4.2.4 对 23.0.0 的否决），关闭评论均指向 Issue #32。**不要重开。**

## 4. 领地（避免同时改同一处）

> **本节只放长期约束**；**有时效的占用请写 §6.2**（那是认领表的职责）。
> 2026-10-15 修：原「#72 占用视觉基线」一行早已过期（#72 早就合并），
> 与 §3 是同一类病——**把有时效的占用写进了慢表**。

| 文件 / 目录 | 占用或约束 | 说明 |
| --- | --- | --- |
| `web/e2e/ui-visual*.spec.ts` + `ui-visual.spec.ts-snapshots/**` | **改动前必须登记** | 视觉回归基线（含 4 张 PNG）——动它等于动像素基线，按 §6.1 先认领 |
| `web/package.json`、`web/pnpm-lock.yaml` | **改动前必须登记** | 依赖升级已全部完成，如无必要不要动 |
| `scripts/adr015-manifest.txt` | **不得删条目** | ADR-015 §5 已由 CI 门禁 `check_adr015_manifest.py` 强制 |
| `docs/ROADMAP-2026Q4.md` | 冻结 | 由 `scripts/check_burndown.py` / burndown workflow 消费 |
| `scripts/zero-coverage-baseline.txt` | 冻结 | 覆盖率棘轮基线 |
| `docs/decisions/ADR-*.md` | 改动需回写状态段 | ADR 一经落地即成为契约 |

## 5. 已定案 / 已消化的冲突

| 事项 | 结论 |
| --- | --- |
| #44 与 #46 内容逐字节相同 | 保留 #46（`test/auth-logout-semantics`，已合并），#44 关闭 |
| 跨租户越权的响应码 | viewer 写操作返回 **403**（不是 401）；401 仅指「未认证」。见 ADR-011 |
| 登出后旧 access token | 在剩余 TTL（15m，硬编码）内仍有效，属已知取舍；可续期窗口 = 0。**原记的「残余缺口：WebSocket 连接不随登出断开」前提不成立**——本部署跑 Next.js standalone server（`web/docker/entrypoint.sh:70` 的 `exec node server.js`），不处理 WS upgrade（实测部署产物 `.next/standalone/web/server.js` 里 `upgrade` 出现 **0** 次、`handleImUpgrade` **0** 次，`ws` 库未安装，源码零调用点），**根本没有 WS 连接**。真实缺口是「IM 无实时推送」，已按 ADR-009 §2.1.1 补 5s 轮询兜底（#65 / #67） |
| TypeScript 6.0.3 | 已合入（#14）。**CI 每次都在 TS 6.0.3 下编译**（`ci.yml:34` 的 `tsc --noEmit` + `--frozen-lockfile`），不存在"从未验证"；ADR §4.1.1 预判的 `types` 默认变 `[]` 风险未发生 |
| Prisma 7.10.0（#15/#16） | 当初判定「不可合」正确——Dependabot 版本只改两个文件必然撞 P1012。**最终由 #51 作为独立工程完成**：`web/prisma.config.ts` + driver adapter + 4 处装配点 + 124 条 import 路径 |
| Stripe 23.0.0（#38） | **不合**。ADR-014 §4.2.4 否决（23.x 稳定版仅 1 个，触发条件 ≥3 未满足）。**阶段二改投 22.6.2（#58）**，且**保留 `apiVersion: "2025-06-30.basil"` 钉版**——22.6.2 默认值是 `2026-08-26.dahlia`，省略即静默跨过 clover + dahlia 两个 API 大版本 |
| `desktop/src-tauri/resources/standalone/package.json` | **不是声明点**，是 `copy-standalone.mjs` 的生成物（每次桌面构建 `rmSync` + `cpSync` 整体重建）。#57 曾手改其 TS 版本到 6.0.3 —— **无害但无效**，下次桌面构建即被覆盖。不要为它加 CI 门禁 |

## 6. 认领（claim）—— 动手前必须做的一步

> **为什么加这一节（2026-10-15 实测事故）**：`#94` 本来有自己专属的 worktree
> （`F:/Nexus/corps-wt-a11y`），**隔离是够的**；但一个 `git worktree` 从外面看和普通目录
> 没区别，**它不会告诉你「此刻有 agent 正在这里实时编辑」**。于是另一个会话走了进去、
> 改了同一批文件，最后是靠「同一行在我两次读取之间变了」加上「临时脚本的 mtime 距我取证
> 只差 34 秒」这种**事后经验证据**才发现撞车（已在写坏之前停手回退，未污染对方工作树）。
> §1 的规则与 §4 的领地都是**君子协定**：不登记不会让任何东西变红。本节把它补成
> **显式的、带时效的、且开工前必须检查**的一步。
>
> **第二版（2026-10-15 同日）：认领表搬到了一条分支上。** 第一版把表放在**本文件**里，
> 实测发现一个致命缺口：本文件只在 **PR 合并后**才进 `main`，而别人读的是 `main` 的副本
> —— 于是**认领对自己有效、对别人几乎不可见**，单 PR 短任务里更是「加了又删、净零 churn」。
> 现在表在 `refs/heads/coordination-claims` 上，**直接 push / fetch、不走 PR + CI → 合并前就可见**。

### 6.1 认领粒度

认领的不是「任务」也不是「PR」，是**可写资源**：一个 worktree、一个分支、一组路径。
粒度细到「能判断我下一步会不会踩到别人」即可。**只读不算认领。**

### 6.2 活态认领表（**不在本文件里**）

**表在 `refs/heads/coordination-claims:coordination-claims.txt`** —— 一条**不受保护的分支**上的单个文件，
直接 `push` / `fetch`、不走 PR + CI。这就是它能**在合并前可见**的原因（见节首「第二版」）。

```bash
python scripts/check_coordination_claims.py list      # 看谁在占什么（动手前先看这个）
```

每行一条认领，`|` 分隔，`#` 起头为注释：

```
worktree | 分支 | 路径 glob | agent | since | expires | 意图
```

字段口径：

- **worktree / 分支**：worktree 写**绝对路径**；两者任一不同即视为不同资源。
- **路径 glob**：本次会**写入**的路径（相对仓库根），多个用 `,` 分隔。**只读不算认领。**
- **agent**：会话标识，与 §2 的「会话」列对齐。
- **since / expires**：**`expires` 是硬闸门**——到点即自动释放，不需要本人回来解锁（防死锁）。
  默认 **4 小时**（`claim --hours` 可调）；确需更久就在到期前重新 `claim`（= 心跳）。
- **意图**：一句话，让别人能判断「我该等，还是该要 handoff」。

> 为什么表不放在本文件里、以及它踩过的两个坑（净零 churn、删行循环），见
> `scripts/check_coordination_claims.py` 的 docstring —— 那里是**机制的第一手记录**。

### 6.3 开工前检查（三步，缺一不可）

这三步已机械化，直接跑（别只用肉眼扫一眼）：

```bash
python scripts/check_coordination_claims.py preflight --worktree <目标 worktree> --agent <你的会话名>
# 退出码 0 = 可进入；1 = 停手（被他人认领且未过期，或有未提交改动且无人认领）
```

它替你做的就是下面三件事：

1. `git worktree list` —— 这个 worktree 在哪个分支、还有谁在用。
2. `git -C <worktree> status --short` —— 是否已有未提交改动（**脏 = 可能有人在写**）。
3. 读**活态表**（§6.2）：
   - 目标 worktree / 路径**已被认领且未过期** → **停手**。等它过期，或找对方要 handoff；
     **不要自己 `release` 别人的认领**（那与「替别人合并 PR」是同类越界）。
   - 目标 worktree 干净且**无人认领** → 可以进，但**进去第一件事就是 `claim` 一条**。

> **判定优先级：认领优先于「脏」。** 持有认领的人本来就该是脏的（那是他的在制品）；
> 若把「脏」排在前面，就成了「越守规矩越进不去」的自锁（初版实测踩到过，已有自检钉住）。

### 6.4 收工

```bash
python scripts/check_coordination_claims.py release --agent <你的会话名>
```

- 忘了也没关系：`expires` 到点即视为释放，判据不会因此判红。
- **认领与释放都不产生 PR 改动**（表在独立分支上），所以第一版那个
  「为了删一行要再开一个 PR」的循环**从根上消失了** —— 这是把表搬出仓库文件的另一个收益。
- 认领**不替代** §1：`main` 仍要 PR + 12/12；共享工作树仍禁写（规则 2 / 5 / 10）。

### 6.5 强制范围（如实声明：强制的是一半）

`scripts/check_coordination_claims.py` 已接进 CI（Lint job：判据 + `--self-test`）。
判据读的是**活态表的当前状态**（不是某次提交的快照），**被强制的是这两条**：

- **格式合法**：段数、字段非空、`expires > since`、worktree 为绝对路径、glob 为相对路径；
- **同一资源不得被两条未过期认领占用**（`CLAIM_CONFLICT`）。

**没被强制的**（别误以为已经万无一失）：

- **「压根没认领就动手」** —— 而这正是 2026-10-15 事故的形态。静态判据看不见它，
  只能靠 §6.3 的自觉执行（`preflight` 把 §6.3 压成一条命令，是为了降低门槛，不是替代自觉）；
- **过期行不判红** —— 依据是 §6.4 的承诺。代价是表里会留「可清理」的尾巴，`check` 会打印提示；
- **重叠但不相等的 glob**（如 `src/**` 与 `src/a.ts`）不判红 —— 要 glob 求交，
  收益低而假阳性高，这一层交给人眼。

> **边界（如实声明）**：判据从 `origin` 取那条存储分支。本仓库的 PR 都来自同仓分支（含
> Dependabot），所以取得到；**来自 fork 的 PR 会取不到**，会被判 `CLAIM_STORE_MISSING`（红）。
> 真出现 fork 贡献者时，再让脚本回退到 `upstream` 或改用 API 读 —— 现在不预先复杂化。

改动本节口径时，务必同步改脚本的红因集合与 `--self-test` 用例：**约定与执行器必须同源**，
否则文档写着一套、CI 判着另一套，比没有判据更坏。
