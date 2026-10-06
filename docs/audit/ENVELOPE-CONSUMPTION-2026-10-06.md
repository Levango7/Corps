# corps 信封消费面普查 + 一处静默失效（2026-10-06）

- 对象：`main @ fd572159`（本机 `git rev-parse --short HEAD` 实读）
- 立场：只记能给出**命令 + 输出/退出码**的结论。分析脚本 `env_audit.py` 留在仓库外
  （`F:\Agent\Qoder\workspace\`），故本报告**不是**已入库门禁，是一次性普查 + 定性。
- 起因：复核基线（`corps-assessment-baseline` 第 10/11 条）挂着"候选但未核实的信封误用"三条，
  且本仓库该缺陷曾把 `/documents` 整页打进错误边界（`KnowledgeBase` 用 `api<Space[]>` 消费
  `{items,total}` ⇒ 渲染期 `TypeError: e is not iterable`）。

---

## 1. 结论

| # | 判定 | 依据 | 状态 |
|---|---|---|---|
| 1 | **信封误用（`api<Foo[]>` 消费分页信封）在可读范围内已清零** | 25 个顶层数组消费点逐个对到路由 200 返回：21 个路由确实返回裸数组、3 个端点无 GET（见 §4）、1 个工具没匹配上但人工读完是裸数组（`decisions/[did]/versions/route.ts:41 data: versions`）。`RISKY = 0` | 已核实，不是缺陷 |
| 2 | 基线里那三条候选（`DocQaPanel` / `ContactDetail` / `contacts page`）**都不是缺陷** | 三者已用 `apiList`，而 `wiki` 与 `contact-groups` 的 GET 都返回 `data:{items,total,hasMore}`（`wiki/route.ts:150`、`contact-groups/route.ts:58`），`itemsOf` 取 `items` 正确 | 已核实，不是缺陷 |
| 3 | **`approvals/instances/[aid]/cc` 无 GET handler，两处消费方静默拿到空列表** | `cc/route.ts` 只有 `export async function POST`（`grep -nE "^export async function"` 仅一条命中）；`ApprovalDetail.tsx:247` 与 `:335` 用无 method 的 `api<CcUser[]>(url)` ⇒ GET ⇒ 405，且分别被 `catch {}` 与 `.catch(() => [])` 吞掉 | **真实缺陷（P2，静默）** |
| 4 | 成功码约定不统一：65 个路由文件返回 `code: 0`、200 个返回 `code: 200` | `grep -rlE "code: 0," app/api --include=route.ts \| wc -l` = 65；`code: 200` = 200 | 非缺陷（见下） |

第 4 条为什么不算缺陷：`lib/api.ts:76` 判错只看 HTTP 状态（`if (!res.ok)`），`json.code` 仅作为
`ApiError` 的附带码返回，所以 `code:0` 与 `code:200` 混用**不影响**前端错误判定；
但它会让任何"按 body 的 code 判成功"的新客户端踩坑，属风格债，未列入待办。

---

## 2. 普查口径（数字可复现）

同一件事有三种数法，各自口径不同，写清楚免得被当成互相矛盾：

| 数法 | 命令 | 结果 |
|---|---|---|
| **调用点 token 总数**（统一分母） | `grep -rhoE "\bapi(List)?<" --include=*.ts --include=*.tsx app/'[locale]' components lib \| wc -l` | **294** |
| 脚本解析到的调用点 | `python env_audit.py`（要求首个实参是字符串字面量） | 224 |
| **盲区：未被脚本解析** | 同一脚本自报聚合（42 个文件） | **70** |
| 其中顶层数组消费点 | 同上，`TOP_ARRAY` 判定 | 25 |
| 已写成兼容式的信封消费 | `grep -oE "api<[^()]*>\(" \| grep "\[\]" \| grep -c "\|"` | 12 |
| 显式声明信封（`api<{items:X[]}>`） | `grep -c "^api<{\s*items"` | 36 |
| 用 `apiList` 归一化 | `grep -rhoE "apiList<[^()]*>\(" \| wc -l` | 20 |

**盲区（如实标注）**：**70 处 / 42 个文件**未被脚本解析，全是"路径不是字面量"的调用
（如 `api<ChatMessage[]>(base)`、`api<T[]>(endpoint)`、多行写法）。要靠读变量构造点才能定性，
所以本报告**不下"全仓已闭"的结论** —— 只说"字面量路径的消费面已闭"。
（先前这里写的是"34 处"，那是拿 258 减 224 得来的**跨口径减法**：258 用的是
`api<[^()]*>\(`，既不含 `apiList<`、又要求 `>(` 与泛型同行，与被减数 224 的分母根本不同。
现改用"同一脚本自报 token 总数与解析数"这对同口径数字，差值由脚本自己算并打印。）

---

## 3. 探针自检与五次自伤（都造成过假结论）

脚本开头带 5 条对照，用来证明"它能分辨信封与裸数组"，否则它的 `RISKY=0` 没有证据力：

```
ok   /api/v1/workspaces/SEG/contact-groups envelope=True  want=True
ok   /api/v1/workspaces/SEG/members        envelope=True  want=True
ok   /api/v1/workspaces/SEG/tasks          envelope=True  want=True
ok   /api/v1/workspaces                    envelope=False want=False
ok   /api/v1/workspaces/SEG                envelope=False want=False
self-check wrong: 0
```

过程里我自己制造并纠正了五个错，都值得留字据：

1. **正则要求 `>` 紧跟 `[`**：`api<[A-Za-z0-9_.]+>\[` 匹配不到 `api<Foo[]>`（`[` 在 `>` 之前），
   于是得到假的"全仓 0 处裸数组消费"。
2. **字符类里根本没有方括号**：改用 `api<[A-Za-z0-9_\| {},<>.]*>\(` 数 `[]`，同样恒 0。
   前两次都指向"已清零"，而第三次跑就出来 85 处含数组的泛型 —— **连续两次假阴性不会互相印证，只会互相掩盖**。
3. **拿正则当被匹配字符串**：路由键是正则、调用点模式也是正则，`re.match(tmpl_re, route_pattern)`
   把 25 个调用点全判成"未匹配"，看起来像"路由表不全"，其实是方向搞反。改成动态段一律归一成 `SEG` 标记、
   做**字面相等**比较才对。
4. **扫描漏了 `.ts`**：只扫 `components/**/*.tsx`，漏掉 `components/im/useIM.ts` 这类消费者，
   解析数停在 148；补齐后是 224。缺口不是多行调用（实测 0 例），纯粹是文件范围少了一类。
5. **跨口径减法造出假盲区**：我先用 `258 − 224 = 34` 宣布"34 处未定性"。但 258 来自
   `api<[^()]*>\(`（不含 `apiList<`、且要求 `>(` 与泛型同行），224 来自另一套正则，
   **两个数不是同一分母，相减毫无意义**。改成"同一脚本自报 token 总数 294 与解析数 224，
   差值由脚本自己算并打印"之后，真实盲区是 **70 处 / 42 个文件**——比我先公布的数字大一倍。
   判据：**做差值的两个数必须来自同一把尺**，否则宁可让工具自己打印聚合，不要手算。

另有一条判据：**GET 有 handler 但 200 返回没被解析出来的路由，绝不能默认放行**。
第一版脚本正是这么处理的（空列表 ⇒ `any(...)=False` ⇒ 判"安全"），当时 `agents`/`im-search` 三行
显示 `data~ -` 暴露了它。现按 `GET_SHAPE_UNPARSED` 单独成桶（本次为 0 例，但桶必须存在）。

---

## 4. 待修：审批抄送列表恒空（本次唯一的真实缺陷）

- 位置：`web/app/api/v1/workspaces/[wid]/approvals/instances/[aid]/cc/route.ts`（仅 `POST`）
  与 `web/components/approval/ApprovalDetail.tsx:247`、`:335`。
- 现象：**不报错、不红、界面看着正常**，只是抄送人区块永远空。第 247 行原有注释
  "抄送 API 可能不存在，从详情中提取" —— 写代码时已经怀疑，但没有把怀疑变成断言或端点。
- 为什么属于基线第 1 条判据家族：*接线存在 ≠ 调用能通过*。这里连"调用会 405"都被 `catch` 吸收了，
  比缺接线更坏 —— 它给使用者一个"没有抄送"的假事实。
- 修法二选一（都要连带测试，未在本机验证，因为 Docker/PG 没起、`next build` 又被 Windows SWC
  DACL 卡住，见 [[corps-verify-hazards]] §12）：
  ① 给 `cc/route.ts` 补 `GET`：`requirePermission(ctx, "approvals", "r")` + 按 `workspaceId`/RLS 过滤，
     返回 `data: CcUser[]`；
  ② 或让详情端点把 `cc` 一起返回，删掉这两次独立请求（少一个端点，但要改详情响应契约，成本更高）。
- **补一条实测，因为这条改动的成本比看上去低**：`check_api_contract.py` 的 `collect_routes()`
  返回的是**路径集合、不含 HTTP method**，而 `scripts/api-contract-baseline.txt:124` 已收了
  `/api/v1/workspaces/{wid}/approvals/instances/{aid}/cc` ⇒ **给已有路径补 GET 不会触碰只允许收缩的
  端点基线**、也不需要新增路径条目（openapi 补 operation 即可，该门禁只比 path 键）。
  所以选 ① 不必先谈并行会话的脚本归属；真要谈的是"要不要把方法维度纳入契约"——那是另一条更大的口径。
- 已在 `ApprovalDetail.tsx:245-247` 留 `TODO(P2)` 注释指向本文，未擅自改服务端行为。

---

## 5. 复查命令

```bash
cd F:/Nexus/corps/web
python F:/Agent/Qoder/workspace/env_audit.py        # 含 §3 的 5 条自检
grep -nE "^export async function" "app/api/v1/workspaces/[wid]/approvals/instances/[aid]/cc/route.ts"
sed -n '245,255p' components/approval/ApprovalDetail.tsx
```

若 `env_audit.py` 被删除，§2 的 grep 行仍能独立复现三个计数；但"0 处信封误用"这个结论
依赖脚本的自检，**没有自检输出的 `RISKY=0` 不应被采信**。

要不要把它升成入库门禁（`scripts/check_envelope_consumption.py` + 一条 CI leg，像零覆盖棘轮那样
只允许收缩）是一个待决项：它天然该和 `check_api_contract.py`（205 端点基线，归属并行会话）合流，
所以**先定归属再落 `scripts/`**，否则会出现两份端点形状口径互相打架——那正是
"同一指标两处声明"在覆盖率门上踩过的坑。
