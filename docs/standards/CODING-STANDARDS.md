# corps 编码规范

> 版本：v1.0 ｜ 日期：2026-08-23 ｜ 适用范围：web/ 全目录

---

## 第1章 TypeScript 规范

### 1.1 严格模式

- `tsconfig.json` 必须启用 `"strict": true`
- 禁止使用 `any`，优先用 `unknown` 替代
- 仅在第三方库类型缺失时用 `// @ts-expect-error` 注释豁免
- 优先使用 `as` 类型断言，仅在 JSX 中用 `as` 语法

### 1.2 命名约定

| 类型 | 规则 | 示例 |
|------|------|------|
| 变量/函数 | camelCase | `getUserToken`、`memberCount` |
| React 组件 | PascalCase | `NewTaskDialog`、`CommandPalette` |
| 常量 | UPPER_SNAKE_CASE | `TOKEN_KEY`、`MAX_MEMBERS` |
| 类型/接口 | PascalCase（接口不加 `I` 前缀） | `JWTPayload`、`CreateTaskRequest` |
| Prisma 模型 | PascalCase | `Workspace`、`Member` |
| 数据库字段 | snake_case（`@map` 映射） | `@map("workspace_id")` |
| 文件名（组件） | PascalCase.tsx | `CommandPalette.tsx` |
| 文件名（工具） | kebab-case.ts | `api-client.ts` |
| 路由目录 | kebab-case | `w/[wid]/task/[id]/` |

### 1.3 类型 vs Interface

- 优先使用 `type` 定义数据结构（Props、API 响应、DTO）
- `interface` 仅用于需要扩展（`extends`）或声明合并的场景
- 禁止默认导出未命名的类型

### 1.4 导入顺序

```typescript
// 1. React / Next.js 核心
import { useState } from "react";
import { useRouter } from "next/navigation";

// 2. 第三方库
import { Plus, Search } from "lucide-react";

// 3. 本地模块（@别名）
import { api } from "@/lib/api";
import NewTaskDialog from "@/components/NewTaskDialog";
```

---

## 第2章 React / Next.js 规范

### 2.1 组件类型选择

- **优先 Server Component**（不加 `"use client"`）
- 仅在需要以下特性时才加 `"use client"`：
  - `useState`/`useEffect`/`useCallback` 等 Hooks
  - 事件处理器（`onClick`/`onChange` 等）
  - 浏览器 API（`localStorage`/`fetch` 等）
- Client Component 文件**首行必须是 `"use client"`**

### 2.2 Props 定义

```typescript
// ✅ 内联 type（组件在同一文件时）
export default function BoardPage({ params }: { params: Promise<{ wid: string }> }) { ... }

// ✅ 抽取到 types.ts（多处引用时）
// types/task.ts
export type TaskStatus = "todo" | "in_progress" | "review" | "done";
```

### 2.3 Hooks 规范

- 自定义 Hooks 统一放在 `hooks/` 目录
- 命名以 `use` 开头：`useWorkspace`、`useTasks`
- 优先使用 Next.js 内置 Hooks（`useRouter`、`useParams`、`useSearchParams`）

### 2.4 文件组织

```
web/
├── app/                        # Next.js App Router 页面
│   ├── api/v1/                 # API Route Handlers
│   ├── auth/                   # 认证页面（登录/注册）
│   ├── w/[wid]/                # 工作区页面
│   │   ├── board/              # 任务看板
│   │   ├── task/[id]/          # 任务详情
│   │   ├── members/            # 成员管理
│   │   ├── billing/            # 计费
│   │   ├── settings/           # 设置
│   │   └── layout.tsx          # 工作区 Shell
│   ├── globals.css             # 全局样式 + CSS 变量
│   ├── layout.tsx              # 根布局
│   └── page.tsx                # 首页（重定向）
├── components/                  # 共享组件
├── lib/                         # 工具函数（纯函数，不依赖 React）
│   ├── prisma.ts                # Prisma 客户端
│   ├── auth.ts                  # 认证中间件
│   ├── jwt.ts                   # JWT 工具
│   ├── api.ts                   # 前端 API 客户端
│   └── stripe.ts                # Stripe 客户端
├── hooks/                       # 自定义 Hooks
├── types/                       # 共享类型定义
├── tests/                       # 测试文件
├── prisma/                      # Prisma schema + 迁移
│   ├── schema.prisma
│   └── seed.ts
└── docker/                      # Docker 配置
```

### 2.5 文案与本地化防退化约定

