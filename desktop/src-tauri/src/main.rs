// Corps 桌面端入口（Tauri v2）
//
// 功能：
//   1. 单实例锁 —— 第二实例启动时聚焦已有主窗口
//   2. 系统托盘 —— 最小化到托盘 + 右键菜单（显示/退出）
//   3. 全局快捷键 —— Ctrl+Shift+C 唤起主窗口
//   4. 深色/浅色主题 —— 跟随系统主题
//
// 仅 Windows / macOS / Linux 三端通用代码，无平台条件编译分支。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const SHOW_LABEL: &str = "显示窗口";
const QUIT_LABEL: &str = "退出";
const HIDE_LABEL: &str = "隐藏到托盘";

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
                    "quit" => app.exit(0),
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