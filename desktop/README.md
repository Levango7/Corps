# Corps 桌面端（Tauri v2）

## 项目简介

将 Corps Web 端（`web/`，Next.js 16）打包为 Windows / macOS / Linux 原生桌面应用。

基于 **Tauri v2** 构建，采用 Rust 内核 + WebView 渲染，体积远小于 Electron 方案。生产模式下，Next.js standalone server 作为 **Sidecar 子进程**内嵌于应用中，启动时自动拉起本地 HTTP server（默认 `127.0.0.1:3000`），WebView 加载该地址渲染界面。

### 核心功能

| 功能 | 说明 |
|------|------|
| 单实例锁 | 第二实例启动时聚焦已有主窗口，不重复创建 |
| 系统托盘 | 最小化到托盘；左键切换窗口可见性；右键菜单（显示/隐藏/退出） |
| 全局快捷键 | `Ctrl+Shift+C`（macOS 下 `Cmd+Shift+C`）唤起主窗口 |
| 关闭即最小化 | 点击窗口关闭按钮时隐藏到托盘，不退出进程 |
| 自动更新 | 通过 `tauri-plugin-updater` 拉取远端版本并热更新 |
| 开机自启 | `tauri-plugin-autostart` 支持设置开机启动 |
| 深色/浅色主题 | 启动时跟随系统主题（`set_theme(None)`） |
| Sidecar 内嵌 | Next.js standalone server 打包进二进制，无需外部 Node.js 环境 |

---

## 目录结构

```
desktop/
├── package.json              # Tauri CLI 脚本与 devDependency
├── README.md                 # 本文件
├── .env.example              # 桌面端环境变量模板
├── .gitignore                # 忽略 target/ / dist/ / node_modules/ / 密钥
├── copy-standalone.mjs       # 构建后复制 Next.js standalone 到 resources/
├── dist/                     # 前端占位产物（由 copy-standalone.mjs 生成）
└── src-tauri/
    ├── tauri.conf.json       # Tauri 配置（窗口 / 打包 / 自动更新）
    ├── Cargo.toml            # Rust 依赖与 release profile
    ├── Cargo.lock            # Rust 依赖锁定
    ├── build.rs              # Tauri 构建脚本
    ├── capabilities/
    │   └── default.json      # 插件权限授权
    ├── icons/                # 应用图标（32x32.png / 128x128.png / icon.icns / icon.ico）
    ├── resources/
    │   └── standalone/       # Next.js standalone server（构建时由 copy-standalone.mjs 填充）
    └── src/
        ├── main.rs           # 入口：托盘 + 快捷键 + 单实例锁 + Sidecar 管理
        └── lib.rs            # 库占位（共享逻辑预留）
```

---

## 前置条件

### 基础工具链

| 工具 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | ≥ 20（推荐 22） | 与 `web/` 一致 |
| pnpm | 11.22.0 | 与 `web/` 的 `packageManager` 字段一致 |
| Rust | ≥ 1.77.2 | 稳定版工具链（`rustup default stable`） |
| Tauri CLI | v2 | 由 `desktop/package.json` devDependency 提供 |

### 平台额外依赖

- **Windows**：[Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)（Win11 已预装；Win10 需安装。打包时 `webviewInstallMode` 已配置为自动下载引导）
- **macOS**：Xcode Command Line Tools（`xcode-select --install`）
- **Linux**：`webkit2gtk-4.1`、`libgtk-3`、`libappindicator3`、`librsvg`（Debian 系：`sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf`）

---

## 开发模式

开发模式下，Tauri 通过 `beforeDevCommand` 自动拉起 Next.js dev server，WebView 加载 `devUrl`（`http://localhost:3000`），支持前端热重载。

```bash
cd desktop
pnpm install          # 安装 Tauri CLI
pnpm dev              # 等价于 tauri dev
```

执行流程：
1. `beforeDevCommand` → `cd ../web && pnpm dev` 启动 Next.js dev server（Turbopack）
2. Tauri 编译 Rust 内核并启动原生窗口
3. WebView 加载 `http://localhost:3000`，前端代码变更自动热重载

