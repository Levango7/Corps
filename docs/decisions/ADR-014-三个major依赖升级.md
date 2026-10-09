# ADR-014: 三个 major 依赖升级（TypeScript / Stripe / Prisma）

> 状态：**草案 · 待用户确认后实施**
> 日期：2026-10-07
> 关联：ADR-002（技术栈选型）、ADR-003（计费方案）、ADR-005（Stripe 计费接入）、ADR-006（RLS 激活机制与 op 信任模型）、ADR-012（协同降级）、issue #32
> 范围：只读调研 + 决策记录。**本 ADR 落地前不改动任何 `package.json`，不执行任何 `pnpm update` / 依赖安装。**

---

## 一、背景

issue #32 的 body **只有 5 字节**（一个 `## 现状`）。也就是说 TypeScript、Prisma、Stripe 三个 major 升级**从来没有过论证依据**，只有一句待办。

本轮之前存有两周前（2026-10-04）的口头结论：TS 锁 6.0.3 而非 7.0.2、Prisma 7 有一组破坏性变更、Stripe 最新 23.0.0。这些结论**没有写进任何文档**，且两周内上游已发生变化。本 ADR 全部数据重新实测，不引用旧结论。

用户已确认的初始升级顺序为 **TS → Stripe → Prisma**（按风险从低到高、可独立回滚排序）。§5 给出对这一顺序的裁决。

---

## 二、决策（摘要）

| 阶段 | 依赖 | 当前 | 目标 | 裁决 |
|---|---|---|---|---|
| 一 | TypeScript | `6.0.3`（已声明，**未安装**，见 §10.1） | **`6.0.3`** | 实施。明确否决 7.0.2（见 §4.1.4）。**当前处于半成品状态** |
| 二 | Stripe | `18.3.0` | **`22.6.2`** | 实施。明确否决 23.0.0（见 §4.2.4，`apiVersion` 护栏已先落地） |
| 三 | Prisma | `6.15.0` | `7.10.0` | **本轮不启动**，挂 §7.3 的前置条件 |

顺序维持 **TS → Stripe → Prisma**，理由见 §5。三处修正（目标版本而非 latest、Prisma 改挂前置条件）是本 ADR 相对初始顺序的实质改动。

> §10（2026-10-09 修订记录）包含后续实测对本文件各章节的校验与勘误，编号如上表的实测数据以 §10 为准。

---

## 三、现状实测数据

所有版本号来自 `npm view`，实测于 2026-10-07（registry 为 `npmmirror.com` 镜像，存在滞后可能；下表数据内部自洽，如 stripe 23.0.0 的发布日期与搜索结果一致）。

### 3.1 声明版本与安装版本

`web/package.json` 三个包均为**精确 pin、无 semver 范围**：

| 包 | 位置 | 声明值 | `node_modules` 实测值 | 一致 |
|---|---|---|---|---|
| `typescript` | `web/package.json:100`（devDeps） | `5.9.3` | 5.9.3 | 是 |
| `stripe` | `web/package.json:68` | `18.3.0` | 18.3.0 | 是 |
| `@prisma/client` | `web/package.json:33` | `6.15.0` | 6.15.0 | 是 |
| `prisma`（CLI） | `web/package.json:98`（devDeps） | `6.15.0` | 6.15.0 | 是 |

**第二处声明点（易漏）**：`desktop/src-tauri/resources/standalone/package.json` 同样精确 pin 了这四个包（`:33` `@prisma/client 6.15.0`、`:68` `stripe 18.3.0`、`:97` `prisma 6.15.0`、`:99` `typescript 5.9.3`）。任何一项升级都要同步改这两处，否则 Tauri 桌面端打包拿到的仍是旧版本。

### 3.2 当前版本 vs latest

```
$ npm view typescript dist-tags
{ beta: '6.0.0-beta', latest: '7.0.2', next: '7.1.0-dev.20261006.1', rc: '7.0.1-rc' }

$ npm view stripe dist-tags
{ beta: '18.6.0-alpha.2', latest: '23.0.0', 'public-preview': '23.1.0-beta.1' }

$ npm view @prisma/client dist-tags
{ latest: '7.10.0', prev: '6.19.3', dev: '8.1.0-dev.7' }

$ npm view prisma dist-tags
{ latest: '8.0.0-rc.20', prev: '7.10.0', dev: '8.0.0-rc.20-dev.139' }
```

跨 major 数与发布节奏：

| 包 | 当前 | 当前发布日期 | latest | latest 发布日期 | 跨越 major | 当前所在线是否还在出补丁 |
|---|---|---|---|---|---|---|
| typescript | 5.9.3 | 2025-09-30 | **7.0.2** | 2026-07-08 | 2（6、7） | 5.x 已停更 |
| stripe | 18.3.0 | 2025-07-01 | **23.0.0** | **2026-10-01** | 5（19–23） | 18.x 最后一版 18.5.0（2025-08-27），已停更 13 个月 |
| @prisma/client | 6.15.0 | ~2025-08 | **7.10.0** | 2026-08-25 | 1（7） | 6.x 最后一版 6.19.3（2026-04-01），已停更 6 个月 |

TypeScript 稳定版实际只有三个跨过 5.9 的版本，且 **6.x 线已终止**：

```
6.0.2  2026-03-23
6.0.3  2026-04-16    ← 6.x 最后一个版本，此后无 6.0.4 / 6.1
7.0.2  2026-07-08
```

Stripe 各 major 的成熟度差异极大：

```
19.x  6 个版本   20.x  9 个   21.x  2 个
22.x 17 个版本   22.6.2 = 2026-09-09
23.x  1 个版本   23.0.0 = 2026-10-01（本 ADR 撰写时 6 天龄）
```

### 3.3 类型检查基线

```
$ cd web && ./node_modules/.bin/tsc --noEmit --incremental false
EXIT=0        耗时 2m14s
```

**升级前类型检查零错误**（904 个 `web/**/*.ts(x)` 文件）。这是后面两阶段能把新增报错干净归因的前提：任何升级后新出现的错误都来自升级本身，不是历史欠账。

---

## 四、每项升级的成本与风险（落到文件）

### 4.1 TypeScript 5.9.3 → 6.0.3

#### 4.1.1 会撞上的破坏性变更

TS 6.0 是自 TS 2.0 以来破坏性变更最多的一次发布（多个二手来源一致，官方文档待实施时核对）。与本仓相关的：

| 变更 | 本仓现状 | 是否撞上 |
|---|---|---|
| `types` 默认变为 `[]`，不再自动包含全部 `@types/*` | `web/tsconfig.json` **没有 `types` 字段** | **会。** `@types/node` 的全局声明（`process` / `Buffer` / `__dirname`）会整体消失，API 路由与脚本大面积报错 |
| `strict` 默认 true | 已显式 `strict: true` | 否 |
| `module` 默认 `esnext`、`target` 默认 `es2025` | 已显式 `target: ES2022`、`module: esnext` | 否（但 `target` 需评估是否顺势上调） |
| 移除 `module: amd/umd/systemjs/none`、`moduleResolution: classic`、`outFile` | 用的是 `bundler` | 否 |
| `esModuleInterop` / `allowSyntheticDefaultImports` 不可再为 false | 已为 `true` | 否 |
| 为 tsc 传文件参数且存在 tsconfig 时报错 | CI 用 `-p .`，不传文件参数 | 否 |