> 来源：ADR-008《国际化（i18n）方案选型与范围界定》，2026-08-26 经用户拍板生效。i18n 当前为条件触发项（触发条件见 ADR-008 §4.2），以下三条约定用于保证未来启动双语改造时，全站文案的整句抽取成本不随时间恶化：

1. **整句原则**：UI 文案禁用字符串拼接造句，保留完整短语（便于未来 i18n 整句抽取）；动态数据用占位符模板而非拼接。
2. **日期格式化**：一律使用 `Intl.DateTimeFormat("zh-CN", …)`（或封装好的格式化工具），禁止手写格式化函数与硬编码格式串。
3. **货币符号集中化**：货币符号走集中常量映射（如 `CURRENCY_SYMBOLS`），禁止在组件中散落硬编码 `"¥"`/`"$"`。

---

## 第3章 CSS / 样式规范

### 3.1 Token 引用规则

- **强制**：所有颜色引用 `var(--token)`，禁止裸 hex
- **强制**：每屏强调色（`var(--accent)`）≤2处——①主CTA按钮 ②当前选中导航项
- 原始色值（Primitive）仅出现在 `globals.css` 的 `:root` 块中

### 3.2 图标规范

- **唯一图标库**：`lucide-react` 0.513.0，具名 import
- **尺寸档位**：仅 `16/20/24/32px`
- **描边**：`strokeWidth={2}`，`stroke="currentColor"`
- **禁止 emoji** 作功能图标
- 图标按钮必须有 `aria-label`，触摸热区 ≥44×44

### 3.3 字体

- 正文：`Inter` + `Noto Sans SC`
- 等宽：`JetBrains Mono`
- 字重：400 / 510 / 590 三级（禁用 500/600/700 等含糊档位）

---

## 第4章 API 开发规范

### 4.1 Route Handler 模式

```typescript
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  // 1. 认证
  const payload = await authenticate(req);
  if (!payload) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  // 2. RBAC
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 403, message: "Forbidden" }, { status: 403 });
  // 3. 业务逻辑 + RLS
  const result = await runWhithWorkspace(wid, async (tx) => { ... });
  // 4. 统一响应
  return NextResponse.json({ code: 200, data: result, message: "ok" });
}
```

### 4.2 响应信封

```json
{
  "code": 200,
  "data": { ... },
  "message": "ok"
}
```

| HTTP Status | code | 含义 |
|-------------|------|------|
| 200 | 200 | 成功 |
| 201 | 201 | 创建成功 |
| 400 | 400 | 请求参数错误 |
| 401 | 401 | 未认证 |
| 403 | 403 | 无权限 |
| 404 | 404 | 资源不存在 |
| 409 | 409 | 资源冲突（如邮箱重复）|
| 500 | 500 | 服务器错误 |

---

## 第5章 Git 工作流

### 5.1 分支命名

| 前缀 | 用途 | 示例 |
|------|------|------|
| feature/ | 新功能 | `feature/cmd-palette` |
| fix/ | Bug修复 | `fix/rls-leak` |
| chore/ | 工程配置 | `chore/eslint-config` |
| docs/ | 文档 | `docs/api-guide` |
| refactor/ | 重构 | `refactor/auth-flow` |

### 5.2 Commit 格式（Conventional Commits）

```
<type>(<scope>): <description>
```

类型：`feat` / `fix` / `chore` / `docs` / `refactor` / `test` / `style`

示例：
```
feat(auth): add refresh token rotation
fix(board): correct drag-drop optimistic update
chore(ci): add GitHub Actions workflow
```

### 5.3 PR 流程

1. 从 `main` 分支拉出新分支
2. 本地开发 + 自测通过
3. 推送并创建 Pull Request
4. 至少 1 人 Review 并 Approve
5. Squash merge 到 `main`

---

## 第6章 Code Review 清单

Reviewer 必须检查以下每一项：

- [ ] TypeScript strict 模式，无 `any` 类型
- [ ] 组件正确区分 Server/Client（`"use client"` 仅在需要时）
- [ ] 颜色全部引用 `var(--token)`，无裸 hex
- [ ] 图标仅 `lucide-react`，无 emoji
- [ ] 错误处理完整（try/catch + 用户友好提示）
- [ ] API 调用有 401 自动刷新逻辑
- [ ] RLS 上下文正确注入（`runWitWorkspace`）
- [ ] 每屏强调色 ≤2处
- [ ] 新功能有对应的自动化测试