use crate::services::watcher::FolderWatcherState;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn watch_folder(
    app_handle: AppHandle,
    state: State<'_, FolderWatcherState>,
    path: String,
) -> Result<(), String> {
    state.watch(app_handle, path)
}

#[tauri::command]
pub fn unwatch_folder(
    state: State<'_, FolderWatcherState>,
    path: String,
) -> Result<(), String> {
    state.unwatch(path)
}
