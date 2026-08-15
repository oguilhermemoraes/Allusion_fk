use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ScannedFile {
    pub absolute_path: String,
    pub size: u64,
    pub date_modified: u64,
    pub date_created: u64,
    pub ino: String,
}

/// Concurrently scans a directory for files matching specified extensions.
pub fn scan_directory<P: AsRef<Path>>(
    root: P,
    extensions: Option<Vec<String>>,
) -> Result<Vec<ScannedFile>, String> {
    let root_path = root.as_ref();
    if !root_path.exists() {
        return Err(format!("Path does not exist: {}", root_path.display()));
    }

    let ext_set: Option<Vec<String>> = extensions.map(|exts| {
        exts.into_iter()
            .map(|e| e.trim_start_matches('.').to_lowercase())
            .collect()
    });

    let entries: Vec<_> = WalkDir::new(root_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .collect();

    let scanned_files: Vec<ScannedFile> = entries
        .into_par_iter()
        .filter_map(|entry| {
            let path = entry.path();

            if let Some(ref exts) = ext_set {
                if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                    if !exts.contains(&ext.to_lowercase()) {
                        return None;
                    }
                } else {
                    return None;
                }
            }

            let metadata = entry.metadata().ok()?;
            let absolute_path = path.to_string_lossy().to_string();

            let size = metadata.len();
            let date_modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            let date_created = metadata
                .created()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(date_modified);

            #[cfg(target_os = "windows")]
            let ino = absolute_path.clone();

            #[cfg(not(target_os = "windows"))]
            let ino = {
                use std::os::unix::fs::MetadataExt;
                metadata.ino().to_string()
            };

            Some(ScannedFile {
                absolute_path,
                size,
                date_modified,
                date_created,
                ino,
            })
        })
        .collect();

    Ok(scanned_files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn scans_directory_with_extension_filter() {
        let dir = tempfile::tempdir().unwrap();
        let path_png = dir.path().join("image1.png");
        let path_jpg = dir.path().join("image2.jpg");
        let path_txt = dir.path().join("doc.txt");

        File::create(&path_png).unwrap().write_all(b"png").unwrap();
        File::create(&path_jpg).unwrap().write_all(b"jpg").unwrap();
        File::create(&path_txt).unwrap().write_all(b"txt").unwrap();

        let scanned = scan_directory(dir.path(), Some(vec!["png".to_string(), "jpg".to_string()])).unwrap();
        assert_eq!(scanned.len(), 2);

        let paths: Vec<String> = scanned.into_iter().map(|f| f.absolute_path).collect();
        assert!(paths.contains(&path_png.to_string_lossy().to_string()));
        assert!(paths.contains(&path_jpg.to_string_lossy().to_string()));
    }

    #[test]
    fn returns_error_for_non_existent_directory() {
        assert!(scan_directory("non/existent/dir/path", None).is_err());
    }
}
