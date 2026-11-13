use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::db::migrations::LATEST_SCHEMA_VERSION;
use crate::db::repo;
use crate::db::wire::{
    FileKeyField, FileWire, LocationWire, OrderByField, OrderDirectionWire, SavedSearchWire,
    SearchCriteriaWire, TagWire, WireValue,
};

const STREAM_CHUNK_SIZE: usize = 2_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInitInfo {
    pub migrated: bool,
    pub schema_version: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuerySummary {
    pub total_count: u64,
}

pub struct DbState {
    writer: Arc<Mutex<Connection>>,
    reader: Arc<Mutex<Connection>>,
}

impl DbState {
    pub fn open(db_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create database directory: {e}"))?;
        }
        let writer = crate::db::open_connection(&db_path)
            .map_err(|e| format!("Failed to open writer SQLite connection: {e}"))?;
        let reader = crate::db::open_connection(&db_path)
            .map_err(|e| format!("Failed to open reader SQLite connection: {e}"))?;
        Ok(Self {
            writer: Arc::new(Mutex::new(writer)),
            reader: Arc::new(Mutex::new(reader)),
        })
    }

    async fn with_reader<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
        T: Send + 'static,
    {
        let reader = Arc::clone(&self.reader);
        tauri::async_runtime::spawn_blocking(move || {
            let conn = reader
                .lock()
                .map_err(|_| "Reader SQLite mutex poisoned".to_string())?;
            f(&conn)
        })
        .await
        .map_err(|e| format!("Database reader task failed: {e}"))?
    }

    async fn with_writer<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
        T: Send + 'static,
    {
        let writer = Arc::clone(&self.writer);
        tauri::async_runtime::spawn_blocking(move || {
            let conn = writer
                .lock()
                .map_err(|_| "Writer SQLite mutex poisoned".to_string())?;
            f(&conn)
        })
        .await
        .map_err(|e| format!("Database writer task failed: {e}"))?
    }
}

fn stream_files(files: Vec<FileWire>, on_chunk: &Channel<Vec<FileWire>>) -> Result<QuerySummary, String> {
    let total_count = files.len() as u64;
    for chunk in files.chunks(STREAM_CHUNK_SIZE) {
        on_chunk
            .send(chunk.to_vec())
            .map_err(|e| format!("Failed to stream file chunk: {e}"))?;
    }
    Ok(QuerySummary { total_count })
}

#[tauri::command]
pub async fn db_init(state: State<'_, DbState>) -> Result<DbInitInfo, String> {
    state
        .with_writer(|conn| {
            repo::ensure_root_tag(conn).map_err(|e| e.to_string())?;
            let schema_version: u32 = conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .unwrap_or(LATEST_SCHEMA_VERSION);
            Ok(DbInitInfo {
                migrated: false,
                schema_version,
            })
        })
        .await
}