> **注意**：开发模式下 Sidecar 不启动（仅生产构建内嵌 standalone server）。开发模式直接连接 Next.js dev server。

---

## 构建模式

### 生产构建（出安装包）

```bash
cd desktop
pnpm install
pnpm build            # 等价于 tauri build
```

执行流程：
1. `beforeBuildCommand` → `cd ../web && pnpm build && node ../desktop/copy-standalone.mjs`
   - 构建 Next.js standalone 产物（`web/.next/standalone/`）
   - 复制 standalone server + 静态资源到 `desktop/src-tauri/resources/standalone/`
   - 在 `desktop/dist/` 创建占位 `index.html`（Tauri 需要 `frontendDist` 存在）
2. Tauri 编译 Rust 内核（release profile：LTO + opt-level=s + strip）
3. 打包原生安装包，输出到 `src-tauri/target/release/bundle/`

### 产物分布

| 平台 | 产物 | 路径 |
|------|------|------|
| Windows | `msi` + `nsis` 安装包 | `src-tauri/target/release/bundle/{msi,nsis}/` |
| macOS | `dmg` 镜像 | `src-tauri/target/release/bundle/dmg/` |
| Linux | `appimage` + `deb` | `src-tauri/target/release/bundle/{appimage,deb}/` |

### Debug 构建

```bash
pnpm build:debug      # 等价于 tauri build --debug
# 产物输出到 src-tauri/target/debug/bundle/
```

### 生成应用图标

准备一张 1024×1024 的 PNG，执行：

```bash
pnpm icon path/to/icon.png
# 自动生成 32x32.png / 128x128.png / icon.icns / icon.ico 到 src-tauri/icons/
```

---

## 环境变量

桌面端在运行时内嵌 Next.js standalone server，需要通过环境变量配置后端连接、认证、AI、实时通信和存储等服务。

### 配置方式

1. **开发/本地**：在 `desktop/` 目录下创建 `.env` 文件（参考 `.env.example`）
2. **打包内嵌**：在构建前将环境变量写入 `src-tauri/resources/standalone/.env`（由 copy-standalone.mjs 复制时携带）
3. **运行时注入**：用户可在应用安装目录放置 `.env` 文件覆盖默认值

### 变量清单

| 变量 | 必填 | 说明 |
|------|------|------|
| `PORT` | 否 | standalone server 监听端口，默认 `3000` |
| `HOSTNAME` | 否 | standalone server 绑定地址，默认 `127.0.0.1`（仅本地访问） |
| `NODE_ENV` | 是 | 运行模式，桌面端固定为 `production` |
| `DATABASE_URL` | 是 | PostgreSQL 连接字符串 |
| `BETTER_AUTH_SECRET` | 是 | Better Auth 会话签名密钥（`openssl rand -hex 32`） |
| `AI_API_KEY` | 否 | AI 服务 API 密钥（未配置时 AI 功能降级） |
| `LIVEKIT_URL` | 否 | LiveKit 服务地址（`ws://` 或 `wss://`） |
| `LIVEKIT_API_KEY` | 否 | LiveKit API 密钥 |
| `LIVEKIT_API_SECRET` | 否 | LiveKit API 密钥（HMAC 签名用） |
| `S3_ENDPOINT` | 否 | S3 兼容存储端点（录制文件上传） |
| `S3_BUCKET` | 否 | S3 存储桶名 |
| `S3_ACCESS_KEY` | 否 | S3 访问密钥 |
| `S3_SECRET_KEY` | 否 | S3 密钥 |
| `S3_REGION` | 否 | S3 区域 |

完整模板见 [`desktop/.env.example`](./.env.example)。

---

## 跨平台构建

### 本地跨平台构建

各平台只能在对应操作系统上构建原生安装包（Tauri 不支持交叉编译）：

```bash
# Windows 上构建 → msi + nsis
# macOS 上构建 → dmg
# Linux 上构建 → appimage + deb
cd desktop && pnpm build
```

