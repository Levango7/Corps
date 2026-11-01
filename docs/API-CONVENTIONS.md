# API 响应信封约定

本文把几条**一直在被消费、却从来没有写下来**的 API 约定明确成文，并指明对应的机器门禁。
它的存在理由很直接：隐式约定无法评审、无法测试，只能靠人记住——而人会记错，代码不会。

---

## 1. `code` 等于 HTTP 状态码

**规则**：响应体里的 `code` 字段必须等于本次响应的 HTTP 状态码。成功即 `200`，新建即 `201`，错误即 `4xx/5xx`。

### 为什么这条不是风格问题

它在被真实消费，两处证据：

| 位置 | 用途 |
|------|------|
| `web/lib/api.ts:114` `json?.code ?? res.status` | 统一错误码的来源：优先读响应体的 `code`，读不到才回落到 HTTP 状态 |
| `web/components/pwa/PushSubscribe.tsx:63` `if (subscribeJson.code !== 200)` | 直接拿 `code` 判成功；`code` 不是 200 就走失败分支 |

也就是说：**一个成功响应如果返回 `code: 0`，在采用这种判法的客户端里会被读成失败。**

**但要说清楚风险的性质**：截至 2026-11-01 这 101 处**没有一处正在造成线上故障**。
唯一按 `code !== 200` 判成功的消费者 `PushSubscribe` 打的是 `/api/v1/push/subscribe`，
该端点返回 `code: 200`（`push/subscribe/route.ts:125`）；而违规出现在
`/api/v1/push/register` 与 `/api/v1/push/send`——**是不同端点**。

所以这是一批**潜在陷阱**而不是现存 bug：谁哪天给 `register` / `send` 接一个按 `code` 判成败的客户端，
就会踩。把它记成"已知隐患"比记成"线上故障"更诚实，也更难被后来人当成噪声忽略。

### 现状（2026-11-01 快照）

| 指标 | 数值 | 复核命令 |
|------|------|----------|
| 违反处数 | **101 处** | `python scripts/check_response_envelope.py` （末行「合计」） |
| 涉及生产路由文件 | **63 个** | 同上（末行括号内） |
| 对照：用状态码的响应 | 389 处 | `grep -rn "code: 200\|code: 201\|code: 204" web/app/api --include=route.ts \| wc -l` |

> 用朴素 `grep -c 'code: 0'` 会数出 117 处 / 65 个文件——多出的是**文档注释在描述信封格式**
> （例如 `ai/mail-assistant/route.ts:6` 的 `// - summarize：{ code: 0, data: ... }`）。
> 门禁先逐行剔除注释再计数，所以基线是 101。这类误报本项目踩过一次：
> `score_maturity.py` 曾把注释里的 `withRed(` 当成真实调用点。

这 101 处横跨 ai / mail / push / notifications / favorites / forms / workflows / sync / im 等域，
是**全仓的第二套方言**，不是某个域的一次性失误。

### 门禁：棘轮，不是一刀切

`scripts/check_response_envelope.py` + `scripts/envelope-code-baseline.txt`，CI 在
`API Contract Check` job 里跑，并附带一次注入式自检。

红因只有两种，都是「新增/变多」语义：

| 红因 | 含义 | 处置 |
|------|------|------|
| `NEW_FILE` | 基线外的文件首次出现 `code: 0` | 真修成 `code: 200/201`；确需保留则显式登记 |
| `REGRESSION` | 已登记文件的处数变多 | 只许减少 |

**处数减少或归零不判红**，只打印「已清偿」提示。理由：如果修好一处的人反而被门禁卡住，
下一个人就会去 `--no-verify`，门禁等于不存在。收紧靠人跑 `--emit` 复核。

为什么不一刀切禁止：上线时全仓已有 101 处真实存量，一道上线就全红的门禁只会被绕过。
登记 ≠ 认可——基线是**待还债务清单**，不是成绩单。

### 口径边界（刻意没做的部分）

- **不判** `code: <N>` 与 `{ status: <M> }` 的配对。`code: 200` 配 `status: 201` 这类要 AST 才分得清，
  正则误报的代价高于收益。
- **不判** `message` 字段的形态差异（有的域带 `message: "OK"`，有的不带）。
- 仅扫 `web/app/api/**/route.ts`；测试与夹具不在射程内。

---

## 2. 清偿路线（按域分批，不夹带）

统一信封是**行为变更**，不应该藏在数据或补丁批次里悄悄做。按域分 PR，每批：

1. 把该域的 `code: 0` 改成对应状态码（`200` / `201`）；
2. 跑 `python scripts/check_response_envelope.py --emit` 收紧基线，**人工核对 diff**；
3. PR 描述里写明「本批改变了响应体，属行为变更」，并列出受影响的端点。

建议顺序（先小后大，先无人依赖后有人依赖）：

| 批次 | 域 | 处数（2026-11-01） | 备注 |
|------|----|--------------------|------|
| 1 | `forms` 7 / `workflows` 9 / `documents` 3 | 19 | 这三组已有契约声明，改完可直接同步 `api/openapi.yaml` 的描述 |
| 2 | `notifications` 5 / `favorites` 5 / `presence` 2 / `sync` 2 / `todos` 2 / `search` 1 | 17 | 前端只见 `res.ok`，风险最低 |
| 3 | `mail` 10 / `remote-control` 5 / `push` 3 | 18 | `push` 的违规在 `register` / `send`，与 `PushSubscribe` 打的 `subscribe` 不是同一端点 |
| 4 | `ai` 45 / `tasks` 1 / `im` 1 | 47 | 最大一块，最后做 |

> 上表处数由基线文件按域汇总得出（`awk` 求和 = 101，与门禁合计一致），是 2026-11-01 的快照。
> **不要当"当前值"读**——每批合入后跑一次门禁取新数。

---

## 3. 新增响应时的自检清单

- [ ] 成功响应的 `code` 是否等于 HTTP 状态码（`200` / `201`）？
- [ ] 错误响应的 `code` 是否等于 HTTP 状态码（不是 `0`、不是 `200`）？
- [ ] `data` 是对象还是 `null`，是否与该端点在 `api/openapi.yaml` 的声明一致？
- [ ] 跑过 `python scripts/check_response_envelope.py`（本地即可，秒级）？
