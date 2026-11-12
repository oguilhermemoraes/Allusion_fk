use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, TransactionBehavior};

use super::wire::DbResult;

pub const LATEST_SCHEMA_VERSION: u32 = 1;

/// Initial SQLite schema consolidated from Dexie versions 4..10 plus RFC Section 9.1 decisions:
/// - `tags.parent_id` uses `ON DELETE SET NULL` (orphan tags are reattached to `'root'` on fetch)
/// - `files.location_id` intentionally omits a strict FK constraint (cleaned transactionally in `remove_location`)
/// - `files.absolute_path` keeps `BINARY` uniqueness (Rust normalizes Windows drive letters to uppercase)
pub const V1_INITIAL_SQL: &str = r#"
CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  date_added INTEGER NOT NULL,
  sort_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sublocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES sublocations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_excluded INTEGER NOT NULL DEFAULT 0 CHECK (is_excluded IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date_added INTEGER NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  parent_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  ino TEXT NOT NULL,
  location_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  absolute_path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  extension TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  date_added INTEGER NOT NULL,
  date_modified INTEGER NOT NULL,
  date_created INTEGER NOT NULL,
  date_last_indexed INTEGER NOT NULL,
  description TEXT,
  rating INTEGER NOT NULL DEFAULT 0,
  duration REAL
);

CREATE TABLE file_tags (
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (file_id, tag_id)
);

CREATE TABLE file_palette (
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  r INTEGER NOT NULL CHECK (r BETWEEN 0 AND 255),
  g INTEGER NOT NULL CHECK (g BETWEEN 0 AND 255),
  b INTEGER NOT NULL CHECK (b BETWEEN 0 AND 255),
  percentage REAL NOT NULL,
  color_id TEXT NOT NULL,
  PRIMARY KEY (file_id, position)
);

CREATE TABLE saved_searches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  match_any INTEGER NOT NULL DEFAULT 0 CHECK (match_any IN (0, 1)),
  sort_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE saved_search_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_id TEXT NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  key TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('number', 'date', 'string', 'array', 'color')),
  operator TEXT NOT NULL,
  value_json TEXT NOT NULL
);

CREATE INDEX idx_files_location_id ON files(location_id);
CREATE INDEX idx_files_ino ON files(ino);
CREATE INDEX idx_files_extension ON files(extension);
CREATE INDEX idx_files_date_added ON files(date_added);
CREATE INDEX idx_files_date_modified ON files(date_modified);
CREATE INDEX idx_files_date_created ON files(date_created);
CREATE INDEX idx_files_name_nocase ON files(name COLLATE NOCASE);
CREATE INDEX idx_files_size ON files(size);
CREATE INDEX idx_files_rating ON files(rating);
CREATE INDEX idx_file_tags_tag_id ON file_tags(tag_id, file_id);
CREATE INDEX idx_file_palette_color_id ON file_palette(color_id, file_id);
CREATE INDEX idx_tags_parent_order ON tags(parent_id, sort_order);
CREATE INDEX idx_sublocations_loc_parent ON sublocations(location_id, parent_id, sort_order);
CREATE INDEX idx_saved_search_criteria_search ON saved_search_criteria(search_id, position);
"#;

pub fn now_epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Applies all pending schema migrations inside immediate transactions, updating both
/// `PRAGMA user_version` and the `schema_migrations` audit table.
pub fn run_migrations(conn: &mut Connection) -> DbResult<u32> {
    let mut current_version: u32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    if current_version < 1 {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute_batch(V1_INITIAL_SQL)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(version) DO NOTHING",
            params![1_i64, "v1_initial", now_epoch_ms()],
        )?;
        tx.pragma_update(None, "user_version", 1_u32)?;
        tx.commit()?;
        current_version = 1;
    }

    Ok(current_version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn migrates_from_empty_and_reopens_idempotently() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("allusion.db");

        {
            let mut conn = Connection::open(&db_path).unwrap();
            let v1 = run_migrations(&mut conn).unwrap();
            assert_eq!(v1, LATEST_SCHEMA_VERSION);

            let user_ver: u32 = conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .unwrap();
            assert_eq!(user_ver, 1);

            let (ver, name): (i64, String) = conn
                .query_row(
                    "SELECT version, name FROM schema_migrations WHERE version = 1",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(ver, 1);
            assert_eq!(name, "v1_initial");
        }

        {
            let mut conn = Connection::open(&db_path).unwrap();
            let v2 = run_migrations(&mut conn).unwrap();
            assert_eq!(v2, 1);

            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, 1);
        }
    }
}