### CI/CD 自动构建

项目提供 GitHub Actions 工作流 [`.github/workflows/tauri-build.yml`](../.github/workflows/tauri-build.yml)，在推送 `v*` 标签或手动触发时，在 Windows / macOS / Linux 三个平台并行构建。

#### 触发方式

```bash
# 方式一：打 tag 触发
git tag v0.6.0
git push origin v0.6.0

# 方式二：手动触发
# GitHub → Actions → Tauri Build → Run workflow
```

#### 工作流步骤

1. **checkout** 代码
2. **setup-node 22** + **pnpm 11** 安装 Node.js 工具链
3. **rust-toolchain stable** 安装 Rust 稳定版
4. **rust-cache** 缓存 Rust 编译产物（加速后续构建）
5. **Linux 依赖**（仅 ubuntu）安装 `libwebkit2gtk-4.1-dev`、`libappindicator3-dev`、`librsvg2-dev`、`patchelf`
6. **pnpm install web** 安装前端依赖（frozen lockfile）
7. **prisma generate** 生成 Prisma Client
8. **pnpm install desktop** 安装 Tauri CLI
9. **tauri build** 构建原生安装包
10. **upload-artifact** 上传各平台安装包到 GitHub Artifacts（保留 30 天）

#### 产物下载

构建完成后，在 GitHub Actions 运行页面的 Artifacts 区域下载：
- `tauri-bundle-windows-latest` — Windows 的 msi/nsis 安装包
- `tauri-bundle-macos-latest` — macOS 的 dmg 镜像
- `tauri-bundle-ubuntu-latest` — Linux 的 appimage/deb 包

### 自动更新签名

CI 构建支持自动签名（需在 GitHub Secrets 中配置）：

| Secret | 说明 |
|--------|------|
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri 更新签名私钥（`.key` 文件内容） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码 |

配置后，构建产物会附带 `.sig` 签名文件，供 `tauri-plugin-updater` 验证更新包完整性。

---

## 与 `web/` 共享前端代码

Tauri 通过 `tauri.conf.json` 的 `build` 字段与 `web/` 联动：

```json
{
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:3000",
    "beforeDevCommand": "cd ../web && pnpm dev",
    "beforeBuildCommand": "cd ../web && pnpm build && node ../desktop/copy-standalone.mjs"
  }
}
```

- **开发**：`beforeDevCommand` 启动 `web/` 的 Next.js dev server（端口 3000），WebView 加载 `devUrl`。
- **生产**：`beforeBuildCommand` 构建 `web/` standalone 产物，`copy-standalone.mjs` 将 standalone server 复制到 `src-tauri/resources/standalone/` 并打包进二进制。运行时 Rust 端启动该 server 作为 Sidecar 子进程。

---

## 自动更新配置

`tauri.conf.json` 已配置 `plugins.updater`：

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": ["https://releases.corps.com/desktop/updater/{{target}}/{{arch}}/{{current_version}}"],
      "pubkey": "REPLACE_WITH_YOUR_UPDATER_PUBKEY"
    }
  }
}
```

### 启用步骤

1. **生成签名密钥对**：
   ```bash
   pnpm tauri signer generate -w ~/.tauri/corps-updater.key
   ```
   会生成私钥（`.key`）与公钥（`.key.pub`）。

2. **填入公钥**：将 `.key.pub` 内容粘贴到 `tauri.conf.json` 的 `plugins.updater.pubkey` 字段。

3. **配置 CI Secrets**：将 `.key` 文件内容设为 GitHub Secret `TAURI_SIGNING_PRIVATE_KEY`，密码设为 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。

4. **发布更新**：将安装包与 `.sig` 上传到 `https://releases.corps.com/desktop/`，并维护一份 `latest.json` 清单（格式见 [Tauri Updater 文档](https://v2.tauri.app/plugin/updater/)）。

5. **前端调用更新**（可选）：在 `web/` 中调用 `@tauri-apps/plugin-updater` 的 `check()` / `downloadAndInstall()` 实现应用内更新检查 UI。

