# corps CI 排查记录 · 2026-10-06 · hosted runner 未分配导致的"假红"

- 排查对象：`main @ 3836352b`（本批 3 笔：`efbcd06b` 权限判定/AI 上下文/过期授权 cron 补测、
  `62fd23f8` 时区断言钉 `Asia/Shanghai`、`3836352b` 离线同步队列补测）
- 涉及 workflow run：CI `37366905204`、Burndown `37366905530`（同一颗 sha 的 `push` 触发）
- 立场：只记录能给出**命令 + 返回内容/退出码**的结论。时间一律 UTC。

---

## 一、结论先行

1. **这颗 sha 的 CI 是全绿的**：CI run 现 `attempt=4`、`completed/success`（`updated_at=2026-10-05T21:33:31Z`），
   Burndown `attempt=3`、`completed/success`（`20:47:52Z`）。
2. 在此之前它连红 3 轮，**红因 100% 是 runner 分配失败，与代码无关**：三轮里
   `conclusion=="failure"` 的 job 数**恒为 0**，全部红点来自 `cancelled`。
3. 判据形态值得固化：**run 级 `failure` 只说明"有 job 不 success"，不区分"跑挂了"和"没跑上"**。
   分辨方法是看 job 的 `runner_name` 与 `steps` 长度——两者皆空即从未被接单。

> **结论 1 有生效时点，现已失效（补记 2026-10-06）**：全绿成立到 `2026-10-05T21:33:31Z` 为止。
> 同一颗锁文件（blob `ec8bbd4a`，`3836352b`/`50506a36`/`f78fc121` 三者逐字节相同，按 blob hash 核对）
> 从 `2026-10-06T03:00` 那轮起被 `Security Audit` 判红——报 **2 critical + 1 high**，
> 并因 `needs` 把下游 `Build`/`Publish image (GHCR)` 一起置 skipped。
> 旁证：run `37406946505`（`50506a36`）与 `37411350884`（`f78fc121`）失败 job 数恒为 1、
> 失败步骤恒为 `Audit production deps (high/critical block CI)`，其余 11 个 job 全 success。
> 红因仍是**公告库更新**而非本仓回归（本文的 runner 分配结论不受影响）。
> 已由 `526e1111` 的两条 pnpm override 解掉，改前/改后同命令实测 `退出 1 → 退出 0`，口径见 CHANGELOG。
> **终判（2026-10-06）**：推送 `9f80938d` 的 CI run `37415473720` = **12/12 success**，
> `Security Audit` 首次转绿并把 `Build` 与 `Publish image (GHCR)` 一起放回来，
> 发布日志实到 `ghcr.io/levango7/corps:{main,latest,sha-9f80938d…}`；`Test`/`Test (hardened RLS)`/
> `E2E (production build)` 三条腿在 `tinypool@2.2.0` 下全绿（本机因 Docker 未起而没跑的那两条，由此补上）。
>
> 由此固化一条判据：**"这颗 sha 全绿"不等于"这颗 sha 现在仍全绿"**——审计类门禁的结论绑定
> 公告库时间点，引用它必须带时间戳；同理重跑历史 red 时，先问"门禁的输入变了没有"再归因代码。

---

## 二、时间线（观察值来自本机轮询记录 + API 字段，两者互相印证）

| attempt | 起（UTC） | 终（UTC） | 结果 | 明细 |
|---|---|---|---|---|
| CI 1 | 19:59:10 创建 | ~20:25 | failure（全 cancelled 拼出） | `Test` 20:22:55、`Lint` 20:25:32 转终态但结论均为 `cancelled`；诊断只存在于 check-run 注解（见证据 3） |
| CI 2 | ~20:29 定向重跑 | ~20:44 | failure | 新抢到 `Test`/`Test (hardened RLS)`/`Security Audit`；`Lint`/`API Contract`/`Schema Drift` 仍未接单 |
| CI 3 | ~20:47 定向重跑 | 21:13 | failure | 又抢到 `Lint`、`E2E (production build)`；剩 `API Contract`/`Schema Drift`，下游 `Build`/`Publish image` 被置 `skipped` |
| CI 4 | ~21:23 定向重跑 | **21:33:31 success** | **12/12 success** | 最后两条各自拿到 runner（`1000085854` / `1000085855`） |
| Burndown 3 | ~20:41 定向重跑 | 20:47:52 | **success** | 含 doc-drift 校验与它自己的变异自测（`BURND_DOC_DRIFT` 那条判据） |

推论：**池子是"陆续松"的，不是"永远不给"**——所以正确处置是分批定向重跑（`gh run rerun --failed`），
而不是改流水线配置。

---

## 三、关键证据与命令

**1. 没有一条 job 真失败**

