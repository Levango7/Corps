// Corps 桌面端入口（Tauri v2）
//
// 功能：
//   1. 单实例锁 —— 第二实例启动时聚焦已有主窗口
//   2. 系统托盘 —— 最小化到托盘 + 右键菜单（显示/退出）
//   3. 全局快捷键 —— Ctrl+Shift+C 唤起主窗口
//   4. 深色/浅色主题 —— 跟随系统主题
//   5. Sidecar —— 生产模式下启动内嵌 Next.js standalone server 子进程
//
// 仅 Windows / macOS / Linux 三端通用代码，无平台条件编译分支。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const SHOW_LABEL: &str = "显示窗口";
const QUIT_LABEL: &str = "退出";
const HIDE_LABEL: &str = "隐藏到托盘";

/// Sidecar 子进程状态：包装 Next.js standalone server 的子进程句柄。
/// 使用 Mutex<Option<Child>> 以满足 Send + Sync 要求（Child 仅 Send 非 Sync）。
/// take() 取出后置 None，确保 kill 只执行一次。
struct SidecarState(Mutex<Option<Child>>);

/// 终止 sidecar 子进程（如果存在且尚未终止）。
/// 在应用真正退出时调用（quit_app 命令 / 托盘"退出"菜单）。
/// CloseRequested 时不调用 —— 此时仅隐藏窗口到托盘，保持 server 运行。
fn kill_sidecar(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait(); // 回收僵尸进程，避免资源泄漏
            }
        }
    }
}

/// 构建系统托盘菜单：显示 / 隐藏 / 分隔 / 退出
fn build_tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(app, "show", SHOW_LABEL, true, None)?;
    let hide = MenuItem::with_id(app, "hide", HIDE_LABEL, true, None)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", QUIT_LABEL, true, None)?;
    Menu::with_items(app, &[&show, &hide, &sep, &quit])
}

/// 显示主窗口（取消最小化 + 聚焦）
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 隐藏主窗口到托盘
fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

/// 切换主窗口可见性（托盘左键点击用）
fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            show_main_window(app);
        }
    }
}

#[tauri::command]
fn toggle_window(app: tauri::AppHandle) {
    toggle_main_window(&app);
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    // 终止 sidecar 子进程（Next.js standalone server）
    kill_sidecar(&app);
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // ─── 单实例锁 ──────────────────────────────────────────
        // 第二实例启动时：不创建新窗口，直接聚焦已有主窗口。
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .setup(|app| {
            // ─── Sidecar: 启动 Next.js standalone server ──────────────
            // 生产模式下启动内嵌的 Node.js standalone server，
            // 开发模式下由 beforeDevCommand 启动 pnpm dev，无需此处启动。
            #[cfg(not(debug_assertions))]
            {
                let resource_path = app.path().resource_dir()?;
                let server_path = resource_path.join("standalone").join("server.js");

                // 检查 server.js 是否存在；缺失时弹出错误对话框并中止启动（不 panic）
                if !server_path.exists() {
                    app.dialog()
                        .message(format!(
                            "未找到内嵌服务文件：\n{}\n\n请重新安装应用或联系技术支持。",
                            server_path.display()
                        ))
                        .title("Corps 启动失败")
                        .blocking_show();
                    return Err(format!(
                        "Sidecar server.js not found: {}",
                        server_path.display()
                    )
                    .into());
                }

                // 启动 Next.js standalone server，传递生产环境变量
                let child = match Command::new("node")
                    .arg(&server_path)
                    .env("PORT", "3000")
                    .env("HOSTNAME", "127.0.0.1")
                    .env("NODE_ENV", "production")
                    .spawn()
                {
                    Ok(c) => c,
                    Err(e) => {
                        app.dialog()
                            .message(format!(
                                "启动内嵌服务失败：\n{e}\n\n请确保系统已安装 Node.js 运行时。"
                            ))
                            .title("Corps 启动失败")
                            .blocking_show();
                        return Err(e.into());
                    }
                };

                // 存储子进程句柄，退出时终止
                app.manage(SidecarState(Mutex::new(Some(child))));

                // ─── 健康检查：等待 server 就绪后导航 webview ──────────
                // 单独线程轮询 127.0.0.1:3000，最多重试 30 次（每次 500ms），
                // 就绪后通过 window.eval 将 webview 跳转到本地服务地址。
                let app_handle = app.handle().clone();
                thread::spawn(move || {
                    for _ in 0..30 {
                        if TcpStream::connect("127.0.0.1:3000").is_ok() {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window
                                    .eval("window.location.href = 'http://127.0.0.1:3000';");
                            }
                            return;
                        }
                        thread::sleep(Duration::from_millis(500));
                    }
                    // 30 次重试仍未就绪：在 webview 中提示用户
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.eval(
                            "document.body.innerHTML = \
                             '<h2>服务启动超时</h2>\
                             <p>内嵌服务未能在预期时间内就绪，请重启应用或联系技术支持。</p>';",
                        );
                    }
                });
            }

            // 开发模式下也注册空的 SidecarState，使 try_state::<SidecarState>() 始终可用
            #[cfg(debug_assertions)]
            {
                app.manage(SidecarState(Mutex::new(None)));
            }

            // ─── 系统托盘 ──────────────────────────────────────
            let menu = build_tray_menu(app.handle())?;
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    // 左键单击：切换窗口可见性
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "hide" => hide_main_window(app),
                    "quit" => {
                        // 终止 sidecar 子进程后退出应用
                        kill_sidecar(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // ─── 全局快捷键 Ctrl+Shift+C 唤起窗口 ─────────────
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyC);
            app.global_shortcut().on_shortcut(shortcut, move |app, _sc, event| {
                if event.state == ShortcutState::Pressed {
                    show_main_window(app);
                }
            })?;

            // ─── 跟随系统主题 ──────────────────────────────────
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_theme(None);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![toggle_window, quit_app])
        // ─── 拦截窗口关闭：最小化到托盘而非退出 ────────────────
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 阻止默认关闭，改为隐藏到托盘
                api.prevent_close!();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Corps desktop application");
}