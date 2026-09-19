// Corps 应用库入口（桌面端 + 移动端共享）
//
// 桌面端：main.rs 调用 lib::run()，附加 sidecar/托盘/全局快捷键等桌面特有功能
// 移动端：Android/iOS 平台入口调用 lib::run()，仅基础 WebView + 远程 URL
//
// 移动端架构：WebView → 远程 Next.js 服务器（https://corps.com）
// 桌面端架构：WebView → 本地 Node.js sidecar（127.0.0.1:3000）

use tauri::Manager;

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const APP_IDENTIFIER: &str = "com.corps.desktop";

/// 移动端入口：基础 Tauri 应用（无 sidecar/托盘/快捷键）
///
/// 桌面端特有的功能（sidecar、系统托盘、全局快捷键、单实例锁）
/// 在 main.rs 中通过 cfg(desktop) 条件编译附加。
#[cfg(mobile)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 跟随系统主题
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_theme(None);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Corps mobile application");
}

/// 桌面端共享入口占位
///
/// 桌面端的实际入口在 main.rs 中，此处仅提供常量供桌面端引用。
#[cfg(not(mobile))]
pub fn run() {
    // 桌面端入口在 main.rs::main() 中直接构建
    // 此函数在桌面端不会被调用
}
