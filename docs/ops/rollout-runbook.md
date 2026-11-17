# corps 灰度放量 Runbook（三态开关）

> 覆盖对象：本仓两套灰度机制——`WRITE_POLICY_MODE`（写策略，已接线）与
> `FLAG_<NAME>_ROLLOUT`（功能开关，`web/lib/feature-flags.ts`，**基础设施，当前零业务调用**）。
> 两者共用同一套设计惯例：三态 + fail-closed（env 取值非法时不降级、不放开，收口到最严档）。
> 关联文档：[`../runbook-monitoring.md`](../runbook-monitoring.md)（看什么日志/指标）、
> [`../runbook-deploy.md`](../runbook-deploy.md)（重启与回滚）、
> `scripts/write-access-registry.txt`（写接口登记表）。
> 更新日期：2026-11-17（初版；flag 登记表当前为空——还没有任何业务 flag 接线）。

---

## 0. 现状声明（先读这个）

- **本仓当前没有生产实例**，本 runbook 是"实例上线后即可执行"的 SOP，不是已完成事项的记录。
- `FLAG_<NAME>_ROLLOUT` 机制**当前没有任何业务调用**：没有任何 route / handler / 组件
  import `web/lib/feature-flags.ts`。谁接了第一个业务 flag，必须在 §8 登记表加一行（接线 PR 一起改）。
- 90 天冻结期约束（`docs/ROADMAP-2026Q4.md` §3）：本机制只提供"按 workspace 放行"，
  不新增表、不新增 route——放量粒度是 **workspace id 白名单**，没有按用户/百分比放量。

## 1. 两套机制总览

| | WRITE_POLICY_MODE | FLAG_<NAME>_ROLLOUT |
|---|---|---|
| 用途 | 写权限裁决灰度（viewer 只读承诺的上线开关） | 任意新功能按 workspace 灰度放行 |
| 代码 | `web/lib/write-policy.ts` + `web/lib/auth.ts`（getWorkspaceContext 内调用） | `web/lib/feature-flags.ts`（`isFlagEnabled(flag, wid?)`，纯函数，调用方自读） |
| env | `WRITE_POLICY_MODE` | `FLAG_<NAME>_ROLLOUT` + `FLAG_<NAME>_WORKSPACES` |
| 三态 | enforce / shadow / off | off / allowlist / on |
| 非法值 | → enforce（fail-closed） | → off（fail-closed） |
| 接线点 | choke point：所有过 getWorkspaceContext 的写请求 | 业务代码自行调用 `isFlagEnabled`，仓库不管接线 |
| 日志 | deny 时 `[write-policy] denied ...`；shadow 误杀面 `[write-policy] shadow-deny ...`（`web/lib/auth.ts`） | **无自动日志**——isFlagEnabled 是纯裁决。观察手段见 §5.3 |
| compose 接线 | `docker-compose.yml` app 服务：`WRITE_POLICY_MODE: ${WRITE_POLICY_MODE:-enforce}` | 尚未接线（第一个 flag 接线 PR 补，惯例同左：`${VAR:-default}`） |

两套机制**并存不互斥**：写策略永远走 `WRITE_POLICY_MODE`（它的三态语义钉死在写权限场景，
shadow=只记不拦，不能复用）；新功能灰度走 `FLAG_*`。

## 2. 三态语义（通用口径）

| 态 | WRITE_POLICY_MODE | FLAG_*_ROLLOUT | 谁能看到 |
|---|---|---|---|
| 最严 | off | off | 没有人（机制完全不介入 / 功能关闭） |
| 中间 | shadow | allowlist | shadow=所有人但只记不拦；allowlist=仅白名单 workspace |
| 最宽 | enforce | on | enforce=裁决生效（拒绝即拒绝）；on=所有人 |

**fail-closed 规则**：env 值非法（空串、拼错、语义含糊如 `"1"` / `"true"` / `"enabled"`）一律按
最严档处理（WRITE_POLICY_MODE → enforce；FLAG → off），取值大小写不敏感。所以：

- 拼错 env 的后果是"功能没开"（安全侧），**永远不是"意外全量放开"**。
- 反过来，"设了 env 但没生效"第一嫌疑就是值拼错——对照上表逐字符核对。

