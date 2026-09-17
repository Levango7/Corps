// Corps 桌面端库入口（移动端 / 桌面端共享逻辑预留）
//
// 当前所有桌面端逻辑在 main.rs 中，此文件保留为 lib 目标占位，
// 便于后续抽取共享命令或被移动端 target 复用。

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const APP_IDENTIFIER: &str = "com.corps.desktop";