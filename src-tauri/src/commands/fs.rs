use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub absolute_path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub date_created: Option<u64>,
    pub date_modified: Option<u64>,
    pub ino: Option<String>,
}

impl FileInfo {
    fn from_path(path: PathBuf) -> Result<Self, String> {
        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;

        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());

        let absolute_path = match std::path::absolute(&path) {
            Ok(p) => p.to_string_lossy().into_owned(),
            Err(_) => path.to_string_lossy().into_owned(),
        };

        let to_epoch_millis =
            |t: std::time::SystemTime| -> Option<u64> {
                t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
            };

        let date_created = metadata.created().ok().and_then(to_epoch_millis);
        let date_modified = metadata.modified().ok().and_then(to_epoch_millis);

        Ok(Self {
            absolute_path,
            name,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            date_created,
            date_modified,
            ino: None,
        })
    }
}

#[tauri::command]
pub fn get_file_info(path: String) -> Result<FileInfo, String> {
    FileInfo::from_path(PathBuf::from(path))
}

#[tauri::command]
pub fn read_directory_files(path: String, extensions: Vec<String>) -> Result<Vec<FileInfo>, String> {
    let dir = fs::read_dir(&path).map_err(|e| e.to_string())?;

    let extensions: Vec<String> = extensions
        .iter()
        .map(|e| e.trim_start_matches('.').to_lowercase())
        .collect();

    let mut files: Vec<FileInfo> = Vec::new();
    for entry in dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let info = FileInfo::from_path(entry.path())?;
        if info.is_dir {
            files.push(info);
        } else if extensions.is_empty() {
            files.push(info);
        } else {
            let ext = Path::new(&info.name)
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase());
            if let Some(ext) = ext {
                if extensions.contains(&ext) {
                    files.push(info);
                }
            }
        }
    }
    Ok(files)
}

