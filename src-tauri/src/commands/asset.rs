use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Resolves the given directory roots, preferring their canonical form.
///
/// Unlike a strict `canonicalize`-and-skip, directories that do not exist yet
/// are still returned as-is. This matters for the thumbnail directory: it is
/// created lazily (by the first thumbnail generation) *after* the initial scope
/// registration, and if we dropped the path here the asset protocol would never
/// allow it (403 on every thumbnail). Keeping the raw path lets it match once
/// the directory (and its files) come into existence.
pub fn canonical_roots(paths: Vec<String>) -> Vec<PathBuf> {
    paths
        .into_iter()
        .map(PathBuf::from)
        .map(|p| match p.canonicalize() {
            Ok(c) => c,
            Err(_) => p,
        })
        .collect()
}

/// Registers directory roots in the asset protocol scope so their files can be
/// served to the WebView via `asset://` (convertFileSrc) URLs.
#[tauri::command]
pub fn register_asset_scope(app: AppHandle, paths: Vec<String>) -> Result<usize, String> {
    let roots = canonical_roots(paths);
    let scope = app.asset_protocol_scope();
    for root in &roots {
        scope
            .allow_directory(root, true)
            .map_err(|e| format!("Failed to allow {}: {}", root.display(), e))?;
    }
    Ok(roots.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn canonical_roots_keeps_existing_directories() {
        let dir = tempdir().unwrap();
        let existing = dir.path().to_string_lossy().to_string();
        let missing = dir.path().join("nope").to_string_lossy().to_string();
        let roots = canonical_roots(vec![existing, missing.clone()]);
        // The existing dir is canonicalized; the missing one is kept as-is (it
        // may be created after registration, e.g. the thumbnail directory).
        assert_eq!(roots.len(), 2);
        assert_eq!(roots[0], dir.path().canonicalize().unwrap());
        assert_eq!(roots[1], PathBuf::from(&missing));
    }

    #[test]
    fn canonical_roots_is_empty_for_no_input() {
        assert!(canonical_roots(vec![]).is_empty());
    }
}