唯一实质改动面是 **`web/tsconfig.json` 一个文件**。

#### 4.1.2 改动面与回滚

- 改动面：**1 个配置文件 + 1 个 version pin（`web/package.json:100`）+ 同步 `desktop/.../standalone/package.json:99`**。
- 预估：补一个显式 `types` 数组（大概率只需 `["node"]`），然后跑 tsc 收敛。
- 回滚成本：**最低**。只 revert version pin，无业务代码改动，无数据面影响。

#### 4.1.3 可独立发布/回滚

可以。TS 只影响构建期类型检查，不进入运行时产物。

#### 4.1.4 为什么否决 TypeScript 7.0.2 —— 两条硬证据

这不是保守，是两条可验证的事实把它排除了：

**证据 A：`typescript@7.0.2` 是原生二进制发行版，不再提供 JS Compiler API。**

```
$ npm view typescript@5.9.3 bin     → { tsc: 'bin/tsc', tsserver: 'bin/tsserver' }
$ npm view typescript@6.0.3 bin     → { tsc: 'bin/tsc', tsserver: 'bin/tsserver' }
$ npm view typescript@7.0.2 bin     → { tsc: 'bin/tsc' }        ← tsserver 消失
$ npm view typescript@7.0.2 deps    → 20 个平台原生包
                                      （@typescript/typescript-win32-x64 等）
```

`bin` 里 `tsserver` 消失、依赖变成 20 个按平台分发的可执行文件，说明 7.x 的 `typescript` 包是 Go 编译器（`tsgo`）的分发壳，**不再导出 `lib/typescript.js`**。

**证据 B：本仓两条工具链都依赖 `typescript` 的 JS API，且都把 6.x 当作上限。**

1. Next 16.3.8 在构建期做类型检查时，直接 require JS API 文件，并且缺失时安装的是 `typescript@^6.0.0`：

```
node_modules/next/dist/lib/verify-typescript-setup.js:83-85
  const typescriptApiPackage = {
      file: 'typescript/lib/typescript.js',   ← 7.0.2 没有这个文件
      pkg: 'typescript',
      install: 'typescript@^6.0.0',           ← Next 认定的配套版本是 6
  };

node_modules/next/dist/lib/typescript/runTypeCheck.js:101/111/121
  typescript.createIncrementalProgram(...)
  typescript.createProgram(fileNames, options)
  typescript.getPreEmitDiagnostics(program)
  typescript.DiagnosticCategory.Error
```

2. `typescript-eslint` 的 peer 范围同时封住了 7.x，且**最新版仍未放开**：

```
typescript-eslint@8.71.0（本仓在用）  peerDependencies.typescript = ">=4.8.4 <6.1.0"
typescript-eslint@8.71.1（latest）    peerDependencies.typescript = ">=4.8.4 <6.1.0"
```

`6.0.3` 落在 `<6.1.0` 内，合法；`7.0.2` 直接越界，且 `eslint.config.mjs:2-9` 用的 `@typescript-eslint/parser` 需要 JS 解析器 API。

**一个反直觉但重要的点**：TS 6.0.3 是 6.x 的**最后一个**版本（此后无 6.0.4、无 6.1）。也就是说 6.0.3 是一条不再收补丁的死路。但它是 Next 16.3.8 与 typescript-eslint 共同支持的**唯一**"新"版本——在 Next / typescript-eslint 升级之前，7.x 无解。这个取舍要写清楚，不要让人误以为锁 6.0.3 是长期方案。

**TS 7 的触发条件**（满足后可另立 ADR 重启）：

1. `typescript-eslint` 发布支持 `>=7.0.0` 的版本；
2. Next 官方声明支持 TS 7（或 `verify-typescript-setup` 不再 require `typescript/lib/typescript.js`）；
3. 有 `@typescript/native-preview` 与本仓 CI 并行的验证记录。

### 4.2 Stripe 18.3.0 → 22.6.2

#### 4.2.1 使用面：极小，且已被 provider 抽象隔离

- 全仓**只有 1 个文件** import Stripe SDK：`web/lib/payments/stripe-provider.ts`。`web/lib/payments/index.ts` 只 import `StripeProvider` 这个适配器类，不碰 SDK。
- SDK 调用点共 **6 处**，全部是单参数对象形式：

| 行 | 调用 |
|---|---|
| `stripe-provider.ts:113` | `stripe.checkout.sessions.create({...})` |
| `stripe-provider.ts:159` | `stripe.billingPortal.sessions.create({...})` |
| `stripe-provider.ts:176` | `stripe.subscriptions.retrieve(id)` |
| `stripe-provider.ts:179` | `stripe.subscriptions.update(id, {...})` |
| `stripe-provider.ts:209` | `stripe.webhooks.constructEvent(rawBody, sig, secret)` |
| `stripe-provider.ts:248` | `stripe.subscriptions.retrieve(subId)` |

- 文件里还有 **4 处为绕开 v18 类型缺口而写的交叉类型 cast**，它们是最可能与新版类型冲突的地方：

  - `:270-271` `Stripe.Subscription & { current_period_end?: number }`（注释：`v18+ 类型已移除 current_period_end`）
  - `:282-284` `Stripe.Invoice & { subscription?: ... }`
  - `:298-303` `billing_reason` / `subscription` 同类型缺口
  - `:318-322` `cancellation_details?.reason`

#### 4.2.2 会撞上的破坏性变更（跨 4 个 major）

| 版本 | API 版本 | 与本仓相关的破坏性变更 | 是否撞上 |
|---|---|---|---|
| v19 | 2025-09-30.clover | V2 事件类型搬移；`Discount.coupon` 移除 | 不撞（本仓只用 v1 资源） |
| v20 | 2025-11-17.clover | v2 数组参数序列化改 indexed 格式 | 不撞（不用 v2） |
| v21 | `2026-03-25.dahlia`（21.0.0 起） | ① `decimal_string` 字段类型 `string` → `Stripe.Decimal`；② **用错 webhook 解析方法时抛错**；③ Node >= 18 | ① **已实测不撞**（见 §10.2）；② **已实测排除**——只在 V2 thin event 触发，本仓接 V1（见 §10.2）；③ CI Node 22 满足 |
| v22 | `2026-03-25.dahlia`（22.0.0）→ **`2026-08-26.dahlia`（22.6.2，本 ADR 目标）** | ① TS 类型大改：类型改为与实现同文件内联，移除顶层 `stripe` ambient module；② **移除 callback 支持**；③ **params 与 options 不再混用，params 必须在前、options 必须在后**；④ CJS 入口不再导出 `.default` / `.Stripe`；⑤ `Stripe.StripeContext` → `StripeContextType` | ②③ 不撞（6 处调用都是单 params 对象）；① **已实测通过**（PR #38 CI + §10.2 隔离复刻，0 error）；⑤ 不撞 |

**最大风险不在代码，而在 API 版本的隐式跳跃。** `stripe-provider.ts:50-52` 构造时**没有指定 `apiVersion`**：

```ts
this.client = new Stripe(STRIPE_SECRET_KEY, {
  appInfo: { name: "corps", version: "0.1.0" },
});
```

实测当前 SDK 默认值：

```
$ cat web/node_modules/stripe/cjs/apiVersion.js
exports.ApiVersion = '2025-06-30.basil';
```

