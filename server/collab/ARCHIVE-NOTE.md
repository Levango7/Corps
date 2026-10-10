# ARCHIVE-NOTE · 实时协同（CRDT）能力现状与复活前置条件

> 状态：**保留但断开**（用户 2026-10-03 拍板走「保留离线编辑 + 版本历史」那一档）
> 决策依据：ADR-013（协同降级）、ADR-019（版本回滚实现契约）
> 维护：本文件是「复活协同」的唯一前置检查项。改动本目录或挂载协同组件前，先读本文件。

---

## 一、当前状态：代码在，但从未工作过

本目录（`server/collab/`，约 21KB）与前端配套组件**已写完但从未运行过**。
它们不是「即将上线的功能」，而是「一份从未工作过的代码」。

### 三道独立的门，缺一不可

| # | 门 | 当前状态 | 证据 |
|---|---|---|---|
| 1 | 服务端可运行 | ❌ **缺 2 个依赖** | `ws` 与 `@types/ws` 不在 `web/package.json`；`y-websocket-server.ts:19-30` 的「运行时依赖」注释自己列出了这个清单 |
| 2 | 前端挂载 Provider | ❌ **全仓零挂载** | `web/app/` 下**零个**文件 import `CollaborationProvider`；`PresenceIndicator` 与 `CollaborationCursor` 的唯一 import 出现在它们自己文件与彼此的注释里 |
| 3 | 编辑器接入 CRDT | ❌ **未接入** | `web/components/RichTextEditor.tsx:464` 仅 `StarterKit.configure()`，全文无 `yjs` / `Collaboration` 引用；`:27` 只 import `StarterKit` |

**三道门都是独立��** —— 即使 1、2 都完成，编辑器不接 CRDT 扩展，文档编辑仍不走 Yjs。
**任何单一改动都不会让这个功能"部分可用"，只会产生"看起来接线了但没用"的中间态。**

### 依赖实测（2026-10-03）

`web/package.json` 实际状态：

| 包 | 状态 |
|---|---|
| `y-websocket` | ✅ `^3.1.0` |
| `yjs` | ✅ `^13.6.33` |
| `lib0` | ✅ `^0.2.118` |
| `jsonwebtoken` | ✅ `9.0.3` |
| `@prisma/client` | ✅ `7.10.0`（2026-10-10 随 PR 批次升 v7；本目录仍未接线，装饰配点同步适配） |
| **`ws`** | ❌ **缺失** |
| **`@types/ws`** | ❌ **缺失** |

> 注：早期讨论中曾表述为「`ws` 包不在 `web/package.json` 里，那 473 行服务端文件在当前依赖树下无法编译」——
> 方向正确，但需精确化：**缺的只有 `ws` 与 `@types/ws`**，其余运行时依赖均已就位。
> 该文件本身已在注释中声明它是独立服务、不在 `web/` 的 tsconfig 范围内（`y-websocket-server.ts:17-18`），
> 所以「无法编译」指的是**缺少运行时的 WS 服务端实现**，不是 tsconfig 配置问题。

---

## 二、保留的部分（不归档，已在用）

用户拍板保留的是**离线编辑**，它**不依赖本目录**：

| 能力 | 实现 | 依赖本目录？ |
|---|---|---|
| 文档编辑 | `RichTextEditor.tsx`（TipTap StarterKit） | ❌ |
| 自动保存 | `DocumentEditor.tsx:463` `onBlur={() => save()}` | ❌ |
| **离线编辑** | `CollaborationProvider` 内的 `y-indexeddb`（IndexedDB 本地持久化） | ❌ **纯浏览器侧** |
| 版本历史 | `DocumentVersionHistory.tsx` + `versions/*` 路由 | ❌ |

**关键点**：`y-indexeddb` 走 IndexedDB，是**纯浏览器侧**能力，**不需要 WebSocket 服务端**。
所以「保留离线编辑」与「断开协同服务」不冲突 —— 这是本决策能成立的技术前提。

**断开 WS 连接后，能力边界（务必如实告知用户，不要含糊）：**

- ✅ 文档能编辑、能离线保存、重连后同步回服务端
- ❌ **没有多人实时光标**
- ❌ **没有远端实时同步**（对方改动不会实时出现）
- ❌ **看不到在线人数**

---

## 三、🔴 复活前置条件（硬约束）

> **本节是本文件存在的唯一理由。任何挂载 `CollaborationProvider` 的改动，必须与本节同时落地，否则视为引入误导性 UI。**

### 3.1 核心风险：静默兜底导致的"永动黄条"

`web/components/CollaborationProvider.tsx:206`：