#[tauri::command]
pub async fn db_fetch_tags(state: State<'_, DbState>) -> Result<Vec<TagWire>, String> {
    state
        .with_reader(|conn| repo::fetch_tags(conn).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn db_fetch_files(
    state: State<'_, DbState>,
    order: OrderByField,
    direction: OrderDirectionWire,
    on_chunk: Channel<Vec<FileWire>>,
) -> Result<QuerySummary, String> {
    state
        .with_reader(move |conn| {
            let files = repo::fetch_files(conn, order, direction, None, None)
                .map_err(|e| e.to_string())?;
            stream_files(files, &on_chunk)
        })
        .await
}

#[tauri::command]
pub async fn db_fetch_files_by_id(
    state: State<'_, DbState>,
    ids: Vec<String>,
) -> Result<Vec<FileWire>, String> {
    state
        .with_reader(move |conn| repo::fetch_files_by_id(conn, &ids).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn db_fetch_files_by_key(
    state: State<'_, DbState>,
    key: FileKeyField,
    value: WireValue,
) -> Result<Vec<FileWire>, String> {
    state
        .with_reader(move |conn| {
            repo::fetch_files_by_key(conn, key, &value).map_err(|e| e.to_string())
        })
        .await
}

#[tauri::command]
pub async fn db_fetch_locations(state: State<'_, DbState>) -> Result<Vec<LocationWire>, String> {
    state
        .with_reader(|conn| repo::fetch_locations(conn).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn db_fetch_searches(state: State<'_, DbState>) -> Result<Vec<SavedSearchWire>, String> {
    state
        .with_reader(|conn| repo::fetch_searches(conn).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn db_search_files(
    state: State<'_, DbState>,
    criteria: Vec<SearchCriteriaWire>,
    order: OrderByField,
    direction: OrderDirectionWire,
    match_any: bool,
    on_chunk: Channel<Vec<FileWire>>,
) -> Result<QuerySummary, String> {
    state
        .with_reader(move |conn| {
            let files = repo::search_files(conn, &criteria, order, direction, match_any, None, None)
                .map_err(|e| e.to_string())?;
            stream_files(files, &on_chunk)
        })
        .await
}

#[tauri::command]
pub async fn db_create_tag(state: State<'_, DbState>, tag: TagWire) -> Result<(), String> {
    state
        .with_writer(move |conn| repo::create_tag(conn, &tag).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn db_create_files_from_path(
    state: State<'_, DbState>,
    path: String,
    files: Vec<FileWire>,
) -> Result<(), String> {
    state
        .with_writer(move |conn| {
            repo::create_files_from_path(conn, &path, &files).map_err(|e| e.to_string())
        })
        .await
}

#[tauri::command]
pub async fn db_create_location(
    state: State<'_, DbState>,
    location: LocationWire,
) -> Result<(), String> {
    state
        .with_writer(move |conn| repo::create_location(conn, &location).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn db_create_search(
    state: State<'_, DbState>,
    search: SavedSearchWire,
) -> Result<(), String> {
    state
        .with_writer(move |conn| repo::create_search(conn, &search).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn db_save_tag(state: State<'_, DbState>, tag: TagWire) -> Result<(), String> {
    state
        .with_writer(move |conn| repo::save_tag(conn, &tag).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn db_save_files(
    state: State<'_, DbState>,
    files: Vec<FileWire>,
) -> Result<(), String> {
    state
        .with_writer(move |conn| repo::save_files(conn, &files).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn db_save_location(
    state: State<'_, DbState>,
    location: LocationWire,
) -> Result<(), String> {
    state
        .with_writer(move |conn| repo::save_location(conn, &location).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn db_save_search(
    state: State<'_, DbState>,
    search: SavedSearchWire,
) -> Result<(), String> {
    state
        .with_writer(move |conn| repo::save_search(conn, &search).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn db_remove_tags(state: State<'_, DbState>, tag_ids: Vec<String>) -> Result<(), String> {
    state
        .with_writer(move |conn| repo::remove_tags(conn, &tag_ids).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn db_merge_tags(
    state: State<'_, DbState>,
    tag_to_be_removed: String,
    tag_to_merge_with: String,
) -> Result<(), String> {
    state
        .with_writer(move |conn| {
            repo::merge_tags(conn, &tag_to_be_removed, &tag_to_merge_with)
                .map_err(|e| e.to_string())
        })
        .await
}

#[tauri::command]
pub async fn db_remove_files(
    state: State<'_, DbState>,
    file_ids: Vec<String>,
) -> Result<(), String> {
    state
        .with_writer(move |conn| repo::remove_files(conn, &file_ids).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn db_purge_unsupported_extensions(
    state: State<'_, DbState>,
    supported_extensions: Vec<String>,
) -> Result<u64, String> {
    state
        .with_writer(move |conn| {
            let refs: Vec<&str> = supported_extensions.iter().map(String::as_str).collect();
            repo::purge_unsupported_extensions(conn, &refs).map_err(|e| e.to_string())
        })
        .await
}

#[tauri::command]
pub async fn db_remove_location(
    state: State<'_, DbState>,
    location_id: String,
) -> Result<(), String> {
    state
        .with_writer(move |conn| repo::remove_location(conn, &location_id).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn db_remove_search(
    state: State<'_, DbState>,
    search_id: String,
) -> Result<(), String> {
    state
        .with_writer(move |conn| repo::remove_search(conn, &search_id).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn db_count_files(state: State<'_, DbState>) -> Result<(u64, u64), String> {
    state
        .with_reader(|conn| repo::count_files(conn).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn db_clear(state: State<'_, DbState>) -> Result<(), String> {
    state
        .with_writer(|conn| repo::clear(conn).map_err(|e| e.to_string()))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::wire::{FileColumn, SearchOperator, SearchValueType};
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn db_state_create_files_and_search_in_temp_dir() {
        let dir = tempdir().unwrap();
        let state = DbState::open(dir.path().join("allusion.db")).unwrap();

        let file = FileWire {
            id: "f1".to_string(),
            ino: "ino_1".to_string(),
            location_id: "loc_1".to_string(),
            relative_path: "dragon.png".to_string(),
            absolute_path: "c:/art/dragon.png".to_string(),
            tags: Vec::new(),
            size: 2048,
            width: 1920,
            height: 1080,
            date_added: 1_750_000_000_000,
            date_modified: 1_750_000_000_000,
            date_created: 1_750_000_000_000,
            date_last_indexed: 1_750_000_000_000,
            name: "dragon.png".to_string(),
            extension: "png".to_string(),
            description: Some("watercolor dragon".to_string()),
            rating: Some(5),
            duration: None,
            palette: None,
        };

        {
            let writer = state.writer.lock().unwrap();
            repo::create_files_from_path(&writer, "c:/art", &[file]).unwrap();
        }

        let results = {
            let reader = state.reader.lock().unwrap();
            repo::search_files(
                &reader,
                &[SearchCriteriaWire {
                    key: FileColumn::Description,
                    value_type: SearchValueType::String,
                    operator: SearchOperator::Contains,
                    value: json!("dragon"),
                }],
                OrderByField::Name,
                OrderDirectionWire::Asc,
                false,
                None,
                None,
            )
            .unwrap()
        };

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "f1");
        assert_eq!(results[0].absolute_path, "C:/art/dragon.png");
    }
}