不指定 `apiVersion` 意味着**升 SDK 就自动换 API 版本**，生产响应结构会跟着变——这是支付路径上最难回滚的一类变更。

**强制要求**：升级时在构造函数里**显式钉住 `apiVersion: "2025-06-30.basil"`**，把"SDK 大版本升级"与"Stripe API 大版本升级"拆成两件独立的事。API 版本是否跟进，另开一次带沙箱验证的变更。

#### 4.2.3 改动面与回滚

- 改动面：**1 个业务文件 + 1 个 version pin + 同步 `desktop/.../standalone/package.json:68`**。
- 回滚成本：低。revert version pin + `apiVersion` pin 即可，无数据面影响。
- 可独立发布/回滚：**可以**，且是本仓隔离得最干净的一项——`web/lib/payments/types.ts` 定义了 `PaymentProvider` 接口，`index.ts:33` 用工厂 + 进程内单例装配，Stripe 只是其中一个 provider。

#### 4.2.4 为什么否决 Stripe 23.0.0

- **6 天龄**（2026-10-01 发布，本 ADR 撰写时 `23.x` 只有 1 个版本）。22.x 有 17 个版本、6 个月的实际使用。
- v23 绑定的是**新的 Stripe API 大版本（endive，`2026-09-30.endive`）**。API 版本跨度上三者是：`2025-06-30.basil`（v18，现用）→ **`2026-08-26.dahlia`（v22.6.2）** → `2026-09-30.endive`（v23.0.0）。也就是说 18→22.6.2 与 18→23.0.0 在 API 版本跨度上只差最后一个月度版本，但 22 有半年的补丁沉淀，23 没有。（**勘误**：本条曾误写为「v21/v22 同为 `2026-03-25.dahlia`」，那是 22.0.0 的初始值而非 22.6.2 的实际值，见 §10.5。）
- 支付路径不需要抢这 6 天。等 23.x 攒到 23.2+ 且 dahlia→endive 的差异有沙箱验证记录后再评。

**触发条件**：`23.x` 累计 ≥ 3 个补丁版本，且已在 Stripe 测试模式跑通 checkout → webhook → portal 全链路。

### 4.3 Prisma 6.15.0 → 7.10.0

这一项与其它两项不在一个量级。

#### 4.3.1 使用面：135 文件 / 159 处引用 / 124 条 import

```
$ git grep -l "@prisma/client" | wc -l      → 135 个文件
$ git grep -n "@prisma/client" | wc -l      → 159 处
$ git grep -h 'from "@prisma/client"' | wc -l → 124 条 import 语句
```

分布：`web/app/**` 84 个文件、`web/lib/**` 21 个、`web/components/**` 12 个，其余在测试、`server/collab/`、`web/prisma/seed.ts`。

import 形态拆解（决定 v7 改动的机械程度与风险）：

```
75 × import { Prisma } from "@prisma/client";          ← 值导入
25 × import type { Prisma } from "@prisma/client";
 5 × import type { Database, DatabaseField, ... }
 4 × import { PrismaClient } from "@prisma/client";
 3 × import type { FileAsset } from "@prisma/client";
 2 × import { PrismaClient, Prisma } from "@prisma/client";
 ... 其余为模型类型导入
```

**77 个文件是 `Prisma` 的值导入**（另有 28 个 `import type`）。Prisma 7 的 `prisma-client` 生成器把产物拆成 `client` / `browser` / `models` / `enums` 多个入口，模型类型不再从 `client` 出。这 124 条 import **既要换路径，又要按类型种类分流**——是本仓有史以来最大的一次机械 diff。

#### 4.3.2 会撞上的破坏性变更（逐条落到文件）

| # | 破坏性变更 | 本仓证据 | 影响 |
|---|---|---|---|
| 1 | **driver adapter 强制**（`new PrismaClient({ adapter })`，空构造抛错） | `web/lib/prisma.ts:43`、`web/prisma/seed.ts:6`、`server/collab/persistence.ts:62`、`server/collab/y-websocket-server.ts:335` | 4 处装配点改写；新增依赖 `@prisma/adapter-pg` + `pg`（`^8.16.3`） |
| 2 | **`datasourceUrl` 构造参数移除** | `web/tests/integration/rls-engine.test.ts:35-36`（`new PrismaClient({ datasourceUrl: OWNER_URL! })` 两处） | RLS 引擎集成测试必须重写连接注入方式——这是**唯一守护 RLS 的集成测试** |
| 3 | **generator 要求显式 `output`，产物不再进 `node_modules`** | `web/prisma/schema.prisma:51-53` 只有 `provider = "prisma-client-js"`，无 `output` | 124 条 import 全量改路径；产物目录要进 `.gitignore` 与 Docker 复制清单 |
| 4 | **client 转为 ESM** | `web/package.json` 无 `"type": "module"`（CJS） | Next 与 `tsx` 可消化，但 `desktop/src-tauri` 的 standalone 打包链路需单独验证 |
| 5 | **`prisma.config.ts` 成为 CLI 配置主入口**；`datasource.url` 从 schema 迁走 | `web/prisma/schema.prisma:55-58`（`url = env("DATABASE_URL")`）；仓库内**无 `prisma.config.ts`** | 新增文件；`schema.prisma` 改结构 |
| 6 | **CLI 不再自动加载 `.env`** | `web/.env`、`web/.env.local` 存在；本地 `prisma migrate dev` / `db:seed` 依赖它 | 需 dotenv 显式加载；容器入口靠环境变量传值（`web/docker/entrypoint.sh:24-26` 用 `DATABASE_URL=... prisma migrate deploy`）不受影响 |
| 7 | **`Prisma.validator()` 废弃/移除，改用 `satisfies`** | `web/app/api/v1/workspaces/[wid]/tasks/route.ts:70,91` | 1 个文件 2 处改写 |
| 8 | **`$use()` 中间件移除** | 全仓零使用（已 grep 确认） | 不撞 |
| 9 | **client 引擎全部移除**（LibraryEngine / BinaryEngine / DataProxy / ReactNative） | `web/Dockerfile:47-56` 手工 `cp` `@prisma/engines` 与 `.prisma/client` 到 standalone；`pnpm-workspace.yaml:8` 允许 `@prisma/client` / `@prisma/engines` 构建脚本 | 镜像构建的两条复制逻辑失效或复制了不再存在的东西，需重写 |
| 10 | `prisma.config.ts` 缺失时 introspection 不可用 | 影响 drift 检查（`ci.yml:153` 的 `corps_drift` 库） | CI 需配套改 |

**额外：部署链路上的硬编码版本。**

```
web/Dockerfile:76    RUN npm install -g prisma@6.15.0
```

容器启动时用这个全局 CLI 跑 `prisma migrate deploy`。**不改这一行，就会出现 v7 的 client + v6 的 CLI 混跑。**

**额外：CI 里的硬编码产物路径。**

```
.github/workflows/ci.yml            35,79,264,352,449,546 → npx prisma generate
.github/workflows/ci.yml            153,266,353,451       → npx prisma migrate deploy
.github/workflows/mobile-build.yml  81-95, 164-178        → 硬编码 cp .prisma/client 的 hack
.github/workflows/tauri-build.yml   81-84                 → 同上
```

`mobile-build.yml` / `tauri-build.yml` 里那段按 `.prisma/client` 路径拷贝的逻辑，是**照着 v6 产物布局写的**，v7 换布局后必然失效。

