use crate::services::scanner::{scan_directory, ScannedFile};

#[tauri::command]
pub fn scan_library(
    path: String,
    extensions: Option<Vec<String>>,
) -> Result<Vec<ScannedFile>, String> {
    scan_directory(path, extensions)
}