```bash
gh api repos/Levango7/Corps/actions/runs/37366905204/jobs \
  --jq '.jobs[] | select(.conclusion=="failure") | .name'
# → 空输出（attempt 1/2/3 三轮皆空；红点全是 cancelled。attempt 4 已无 cancelled）
```

**2. "没跑上"的结构性判据**

```bash
gh api .../runs/37366905204/jobs --jq '.jobs[] | [.name,.status,(.conclusion//"-"),(.runner_name//"NO-RUNNER"),(.steps|length)] | @tsv'
# Lint / API Contract / Schema Drift 在红的那几轮：runner 空 + steps 长度 0
```

**3. GitHub 自己的诊断只在注解里**（attempt 1 的 check-run `111954174458` 至今可回溯）

```bash
gh api repos/Levango7/Corps/check-runs/111954174458/annotations
# → "The job was not acquired by Runner of type hosted even after multiple attempts"
# → 另有：ubuntu-latest 将于 2026-10-19 迁移到 Ubuntu 26（actions/runner-images#14748）
```

**4. 被取消的 job 确实没有日志（不是没取到）**——同一方法做对照：

| job | 是否上过 runner | 直取日志字节 | 内容 |
|---|---|---|---|
| `Test` | 是（`1000085652`） | **335,539** | 正常日志流，首行 `Current runner version: '2.337.0'` |
| `Lint` | 否 | **215** | `BlobNotFound / The specified blob does not exist` |

取法（`gh api` 不跟随 302，必须自己带 token 跟随）：

```bash
curl -sL -H "Authorization: bearer $(gh auth token)" \
  "https://api.github.com/repos/Levango7/Corps/actions/jobs/<job-id>/logs" | wc -c
```

**5. 从 `Test` 那份日志里拿到的 CI 侧实证**（比本机跑更有分量）

```
##[group]Run npx vitest run --coverage
 Test Files  89 passed | 1 skipped (90)
      Tests  937 passed | 4 skipped (941)
   Duration  108.95s
```

- 唯一 skipped 文件是 `tests/integration/rls-engine.test.ts`（4 例，无 DSN 时按设计跳过；
  它的真库腿在 `Test (hardened RLS mode)`，该 job 本轮 success）。
- `20:41:24 [cron check-expired-permissions] error: Error: delete failed` 是本批新用例
  **故意触发的错误分支**⇒ 证明该文件在 runner 上执行到了，而不只是被收集。

---

## 四、本次踩到的三条"工具假信号"（会直接导致误判）

1. **`gh api .../jobs/{id}/logs` 不跟随 302**，且响应含 ANSI 转义时 `gh` 会**直接拒答**
   （`the response contains terminal escape sequences; pass --allow-escape-sequences`）。
   我一度把它那句 99 字节的报错当成"日志只有 99 字节"，据以差点对"已跑完的 job"下错结论。
2. **`gh run view --job … --log` 在整个 run 未收尾时不报错、只回一句**
   `run … is still in progress; logs will be available when it is complete`（81 字节）。
   这与"日志为空"长得一模一样。
3. **`jobs` 端点只返回当前 attempt**：重跑后 attempt 1/2 的 job 记录被覆盖，
   `select(.conclusion=="cancelled")` 会变空集——那是数据被覆盖，不是"取消了又恢复"。
   可回溯的是 **check-run id 与注解**（按 name 保留）。

---

## 五、处置与遗留

- **未做**：没有把 `runs-on: ubuntu-latest` 钉成具体版本镜像。理由：无证据表明钉版本能落到另一个池，
  而 `.github/workflows/ci.yml` 是共享配置；真要改，**2026-10-19 的 Ubuntu 26 迁移**是更硬的理由，
  届时一并处理更划算（12 个 job 全用 `ubuntu-latest`，且**没有任何 `timeout-minutes`**）。
- **未做**：没有为躲 runner 分配失败去加自动重跑逻辑。现象已由分批 `--failed` 重跑解释清楚，
  机制层面的根因（池容量/账号并发额度）不在仓库内，属外部事实。
- **本批内容**：4 个安全/逻辑文件脱离零覆盖（`lib/document-permission-check.ts`、
  `lib/ai/context.ts`、`app/api/cron/check-expired-permissions/route.ts`、`lib/sync/sync-manager.ts`），
  48 条断言 + 27 处反向变异自测；基线 `scripts/zero-coverage-baseline.txt` 632 → 628，
  与 `docs/ROADMAP-2026Q4.md` §0/§2 同批同步（该耦合由 Burndown 的 doc-drift 校验强制，
  本轮 `Unit Coverage Ratchet` 与 `Quality Baseline Burndown` 双双 success 即为闭环证据）。
