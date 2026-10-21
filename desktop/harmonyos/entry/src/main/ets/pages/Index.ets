import { webview } from '@kit.ArkWeb';

// Corps HarmonyOS 主页面
//
// 架构：ArkWeb WebView → 远程 Next.js 服务器（CORPS_WEB_URL 注入）
// 对应 Tauri 移动端：WebView → 远程 URL（同样由 CORPS_WEB_URL 注入）
// 对应 Tauri 桌面端：WebView → localhost:3000（内嵌 Node.js sidecar）

// 提交值 = 发货值：HarmonyOS 无法在标准 CI 构建（需 DevEco Studio），
// mobile-build.yml 只做结构校验，不会调用 prepare-mobile.mjs 覆盖这里。
// 因此下面的哨兵值不是"待替换的占位符"，而是**安全默认值**：
// .invalid 是 RFC 2606 保留 TLD，保证永不解析，绝不可能落到真实第三方站点。
// 出包前必须由 `CORPS_WEB_URL=... node scripts/prepare-mobile.mjs` 注入真实地址。
const CORPS_URL = 'https://REPLACE_ME.invalid';

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();

  aboutToAppear(): void {
    // 配置 WebView 允许加载远程内容
    webview.WebviewController.setWebDebuggingAccess(true);
  }

  build() {
    Column() {
      Web({ src: CORPS_URL, controller: this.controller })
        .domStorageAccess(true)
        .geolocationAccess(true)
        .fileAccess(true)
        .mixedMode(MixedMode.All)
        .javaScriptAccess(true)
        .imageAccess(true)
        .onlineImageAccess(true)
        .width('100%')
        .height('100%')
        .onPageBegin((e) => {
          // 页面开始加载
        })
        .onPageEnd((e) => {
          // 页面加载完成
        })
        .onErrorReceive((e) => {
          // 网络错误时显示离线提示
          if (e.error) {
            this.controller.loadData(
              `<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:sans-serif;color:#666;">
              <div style="text-align:center;">
              <h2>无法连接到服务器</h2>
              <p>请检查网络连接后重试</p>
              <p style="color:#999;font-size:14px;">${CORPS_URL}</p>
              </div></body></html>`,
              'text/html',
              'UTF-8'
            );
          }
        })
    }
    .width('100%')
    .height('100%')
  }
}