#### 4.3.3 连接池语义变化 —— 对生产可用性的影响（专项）

这是本次调研里最值得单列的一条。Prisma 官方给出的 v6 URL 参数 → v7 pg 配置对照表：

| 行为 | v6 URL 参数 | v6 默认 | v7 pg 配置字段 | v7 默认 |
|---|---|---|---|---|
| 池大小 | `connection_limit` | `num_cpus*2+1` | `max` | **10** |
| 取连接超时 | `pool_timeout` | **10s** | `connectionTimeoutMillis` | **0（无超时）** |
| 建连超时 | `connect_timeout` | **5s** | `connectionTimeoutMillis` | **0（无超时）** |
| 空闲超时 | `max_idle_connection_lifetime` | 300s | `idleTimeoutMillis` | 10s |

（来源：Prisma 官方文档 Connection pool 页）

**本仓的实际情况让这条变更从"参数变了"升级成"故障模式变了"：**

1. **今天没有任何 pool 参数被显式设置。** `docker-compose.yml:111` 的 `DATABASE_URL` 只有 `schema=public`；`web/lib/prisma.ts:8-12` 那几行只是**注释里的建议**（建议 `connection_limit=10&pool_timeout=30`），从未落实。所以当前完全跑在 Rust 引擎默认值上（池 = `num_cpus*2+1`，取连接超时 10s）。

2. **`withDbRetry` 的唯一触发条件之一会被静默废掉。** `web/lib/prisma.ts:73-77` 明确把 `P1008`（从池取连接超时）列为可重试错误并做了指数退避 + 抖动：

```ts
const isConnectionError =
  error instanceof Prisma.PrismaClientKnownRequestError &&
  (error.code === "P1001" || error.code === "P1002" || error.code === "P1008");
```

   换成 pg adapter 后取连接默认**不再超时**（`connectionTimeoutMillis: 0`），也就**不再产生 P1008**。结果是：池耗尽时不再快速失败并被重试，而是**无限排队**。表现不是报错率上升，而是延迟无声拉长直到上游超时——**没有错误码、没有告警、日志全绿**。这正是"上线后才炸"的典型形态。

3. **`withGuc` 的并发上限会静默下降。** `web/lib/auth.ts:247-253` 是 `runWithWorkspace` / `runWithAuthOp` / `runWithSeatCheck` / `runWithShareToken` 的共同底层——**每一个带租户上下文的数据库操作都走它**：

```ts
return withDbRetry(() =>
  prisma.$transaction(
    async (tx) => { await setGucs(tx, gucs); return fn(tx); },
    { maxWait: 10_000, timeout: 20_000 },
  ),
);
```

   交互式事务在 pg adapter 下要从池里独占一条连接。池上限从 `num_cpus*2+1` 变成 **10**，`maxWait: 10_000` 这条保护能否在 adapter 路径下继续生效**无法静态确认**（Prisma 文档里 `$transaction` 的 `maxWait`/`timeout` 在 v7 仍列出，但底层取连接者已换成 pg Pool）。

**结论：升级 Prisma 7 必须把连接池配置当成一等公民显式写死，而不是依赖默认值。** 官方给出的对齐 v6 行为的写法：

```ts
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5_000,   // 对齐 v6 connect_timeout=5s
  idleTimeoutMillis: 300_000,       // 对齐 v6 max_idle_connection_lifetime=300s
  max: <按实例数与 DB max_connections 反推>,   // 不要留默认的 10
});
```

并同步做两件事：① 把 `web/lib/prisma.ts:8-12` 那段只在注释里的连接池建议改成真正的代码常量；② 给 `withDbRetry` 加一层**请求级超时兜底**（`AbortSignal.timeout`），让它不完全依赖 P1008 是否产生。

#### 4.3.4 改动面与回滚

- 改动面：**135 个源码文件（124 条 import）+ `schema.prisma` + 新增 `prisma.config.ts` + `web/lib/prisma.ts` + `web/lib/auth.ts` + 2 个测试文件 + `web/Dockerfile` + 4 个 CI workflow + 2 个 `package.json`**。52 个迁移目录与 99 个 model/enum（schema 2680 行）本身**不需要改**（Prisma 7 不动数据模型与迁移格式）。
- 回滚成本：**高**。虽然 DB 侧无需回滚迁移（schema 不变），但 135 文件 diff 与部署链路改动要让 CI 全绿才能回退，且回退窗口内产物路径与镜像布局处于中间态。
- 可独立发布/回滚：**理论上可以**（纯依赖升级，无 schema 变更），但**本轮实际不可独立**——见 §5.3 与 §7.3。

---

## 五、顺序裁决

### 5.1 结论

**维持 TS → Stripe → Prisma。**

### 5.2 维持的理由（三条，按权重）

1. **独立回滚性排序正确且差距悬殊。** TS 一个 version pin + 一个 tsconfig，构建期即失败、零运行时影响；Stripe 一个业务文件、被 `PaymentProvider` 接口隔离；Prisma 135 文件 + 容器镜像 + 4 个 CI workflow。把 Prisma 放最后是唯一合理排法。

2. **依赖方向决定了 TS 必须先落地。** Prisma 7 会换生成产物路径与类型入口，Stripe 22 会重做 TS 类型——两者都会改变类型形状。先做 TS 6，是为了在一个**已实测零错误**的基线上接收后续报错：升级后冒出来的每一条错误都可归因到具体那一项，而不是和历史欠账混在一起。反过来做会让归因成本翻倍。

3. **TS 6.0.3 同时是 Next 16.3.8 与 typescript-eslint 认定的配套版本**（§4.1.4 证据 A/B）。先升它，等于把整个工具链对齐到上游支持的那一档，后两项的验证环境才是"被支持的"。

### 5.3 相对初始顺序的三处修正

| # | 初始 | 本 ADR | 理由 |
|---|---|---|---|
| 1 | TS → 6 | **→ 6.0.3，明确否决 7.0.2** | 7.0.2 是原生二进制发行版，无 JS Compiler API；Next 16.3.8 require `typescript/lib/typescript.js` 且装 `typescript@^6.0.0`；typescript-eslint 最新版 peer 仍是 `<6.1.0` |
| 2 | Stripe → 22 | **→ 22.6.2，明确否决 23.0.0；且必须显式钉 `apiVersion`** | 23.0.0 仅 6 天龄、23.x 只 1 个版本、绑定新 API 大版本 endive；22.x 17 个版本、6 个月沉淀。不钉 `apiVersion` 会让 SDK 升级顺带换掉生产 API 版本 |
| 3 | Prisma → 7（本轮实施） | **本轮不启动，挂 §7.3 前置条件** | 见下 |

**为什么 Prisma 阶段三本轮不启动（不是"不该升"，而是"现在不该动"）：**

