# iOS 测试方案详细对比

> 当前状态：CI 中 `tauri ios build` 因缺少 Apple Developer Team 签名无法产出 .app/.ipa

## 方案对比

| 维度 | 方案 A：借朋友的 Mac | 方案 B：云 Mac 服务 | 方案 C：Apple Developer Program |
|------|---------------------|---------------------|-------------------------------|
| **成本** | 免费 | ~$20-40/月 | $99/年 |
| **准备时间** | 1-2 小时 | 30 分钟 | 1-3 天（审核） |
| **签名有效期** | 7 天 | 7 天 | 1 年 |
| **设备限制** | 3 台/Apple ID | 3 台/Apple ID | 100 台 |
| **CI 自动签名** | ❌ | ❌ | ✅ |
| **App Store 上架** | ❌ | ❌ | ✅ |
| **推送通知** | ❌ | ❌ | ✅ |
| **适合场景** | 快速验证 | 持续开发无 Mac | 正式发布 |

---

## 方案 A：借朋友的 Mac（推荐快速验证）

### 前置条件
- 朋友的 Mac（macOS 13+）
- 你自己的免费 Apple ID（不需要朋友账号）

### 操作步骤

1. **在朋友的 Mac 上安装工具**
   ```bash
   # 安装 Xcode Command Line Tools
   xcode-select --install
   
   # 安装 Rust
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   
   # 添加 iOS target
   rustup target add aarch64-apple-ios aarch64-apple-ios-sim
   
   # 安装 Tauri CLI
   npm install -g @tauri-apps/cli
   ```

2. **克隆项目并构建**
   ```bash
   git clone https://github.com/Levango7/Corps.git
   cd Corps/desktop
   npm install
   
   # 设置远程 URL（你的测试服务器）
   export CORPS_WEB_URL=https://your-test-server.com
   
   # 构建 iOS 模拟器版本（无需签名）
   npx tauri ios build --target aarch64-apple-ios-sim
   ```

3. **在 Xcode 中签名（真机测试）**
   ```bash
   # 打开生成的 Xcode 项目
   open src-tauri/gen/apple/Corps.xcodeproj
   ```
   - Xcode → 项目设置 → Signing & Capabilities
   - Team: 选择你的 Personal Team（自动创建）
   - Bundle Identifier: 改为 `com.yourname.corps`（确保唯一）
   - 连接你的 iPhone → 选择设备 → Build & Run

4. **安装到真机**
   - 首次运行需在 iPhone 上信任开发者：设置 → 通用 → VPN与设备管理 → 信任你的 Apple ID

### 优缺点
- ✅ 完全免费
- ✅ 最快上手
- ❌ 签名 7 天过期，需重新构建
- ❌ 依赖朋友的 Mac
- ❌ 无法 CI 自动化

---

## 方案 B：云 Mac 服务

### 推荐服务商

