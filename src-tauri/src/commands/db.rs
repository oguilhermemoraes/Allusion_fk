use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;

use crate::db::color::nearest_color_id;
use crate::db::migrations::{now_epoch_ms, LATEST_SCHEMA_VERSION};
use crate::db::normalize_drive_letter;
use crate::db::repo;
use crate::db::wire::{
    FileKeyField, FileWire, LocationWire, OrderByField, OrderDirectionWire, PaletteColorWire,
    SavedSearchWire, SearchCriteriaWire, SubLocationWire, TagWire, WireValue, ROOT_TAG_ID,
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

const META_MIGRATION_STATE: &str = "dexie_migration_state";
const META_MIGRATED_AT: &str = "dexie_migrated_at";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyTagWire {
    pub id: String,
    pub name: String,
    pub date_added: i64,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub sub_tags: Vec<String>,
    #[serde(default)]
    pub is_hidden: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyLocationWire {
    pub id: String,
    pub path: String,
    pub date_added: i64,
    #[serde(default)]
    pub sub_locations: Vec<SubLocationWire>,
    #[serde(default)]
    pub index: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacySavedSearchWire {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub criteria: Vec<SearchCriteriaWire>,
    #[serde(default)]
    pub match_any: bool,
    #[serde(default)]
    pub index: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyFileWire {
    pub id: String,
    #[serde(default)]
    pub ino: Option<String>,
    pub location_id: String,
    pub relative_path: String,
    pub absolute_path: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub size: i64,
    pub width: i64,
    pub height: i64,
    pub date_added: i64,
    pub date_modified: i64,
    #[serde(default)]
    pub date_created: Option<i64>,
    #[serde(default)]
    pub date_last_indexed: Option<i64>,
    pub name: String,
    pub extension: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub rating: Option<i64>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub palette: Option<Vec<PaletteColorWire>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateFilesBatchResult {
    pub migrated_count: usize,
    pub ignored_tag_refs: usize,
    pub orphan_location_files: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationExpectedCounts {
    pub tags: u64,
    pub files: u64,
    pub locations: u64,
    pub searches: u64,
}

fn set_app_meta(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| format!("Failed to update app_meta['{key}']: {e}"))?;
    Ok(())
}

fn get_migration_state(conn: &Connection) -> Result<String, String> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = ?1",
            [META_MIGRATION_STATE],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read migration state: {e}"))?;
    Ok(value.unwrap_or_else(|| "none".to_string()))
}

fn migration_begin_impl(conn: &Connection) -> Result<(), String> {
    repo::clear(conn).map_err(|e| e.to_string())?;
    set_app_meta(conn, META_MIGRATION_STATE, "in_progress")
}

fn migration_skip_impl(conn: &Connection) -> Result<(), String> {
    repo::ensure_root_tag(conn).map_err(|e| e.to_string())?;
    set_app_meta(conn, META_MIGRATION_STATE, "skipped")
}

fn migrate_metadata_impl(
    conn: &Connection,
    tags: &[LegacyTagWire],
    locations: &[LegacyLocationWire],
    searches: &[LegacySavedSearchWire],
) -> Result<(), String> {
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to start metadata migration transaction: {e}"))?;

    if !tags.is_empty() {
        let mut upsert_tag = tx
            .prepare_cached(
                "INSERT INTO tags (id, name, date_added, color, is_hidden, parent_id, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, 0)
                 ON CONFLICT(id) DO UPDATE SET
                   name = excluded.name,
                   date_added = excluded.date_added,
                   color = excluded.color,
                   is_hidden = excluded.is_hidden,
                   parent_id = NULL,
                   sort_order = 0",
            )
            .map_err(|e| format!("Failed to prepare tag upsert: {e}"))?;

        for tag in tags {
            upsert_tag
                .execute(params![
                    tag.id,
                    tag.name,
                    tag.date_added,
                    tag.color,
                    i64::from(tag.is_hidden),
                ])
                .map_err(|e| format!("Failed to migrate tag '{}': {e}", tag.id))?;
        }

        let mut set_parent = tx
            .prepare_cached(
                "UPDATE tags SET parent_id = ?1, sort_order = ?2 WHERE id = ?3",
            )
            .map_err(|e| format!("Failed to prepare tag hierarchy update: {e}"))?;

        for tag in tags {
            for (sort_order, child_id) in tag.sub_tags.iter().enumerate() {
                if child_id == ROOT_TAG_ID || child_id == &tag.id {
                    continue;
                }
                set_parent
                    .execute(params![tag.id, sort_order as i64, child_id])
                    .map_err(|e| format!("Failed to link subTag '{child_id}': {e}"))?;
            }
        }
    }

    for loc in locations {
        let wire = LocationWire {
            id: loc.id.clone(),
            path: loc.path.clone(),
            date_added: loc.date_added,
            sub_locations: loc.sub_locations.clone(),
            index: loc.index,
        };
        repo::save_location(&tx, &wire).map_err(|e| e.to_string())?;
    }

    for search in searches {
        let wire = SavedSearchWire {
            id: search.id.clone(),
            name: search.name.clone(),
            criteria: search.criteria.clone(),
            match_any: search.match_any,
            index: search.index,
        };
        repo::save_search(&tx, &wire).map_err(|e| e.to_string())?;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit metadata migration transaction: {e}"))?;
    Ok(())
}

fn migrate_files_batch_impl(
    conn: &Connection,
    files: &[LegacyFileWire],
) -> Result<MigrateFilesBatchResult, String> {
    if files.is_empty() {
        return Ok(MigrateFilesBatchResult {
            migrated_count: 0,
            ignored_tag_refs: 0,
            orphan_location_files: 0,
        });
    }

    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to start file batch migration transaction: {e}"))?;

    let existing_tags: HashSet<String> = {
        let mut stmt = tx
            .prepare("SELECT id FROM tags")
            .map_err(|e| format!("Failed to query existing tags: {e}"))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to read existing tags: {e}"))?;
        let mut set = HashSet::new();
        for id in rows {
            set.insert(id.map_err(|e| format!("Failed to read tag id: {e}"))?);
        }
        set
    };

    let existing_locations: HashSet<String> = {
        let mut stmt = tx
            .prepare("SELECT id FROM locations")
            .map_err(|e| format!("Failed to query existing locations: {e}"))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to read existing locations: {e}"))?;
        let mut set = HashSet::new();
        for id in rows {
            set.insert(id.map_err(|e| format!("Failed to read location id: {e}"))?);
        }
        set
    };

    let mut upsert_file = tx
        .prepare_cached(
            "INSERT INTO files (
                id, ino, location_id, relative_path, absolute_path, name, extension,
                size, width, height, date_added, date_modified, date_created,
                date_last_indexed, description, rating, duration
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                ?8, ?9, ?10, ?11, ?12, ?13,
                ?14, ?15, ?16, ?17
             )
             ON CONFLICT(id) DO UPDATE SET
                ino = excluded.ino,
                location_id = excluded.location_id,
                relative_path = excluded.relative_path,
                absolute_path = excluded.absolute_path,
                name = excluded.name,
                extension = excluded.extension,
                size = excluded.size,
                width = excluded.width,
                height = excluded.height,
                date_added = excluded.date_added,
                date_modified = excluded.date_modified,
                date_created = excluded.date_created,
                date_last_indexed = excluded.date_last_indexed,
                description = excluded.description,
                rating = excluded.rating,
                duration = excluded.duration",
        )
        .map_err(|e| format!("Failed to prepare file upsert: {e}"))?;
    let mut del_tags = tx
        .prepare_cached("DELETE FROM file_tags WHERE file_id = ?1")
        .map_err(|e| format!("Failed to prepare file_tags delete: {e}"))?;
    let mut ins_tag = tx
        .prepare_cached(
            "INSERT OR IGNORE INTO file_tags (file_id, tag_id, position) VALUES (?1, ?2, ?3)",
        )
        .map_err(|e| format!("Failed to prepare file_tags insert: {e}"))?;
    let mut del_palette = tx
        .prepare_cached("DELETE FROM file_palette WHERE file_id = ?1")
        .map_err(|e| format!("Failed to prepare file_palette delete: {e}"))?;
    let mut ins_palette = tx
        .prepare_cached(
            "INSERT OR REPLACE INTO file_palette (file_id, position, r, g, b, percentage, color_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .map_err(|e| format!("Failed to prepare file_palette insert: {e}"))?;

    let mut ignored_tag_refs = 0usize;
    let mut orphan_location_files = 0usize;

    for file in files {
        let ino = file
            .ino
            .as_deref()
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("legacy-{}", file.id));
        let abs_path = normalize_drive_letter(&file.absolute_path);
        let date_created = file.date_created.unwrap_or(file.date_added);
        // Dexie v6 upgrade defaulted dateLastIndexed to dateAdded.
        let date_last_indexed = file.date_last_indexed.unwrap_or(file.date_added);
        // Dexie v10 upgrade defaulted rating to 0.
        let rating = file.rating.unwrap_or(0);

        if !existing_locations.contains(&file.location_id) {
            orphan_location_files += 1;
        }

        upsert_file
            .execute(params![
                file.id,
                ino,
                file.location_id,
                file.relative_path,
                abs_path,
                file.name,
                file.extension,
                file.size,
                file.width,
                file.height,
                file.date_added,
                file.date_modified,
                date_created,
                date_last_indexed,
                file.description,
                rating,
                file.duration,
            ])
            .map_err(|e| format!("Failed to migrate file '{}': {e}", file.id))?;

        del_tags
            .execute([&file.id])
            .map_err(|e| format!("Failed to clear file_tags for '{}': {e}", file.id))?;

        let mut pos: i64 = 0;
        for tag_id in &file.tags {
            if !existing_tags.contains(tag_id) {
                ignored_tag_refs += 1;
                continue;
            }
            ins_tag
                .execute(params![file.id, tag_id, pos])
                .map_err(|e| format!("Failed to insert file_tag for '{}': {e}", file.id))?;
            pos += 1;
        }

        del_palette
            .execute([&file.id])
            .map_err(|e| format!("Failed to clear file_palette for '{}': {e}", file.id))?;

        // Dexie v9 upgrade defaulted palette to [].
        if let Some(palette) = &file.palette {
            for (idx, color) in palette.iter().enumerate() {
                let color_id = nearest_color_id(color.r, color.g, color.b);
                ins_palette
                    .execute(params![
                        file.id,
                        idx as i64,
                        i64::from(color.r),
                        i64::from(color.g),
                        i64::from(color.b),
                        color.percentage,
                        color_id,
                    ])
                    .map_err(|e| {
                        format!("Failed to insert file_palette for '{}': {e}", file.id)
                    })?;
            }
        }
    }

    drop(upsert_file);
    drop(del_tags);
    drop(ins_tag);
    drop(del_palette);
    drop(ins_palette);

    tx.commit()
        .map_err(|e| format!("Failed to commit file batch migration transaction: {e}"))?;

    if orphan_location_files > 0 || ignored_tag_refs > 0 {
        eprintln!(
            "[dexie-migration] batch migrated={} orphan_location_files={} ignored_tag_refs={}",
            files.len(),
            orphan_location_files,
            ignored_tag_refs
        );
    }

    Ok(MigrateFilesBatchResult {
        migrated_count: files.len(),
        ignored_tag_refs,
        orphan_location_files,
    })
}

fn migration_finish_impl(
    conn: &Connection,
    expected: &MigrationExpectedCounts,
) -> Result<(), String> {
    let actual_tags: u64 = conn
        .query_row("SELECT COUNT(*) FROM tags", [], |r| r.get::<_, i64>(0))
        .map_err(|e| format!("Failed to count tags: {e}"))? as u64;
    let actual_files: u64 = conn
        .query_row("SELECT COUNT(*) FROM files", [], |r| r.get::<_, i64>(0))
        .map_err(|e| format!("Failed to count files: {e}"))? as u64;
    let actual_locations: u64 = conn
        .query_row("SELECT COUNT(*) FROM locations", [], |r| r.get::<_, i64>(0))
        .map_err(|e| format!("Failed to count locations: {e}"))? as u64;
    let actual_searches: u64 = conn
        .query_row("SELECT COUNT(*) FROM saved_searches", [], |r| {
            r.get::<_, i64>(0)
        })
        .map_err(|e| format!("Failed to count saved_searches: {e}"))? as u64;

    if actual_tags != expected.tags
        || actual_files != expected.files
        || actual_locations != expected.locations
        || actual_searches != expected.searches
    {
        return Err(format!(
            "Migration count mismatch: expected (tags={}, files={}, locations={}, searches={}), actual (tags={}, files={}, locations={}, searches={})",
            expected.tags,
            expected.files,
            expected.locations,
            expected.searches,
            actual_tags,
            actual_files,
            actual_locations,
            actual_searches,
        ));
    }

    let check: String = conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| format!("Failed to run PRAGMA quick_check: {e}"))?;
    if !check.eq_ignore_ascii_case("ok") {
        return Err(format!("SQLite integrity check failed: {check}"));
    }

    set_app_meta(conn, META_MIGRATION_STATE, "completed")?;
    set_app_meta(conn, META_MIGRATED_AT, &now_epoch_ms().to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_migration_state(state: State<'_, DbState>) -> Result<String, String> {
    state.with_reader(get_migration_state).await
}

#[tauri::command]
pub async fn db_migration_begin(state: State<'_, DbState>) -> Result<(), String> {
    state.with_writer(migration_begin_impl).await
}

#[tauri::command]
pub async fn db_migration_skip(state: State<'_, DbState>) -> Result<(), String> {
    state.with_writer(migration_skip_impl).await
}

#[tauri::command]
pub async fn db_migrate_metadata(
    state: State<'_, DbState>,
    tags: Vec<LegacyTagWire>,
    locations: Vec<LegacyLocationWire>,
    searches: Vec<LegacySavedSearchWire>,
) -> Result<(), String> {
    state
        .with_writer(move |conn| migrate_metadata_impl(conn, &tags, &locations, &searches))
        .await
}

#[tauri::command]
pub async fn db_migrate_files_batch(
    state: State<'_, DbState>,
    files: Vec<LegacyFileWire>,
) -> Result<MigrateFilesBatchResult, String> {
    state
        .with_writer(move |conn| migrate_files_batch_impl(conn, &files))
        .await
}

#[tauri::command]
pub async fn db_migration_finish(
    state: State<'_, DbState>,
    expected: MigrationExpectedCounts,
) -> Result<(), String> {
    state
        .with_writer(move |conn| migration_finish_impl(conn, &expected))
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

    fn sample_legacy_file(id: &str, location_id: &str, tags: Vec<String>) -> LegacyFileWire {
        LegacyFileWire {
            id: id.to_string(),
            ino: None,
            location_id: location_id.to_string(),
            relative_path: format!("{id}.png"),
            absolute_path: format!("c:/art/{id}.png"),
            tags,
            size: 1024,
            width: 800,
            height: 600,
            date_added: 1_750_000_000_000,
            date_modified: 1_750_000_000_100,
            date_created: None,
            date_last_indexed: None,
            name: format!("{id}.png"),
            extension: "png".to_string(),
            description: None,
            rating: None,
            duration: None,
            palette: None,
        }
    }

    #[test]
    fn migration_begin_metadata_two_batches_and_finish_completed() {
        let dir = tempdir().unwrap();
        let state = DbState::open(dir.path().join("allusion.db")).unwrap();
        let writer = state.writer.lock().unwrap();

        assert_eq!(get_migration_state(&writer).unwrap(), "none");
        migration_begin_impl(&writer).unwrap();
        assert_eq!(get_migration_state(&writer).unwrap(), "in_progress");

        let tags = vec![
            LegacyTagWire {
                id: ROOT_TAG_ID.to_string(),
                name: String::new(),
                date_added: 1_700_000_000_000,
                color: String::new(),
                sub_tags: vec!["t_parent".to_string()],
                is_hidden: false,
            },
            LegacyTagWire {
                id: "t_parent".to_string(),
                name: "Characters".to_string(),
                date_added: 1_700_000_000_100,
                color: "#ff0000".to_string(),
                sub_tags: vec!["t_child".to_string()],
                is_hidden: false,
            },
            LegacyTagWire {
                id: "t_child".to_string(),
                name: "Dragons".to_string(),
                date_added: 1_700_000_000_200,
                color: "#00ff00".to_string(),
                sub_tags: vec![],
                is_hidden: true,
            },
        ];
        let locations = vec![LegacyLocationWire {
            id: "loc_1".to_string(),
            path: "c:/art".to_string(),
            date_added: 1_700_000_000_000,
            sub_locations: vec![SubLocationWire {
                name: "sub".to_string(),
                is_excluded: true,
                sub_locations: vec![],
            }],
            index: 0,
        }];
        let searches = vec![LegacySavedSearchWire {
            id: "s_1".to_string(),
            name: "Dragons".to_string(),
            criteria: vec![SearchCriteriaWire {
                key: FileColumn::Name,
                value_type: SearchValueType::String,
                operator: SearchOperator::Contains,
                value: json!("dragon"),
            }],
            match_any: false,
            index: 0,
        }];

        migrate_metadata_impl(&writer, &tags, &locations, &searches).unwrap();

        let batch1 = vec![
            sample_legacy_file(
                "f1",
                "loc_1",
                vec!["t_child".to_string(), "missing_tag".to_string()],
            ),
            sample_legacy_file("f2", "orphan_loc", vec![]),
        ];
        let mut f3 = sample_legacy_file("f3", "loc_1", vec!["t_parent".to_string()]);
        f3.palette = Some(vec![PaletteColorWire {
            r: 255,
            g: 0,
            b: 0,
            percentage: 0.75,
        }]);
        f3.rating = Some(4);
        let batch2 = vec![f3];

        let res1 = migrate_files_batch_impl(&writer, &batch1).unwrap();
        assert_eq!(res1.migrated_count, 2);
        assert_eq!(res1.ignored_tag_refs, 1);
        assert_eq!(res1.orphan_location_files, 1);

        let res2 = migrate_files_batch_impl(&writer, &batch2).unwrap();
        assert_eq!(res2.migrated_count, 1);
        assert_eq!(res2.ignored_tag_refs, 0);
        assert_eq!(res2.orphan_location_files, 0);

        migration_finish_impl(
            &writer,
            &MigrationExpectedCounts {
                tags: 3,
                files: 3,
                locations: 1,
                searches: 1,
            },
        )
        .unwrap();
        assert_eq!(get_migration_state(&writer).unwrap(), "completed");

        let fetched_tags = repo::fetch_tags(&writer).unwrap();
        assert_eq!(fetched_tags.len(), 3);
        let parent = fetched_tags.iter().find(|t| t.id == "t_parent").unwrap();
        assert_eq!(parent.sub_tags, vec!["t_child".to_string()]);

        let fetched_files = repo::fetch_files_by_id(&writer, &["f1".to_string()]).unwrap();
        assert_eq!(fetched_files[0].tags, vec!["t_child".to_string()]);
        assert_eq!(fetched_files[0].rating, Some(0));
        assert_eq!(fetched_files[0].date_last_indexed, 1_750_000_000_000);
        assert_eq!(fetched_files[0].absolute_path, "C:/art/f1.png");
    }

    #[test]
    fn migration_repeated_batch_is_idempotent_without_duplicates() {
        let dir = tempdir().unwrap();
        let state = DbState::open(dir.path().join("allusion.db")).unwrap();
        let writer = state.writer.lock().unwrap();

        migration_begin_impl(&writer).unwrap();
        let tags = vec![
            LegacyTagWire {
                id: ROOT_TAG_ID.to_string(),
                name: String::new(),
                date_added: 1_700_000_000_000,
                color: String::new(),
                sub_tags: vec!["t1".to_string()],
                is_hidden: false,
            },
            LegacyTagWire {
                id: "t1".to_string(),
                name: "Tag".to_string(),
                date_added: 1_700_000_000_000,
                color: String::new(),
                sub_tags: vec![],
                is_hidden: false,
            },
        ];
        migrate_metadata_impl(&writer, &tags, &[], &[]).unwrap();

        let batch = vec![sample_legacy_file("f1", "loc_1", vec!["t1".to_string()])];
        migrate_files_batch_impl(&writer, &batch).unwrap();
        migrate_files_batch_impl(&writer, &batch).unwrap();

        let (total, _) = repo::count_files(&writer).unwrap();
        assert_eq!(total, 1);
    }

    #[test]
    fn migration_finish_with_wrong_counts_returns_error() {
        let dir = tempdir().unwrap();
        let state = DbState::open(dir.path().join("allusion.db")).unwrap();
        let writer = state.writer.lock().unwrap();

        migration_begin_impl(&writer).unwrap();
        let err = migration_finish_impl(
            &writer,
            &MigrationExpectedCounts {
                tags: 1,
                files: 5,
                locations: 0,
                searches: 0,
            },
        )
        .unwrap_err();
        assert!(err.contains("expected"));
        assert!(err.contains("actual"));
        assert_eq!(get_migration_state(&writer).unwrap(), "in_progress");
    }

    #[test]
    fn migration_in_progress_then_begin_clears_database() {
        let dir = tempdir().unwrap();
        let state = DbState::open(dir.path().join("allusion.db")).unwrap();
        let writer = state.writer.lock().unwrap();

        migration_begin_impl(&writer).unwrap();
        migrate_files_batch_impl(&writer, &[sample_legacy_file("f1", "loc_1", vec![])]).unwrap();
        assert_eq!(repo::count_files(&writer).unwrap().0, 1);

        // Simulate restart after crash while 'in_progress'
        assert_eq!(get_migration_state(&writer).unwrap(), "in_progress");
        migration_begin_impl(&writer).unwrap();
        assert_eq!(repo::count_files(&writer).unwrap().0, 0);
        assert_eq!(get_migration_state(&writer).unwrap(), "in_progress");
    }
}