```js
const DEFAULT_WS_URL = process.env.NEXT_PUBLIC_COLLAB_WS_URL ?? "ws://localhost:1234";
```

未配置 WS 地址时**不是 fail-close，而是静默兜底 localhost**。于是一旦挂载 Provider：

1. WS 连不上 localhost
2. `PresenceIndicator.tsx:162-167` 的 offline 档用 `--warn`（amber）呈现
3. 状态在 offline ↔ connecting 之间**永久抖动**（y-websocket 指数退避重连）
4. **用户看到一个永动的黄色警告条，会去查自己的网络** —— 而实际上是我们的服务端没部署

**这是接线后必然发生的误导，不是假设风险。**

### 3.2 强制要求

挂载 `CollaborationProvider` 的**同一次提交**，必须同时实现 **S5 判定**（见第四节）。
**两者不可拆分提交。**

判定实现方式（**只用这一种，不要用时序阈值**）：

```js
// CollaborationProvider 内新增 boolean state，无持久化
const [fromEverConnected, setFromEverConnected] = useState(false);
// wsProvider 首次成功 connect 时置 true，此后不再回 false
const isCollabUnavailable = !fromEverConnected && 连续失败次数 >= 3;
```

**为什么必须用 boolean 而不是「connecting 持续 8 秒」这类时序阈值** —— 两者代价不对称：

| 方案 | 判错时的后果 |
|---|---|
| 时序阈值（魔数） | 慢网络下 8 秒内连上 → **误判成"未启用"** → **对正常用户说谎** |
| boolean `fromEverConnected` | 中途抖动过的场景**漏判** → 继续显示 S2/S3 → 代价仅是"多看一会儿加载态" |

**漏判只是体验降级，误判是诚实性事故。** 选 boolean。

### 3.3 提交前自检

- [ ] `ws` + `@types/ws` 已加入依赖，服务端可实际启动
- [ ] `RichTextEditor` 已接入 Collaboration 扩展（否则 Provider 挂了也没用）
- [ ] S5 判定已实现，用 `fromEverConnected` boolean，非时序阈值
- [ ] S5 态下 `CollaborationCursor` **完全不渲染**（不渲染占位）
- [ ] S5 态下光标色板**完全不渲染**
- [ ] `NEXT_PUBLIC_COLLAB_WS_URL` 在生产环境**未配置时**不会静默兜底 localhost

---

## 四、S1–S5 状态规范（接线时按此实现）

**位置**：文档编辑器顶部**常驻状态条**（与工具栏之上对齐，零布局抖动），不新增横幅。

| 态 | 判定 | 图标（Lucide，含义描述） | 中文 | English | 色 |
|---|---|---|---|---|---|
| **S1** 在线 | WS connected 且离线缓存已加载 | 对勾 | 已连接 | Connected | `--success` |
| **S2** 正在重连 | 曾 connected，现 connecting | 环形加载（旋转） | 正在重连… | Reconnecting… | `--info` |
| **S3** 已离线 | WS disconnected 或 `navigator.offline` | 断网 | 已离线 · 你的改动已保存在本机 | Offline · your changes are saved on this device | `--warn` |
| **S4** N 条待同步 | `getPendingCount() > 0` | 云端断开 | {count} 条改动待同步 | {count} changes waiting to sync | `--warn` |
| **S5** 服务未启用 | **从未成功 connect + 连续失败 ≥3** | 断开的插头 | 实时协作未启用 · 你可正常单人编辑 | Live collaboration isn't enabled · you can still edit normally | `--muted` |

**S5 的三条硬约束**：

1. **不提供「重试连接」按钮** —— 服务端未部署时重试 100 次结果相同。给一个必然失败的操作按钮是设计失职
2. **停掉重试动画** —— 永动的 spinner 制造"正在努力连接"的错觉，比诚实说"没开"更糟
3. **用中性色（`--muted`）不用 `--warn`** —— 这是"没启用"，不是"你的网络坏了"

**S1 保持 3 秒后消失**（沿用 `PresenceIndicator.tsx:122,184-191` 现状）。
正常状态不该占据视觉预算；改常驻会让用户对正常脱敏，反而在真出问题时不被注意。

**离线同步告知（三层，防用户误判协作丢失）**：

1. **降级瞬间**（一次性 Toast，同一会话只弹一次，`sessionStorage` 打标）
2. **常驻状态条**（S3/S4，**不自动消失** —— 用户持续工作，需要随时确认"我的改动还在"）；展开态显示最后同步时间 + 待同步条数 + 一句「联网后自动上传，不需要你手动操作」
3. **恢复瞬间**（Toast，**必须带条数**）：「已恢复连接，{count} 条改动已同步。」只说"已恢复连接"用户不知道自己的东西到底上没上去