| 服务 | 价格 | 特点 |
|------|------|------|
| [MacInCloud](https://www.macincloud.com/) | $20/月起 | 稳定可靠，按需配置 |
| [MacStadium](https://www.macstadium.com/) | $45/月起 | 面向开发者，可配置 CI |
| [GitHub Actions macOS](https://docs.github.com/en/actions/using-github-hosted-runners/using-github-hosted-runners/about-github-hosted-runners) | 包含在 Actions 中 | 免费 2000 分钟/月（私有仓库有限） |

### 操作步骤（以 GitHub Actions 为例）

GitHub Actions 已提供 macOS runner，可以直接在 CI 中构建 iOS：

1. **修改 `.github/workflows/mobile-build.yml`**，iOS 部分改为：
   ```yaml
   ios-build:
     runs-on: macos-latest  # 改为 macOS runner
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with:
           node-version: 20
       - uses: dtolnay/rust-toolchain@stable
         with:
           targets: aarch64-apple-ios,aarch64-apple-ios-sim
       - name: Install Tauri CLI
         run: npm install -g @tauri-apps/cli
       - name: Build iOS (simulator)
         run: |
           cd desktop
           npm install
           export CORPS_WEB_URL=${{ secrets.CORPS_WEB_URL || 'https://corps.com' }}
           npx tauri ios build --target aarch64-apple-ios-sim
       - uses: actions/upload-artifact@v4
         with:
           name: ios-app
           path: desktop/src-tauri/gen/apple/build/Build/Products/*.app
   ```

2. **模拟器版本无需签名**，可直接产出 .app

3. **真机版本需免费 Apple ID**：
   - 在 GitHub Secrets 中配置 `APPLE_ID` 和 `APPLE_PASSWORD`
   - 使用 `xcrun altool` 上传到 TestFlight（需 Apple Developer Program）

### 优缺点
- ✅ 无需拥有 Mac
- ✅ 可 CI 自动化（模拟器版本）
- ✅ 适合持续开发
- ❌ 云 Mac 有网络延迟
- ❌ 真机签名仍需 Apple Developer Program

---

## 方案 C：Apple Developer Program（正式发布）

### 前置条件
- Apple Developer Program 会员（$99/年）
- 注册地址：https://developer.apple.com/programs/

### 注册流程

1. **使用你的 Apple ID 登录** https://developer.apple.com/programs/
2. **点击 Join the Apple Developer Program**
3. **完成个人信息填写**（需真实姓名、地址）
4. **支付年费** $99（支持支付宝/微信）
5. **等待审核**（通常 1-2 个工作日）

### 配置 CI 自动签名

1. **创建签名证书**
   - Apple Developer → Certificates, IDs & Profiles → 创建 Development Certificate
   - 下载 .cer 文件，导入 Keychain

2. **创建 Provisioning Profile**
   - 注册 App ID: `com.corps.desktop`
   - 创建 Provisioning Profile（Development）
   - 下载 .mobileprovision 文件

3. **配置 GitHub Secrets**
   ```
   APPLE_DEVELOPMENT_TEAM=你的Team ID
   APPLE_CERTIFICATE_DATA=base64编码的.p12文件
   APPLE_CERTIFICATE_PASSWORD=.p12密码
   APPLE_PROVISIONING_PROFILE=base64编码的.mobileprovision文件
   ```

4. **修改 CI workflow**
   ```yaml
   - name: Build iOS (signed)
     env:
       APPLE_DEVELOPMENT_TEAM: ${{ secrets.APPLE_DEVELOPMENT_TEAM }}
     run: |
       # 导入证书和 Profile
       # 构建
       npx tauri ios build
   ```

### 优缺点
- ✅ 签名有效期 1 年
- ✅ CI 全自动化
- ✅ 可上架 App Store
- ✅ 推送通知 (APNs) 可用
- ✅ TestFlight 内测分发
- ❌ 年费 $99
- ❌ 注册需审核

---

## 推荐路径

```
快速验证 → 方案 A（借 Mac）
持续开发 → 方案 B（GitHub Actions macOS runner，模拟器版本）
正式发布 → 方案 C（Apple Developer Program）
```

### 分阶段建议

1. **现在**：用方案 A 在朋友的 Mac 上构建模拟器版本，验证 WebView 加载和基本功能
2. **1-2 周后**：如果移动端验证通过，注册 Apple Developer Program（方案 C）
3. **正式发布前**：配置 CI 自动签名，启用 TestFlight 内测分发

---

## 当前 CI 状态

| 平台 | 状态 | 产物 |
|------|------|------|
| Android | ✅ 成功 | `app-universal-release-unsigned.apk` (26MB) |
| iOS | ⚠️ 签名失败 | 无产物（需 Apple Developer Team） |
| HarmonyOS | ✅ 验证通过 | 项目结构完整 |

## 相关文件

- `.github/workflows/mobile-build.yml` — 三端 CI 工作流
- `desktop/docs/mobile-push-setup.md` — 推送通知集成指南
- `desktop/docs/ios-sideload-guide.md` — Sideloadly 签名指南
- `desktop/src-tauri/tauri.ios.conf.json` — iOS Tauri 配置