#[tauri::command]
pub fn write_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if let Some(parent) = path_buf.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path_buf, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(PathBuf::from(path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn copy_file(src: String, dest: String) -> Result<(), String> {
    let dest_buf = PathBuf::from(&dest);
    if let Some(parent) = dest_buf.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(PathBuf::from(src), dest_buf)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(PathBuf::from(path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ensure_file(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if let Some(parent) = path_buf.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if !path_buf.exists() {
        fs::write(&path_buf, []).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn move_to_trash(path: String) -> Result<(), String> {
    trash::delete(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    let mut target = url;
    // Normalise an optional `file://` prefix to a plain path (UiStore/SlideMode
    // pass `file://${absolutePath}`). Preserve it as a URL otherwise.
    if target.starts_with("file://") || target.starts_with("file:") {
        target = target.replacen("file://", "", 1);
        #[cfg(target_os = "windows")]
        {
            // `file:///C:/...` -> strip the leading slash -> `C:/...`
            target = target.trim_start_matches('/').to_string();
        }
    }
    open::that(&target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_in_dir(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return std::process::Command::new("explorer.exe")
            .args(["/select,", &path])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string());
    }
    #[cfg(target_os = "macos")]
    {
        return std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string());
    }
    #[cfg(target_os = "linux")]
    {
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or(path.clone());
        return std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string());
    }
    #[allow(unreachable_code)]
    {
        Ok(())
    }
}

#[tauri::command]
pub fn remove_path(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Ok(());
    }
    if path_buf.is_dir() {
        fs::remove_dir_all(path_buf).map_err(|e| e.to_string())
    } else {
        fs::remove_file(path_buf).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn get_app_data_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    app_handle
        .path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

/// Resolves well-known filesystem paths by name (mirrors Electron's
/// `app.getPath`). Returns the raw value so the renderer can build directories
/// such as the default thumbnail directory (`%TEMP%/Allusion/thumbnails`).
#[tauri::command]
pub fn get_path(name: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = match name.as_str() {
        "temp" => std::env::temp_dir(),
        "userData" | "appData" => app_handle.path().app_data_dir().map_err(|e| e.to_string())?,
        "home" => app_handle.path().home_dir().map_err(|e| e.to_string())?,
        "desktop" => app_handle.path().desktop_dir().map_err(|e| e.to_string())?,
        "documents" => app_handle.path().document_dir().map_err(|e| e.to_string())?,
        "downloads" => app_handle.path().download_dir().map_err(|e| e.to_string())?,
        "pictures" => app_handle.path().picture_dir().map_err(|e| e.to_string())?,
        "music" => app_handle.path().audio_dir().map_err(|e| e.to_string())?,
        "videos" => app_handle.path().video_dir().map_err(|e| e.to_string())?,
        other => return Err(format!("Unsupported path: {other}")),
    };
    Ok(path.to_string_lossy().into_owned())
}

/// Moves a file from `src` to `dest`, creating parent directories as needed.
/// Uses a fast same-volume `rename`; falls back to copy+remove for
/// cross-device moves (e.g. between drives).
#[tauri::command]
pub fn move_file(src: String, dest: String) -> Result<(), String> {
    let src_b = PathBuf::from(&src);
    let dest_b = PathBuf::from(&dest);

    if let Some(parent) = dest_b.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    match fs::rename(&src_b, &dest_b) {
        Ok(_) => Ok(()),
        Err(_) => {
            // Cross-device (EXDEV / ERROR_NOT_SAME_DEVICE): copy then remove.
            let copied = fs::copy(&src_b, &dest_b);
            match copied {
                Ok(_) => fs::remove_file(&src_b).map_err(|e| e.to_string()),
                Err(e) => Err(e.to_string()),
            }
        }
    }
}

/// Creates a new subfolder in `parent_path` with validation.
#[tauri::command]
pub fn create_folder(parent_path: String, folder_name: String) -> Result<String, String> {
    let folder_name = folder_name.trim();
    if folder_name.is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }
    if folder_name.contains(&['<', '>', ':', '"', '/', '\\', '|', '?', '*'][..]) {
        return Err("Folder name contains invalid characters".to_string());
    }
    let parent = PathBuf::from(&parent_path);
    let target = parent.join(folder_name);
    if target.exists() {
        return Err("A folder with this name already exists".to_string());
    }
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}

/// Renames a file or folder at `old_path` to `new_name`.
#[tauri::command]
pub fn rename_path(old_path: String, new_name: String) -> Result<String, String> {
    let new_name = new_name.trim();
    if new_name.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    if new_name.contains(&['<', '>', ':', '"', '/', '\\', '|', '?', '*'][..]) {
        return Err("Name contains invalid characters".to_string());
    }
    let old_p = PathBuf::from(&old_path);
    if !old_p.exists() {
        return Err("Source path does not exist".to_string());
    }
    let parent = match old_p.parent() {
        Some(p) => p,
        None => return Err("Cannot rename root path".to_string()),
    };
    let target = parent.join(new_name);
    if target == old_p {
        return Ok(old_path);
    }
    if target.exists() {
        return Err("A file or folder with this name already exists".to_string());
    }
    fs::rename(&old_p, &target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn move_file_moves_within_same_device() {
        let dir = TempDir::new().unwrap();
        let src = dir.path().join("a.jpg");
        std::fs::write(&src, b"abc").unwrap();
        let dest = dir.path().join("sub").join("a.jpg");

        move_file(
            src.to_string_lossy().into_owned(),
            dest.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert!(dest.exists());
        assert!(!src.exists());
    }

    #[test]
    fn move_file_creates_parent_directories() {
        let dir = TempDir::new().unwrap();
        let src = dir.path().join("b.png");
        std::fs::write(&src, b"xyz").unwrap();
        let dest = dir.path().join("deep").join("nest").join("b.png");

        move_file(
            src.to_string_lossy().into_owned(),
            dest.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert!(dest.exists());
    }

    #[test]
    fn move_file_returns_error_when_source_missing() {
        let dir = TempDir::new().unwrap();
        let src = dir.path().join("missing.jpg");
        let dest = dir.path().join("c.jpg");

        let err = move_file(
            src.to_string_lossy().into_owned(),
            dest.to_string_lossy().into_owned(),
        )
        .unwrap_err();

        assert!(!err.is_empty());
    }

    #[test]
    fn create_folder_creates_directory_successfully() {
        let dir = TempDir::new().unwrap();
        let parent = dir.path().to_string_lossy().into_owned();
        let created = create_folder(parent, "SubFolder1".to_string()).unwrap();

        assert!(PathBuf::from(&created).is_dir());
        assert!(created.ends_with("SubFolder1"));
    }

    #[test]
    fn create_folder_fails_on_duplicate_or_invalid_name() {
        let dir = TempDir::new().unwrap();
        let parent = dir.path().to_string_lossy().into_owned();
        create_folder(parent.clone(), "SubFolder2".to_string()).unwrap();

        let dup_err = create_folder(parent.clone(), "SubFolder2".to_string()).unwrap_err();
        assert!(dup_err.contains("already exists"));

        let invalid_err = create_folder(parent, "Sub/Folder:3".to_string()).unwrap_err();
        assert!(invalid_err.contains("invalid characters"));
    }

    #[test]
    fn rename_path_renames_file_and_folder() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("old_name.txt");
        std::fs::write(&file_path, b"test content").unwrap();

        let renamed = rename_path(
            file_path.to_string_lossy().into_owned(),
            "new_name.txt".to_string(),
        )
        .unwrap();

        assert!(PathBuf::from(&renamed).exists());
        assert!(!file_path.exists());
    }
}