## 3. WRITE_POLICY_MODE 实例：shadow 观察 → enforce 完整流程

这是本仓灰度 SOP 的第一个真实实例，已在 main 接线。背景：157 个写 handler 历史上
零角色判断，viewer 理论上可写；choke point 收口后用 shadow 先观察误杀面再收紧。

### 3.1 shadow 阶段（观察）

```bash
# .env（宿主机）或 compose override 中设：
WRITE_POLICY_MODE=shadow
# 生效（env 是容器启动时注入的，改完必须重启）：
docker compose up -d --force-recreate app
```

看什么（`docker logs corps-app`，日志前缀来自 `web/lib/auth.ts`）：

```bash
# shadow 误杀面：本会被拒但放行的请求（这就是 enforce 上线后会真拒的量）
docker logs corps-app 2>&1 | grep "\[write-policy\] shadow-deny" | tail -50

# 按 path 聚合，看误杀集中在哪些端点
docker logs corps-app 2>&1 | grep "\[write-policy\] shadow-deny" \
  | grep -o 'path=[^ ]*' | sort | uniq -c | sort -rn

# 已拒绝量（enforce 行为的预演）
docker logs corps-app 2>&1 | grep "\[write-policy\] denied" | tail -50
```

### 3.2 判据：什么时候可以切 enforce

| 观察 | 结论 | 动作 |
|---|---|---|
| shadow-deny 连续 ≥3 天为 0，或仅命中 `SELF_SERVICE_WRITE_PATHS` 已豁免的路径 | 误杀面为零 | 切 enforce（§3.3） |
| shadow-deny 集中在某几个 path，且这些操作对 viewer 确属合法自助 | 豁免表缺条目 | 把 path 加入 `web/lib/write-policy.ts` 的 `SELF_SERVICE_WRITE_PATHS`（每条必须写 `why`，注明改的是谁的数据），走 PR，再继续 shadow 观察 |
| shadow-deny 集中在某几个 path，且 viewer 写它们本来就是越权 | 正常拦截，无误杀 | 同上表第一行，可切 enforce |
| 拿不准某 path 是否合法 | 先别切 | 保持 shadow，把 path 与业务判断挂到 PR / 周会决策 |

辅助交叉验证：`scripts/check_permission_gates.py` 的门禁输出（T3 档计数应随修复下降）。

### 3.3 enforce 切换

```bash
WRITE_POLICY_MODE=enforce
docker compose up -d --force-recreate app
# 验证：viewer 账号写任一工作区资源应收到 401 分支响应；日志出现 [write-policy] denied
```

### 3.4 回退

enforce 上线后发现误杀（正常用户被拒）：

```bash
WRITE_POLICY_MODE=shadow   # 只记不拦，恢复可用性，同时继续收集证据
docker compose up -d --force-recreate app
```

**不要回退到 off**：off 会完全关闭写保护（viewer 可写），比误杀严重得多。
shadow 是本机制的"紧急刹车"档——误杀排查清楚（按 §3.2 修豁免表或路由 requirePermission）
后再切回 enforce。

## 4. 新功能 flag 接入步骤（FLAG_*）

1. **代码接线**：在持有 workspace id 的调用点写

   ```ts
   import { isFlagEnabled } from "@/lib/feature-flags";
   // ...
   if (isFlagEnabled("YOUR_FLAG", ctx.workspaceId)) { /* 新功能路径 */ }
   ```

   约定：flag 名建议 UPPER_SNAKE（会 trim + 大写归一到 env key）；`wid` 缺失/空白时
   allowlist 态按未命中处理（fail-closed）。**接线 PR 必须同时更新 §8 登记表**，
   否则 flag 处于"代码里有人读、runbook 里没人管"的失控状态。

2. **compose 接线**（对齐 `WRITE_POLICY_MODE` 的既有惯例，`docker-compose.yml` app 服务）：

   ```yaml
   YOUR_FLAG_ROLLOUT: ${YOUR_FLAG_ROLLOUT:-off}
   YOUR_FLAG_WORKSPACES: ${YOUR_FLAG_WORKSPACES:-}
   ```

   默认必须为 off / 空——新 flag 合入 main 时对所有实例关闭。

