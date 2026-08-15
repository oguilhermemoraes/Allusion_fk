use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatcherEventPayload {
    pub path: String,
    pub kind: String, // "create", "modify", "remove"
}

pub struct FolderWatcherState {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

impl FolderWatcherState {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }

    pub fn watch(&self, app_handle: AppHandle, dir_path: String) -> Result<(), String> {
        let mut watchers = self.watchers.lock().map_err(|e| e.to_string())?;

        if watchers.contains_key(&dir_path) {
            return Ok(());
        }

        let app_handle_clone = app_handle.clone();
        let watched_dir = dir_path.clone();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| match res {
                Ok(event) => {
                    let kind = match event.kind {
                        EventKind::Create(_) => "create",
                        EventKind::Modify(_) => "modify",
                        EventKind::Remove(_) => "remove",
                        _ => return,
                    };

                    for path in event.paths {
                        let path_str = path.to_string_lossy().to_string();
                        let payload = WatcherEventPayload {
                            path: path_str,
                            kind: kind.to_string(),
                        };
                        let _ = app_handle_clone.emit("watcher-event", payload);
                    }
                }
                Err(e) => {
                    eprintln!("Watcher error for {}: {:?}", watched_dir, e);
                }
            },
            Config::default(),
        )
        .map_err(|e| e.to_string())?;

        watcher
            .watch(Path::new(&dir_path), RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;

        watchers.insert(dir_path, watcher);
        Ok(())
    }

    pub fn unwatch(&self, dir_path: String) -> Result<(), String> {
        let mut watchers = self.watchers.lock().map_err(|e| e.to_string())?;
        if let Some(mut watcher) = watchers.remove(&dir_path) {
            let _ = watcher.unwatch(Path::new(&dir_path));
        }
        Ok(())
    }
}