- **Prisma 6.x 已停更 6 个月**（末版 6.19.3，2026-04-01），安全补丁不再回流——这是**要升**的理由，不是不升的理由。
- 但三件事同时卡着：
  1. **与在途工作撞车。** `web/lib/auth.ts` 是另一个并行会话的活跃区，而它恰恰是 Prisma 7 敏感度**最高**的文件（`withGuc` 里的事务 + `$executeRawUnsafe` GUC 注入）。135 个待改文件里只有它撞车，但撞的是最要命的那个。
  2. **部署链路归别人。** `web/Dockerfile:76` 的全局 CLI pin、`mobile-build.yml` / `tauri-build.yml` 的 `.prisma/client` 拷贝 hack 都在需要同步改动的范围里，其中 `.github/workflows/**` 是明确禁改区。Prisma 7 不可能只改 `web/` 就完成。
  3. **Prisma 8 已在 RC 且 API 形态完全不同。** `prisma` 的 `latest` tag 现在是 `8.0.0-rc.20`；v8 文档里的运行时是 `db.transaction(...)` / `tx.orm` / `tx.sql`，且明确"没有 isolationLevel / timeout / maxWait 选项"。现在做 6→7，很可能几个月内要再做一次 7→8。
- 与此同时，连接池那条（§4.3.3）是**可以在不升级的前提下先修掉的**：把 `web/lib/prisma.ts:8-12` 注释里的连接池建议落成显式配置，并给 `withDbRetry` 加请求级超时兜底。这两件事对 v6 同样有益，且能提前消掉升级后最危险的那个坑。

**Prisma 7 的触发条件**（全部满足才启动）：

1. `web/lib/auth.ts` 的在途改动已合入并回归通过；
2. `.github/workflows/**` 与 `web/Dockerfile` 可被同步修改（并行会话让出）；
3. §7.3 前置步骤（连接池显式化 + 超时兜底）已合入并在 v6 上跑过一轮；
4. Prisma 8 的 GA 时间与 7→8 迁移成本已明确（避免 6→7→8 连做两次）；
5. 有一个可压测的预发环境用于验证池耗尽时的失败模式。

---

## 六、分阶段实施步骤与验收

> 每一步都是**一次独立 commit**，可单独 revert。任何一步的验收不通过，不进入下一步。

### 阶段一：TypeScript 5.9.3 → 6.0.3

| 步骤 | 动作 |
|---|---|
| 1.1 | `web/package.json:100` 改 `typescript` 为 `6.0.3`；同步 `desktop/src-tauri/resources/standalone/package.json:99` |
| 1.2 | `pnpm install`（**仅** lock 更新，不触碰其它包） |
| 1.3 | 跑 `tsc --noEmit`，记录新增错误 |
| 1.4 | 若 `@types/*` 全局声明消失 → 在 `web/tsconfig.json` 补显式 `types` 数组（预期至少 `["node"]`，按需补齐） |
| 1.5 | 收敛剩余错误 |

**验收**：
- `cd web && ./node_modules/.bin/tsc --noEmit --incremental false` → **退出码 0**（基线同为 0，不允许新增）
- `pnpm lint` 输出与升级前一致（无新增 error）
- `pnpm build` 成功，且 `typescript-eslint` 未打印 "unsupported TypeScript version" 警告
- `npm ls typescript` 显示 6.0.3，无 peer 警告

**回滚**：revert 1.1 的 version pin + 1.4 的 tsconfig 改动，`pnpm install`。无运行时影响。

### 阶段二：Stripe 18.3.0 → 22.6.2

| 步骤 | 动作 |
|---|---|
| 2.1 | `web/package.json:68` 改 `stripe` 为 `22.6.2`；同步 `desktop/.../standalone/package.json:68` |
| 2.2 | **先**在 `web/lib/payments/stripe-provider.ts:50-52` 的构造函数加 `apiVersion: "2025-06-30.basil"`（与当前 SDK 默认一致，锁定不动） |
| 2.3 | `pnpm install` |
| 2.4 | 跑 `tsc --noEmit`，逐条复核 `:270-271` / `:282-284` / `:298-303` / `:318-322` 四处 cast 是否仍必要、是否与新类型冲突 |
| 2.5 | 跑 `web/e2e/billing.spec.ts` 与 payments 相关单测 |

**验收**：
- `tsc --noEmit` 退出码 0
- `web/lib/payments/*` 全量单测通过
- **Stripe 测试模式真实链路跑通一次**：checkout session 创建 → 回调 webhook 验签（`constructEvent`）→ billing portal 会话创建。其中 webhook 一步必须真发一次事件，不能只靠 mock——v21 的"用错解析方法抛错"只有真实调用才暴露
- `stripe-provider.ts` 里 `apiVersion` 显式可见，不等于 SDK 默认

**回滚**：revert 2.1 + 2.2，`pnpm install`。无数据面影响；计费走 `PaymentProvider` 接口，provider 可整体替换。

### 阶段三：Prisma 6.15.0 → 7.10.0（**本轮不启动**，前置条件见 §5.3）

前置步骤（**在 v6 上先做，与本 ADR 的升级解耦**）：

| 步骤 | 动作 |
|---|---|
| P0 | `web/lib/prisma.ts` 把连接池配置从注释落成显式代码常量；给 `withDbRetry` 加请求级超时兜底 |
| P1 | 等 `web/lib/auth.ts` 在途改动合入 |
| P2 | 等 `.github/workflows/**`、`web/Dockerfile` 可同步修改 |

实施步骤（条件满足后）：

| 步骤 | 动作 |
|---|---|
| 3.1 | `schema.prisma:51-53` generator 改 `provider = "prisma-client"` + `output`；新增 `web/prisma.config.ts`（含 dotenv 加载、`datasource.url`、`migrations.seed`） |
| 3.2 | 加 `@prisma/adapter-pg` + `pg`；改写 4 处 client 装配点（`web/lib/prisma.ts:43`、`web/prisma/seed.ts:6`、`server/collab/persistence.ts:62`、`server/collab/y-websocket-server.ts:335`），**按 §4.3.3 显式配池** |
| 3.3 | 批量改写 124 条 import（按 `client` / `models` / `enums` 入口分流），`Prisma` 值导入改 `import type` |
| 3.4 | `web/app/api/v1/workspaces/[wid]/tasks/route.ts:70,91` 的 `Prisma.validator` 改 `satisfies` |
| 3.5 | `web/tests/integration/rls-engine.test.ts:35-36` 去掉 `datasourceUrl`，改为 adapter 注入 |
| 3.6 | `web/Dockerfile`：`:76` 全局 CLI 改 7.x；`:47-56` 的产物复制逻辑按新 output 路径重写 |
| 3.7 | 4 个 CI workflow：`prisma generate` 前后顺序、`mobile-build.yml` / `tauri-build.yml` 的 `.prisma/client` 拷贝 hack 重写 |

**验收**：
- `tsc --noEmit` 退出码 0
- 全量单测 + 集成测试通过，**特别是 `rls-engine.test.ts`**（RLS 是 ADR-006 的引擎级租户隔离，不容退化）
- `db/rls-smoke.sh` 与 `scripts/rls-smoke.sh` 通过
- `prisma migrate deploy` 在容器入口成功；`prisma migrate dev` 在本地（含 dotenv 加载）成功
- **池耗尽故障注入**：把 `max` 临时压到 2，并发打 `withGuc` 路径，确认请求**在可预期的时间内失败并可被观测**，而不是无限挂起
- 镜像实构建一次并在预发启动，确认 standalone 产物里的 client 与引擎布局正确

**回滚**：revert 全部版本与配置改动 + `pnpm install` + 重新 `prisma generate`。**DB 无需回滚**（schema 与迁移格式不变）。回滚窗口内需确保镜像与产物路径同步回到 v6 布局。

---

## 七、冲击面清单（实施时逐项对照）

