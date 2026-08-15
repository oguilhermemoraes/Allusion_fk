pub mod color;
pub mod commands;
pub mod services;

use services::watcher::FolderWatcherState;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You are running Allusion Next on Tauri 2!", name)
}

/// Shows the main window once the frontend finished loading the initial files.
/// The window is created with `visible: false` so the user never sees the
/// white flash, the frameless-window resize, or the window-state position
/// restore (all happen while the window is still hidden).
#[tauri::command]
fn app_initialized(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(FolderWatcherState::new())
        .setup(|app| {
            // Safety net: the main window is created with `visible: false` and the
            // frontend reveals it via `app_initialized` once the initial files are
            // loaded. If the frontend fails, errors out, or never boots, this timer
            // guarantees the window still appears instead of an invisible hang.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(15)).await;
                if let Some(window) = handle.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                }
            });
            Ok(())
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            app_initialized,
            commands::watcher::watch_folder,
            commands::watcher::unwatch_folder,
            commands::fs::get_file_info,
            commands::fs::read_directory_files,
            commands::fs::write_file,
            commands::fs::read_file,
            commands::fs::copy_file,
            commands::fs::move_file,
            commands::fs::ensure_dir,
            commands::fs::ensure_file,
            commands::fs::remove_path,
            commands::fs::move_to_trash,
            commands::fs::open_external,
            commands::fs::reveal_in_dir,
            commands::fs::create_folder,
            commands::fs::rename_path,
            commands::fs::get_app_data_dir,
            commands::fs::get_path,
            commands::image::get_image_dimensions,
            commands::image::copy_image_to_clipboard,
            commands::window::window_minimize,
            commands::window::window_toggle_maximize,
            commands::window::window_close,
            commands::window::open_devtools,
            commands::exif::read_exif_metadata,
            commands::exr::decode_exr_image,
            commands::masonry::compute_masonry_horizontal,
            commands::masonry::compute_masonry_vertical,
            commands::masonry::compute_masonry_grid,
            commands::scanner::scan_library,
            commands::asset::register_asset_scope,
            commands::thumbnail::generate_thumbnail,
            commands::duplicates::compute_image_hash,
            commands::duplicates::find_duplicate_images,
            commands::palette::extract_palette
        ])
        .run(tauri::generate_context!())
        .expect("error while running allusion tauri application");
}
