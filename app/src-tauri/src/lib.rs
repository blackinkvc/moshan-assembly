// 墨山 · 装配台 —— Tauri 外壳
//
// 壳层只做「网页做不到的事」：原生窗口与菜单、本地状态、打开数据目录。
// 业务与界面全在前端，壳不掺和。

use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager};

#[derive(Serialize)]
struct AppInfo {
    version: String,
    platform: String,
    data_dir: String,
    theme: String,
}

/// 状态文件放在 macOS 的 Application Support 下，跟 localStorage 不是一回事：
/// 用户换 WebView 版本、清缓存都不会丢。
fn state_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

#[tauri::command]
fn store_read(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let p = state_file(&app)?;
    if !p.exists() {
        return Ok(serde_json::Value::Null);
    }
    let raw = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
fn store_write(app: tauri::AppHandle, value: serde_json::Value) -> Result<(), String> {
    let p = state_file(&app)?;
    // 先写临时文件再改名：写到一半被杀掉也不会留下半个 JSON 把草稿全废掉。
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string(&value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, window: tauri::Window) -> Result<AppInfo, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let theme = match window.theme() {
        Ok(tauri::Theme::Dark) => "dark",
        _ => "light",
    };
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        data_dir: dir.to_string_lossy().to_string(),
        theme: theme.to_string(),
    })
}

/// 让前端能主动把数据目录亮出来（「在访达中显示」）。
#[tauri::command]
fn reveal_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

/// 存文件（打包下载走这里）。
/// WebView 里 `<a download>` 不可靠——Tauri 的 WebView 拦 blob 下载时是静默的，
/// 用户点了没反应也看不到错误。所以字节从 Rust 侧落盘，并且把路径回给前端显示。
#[tauri::command]
fn save_file(app: tauri::AppHandle, name: String, bytes: Vec<u8>) -> Result<String, String> {
    // 只取最后一段文件名，挡住 "../../.zshrc" 这种
    let safe = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("download")
        .trim()
        .to_string();
    let safe = if safe.is_empty() { "download".to_string() } else { safe };

    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // 不覆盖同名文件：xxx.zip → xxx-2.zip → xxx-3.zip
    let (stem, ext) = match safe.rfind('.') {
        Some(i) if i > 0 => (safe[..i].to_string(), safe[i..].to_string()),
        _ => (safe.clone(), String::new()),
    };
    let mut path = dir.join(&safe);
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{}-{}{}", stem, n, ext));
        n += 1;
        if n > 999 {
            return Err("同名文件太多".into());
        }
    }

    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    let mk = |id: &str, text: &str, acc: Option<&str>| -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
        let mut b = MenuItemBuilder::with_id(id, text);
        if let Some(a) = acc {
            b = b.accelerator(a);
        }
        b.build(app)
    };

    let app_menu = SubmenuBuilder::new(app, "墨山装配台")
        .item(&PredefinedMenuItem::about(app, Some("关于墨山装配台"), None)?)
        .separator()
        .item(&mk("prefs", "偏好设置…", Some("CmdOrCtrl+,"))?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "文件")
        .item(&mk("new", "新建装配", Some("CmdOrCtrl+N"))?)
        .item(&mk("open", "打开草稿箱", Some("CmdOrCtrl+O"))?)
        .separator()
        .item(&mk("save", "保存草稿", Some("CmdOrCtrl+S"))?)
        .item(&mk("export", "导出方案…", Some("CmdOrCtrl+Shift+E"))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "视图")
        .item(&mk("reload", "重新载入", Some("CmdOrCtrl+Shift+R"))?)
        .separator()
        .item(&mk("actual", "实际大小", Some("CmdOrCtrl+0"))?)
        .item(&mk("zoomin", "放大", Some("CmdOrCtrl+Plus"))?)
        .item(&mk("zoomout", "缩小", Some("CmdOrCtrl+-"))?)
        .separator()
        .item(&mk("toggle-theme", "切换深浅色", Some("CmdOrCtrl+Shift+L"))?)
        .item(&mk("toggle-sidebar", "收起侧栏", Some("CmdOrCtrl+Shift+S"))?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "窗口")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&mk("welcome", "回到工作台", Some("CmdOrCtrl+1"))?)
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "帮助")
        .item(&mk("help", "怎么用", Some("CmdOrCtrl+/"))?)
        .item(&mk("reveal", "在访达中显示数据目录", None)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            build_menu(app.handle())?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            // 菜单只是「另一个入口」，动作全在前端，避免两套逻辑。
            let id = event.id().0.clone();
            let _ = app.emit("menu", id);
        })
        .invoke_handler(tauri::generate_handler![
            store_read,
            store_write,
            app_info,
            reveal_data_dir,
            save_file
        ])
        .run(tauri::generate_context!())
        .expect("墨山装配台启动失败");
}