| 类别 | 位置 | 涉及阶段 |
|---|---|---|
| version pin | `web/package.json:33/68/98/100` | 一、二、三 |
| version pin（易漏） | `desktop/src-tauri/resources/standalone/package.json:33/68/97/99` | 一、二、三 |
| tsconfig | `web/tsconfig.json`（缺 `types`） | 一 |
| 业务代码 | `web/lib/payments/stripe-provider.ts`（1 文件 / 6 调用 / 4 cast） | 二 |
| 业务代码 | 135 个 `@prisma/client` 引用文件（124 条 import） | 三 |
| 核心敏感点 | `web/lib/auth.ts:247-253`（`withGuc` 事务 + GUC 注入） | 三 |
| 核心敏感点 | `web/lib/prisma.ts:43`（装配）、`:73-77`（P1008 重试） | 三（P0 前置即可动） |
| 测试 | `web/tests/integration/rls-engine.test.ts:35-36`（`datasourceUrl`） | 三 |
| 代码 | `web/app/api/v1/workspaces/[wid]/tasks/route.ts:70,91`（`Prisma.validator`） | 三 |
| schema | `web/prisma/schema.prisma:51-58`；新增 `web/prisma.config.ts` | 三 |
| 镜像 | `web/Dockerfile:47-56`（产物复制）、`:76`（`npm install -g prisma@6.15.0`） | 三 |
| CI | `.github/workflows/ci.yml`（6× generate / 4× migrate deploy） | 三 |
| CI | `.github/workflows/mobile-build.yml:81-95,164-178`；`tauri-build.yml:81-84`（`.prisma/client` 拷贝 hack） | 三 |
| 文档 | `spec/SPEC.md:77`（`@prisma/client@6`）、`web/README.md:25`（`stripe@18.3.0`）、`server/collab/ARCHIVE-NOTE.md:35`（`@prisma/client 6.15.0`） | 二、三 |

---

## 八、无法在本地验证的部分

以下各条**只能靠真跑起来或真升级后验证**，本 ADR 不做保证：

1. **TS 6 的 `types: []` 新默认是否真的生效。** 该结论来自二手来源，需装完 6.0.3 跑一次 `tsc --noEmit` 才能确认；若生效，`@types/node` 全局声明消失的影响面（904 文件）也只有跑完才知道。
2. **TS 6 是否还有其它默认翻转在本仓产生新错误**（`rootDir`、`noUncheckedSideEffectImports`、`target` 上浮等）。静态读 tsconfig 无法穷举。
3. **Stripe 22 类型大改后，4 处交叉类型 cast 是否仍编译通过。** 尤其 `current_period_end` 与 `Invoice.subscription`——若新版把它们恢复为正式字段，交叉类型可能与新声明冲突（`never` 化）。只有装完才知道。
4. **Stripe v21 的"用错 webhook 解析方法抛错"是否波及本仓。** `stripe-provider.ts:209` 用的是同步 `constructEvent`，Node 运行时理论上安全，但只有真实 webhook 流量能验证。mock 不会暴露。
5. **Stripe API 版本 basil → dahlia 后生产真实响应字段的变化。** 沙箱数据不全，且本仓读的字段（`amount_paid`、`quantity`、`cancellation_details`）是否受影响需对照 API changelog 逐字段核对。
6. **Prisma 7 + pg adapter 下 P1008 是否还会产生、`$transaction` 的 `maxWait` 是否仍生效。** 官方文档两边都有表述但没说清 adapter 路径下的行为，只能靠故障注入压测。
7. **Prisma 7 的 ESM client 在 Next 16 standalone + alpine + pnpm 虚拟存储下能否被正确追踪与复制。** 现有 `Dockerfile:47-56` 是照 v6 布局写的，新布局必须真构建一次镜像才知道对不对。
8. **`$executeRawUnsafe("SELECT set_config('app.x', $1, true)")` 在 pg adapter 事务内是否语义等价。** RLS 是本仓的引擎级租户隔离（ADR-006），只有 `rls-engine` 集成测试 + `db/rls-smoke.sh` 能给出结论。
9. **desktop / Tauri 打包链路在 Prisma 7 ESM client 下的行为。** standalone 镜像是 CJS 语境，未验证。
10. **`mobile-build.yml` / `tauri-build.yml` 里 `.prisma/client` 硬编码拷贝在新产物布局下的失败模式。** 属于禁改区，无法本地复现。
11. **所有版本号经 `npmmirror.com` 镜像取得**，理论上存在滞后。已用发布日期自洽性交叉校验（stripe 23.0.0 = 2026-10-01、TS 7.0.2 = 2026-07-08），但实施前建议对 `registry.npmjs.org` 复核一次 dist-tags。

---

## 九、影响

- 本 ADR 生效前，**不改任何依赖**。
- §6 的 P0 前置步骤（连接池显式化 + 请求级超时兜底）**可以在不升级的前提下先做**，且对 v6 同样有益，建议独立于本 ADR 排期。
- issue #32 的 body 应由本 ADR 的 §2 决策摘要回填，让那 5 字节变成有据可查的决策。

---

## 十、修订记录（2026-10-09）

本节记录本 ADR 落稿后两项实测（Stripe 专项探针、Prisma 官方升级指南抓取）对前文的校验结果。**被勘误的原文一律保留不动**，只在此标注取代关系，保持决策演进可追溯。

### 10.1 TypeScript 阶段一：已 declare 但未 install，且漏了第二声明点（新阻塞）

Dependabot PR #14（`75b80332`）已把 `web/package.json:100` 抬到 `typescript: 6.0.3`。但该 PR **只改了两个文件**（`web/package.json` + `web/pnpm-lock.yaml`），导致阶段一处于半成品状态：

| 检查项 | 实测（2026-10-09） | 结论 |
|---|---|---|
| `web/package.json:100` 声明值 | `6.0.3` | 已改 |
| `web/pnpm-lock.yaml` | 含 `6.0.3`（55 处） | 已改 |
| `web/node_modules/typescript` 实际版本 | **5.9.3** | **未安装，三者分歧** |
| `web/tsconfig.json` 的 `types` 字段 | **仍不存在** | **§4.1.1 预判的核心风险尚未处理** |
| `desktop/.../standalone/package.json:99` | **仍是 `5.9.3`** | **第二声明点漏改** |

两点后果：

1. **本仓至今没有用 TS 6 编译过一次。** §3.3 那条「0 错误」基线是 TS 5.9.3 跑出来的，对 TS 6 **不作担保**。§8 第 1 条（`types: []` 是否真的生效）仍是未验证项，且已从「未来担心」变成「当前阻塞」。
2. **桌面端会长期停在 TS 5.9.3。** 该 package.json 不在 pnpm workspace 的依赖解析路径上，但会被 Tauri standalone 打包读取——声明与实际不一致，且不会有任何工具报错。

这与 §3.1 预先指出的「第二处声明点（易漏）」完全吻合，不是新问题而是被证实的风险。见 §10.4 的落地要求。

### 10.2 Stripe 章节校验（数据来自 stripe-probe 专项实测，2026-10-09）

**取代 §4.2.2 的表述**：`apiVersion` 护栏**已经落地**，不再是待办。

```
web/lib/payments/stripe-provider.ts:66    apiVersion: "2025-06-30.basil",
web/tests/unit/stripe-api-version.test.ts  配套护栏单测
```