---

## 深色 / 浅色主题适配

- **Rust 端**：`main.rs` 启动时调用 `window.set_theme(None)` 跟随系统。
- **前端端**：`web/` 已使用 Tailwind CSS + design-tokens，通过 `prefers-color-scheme` 媒体查询或 `next-themes` 适配。WebView 会自动将系统主题传递给前端 CSS 媒体查询，无需额外桥接。
- 若需主动切换：前端调用 `@tauri-apps/api/window` 的 `setTheme('light' | 'dark' | null)`，Rust 端已授权 `core:window:allow-set-theme`。

---

## 已知限制

| 限制 | 说明 | 影响 |
|------|------|------|
| **不支持交叉编译** | Tauri 无法在单一平台构建其他平台的安装包 | 必须使用 CI 矩阵或在三台机器上分别构建 |
| **Sidecar 需要数据库连接** | 内嵌的 Next.js standalone server 启动时需连接 PostgreSQL | 用户需确保 `DATABASE_URL` 可达，否则应用启动后页面空白 |
| **WebView2 需预装（Win10）** | Windows 10 不自带 WebView2 Runtime | 已配置 `webviewInstallMode: downloadBootstrapper`，安装包会自动引导下载 |
| **macOS 需代码签名** | 未签名的 dmg 在 macOS 上会触发 Gatekeeper 拦截 | 需配置 Apple Developer 证书签名，或用户手动 `xattr -cr` 绕过 |
| **自动更新需配置公钥** | `tauri.conf.json` 中 `pubkey` 仍为占位值 | 未替换前自动更新功能不可用 |
| **前端静态导出未完全配置** | 当前 `web/next.config.ts` 为 `output: "standalone"`，桌面端通过 Sidecar 方式运行 | 如需纯静态导出（无 Sidecar），需单独维护 `next.config.desktop.ts` 设置 `output: "export"` |
| **Linux 包体积** | AppImage 包含完整 WebView 运行时，体积约 50-80MB | Tauri 方案已优于 Electron，但仍大于原生应用 |
| **环境变量不内嵌** | 构建时的环境变量仅用于 next build，运行时需用户提供真实值 | 用户需在应用目录配置 `.env` 或通过系统环境变量注入 |

---

## 故障排查

| 现象 | 原因 / 解决 |
|------|-------------|
| `pnpm dev` 报 `tauri: command not found` | 未执行 `pnpm install`，或未在 `desktop/` 目录下执行 |
| 构建报 `frontendDist path not found` | `desktop/dist/` 不存在；`copy-standalone.mjs` 应自动创建，检查 `web/` 构建是否成功 |
| 托盘图标不显示 | `src-tauri/icons/` 缺少图标文件；执行 `pnpm icon` 生成 |
| 全局快捷键无效 | 可能被其他应用占用；修改 `main.rs` 中 `Code::KeyC` 为其他键 |
| Windows 打包缺 WebView2 | 已配置 `webviewInstallMode: downloadBootstrapper`，安装包会自动引导下载 |
| 应用启动后白屏 | Sidecar server 启动失败；检查 `DATABASE_URL` 是否可达、端口 3000 是否被占用 |
| macOS 打开后提示"已损坏" | 未签名；执行 `xattr -cr /Applications/Corps.app` 绕过 Gatekeeper |
| CI 构建超时 | Rust 首次编译较慢（20-40 分钟）；`rust-cache` action 会缓存后续构建 |

---

## 经验来源

- Tauri v2 配置 schema：`https://schema.tauri.app/config/2`
- 单实例 / 托盘 / 快捷键插件 API：Tauri v2 官方插件文档
- `package.json` 版本与 `web/` 对齐（0.6.0），遵循「与 next 主版本对齐」经验（来源：`build-env/2026-09-17-next-bundle-analyzer-version-align-with-next-major`）
- CI 工作流 `upload-artifact` 步骤保留构建产物，避免失败证据丢失（来源：`build-env/2026-09-09-ci-e2e-artifact-upload-trace-preservation`）