**长离线兜底**：`offlineTooLong`（>7 天，`CollaborationProvider.tsx:48`）保留现有实现，
呈现从内联 chip 升级为常驻状态条 + `role="alert"`。

---

## 五、Token 约束

### 5.1 光标色板：不是归档对象，但接线前需改名

`CollaborationProvider.tsx:109-116` 定义了 8 色离散光标 token。
**这不违反 P0-2** —— 红线禁止的是"紫色→粉色**渐变**作为主视觉"，而这是离散**纯色**，
且红线本身明确允许 Indigo/Slate Blue 作为纯色使用（`--p-accent: #4263EB` 即是纯色）。

**但接线前必须做两件事**：

1. **改名去掉色相词**：`--cursor-purple` → `--collab-user-1-fg` 之类。
   现名含 "purple"，后续开发者或自动 review 工具按色相检索会命中，误判成"引入紫色主视觉"，白花时间解释。
2. **加约束注释**：

```css
/* 协作者身份标识色板（8 色离散，非渐变）
 * 用途：仅用于多人协同时区分不同用户的光标与选区
 * 约束：不得用于主视觉/CTA/品牌元素；不得组合为渐变；
 *       同一屏内出现的人数不应超过实际协作者数（无协作者时不渲染）
 * 关联：S5 降级态下本色板完全不渲染（无协同即无身份标识需求） */
```

**最后半句是关键** —— 它把色板与诚实化规范绑死：没有协同就没有光标色，
不会出现"有光标颜色但没人协作"的怪状态。

### 5.2 `--info` 语义色

S2「正在重连」需要一个既非成功也非警告的色。
项目当前**没有** `--info`（`design-tokens.css:101-107` 只有 success/warn/danger 三族）。

定义层新增（`design/design-tokens.css` 的 Primitive 块，**唯一允许裸值的位置**）：

```css
:root                        { --p-info: #0E7490; }
:root[data-theme="dark"]     { --p-info: #22A5C4; }
:root                        { --info: var(--p-info);
                              --info-soft: color-mix(in srgb, var(--info) 12%, transparent); }
```

```css
/* globals.css 既有 --*-fg 模式的对齐补充 */
:root                        { --info-fg: #0B4A5C; }
[data-theme="dark"]          { --info-fg: #7DD3E8; }
```

- **不可派生自 `--accent`** —— 后者有"每屏 ≤2 处"的独立预算约束，`--info` 若等于 accent 会吃掉交互强调色预算
- 对比度：`--info-fg` on `--info-soft` ≥ 4.5:1，落地时须实测
- 深色模式**无需组件级 `:root [data-theme="dark"]` 特判** —— `--*-soft` / `--*-fg` 已各自覆盖。若某处需要特判，说明 token 缺失，应回补 token 而非在组件里打补丁

---

## 六、给未来接线者的一句话

> **挂载 Provider 之前，先确认 S5 能工作。**
> 没有 S5，界面会用琥珀色告诉每个用户"你的网络坏了" —— 而真相是我们的服务端没部署。
> 这比"没有多人协同"糟糕得多：前者是我们撒谎，后者只是功能没做。

---

## 附：证据索引

| 结论 | 证据 |
|---|---|
| 服务端缺 2 个依赖 | `web/package.json` 无 `ws` / `@types/ws`；依赖清单见 `server/collab/y-websocket-server.ts:19-30` |
| 服务端为独立服务 | `y-websocket-server.ts:17-18`「不在 web/ 的 tsconfig 范围内」 |
| Provider 零挂载 | `web/app/` 下无任何 import `CollaborationProvider` |
| 编辑器未接 CRDT | `RichTextEditor.tsx:464` 仅 `StarterKit.configure()`；`:27` 只 import StarterKit |
| 静默兜底 localhost | `CollaborationProvider.tsx:206` |
| offline 用 warn 呈现 | `PresenceIndicator.tsx:162-167` |
| S1 三秒闪现现状 | `PresenceIndicator.tsx:122` `SYNCED_FLASH_MS = 3000`；`:184-196` |
| 长离线阈值 7 天 | `CollaborationProvider.tsx:48` `OFFLINE_TOO_LONG_MS` |
| 离线编辑不依赖服务端 | `CollaborationProvider` 内 `y-indexeddb`（IndexedDB 纯浏览器侧） |
| `--info` 缺失 | `design/design-tokens.css:101-107` |
| accent 为纯色（非渐变） | `design/design-tokens.css:21` `--p-accent: #4263EB` |