§4.2.2 里「`:50-52` 构造时没指定 `apiVersion`」的描述已过期，§6 阶段二的 2.2 步骤应视为**已完成**。

**划掉 §8 第 4 条风险**（v21 webhook 解析抛错）。实测依据：`stripe@23.0.0` 的 `cjs/Webhooks.js:9-11` 只在 `jsonPayload.object === 'v2.core.event'`（V2 thin event）时抛错。本仓接的是 **V1** 事件（`stripe-provider.ts` 的 `checkout.session.completed` / `customer.subscription.*` / `invoice.*`），**不触发**。

**划掉 §4.2 表格里「① 大概率不撞」的含糊措辞**（v21 `Stripe.Decimal`）。实测：PR #38 的 CI（run 37870493355）全项目 `tsc` 在 v23 下**只报 1 条错**，且就是那条 `apiVersion` 字面量不匹配：

```
lib/payments/stripe-provider.ts(66,9): error TS2322:
  Type '"2025-06-30.basil"' is not assignable to type '"2026-09-30.endive"'
```

其余 5 处 SDK 调用 + 4 处 cast 在 v23 类型下**均编译通过**；另有隔离复刻验证（`stripe@23.0.0` + `typescript@6.0.3`）得到 0 error。**§4.2.1 那 4 处 cast 的风险因此下调**——类型形状不是 Stripe 升级的障碍。

**§4.2.4 否决 23.0.0 的触发条件复测：仍未满足。** 23.x 稳定版**仍只有 1 个**（`23.0.0`，另有 3 个 alpha/beta），ADR 要求 ≥3 个补丁版本 → 维持否决结论，目标仍是 `22.6.2`。

**新增两个此前遗漏的事实，须写入阶段二的前置条件：**

1. **`apiVersion` 不控制 webhook 事件体形状。** Stripe 官方 API versioning 文档原文：*"Webhook events also use your account's default API version unless you set an API version during endpoint creation."* 也就是说 webhook 侧的事件结构由**账户默认版本或 endpoint 级设置**决定，与 SDK 的 `apiVersion` 无关。§4.2.2 的风险论述应收缩为：**风险面只在出向调用**（`checkout.sessions.create` / `billingPortal.sessions.create` / `subscriptions.retrieve|update`），`normalizeEvent` 的归一化逻辑不会因升 SDK 而改变。这是一条降低风险的修正。

2. **clover 起默认切换到 flexible billing mode —— 这才是「要不要跟 API 版本」的真实业务成本。** 官方 `docs.stripe.com/changelog/clover`（2025-09-30 条目）原文：*"Flexible billing mode is the new default: When you create Subscriptions with this GA version, the subscriptions default to flexible billing mode, which changes how those Subscriptions behave at different points in their lifecycle."*

   本仓 `stripe-provider.ts:129`（即 `checkout.sessions.create({ mode: "subscription" })`）正落在这个面上。**只要 `apiVersion` 抬到 clover 及以后（22.6.2 的 `2026-08-26.dahlia`、23.0.0 的 `2026-09-30.endive` 都算），新建订阅的生命周期行为就会改变。** 而 22.6.2 **默认就是** dahlia（省略 `apiVersion` 实测发出 `2026-08-26.dahlia`，见 §10.5）——比 basil 跨了 clover + dahlia 两个 API 大版本。因此 §6 阶段二必须新增一条前置：**先在 Stripe 测试模式验证 flexible billing mode 下新建订阅的续费/变更/取消行为**，再决定是否把 `apiVersion` 从 basil 抬走。不验证就抬版本 = 拿计费语义赌运气。

### 10.3 Prisma 章节补充（依据 Prisma 官方《升級至 Prisma ORM 7》原文）

本节取代/补充 §4.3.2 的若干条。

**① `prisma-client-js` 在 v7 仍可用，只是被宣告将来移除。** 官方原文：「舊版的 `prisma-client-js` 提供者將在未來的 Prisma ORM 版本中移除。請升級至使用新版 Rust-free 客戶端的 `prisma-client` 提供者。」

→ 这给了阶段三一个**降风险的过渡选项**：可以先用 `prisma-client-js` 把 6→7 的 adapter / config / ESM 部分跑通，把 generator 切换留到第二步。§4.3.2 第 3 条不必与第 1、5、6 条同批落地，可拆成 3.a（切换 generator + 全量改 import，135 文件）与 3.b 两步。**建议拆**，让最大那份 diff 独立可回滚。

**② Prisma 官方的 TypeScript 支持矩阵与阶段一存在张力（新增，需 team-lead 拍板）。** 官方标明的版本要求：

| | 最低支援 | 建議 |
|---|---|---|
| Node | 20.19.0 | 22.x |
| TypeScript | 5.4.0 | **5.9.x** |

本仓阶段一刚把 TS 抬到 `6.0.3`（已声明），而 Prisma 7 官方建议的是 **5.9.x**。这不代表 TS 6 跑不了 Prisma 7，但意味着**阶段三将落在一个 Prisma 官方未标注支持的类型版本上**。两个选项：跟 TS 6 走并自行背书，或阶段三之前先确认 Prisma 7.10 对 TS 6 的实际兼容。**这是把 TS 放在第一阶段的一个代价，此前没写明，现在补上。**

**③ ESM 要求比原先记载的更重。** 官方明确要求：

```json
// package.json
{ "type": "module" }
```
```json
// tsconfig.json
{ "module": "ESNext", "moduleResolution": "node", "target": "ES2023" }
```

`web/package.json` 当前**没有** `"type"` 字段（CJS），且本仓 tsconfig 用的是 `moduleResolution: "bundler"`、`target: "ES2022"`。给一个 Next 16 应用的根 package.json 加 `"type": "module"`，会波及所有 `.js` 配置文件与脚本的解释方式，**不是一行改动**。§4.3.2 第 4 条的影响面据此上调；并需评估 generator 的 `moduleFormat = "cjs"` 逃生开关能否让本仓免于改 `"type"`。

**④ 一批 `PRISMA_*` 环境变量在 v7 被移除 —— 实测本仓全部未使用（可划掉一条风险）。** 官方清单：`PRISMA_CLI_QUERY_ENGINE_TYPE`、`PRISMA_CLIENT_ENGINE_TYPE`、`PRISMA_QUERY_ENGINE_BINARY`、`PRISMA_QUERY_ENGINE_LIBRARY`、`PRISMA_GENERATE_SKIP_AUTOINSTALL`、`PRISMA_SKIP_POSTINSTALL_GENERATE`、`PRISMA_GENERATE_IN_POSTINSTALL`、`PRISMA_GENERATE_DATAPROXY`、`PRISMA_GENERATE_NO_ENGINE`、`PRISMA_CLIENT_NO_RETRY`、`PRISMA_MIGRATE_SKIP_GENERATE`、`PRISMA_MIGRATE_SKIP_SEED`。

实测（2026-10-09）本仓用到的 `PRISMA_*` 只有 4 个，**无一在移除清单内**：

```
PRISMA_CLIENT_DIR      ← mobile-build.yml / tauri-build.yml 的拷贝 hack 用
PRISMA_DATABASE_URL    ← entrypoint 注释说明它 "不识别的前缀"，实际未被使用
PRISMA_ENGINES_MIRROR  ← Dockerfile:31-32
PRISMA_GEN_DIR         ← mobile-build.yml / tauri-build.yml 的拷贝 hack 用
```