3. **单元测试**：env 相关行为在 `web/tests/unit/feature-flags.test.ts` 已覆盖（三态、
   fail-closed、多 flag 隔离）；业务接线的行为差异由接线方在调用点测试覆盖。

## 5. 放量 SOP（off → allowlist → on）

### 5.1 阶段推进

```bash
# 阶段 1：off（默认，合入后即此态）
# 阶段 2：白名单灰度——只给内部/自愿试用工作区开
YOUR_FLAG_ROLLOUT=allowlist
YOUR_FLAG_WORKSPACES=ws-internal-1,ws-beta-2   # workspace id，逗号分隔
# 阶段 3：全量
YOUR_FLAG_ROLLOUT=on
# 每次改完：
docker compose up -d --force-recreate app
```

### 5.2 判据：什么时候进入下一阶段

| 维度 | 看什么 | 门槛（建议值，按业务调整） |
|---|---|---|
| 错误率 | `docker logs corps-app` 中该功能路径的 5xx；或告警阈值（runbook-monitoring §2：5xx > 2% 即告警） | 灰度工作区 5xx 率不高于全量基线 |
| 存活 | `/api/health` 与 15 分钟定时 smoke（`SMOKE_TARGET_URL`）持续绿 | 灰度观察窗（建议 ≥3 天）内无 flag 相关告警 |
| 资源 | `docker stats` CPU/内存对齐 runbook-monitoring §2 阈值 | 无新增 OOM / CPU 长期 >80% |
| 业务反馈 | 白名单 workspace 的实际使用者确认功能可用 | ≥1 个真实工作区跑通主流程 |
| 数据 | 该功能是否写库：Prisma 慢查询/连接数无异常（`docker logs corps-db`） | 无新慢查询模式 |

### 5.3 观察手段的如实声明

`isFlagEnabled` 是纯裁决函数，**不自动打日志**——放量观察靠两件事：

1. 接线方在调用点自行记录开关命中（对齐 `[write-policy] shadow-deny` 的
   `console.error("[your-flag] hit wid=...")` 格式惯例），让 `docker logs | grep "[your-flag]"`
   可统计；或
2. 直接观察业务侧可见效果（功能入口出现与否）+ 上述健康指标。

接线 PR 若选 1，把日志前缀写进 §8 登记表，排障时才有 grep 锚点。

## 6. 回退 SOP

```bash
# on → off：立即止损（全量出问题时）
YOUR_FLAG_ROLLOUT=off
docker compose up -d --force-recreate app

# on → allowlist：问题只出现在部分工作区时，收回到白名单
YOUR_FLAG_ROLLOUT=allowlist
YOUR_FLAG_WORKSPACES=ws-still-healthy-1

# allowlist → off：灰度本身出问题时
YOUR_FLAG_ROLLOUT=off
```

- 回退**只需改 env + 重启**，不需要回滚镜像或代码（新功能代码仍在，只是不可达）。
  这是有意设计：flag 的代价是常驻两套路径的代码，收益是回退秒级且不碰发布物。
- 但若该功能引入了**不可逆数据变更**（新表字段、外部 API 调用等），env 回退不撤销已发生
  的写入——回退前先确认数据面影响，必要时按 `docs/runbook-deploy.md` §4 走完整回滚。
- 回退完成后：在 §8 登记表记一行（日期、从哪态回退到哪态、原因），并开修复 PR。

## 7. env 生效方式（如实声明）

- `isFlagEnabled` 每次调用现读 `process.env`（进程内无缓存快照，测试友好）。
- 但生产 env 由**容器启动时注入**（compose `${VAR:-default}` 语义）——运行中改宿主机
  `.env` 不会热生效，必须 `docker compose up -d --force-recreate app` 重启。
- 验证 flag 当前态：进容器看注入值 `docker exec corps-app printenv | grep FLAG_`，
  再结合调用点日志 / 业务界面行为确认。
- Vercel 托管（`docs/DEPLOY-VERCEL.md`）路径同理：改 Project Environment Variables 后
  需要 Redeploy（Serverless 冷启动即取新值）。

## 8. flag 登记表

| flag 名 | 裁决点（文件:行） | 日志前缀 | 负责人 | 当前态 | 备注 |
|---|---|---|---|---|---|
| （暂无——第一个业务 flag 接线 PR 时在此加行） | | | | | |
