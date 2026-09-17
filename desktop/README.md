# Corps 桌面端（Tauri v2）

将 Corps Web 端（`web/`，Next.js 16）打包为 Windows / macOS / Linux 原生应用。

## 目录结构

```
desktop/
├── package.json              # Tauri CLI 脚本
├── README.md                 # 本文件
├── dist/                     # 前端静态产物（由 web 构建输出，见下文）
└── src-tauri/
    ├── tauri.conf.json       # Tauri 配置（窗口 / 打包 / 自动更新）
    ├── Cargo.toml            # Rust 依赖
    ├── build.rs              # Tauri 构建脚本
    ├── capabilities/
    │   └── default.json      # 插件权限授权
    ├── icons/                # 应用图标（32x32.png / 128x128.png / icon.icns / icon.ico）
    └── src/
        ├── main.rs           # 入口：托盘 + 快捷键 + 单实例锁
        └── lib.rs            # 库占位（共享逻辑预留）
```

## 功能

| 功能 | 说明 |
|------|------|
| 单实例锁 | 第二实例启动时聚焦已有主窗口，不重复创建 |
| 系统托盘 | 最小化到托盘；左键切换窗口可见性；右键菜单（显示/隐藏/退出） |
| 全局快捷键 | `Ctrl+Shift+C`（macOS 下 `Cmd+Shift+C`）唤起主窗口 |
| 关闭即最小化 | 点击窗口关闭按钮时隐藏到托盘，不退出进程 |
| 自动更新 | 通过 `tauri-plugin-updater` 拉取远端版本并热更新 |
| 开机自启 | `tauri-plugin-autostart` 支持设置开机启动 |
| 深色/浅色主题 | 启动时跟随系统主题（`set_theme(None)`） |

## 前置依赖

| 工具 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | ≥ 20 | 与 `web/` 一致 |
| pnpm | 11.22.0 | 与 `web/` 一致（`packageManager` 字段） |
| Rust | ≥ 1.77.2 | 稳定版工具链 |
| Tauri CLI | v2 | 由 `desktop/package.json` devDependency 提供 |

### 平台额外依赖

- **Windows**：[Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)（Win11 已预装；Win10 需安装。打包时 `webviewInstallMode` 已配置为自动下载引导）
- **macOS**：Xcode Command Line Tools（`xcode-select --install`）
- **Linux**：`webkit2gtk-4.1`、`libgtk-3`、`libappindicator3`、`librsvg`（Debian 系：`sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`）

## 构建步骤

### 1. 安装桌面端依赖

```bash
cd desktop
pnpm install
```

### 2. 开发模式（热重载）

```bash
pnpm dev
# 等价于 tauri dev
# 会自动执行 beforeDevCommand: cd ../web && pnpm dev
# 然后在 http://localhost:3000 上拉起 WebView
```

### 3. 生产构建（出安装包）

```bash
pnpm build
# 等价于 tauri build
# 会自动执行 beforeBuildCommand: cd ../web && pnpm build
# 产物输出到 src-tauri/target/release/bundle/
```

产物按平台分布：

| 平台 | 产物 | 路径 |
|------|------|------|
| Windows | `msi` + `nsis` 安装包 | `src-tauri/target/release/bundle/{msi,nsis}/` |
| macOS | `dmg` 镜像 | `src-tauri/target/release/bundle/dmg/` |
| Linux | `appimage` + `deb` | `src-tauri/target/release/bundle/{appimage,deb}/` |

### 4. 生成应用图标

准备一张 1024×1024 的 PNG，执行：

```bash
pnpm icon path/to/icon.png
# 自动生成 32x32.png / 128x128.png / icon.icns / icon.ico 到 src-tauri/icons/
```

## 与 `web/` 共享前端代码

Tauri 通过 `tauri.conf.json` 的 `build` 字段与 `web/` 联动：

```json
{
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:3000",
    "beforeDevCommand": "cd ../web && pnpm dev",
    "beforeBuildCommand": "cd ../web && pnpm build"
  }
}
```

- **开发**：`beforeDevCommand` 启动 `web/` 的 Next.js dev server（端口 3000），WebView 加载 `devUrl`。
- **生产**：`beforeBuildCommand` 构建 `web/`，产物需输出到 `desktop/dist/` 供 `frontendDist` 加载。

> **注意**：当前 `web/next.config.ts` 为 `output: "standalone"`（Node.js server 模式）。
> 桌面端打包需要**静态产物**，需在桌面构建流程中将 Next.js 切换为静态导出（`output: "export"`）或将 standalone server 嵌入 Tauri sidecar。
> 推荐方案：为桌面端单独维护一份 `next.config.desktop.ts`，设置 `output: "export"`、`images: { unoptimized: true }`，并将 `distDir` 指向 `../desktop/dist`。
> 此项属于「与 web/ 共享前端代码的构建配置」后续任务，本脚手架已预留 `frontendDist: "../dist"` 对接点。

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

2. **填入公钥**：将 `.key.pub` 内容粘贴到 `tauri.conf.json` 的 `plugins.updater.pubkey` 字段（替换 `REPLACE_WITH_YOUR_UPDATER_PUBKEY`）。

3. **构建时签名**：设置环境变量后构建：
   ```bash
   # PowerShell
   $env:TAURI_SIGNING_PRIVATE_KEY = "<.key 文件内容>"
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<你设置的密码>"
   pnpm build
   ```
   产物会附带 `.sig` 签名文件。

4. **发布更新**：将安装包与 `.sig` 上传到 `https://releases.corps.com/desktop/`，并维护一份 `latest.json` 清单（格式见 [Tauri Updater 文档](https://v2.tauri.app/plugin/updater/)）。

5. **前端调用更新**（可选）：在 `web/` 中调用 `@tauri-apps/plugin-updater` 的 `check()` / `downloadAndInstall()` 实现应用内更新检查 UI。

## 深色 / 浅色主题适配

- **Rust 端**：`main.rs` 启动时调用 `window.set_theme(None)` 跟随系统。
- **前端端**：`web/` 已使用 Tailwind CSS + design-tokens，通过 `prefers-color-scheme` 媒体查询或 `next-themes` 适配。WebView 会自动将系统主题传递给前端 CSS 媒体查询，无需额外桥接。
- 若需主动切换：前端调用 `@tauri-apps/api/window` 的 `setTheme('light' | 'dark' | null)`，Rust 端已授权 `core:window:allow-set-theme`。

## 故障排查

| 现象 | 原因 / 解决 |
|------|-------------|
| `pnpm dev` 报 `tauri: command not found` | 未执行 `pnpm install`，或未在 `desktop/` 目录下执行 |
| 构建报 `frontendDist path not found` | `desktop/dist/` 不存在；需先完成 web 静态导出配置（见上文） |
| 托盘图标不显示 | `src-tauri/icons/` 缺少图标文件；执行 `pnpm icon` 生成 |
| 全局快捷键无效 | 可能被其他应用占用；修改 `main.rs` 中 `Code::KeyC` 为其他键 |
| Windows 打包缺 WebView2 | 已配置 `webviewInstallMode: downloadBootstrapper`，安装包会自动引导下载 |

## 经验来源

- Tauri v2 配置 schema：`https://schema.tauri.app/config/2`
- 单实例 / 托盘 / 快捷键插件 API：Tauri v2 官方插件文档
- `package.json` 版本与 `web/` 对齐（0.6.0），遵循「与 next 主版本对齐」经验（来源：`build-env/2026-09-17-next-bundle-analyzer-version-align-with-next-major`）