注：`PRISMA_ENGINES_MIRROR` 不在移除清单，但 v7 去掉了 client query engine，需确认它对 schema engine 的下载是否仍有效（并入 §8 待验证项）。

### 10.4 由本节新增的落地要求（合并进 §6/§7）

| # | 要求 | 归属 |
|---|---|---|
| R1 | **先补一次 `pnpm install` 并跑 `tsc --noEmit`**，确认 TS 6.0.3 下的真实错误清单；按 §4.1.1 补 `types` 字段 | 阶段一（当前阻塞） |
| R2 | 同步 `desktop/.../standalone/package.json:99` 至 `6.0.3` | 阶段一 |
| R3 | **把「两处声明点同步」写成每次升级的显式检查项**（`.github/workflows/**` 属他人区域，需协调） | 全部阶段 |
| R4 | Dependabot 只监控 `/web`（`.github/dependabot.yml`），**永远不会提 desktop 那份包**——人工同步是唯一保障，建议补一个 CI 断言：两个 package.json 里这四个包的版本号必须一致 | 全部阶段（新增 CI 门禁建议） |
| R5 | 阶段三允许拆分：3.a（generator 切换 + 124 条 import 改写）与 3.b 分开落地 | 阶段三 |
| R6 | 阶段三前确认 Prisma 7.10 与 TS 6.0.3 的实际兼容性（官方建议是 5.9.x） | 阶段三 |
| R7 | 阶段二前置：**在 Stripe 测试模式验证 flexible billing mode** 下新建订阅的行为，再决定 `apiVersion` 是否抬离 `2025-06-30.basil` | 阶段二（新增） |
| R8 | 阶段二风险面收缩为出向调用；webhook 归一化逻辑不受 SDK `apiVersion` 影响 | 阶段二（风险下调） |
| R9 | 若阶段二选择「跟随 SDK 而非钉住 basil」，`stripe-provider.ts:66` 的字面量必须写 **`"2026-08-26.dahlia"`**（22.6.2 的实际值）；写 `2026-03-25.dahlia` 会直接 TS2322 失败 | 阶段二（新增，见 §10.5） |
| R10 | 若用 `as Stripe.LatestApiVersion` 断言绕过单字面量约束，**必须同时补一条非断言型运行时护栏**（如断言 `getApiField('version') === '2025-06-30.basil'`），否则等于把护栏从类型层降级成人工自觉 | 阶段二（新增，见 §10.5） |

### 10.5 勘误：22.6.2 的 pinned API 版本不是 `2026-03-25.dahlia`

**原文错误**：§4.2 表格与 §4.2.4 曾写「v21/v22 同为 `2026-03-25.dahlia`」。这句话对 **22.0.0** 成立，对作为本 ADR 目标的 **22.6.2 不成立**。已就地更正，此处保留记录以免读过旧稿的人被误导。

**实测依据**（stripe-probe，2026-10-09，隔离目录装真实包）：

```
stripe@22.6.2  cjs/apiVersion.d.ts
  export declare const ApiVersion = "2026-08-26.dahlia";
  export declare const ApiMajorVersion = "dahlia";
```

**为什么会有这个偏差**：Stripe 的版本模型是大版本（`basil` / `clover` / `dahlia` / `endive`）+ 月度向后兼容版本，月度版本沿用大版本名。22.0.0 钉 `2026-03-25.dahlia`，之后 dahlia 又发了 5 个月度版本（04-22 / 05-27 / 06-24 / 07-29 / 08-26），`ApiVersion` 跟着走到 **`2026-08-26.dahlia`**。

**这条错误有多容易被踩**：不是笔误级别，是会直接让实施者编译失败。实测：

```
probe.ts(11,3): error TS2322:
  Type '"2026-03-25.dahlia"' is not assignable to type '"2026-08-26.dahlia"'.
```

**副作用的两条结论**：

1. **「走 22.6.2」和「留在 basil」必须是同时成立的两件事，缺一就退化成静默换 API 版本。** 实测省略 `apiVersion` 时 22.6.2 会发出 `2026-08-26.dahlia` —— 相对 basil 跨过了 **clover + dahlia 两个 API 大版本**，其中就包含 R7 那条 flexible billing mode 的默认切换。这给 §10.2 那句「22.6.2 只在同时钉住 basil 时才安全」补了硬证据。
2. **阶段二的目标字面量取决于走哪条路径**：钉住不动就写 `2025-06-30.basil`（现方案）；跟随 SDK 就必须写 `2026-08-26.dahlia`。前者无额外代价，后者要同时满足 R7 的前置验证。**

### 10.6 TS 6 复测结论：单字面量护栏在 TS 6.0.3 下有效（另一个悬置项的关闭）

我在 §10.4 之外曾担心 TS 6 落地后 `stripe-api-version.test.ts` 的护栏机制失效。**已实测关闭，两条独立证据**：

1. **PR #38 的 CI 日志本身就是 TS 6 下的真实记录**：`pnpm install` 输出含 `+ typescript 6.0.3`，随后的 `tsc --noEmit` 报出

```
lib/payments/stripe-provider.ts(66,9): error TS2322:
  Type '"2025-06-30.basil"' is not assignable to type '"2026-09-30.endive"'
```

   即该护栏**已经在 TS 6.0.3 下真实触发过**，无需等待复测。
2. **隔离复刻**（`typescript@6.0.3` + `stripe@22.6.2`，用本仓 tsconfig 的 flags：`strict` / `esModuleInterop` / `moduleResolution: bundler` / `skipLibCheck`）：写错字面量同样报 TS2322。

**机制分层说明**（这点容易混淆，写清楚）：`stripe-api-version.test.ts` 锁的是**运行时字面量**（值层），「写错版本会 tsc 失败」来自 `StripeConfig.apiVersion` 的**单字面量类型**（类型层）。两者相互独立，TS 6 下都仍然有效。

**由此产生的一条禁令（R10 的来由）**：stripe-probe 验证的「方案 B」写法是 `apiVersion: "2025-06-30.basil" as Stripe.LatestApiVersion`，实测 0 error、运行时确为 basil、webhook 验签通过、现有单测无需改动。但 `as` 断言会把类型层那条护栏**一起消掉**——下次 SDK 升级改了 `LatestApiVersion`，将不再有 TS2322 逼出决策。本次 basil vs dahlia 这个决策正是被 TS2322 逼出来的。

所以：**加 `as` 必须与「补一条非断言型运行时护栏」成对出现**，否则等于把护栏从类型层降级成人工自觉。

### 10.7 22.6.2 其余实测约束

| 项 | 实测 | 结论 |
|---|---|---|
| `engines` | `{"node":">=18"}` | CI Node 22 满足（v23 要求是 `>=20`） |
| 单字面量约束位置 | `cjs/lib.d.ts:11/27` | 与 v23 完全一致，机制同上 |
| `constructEvent` 签名 | `cjs/Webhooks.d.ts:46` | 与 v23 一致，同步版验签实测通过 |
| `WebhookEndpoint.ApiVersion` 枚举 | 仍含 `'2025-06-30.basil'` | **basil 未退役**，钉版可持续 |
| 5 处 SDK 调用 + 4 处 cast | 隔离复刻 0 error | 类型形状不是升级障碍 |
