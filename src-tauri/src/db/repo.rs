use std::collections::{HashMap, HashSet};
use std::ops::Deref;
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::{
    params, params_from_iter, types::Value as SqlValue, Connection, Statement, Transaction,
    TransactionBehavior,
};

use super::color::nearest_color_id;
use super::migrations::now_epoch_ms;
use super::normalize_drive_letter;
use super::search::{append_chunked_in_clause, build_search_query, SQLITE_VAR_CHUNK_SIZE};
use super::wire::{
    DbError, DbResult, FileColumn, FileKeyField, FileWire, LocationWire, OrderByField,
    OrderDirectionWire, PaletteColorWire, SavedSearchWire, SearchCriteriaWire, SearchOperator,
    SearchValueType, SubLocationWire, TagWire, WireValue, ROOT_TAG_ID,
};

const SELECT_FILE_COLUMNS: &str = "\
    f.id, f.ino, f.location_id, f.relative_path, f.absolute_path, \
    f.name, f.extension, f.size, f.width, f.height, \
    f.date_added, f.date_modified, f.date_created, f.date_last_indexed, \
    f.description, f.rating, f.duration";

static NEXT_SAVEPOINT_ID: AtomicU64 = AtomicU64::new(1);

enum RepoTx<'conn> {
    Immediate(Option<Transaction<'conn>>),
    Savepoint {
        conn: &'conn Connection,
        name: String,
        committed: bool,
    },
}

impl<'conn> RepoTx<'conn> {
    fn begin(conn: &'conn Connection) -> DbResult<Self> {
        if conn.is_autocommit() {
            let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
            Ok(Self::Immediate(Some(tx)))
        } else {
            let sp_id = NEXT_SAVEPOINT_ID.fetch_add(1, Ordering::Relaxed);
            let name = format!("_allusion_repo_sp_{sp_id}");
            conn.execute_batch(&format!("SAVEPOINT {name}"))?;
            Ok(Self::Savepoint {
                conn,
                name,
                committed: false,
            })
        }
    }

    fn commit(mut self) -> DbResult<()> {
        match &mut self {
            Self::Immediate(slot) => {
                if let Some(tx) = slot.take() {
                    tx.commit()?;
                }
            }
            Self::Savepoint {
                conn,
                name,
                committed,
            } => {
                conn.execute_batch(&format!("RELEASE SAVEPOINT {name}"))?;
                *committed = true;
            }
        }
        Ok(())
    }
}

impl Deref for RepoTx<'_> {
    type Target = Connection;

    fn deref(&self) -> &Connection {
        match self {
            Self::Immediate(Some(tx)) => tx,
            Self::Immediate(None) => unreachable!("transaction already consumed"),
            Self::Savepoint { conn, .. } => conn,
        }
    }
}

impl Drop for RepoTx<'_> {
    fn drop(&mut self) {
        if let Self::Savepoint {
            conn,
            name,
            committed,
        } = self
        {
            if !*committed {
                let _ = conn.execute_batch(&format!(
                    "ROLLBACK TO SAVEPOINT {name}; RELEASE SAVEPOINT {name};"
                ));
            }
        }
    }
}

/// Ensures the root sentinel tag (`id = 'root'`) exists.
pub fn ensure_root_tag(conn: &Connection) -> DbResult<()> {
    conn.execute(
        "INSERT INTO tags (id, name, date_added, color, is_hidden, parent_id, sort_order)
         VALUES (?1, 'Root', ?2, '', 0, NULL, 0)
         ON CONFLICT(id) DO NOTHING",
        params![ROOT_TAG_ID, now_epoch_ms()],
    )?;
    Ok(())
}

/// Fetches all tags with reconstructed `sub_tags` order. Any non-root tag whose `parent_id` is
/// `NULL` or points to a missing parent is reattached to the end of `root.sub_tags` (RFC 9.1).
pub fn fetch_tags(conn: &Connection) -> DbResult<Vec<TagWire>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, name, date_added, color, is_hidden, parent_id
         FROM tags
         ORDER BY sort_order ASC, date_added ASC, rowid ASC",
    )?;

    struct RawTag {
        id: String,
        name: String,
        date_added: i64,
        color: String,
        is_hidden: bool,
        parent_id: Option<String>,
    }

    let raw_tags = stmt
        .query_map([], |row| {
            let is_hidden_int: i64 = row.get(4)?;
            Ok(RawTag {
                id: row.get(0)?,
                name: row.get(1)?,
                date_added: row.get(2)?,
                color: row.get(3)?,
                is_hidden: is_hidden_int != 0,
                parent_id: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let existing_ids: HashSet<&str> = raw_tags.iter().map(|t| t.id.as_str()).collect();
    let has_root = existing_ids.contains(ROOT_TAG_ID);

    let mut children_by_parent: HashMap<String, Vec<String>> = HashMap::new();
    let mut orphans: Vec<String> = Vec::new();

    for t in &raw_tags {
        if t.id == ROOT_TAG_ID {
            continue;
        }
        match t.parent_id.as_deref() {
            Some(pid) if pid != t.id && existing_ids.contains(pid) => {
                children_by_parent
                    .entry(pid.to_string())
                    .or_default()
                    .push(t.id.clone());
            }
            _ => orphans.push(t.id.clone()),
        }
    }

    if has_root && !orphans.is_empty() {
        let root_children = children_by_parent
            .entry(ROOT_TAG_ID.to_string())
            .or_default();
        for orphan_id in orphans {
            if !root_children.contains(&orphan_id) {
                root_children.push(orphan_id);
            }
        }
    }

    let mut result = Vec::with_capacity(raw_tags.len());
    // Emit root tag first when present to match Allusion's initialization contract.
    if let Some(root_raw) = raw_tags.iter().find(|t| t.id == ROOT_TAG_ID) {
        let sub_tags = children_by_parent.remove(ROOT_TAG_ID).unwrap_or_default();
        result.push(TagWire {
            id: root_raw.id.clone(),
            name: root_raw.name.clone(),
            date_added: root_raw.date_added,
            color: root_raw.color.clone(),
            sub_tags,
            is_hidden: root_raw.is_hidden,
        });
    }

    for t in raw_tags {
        if t.id == ROOT_TAG_ID {
            continue;
        }
        let sub_tags = children_by_parent.remove(&t.id).unwrap_or_default();
        result.push(TagWire {
            id: t.id,
            name: t.name,
            date_added: t.date_added,
            color: t.color,
            sub_tags,
            is_hidden: t.is_hidden,
        });
    }

    Ok(result)
}

fn reconcile_tag_children(conn: &Connection, parent_id: &str, sub_tags: &[String]) -> DbResult<()> {
    let desired: HashSet<&str> = sub_tags.iter().map(String::as_str).collect();
    let current_children = {
        let mut stmt = conn.prepare_cached("SELECT id FROM tags WHERE parent_id = ?1")?;
        let ids = stmt
            .query_map([parent_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids
    };

    // Detach only tags that still point to this parent and are no longer in `sub_tags`,
    // making parent moves convergent regardless of whether oldParent or newParent saves first.
    let mut detach_stmt =
        conn.prepare_cached("UPDATE tags SET parent_id = NULL WHERE id = ?1 AND parent_id = ?2")?;
    for child_id in current_children {
        if !desired.contains(child_id.as_str()) {
            detach_stmt.execute(params![child_id, parent_id])?;
        }
    }

    let mut attach_stmt =
        conn.prepare_cached("UPDATE tags SET parent_id = ?1, sort_order = ?2 WHERE id = ?3")?;
    for (idx, child_id) in sub_tags.iter().enumerate() {
        if child_id == parent_id || child_id == ROOT_TAG_ID {
            continue;
        }
        attach_stmt.execute(params![parent_id, idx as i64, child_id])?;
    }

    Ok(())
}

pub fn create_tag(conn: &Connection, tag: &TagWire) -> DbResult<()> {
    let sp = RepoTx::begin(conn)?;
    sp.execute(
        "INSERT INTO tags (id, name, date_added, color, is_hidden, parent_id, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, 0)",
        params![
            tag.id,
            tag.name,
            tag.date_added,
            tag.color,
            i64::from(tag.is_hidden)
        ],
    )?;
    reconcile_tag_children(&sp, &tag.id, &tag.sub_tags)?;
    sp.commit()?;
    Ok(())
}

pub fn save_tag(conn: &Connection, tag: &TagWire) -> DbResult<()> {
    let sp = RepoTx::begin(conn)?;
    sp.execute(
        "INSERT INTO tags (id, name, date_added, color, is_hidden, parent_id, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, 0)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           date_added = excluded.date_added,
           color = excluded.color,
           is_hidden = excluded.is_hidden",
        params![
            tag.id,
            tag.name,
            tag.date_added,
            tag.color,
            i64::from(tag.is_hidden)
        ],
    )?;
    reconcile_tag_children(&sp, &tag.id, &tag.sub_tags)?;
    sp.commit()?;
    Ok(())
}

pub fn remove_tags(conn: &Connection, tag_ids: &[String]) -> DbResult<()> {
    if tag_ids.is_empty() {
        return Ok(());
    }
    let sp = RepoTx::begin(conn)?;
    for chunk in tag_ids.chunks(SQLITE_VAR_CHUNK_SIZE) {
        let mut params_vec = Vec::with_capacity(chunk.len());
        let in_clause = append_chunked_in_clause("id", chunk, &mut params_vec);
        let sql = format!("DELETE FROM tags WHERE {in_clause}");
        sp.execute(&sql, params_from_iter(params_vec))?;
    }
    sp.commit()?;
    Ok(())
}

pub fn merge_tags(
    conn: &Connection,
    tag_to_be_removed: &str,
    tag_to_merge_with: &str,
) -> DbResult<()> {
    if tag_to_be_removed == tag_to_merge_with {
        return Ok(());
    }
    let sp = RepoTx::begin(conn)?;
    sp.execute(
        "INSERT OR IGNORE INTO file_tags (file_id, tag_id, position)
         SELECT file_id, ?2, position
         FROM file_tags
         WHERE tag_id = ?1",
        params![tag_to_be_removed, tag_to_merge_with],
    )?;
    sp.execute(
        "DELETE FROM file_tags WHERE tag_id = ?1",
        [tag_to_be_removed],
    )?;
    sp.execute("DELETE FROM tags WHERE id = ?1", [tag_to_be_removed])?;
    sp.commit()?;
    Ok(())
}

fn row_to_file_wire(row: &rusqlite::Row<'_>) -> rusqlite::Result<FileWire> {
    Ok(FileWire {
        id: row.get(0)?,
        ino: row.get(1)?,
        location_id: row.get(2)?,
        relative_path: row.get(3)?,
        absolute_path: row.get(4)?,
        tags: Vec::new(),
        name: row.get(5)?,
        extension: row.get(6)?,
        size: row.get(7)?,
        width: row.get(8)?,
        height: row.get(9)?,
        date_added: row.get(10)?,
        date_modified: row.get(11)?,
        date_created: row.get(12)?,
        date_last_indexed: row.get(13)?,
        description: row.get(14)?,
        rating: Some(row.get(15)?),
        duration: row.get(16)?,
        palette: None,
    })
}

fn hydrate_files(conn: &Connection, mut files: Vec<FileWire>) -> DbResult<Vec<FileWire>> {
    if files.is_empty() {
        return Ok(files);
    }

    let mut index_by_id: HashMap<String, usize> = HashMap::with_capacity(files.len());
    for (idx, file) in files.iter().enumerate() {
        index_by_id.insert(file.id.clone(), idx);
    }

    if files.len() <= SQLITE_VAR_CHUNK_SIZE {
        let ids: Vec<String> = files.iter().map(|f| f.id.clone()).collect();
        let mut tag_params = Vec::with_capacity(ids.len());
        let tag_in = append_chunked_in_clause("file_id", &ids, &mut tag_params);
        let tag_sql = format!(
            "SELECT file_id, tag_id FROM file_tags WHERE {tag_in} ORDER BY file_id ASC, position ASC, tag_id ASC"
        );
        let mut tag_stmt = conn.prepare(&tag_sql)?;
        let mut tag_rows = tag_stmt.query(params_from_iter(tag_params))?;
        while let Some(row) = tag_rows.next()? {
            let file_id: String = row.get(0)?;
            let tag_id: String = row.get(1)?;
            if let Some(&idx) = index_by_id.get(&file_id) {
                files[idx].tags.push(tag_id);
            }
        }

        let mut pal_params = Vec::with_capacity(ids.len());
        let pal_in = append_chunked_in_clause("file_id", &ids, &mut pal_params);
        let pal_sql = format!(
            "SELECT file_id, r, g, b, percentage FROM file_palette WHERE {pal_in} ORDER BY file_id ASC, position ASC"
        );
        let mut pal_stmt = conn.prepare(&pal_sql)?;
        let mut pal_rows = pal_stmt.query(params_from_iter(pal_params))?;
        while let Some(row) = pal_rows.next()? {
            let file_id: String = row.get(0)?;
            let color = PaletteColorWire {
                r: row.get(1)?,
                g: row.get(2)?,
                b: row.get(3)?,
                percentage: row.get(4)?,
            };
            if let Some(&idx) = index_by_id.get(&file_id) {
                files[idx].palette.get_or_insert_with(Vec::new).push(color);
            }
        }
    } else {
        // Populate a connection-local TEMP table so SQLite joins via file_tags / file_palette
        // primary keys instead of scanning and sorting the full tables.
        conn.execute_batch(
            "SAVEPOINT _hydrate_sp;
             CREATE TEMP TABLE IF NOT EXISTS _hydrate_ids (id TEXT PRIMARY KEY);
             DELETE FROM _hydrate_ids;",
        )?;
        {
            let mut ins_stmt =
                conn.prepare_cached("INSERT OR IGNORE INTO _hydrate_ids (id) VALUES (?1)")?;
            for file in &files {
                ins_stmt.execute([&file.id])?;
            }
        }
        conn.execute_batch("RELEASE SAVEPOINT _hydrate_sp;")?;

        let mut tag_stmt = conn.prepare_cached(
            "SELECT ft.file_id, ft.tag_id
             FROM _hydrate_ids h
             JOIN file_tags ft ON ft.file_id = h.id
             ORDER BY ft.file_id ASC, ft.position ASC, ft.tag_id ASC",
        )?;
        let mut tag_rows = tag_stmt.query([])?;
        while let Some(row) = tag_rows.next()? {
            let file_id: String = row.get(0)?;
            if let Some(&idx) = index_by_id.get(&file_id) {
                let tag_id: String = row.get(1)?;
                files[idx].tags.push(tag_id);
            }
        }

        let mut pal_stmt = conn.prepare_cached(
            "SELECT fp.file_id, fp.r, fp.g, fp.b, fp.percentage
             FROM _hydrate_ids h
             JOIN file_palette fp ON fp.file_id = h.id
             ORDER BY fp.file_id ASC, fp.position ASC",
        )?;
        let mut pal_rows = pal_stmt.query([])?;
        while let Some(row) = pal_rows.next()? {
            let file_id: String = row.get(0)?;
            if let Some(&idx) = index_by_id.get(&file_id) {
                let color = PaletteColorWire {
                    r: row.get(1)?,
                    g: row.get(2)?,
                    b: row.get(3)?,
                    percentage: row.get(4)?,
                };
                files[idx].palette.get_or_insert_with(Vec::new).push(color);
            }
        }
    }

    Ok(files)
}

fn append_limit_offset(
    sql: &mut String,
    params: &mut Vec<SqlValue>,
    limit: Option<usize>,
    offset: Option<usize>,
) {
    match (limit, offset) {
        (Some(lim), Some(off)) => {
            sql.push_str(" LIMIT ? OFFSET ?");
            params.push(SqlValue::Integer(lim as i64));
            params.push(SqlValue::Integer(off as i64));
        }
        (Some(lim), None) => {
            sql.push_str(" LIMIT ?");
            params.push(SqlValue::Integer(lim as i64));
        }
        (None, Some(off)) => {
            sql.push_str(" LIMIT -1 OFFSET ?");
            params.push(SqlValue::Integer(off as i64));
        }
        (None, None) => {}
    }
}

pub fn fetch_files(
    conn: &Connection,
    order_by: OrderByField,
    direction: OrderDirectionWire,
    limit: Option<usize>,
    offset: Option<usize>,
) -> DbResult<Vec<FileWire>> {
    let order_sql = order_by.order_clause(direction);
    let mut sql = format!("SELECT {SELECT_FILE_COLUMNS} FROM files f ORDER BY {order_sql}");
    let mut params_vec = Vec::new();
    append_limit_offset(&mut sql, &mut params_vec, limit, offset);

    let mut stmt = conn.prepare(&sql)?;
    let files = stmt
        .query_map(params_from_iter(params_vec), row_to_file_wire)?
        .collect::<Result<Vec<_>, _>>()?;

    hydrate_files(conn, files)
}

pub fn fetch_files_by_id(conn: &Connection, ids: &[String]) -> DbResult<Vec<FileWire>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for chunk in ids.chunks(SQLITE_VAR_CHUNK_SIZE) {
        let mut params_vec = Vec::with_capacity(chunk.len());
        let in_clause = append_chunked_in_clause("f.id", chunk, &mut params_vec);
        let sql = format!("SELECT {SELECT_FILE_COLUMNS} FROM files f WHERE {in_clause}");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params_from_iter(params_vec), row_to_file_wire)?
            .collect::<Result<Vec<_>, _>>()?;
        files.extend(rows);
    }
    hydrate_files(conn, files)
}

pub fn fetch_files_by_key(
    conn: &Connection,
    key: FileKeyField,
    value: &WireValue,
) -> DbResult<Vec<FileWire>> {
    let sql_val = match value {
        WireValue::Bool(b) => SqlValue::Integer(i64::from(*b)),
        WireValue::Int(i) => SqlValue::Integer(*i),
        WireValue::Float(f) => SqlValue::Real(*f),
        WireValue::Str(s) => {
            if key == FileKeyField::AbsolutePath {
                SqlValue::Text(normalize_drive_letter(s).into_owned())
            } else {
                SqlValue::Text(s.clone())
            }
        }
    };

    let col = key.sql_column();
    let sql =
        format!("SELECT {SELECT_FILE_COLUMNS} FROM files f WHERE {col} = ?1 ORDER BY f.id ASC");
    let mut stmt = conn.prepare(&sql)?;
    let files = stmt
        .query_map([sql_val], row_to_file_wire)?
        .collect::<Result<Vec<_>, _>>()?;

    hydrate_files(conn, files)
}

pub fn search_files(
    conn: &Connection,
    criteria: &[SearchCriteriaWire],
    order_by: OrderByField,
    direction: OrderDirectionWire,
    match_any: bool,
    limit: Option<usize>,
    offset: Option<usize>,
) -> DbResult<Vec<FileWire>> {
    let built = build_search_query(criteria, match_any)?;
    let order_sql = order_by.order_clause(direction);
    let mut sql = format!(
        "{}SELECT {SELECT_FILE_COLUMNS} FROM files f WHERE {} ORDER BY {order_sql}",
        built.cte_clause, built.where_clause
    );
    let mut params_vec = built.params;
    append_limit_offset(&mut sql, &mut params_vec, limit, offset);

    let mut stmt = conn.prepare(&sql)?;
    let files = stmt
        .query_map(params_from_iter(params_vec), row_to_file_wire)?
        .collect::<Result<Vec<_>, _>>()?;

    hydrate_files(conn, files)
}

fn insert_file_children(
    tag_stmt: &mut Statement<'_>,
    palette_stmt: &mut Statement<'_>,
    file: &FileWire,
) -> DbResult<()> {
    for (pos, tag_id) in file.tags.iter().enumerate() {
        tag_stmt.execute(params![file.id, tag_id, pos as i64])?;
    }
    if let Some(palette) = &file.palette {
        for (pos, color) in palette.iter().enumerate() {
            let color_id = nearest_color_id(color.r, color.g, color.b);
            palette_stmt.execute(params![
                file.id,
                pos as i64,
                i64::from(color.r),
                i64::from(color.g),
                i64::from(color.b),
                color.percentage,
                color_id,
            ])?;
        }
    }
    Ok(())
}

pub fn create_files_from_path(conn: &Connection, _path: &str, files: &[FileWire]) -> DbResult<()> {
    if files.is_empty() {
        return Ok(());
    }
    let sp = RepoTx::begin(conn)?;
    {
        let mut file_stmt = sp.prepare_cached(
            "INSERT INTO files (
                id, ino, location_id, relative_path, absolute_path, name, extension,
                size, width, height, date_added, date_modified, date_created, date_last_indexed,
                description, rating, duration
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
             ON CONFLICT(absolute_path) DO NOTHING",
        )?;
        let mut tag_stmt = sp.prepare_cached(
            "INSERT OR IGNORE INTO file_tags (file_id, tag_id, position) VALUES (?1, ?2, ?3)",
        )?;
        let mut palette_stmt = sp.prepare_cached(
            "INSERT OR REPLACE INTO file_palette (file_id, position, r, g, b, percentage, color_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;

        for file in files {
            let abs_path = normalize_drive_letter(&file.absolute_path);
            let inserted = file_stmt.execute(params![
                file.id,
                file.ino,
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
                file.date_created,
                file.date_last_indexed,
                file.description,
                file.rating.unwrap_or(0),
                file.duration,
            ])?;
            if inserted > 0 {
                insert_file_children(&mut tag_stmt, &mut palette_stmt, file)?;
            }
        }
    }
    sp.commit()?;
    Ok(())
}

pub fn save_files(conn: &Connection, files: &[FileWire]) -> DbResult<()> {
    if files.is_empty() {
        return Ok(());
    }
    let sp = RepoTx::begin(conn)?;
    {
        let mut file_stmt = sp.prepare_cached(
            "INSERT INTO files (
                id, ino, location_id, relative_path, absolute_path, name, extension,
                size, width, height, date_added, date_modified, date_created, date_last_indexed,
                description, rating, duration
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
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
        )?;
        let mut del_tags_stmt = sp.prepare_cached("DELETE FROM file_tags WHERE file_id = ?1")?;
        let mut del_pal_stmt = sp.prepare_cached("DELETE FROM file_palette WHERE file_id = ?1")?;
        let mut tag_stmt = sp.prepare_cached(
            "INSERT OR IGNORE INTO file_tags (file_id, tag_id, position) VALUES (?1, ?2, ?3)",
        )?;
        let mut palette_stmt = sp.prepare_cached(
            "INSERT OR REPLACE INTO file_palette (file_id, position, r, g, b, percentage, color_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;

        for file in files {
            let abs_path = normalize_drive_letter(&file.absolute_path);
            file_stmt.execute(params![
                file.id,
                file.ino,
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
                file.date_created,
                file.date_last_indexed,
                file.description,
                file.rating.unwrap_or(0),
                file.duration,
            ])?;
            del_tags_stmt.execute([&file.id])?;
            del_pal_stmt.execute([&file.id])?;
            insert_file_children(&mut tag_stmt, &mut palette_stmt, file)?;
        }
    }
    sp.commit()?;
    Ok(())
}

pub fn remove_files(conn: &Connection, file_ids: &[String]) -> DbResult<()> {
    if file_ids.is_empty() {
        return Ok(());
    }
    let sp = RepoTx::begin(conn)?;
    for chunk in file_ids.chunks(SQLITE_VAR_CHUNK_SIZE) {
        let mut params_vec = Vec::with_capacity(chunk.len());
        let in_clause = append_chunked_in_clause("id", chunk, &mut params_vec);
        let sql = format!("DELETE FROM files WHERE {in_clause}");
        sp.execute(&sql, params_from_iter(params_vec))?;
    }
    sp.commit()?;
    Ok(())
}

pub fn purge_unsupported_extensions(
    conn: &Connection,
    supported_extensions: &[&str],
) -> DbResult<u64> {
    let sp = RepoTx::begin(conn)?;
    let deleted = if supported_extensions.is_empty() {
        sp.execute("DELETE FROM files", [])?
    } else {
        let lower_exts: Vec<String> = supported_extensions
            .iter()
            .map(|e| e.to_ascii_lowercase())
            .collect();
        let mut parts = Vec::new();
        let mut params_vec = Vec::with_capacity(lower_exts.len());
        for chunk in lower_exts.chunks(SQLITE_VAR_CHUNK_SIZE) {
            let placeholders = vec!["?"; chunk.len()].join(", ");
            parts.push(format!("LOWER(extension) NOT IN ({placeholders})"));
            for ext in chunk {
                params_vec.push(SqlValue::Text(ext.clone()));
            }
        }
        let sql = format!("DELETE FROM files WHERE {}", parts.join(" AND "));
        sp.execute(&sql, params_from_iter(params_vec))?
    };
    sp.commit()?;
    Ok(deleted as u64)
}

pub fn fetch_locations(conn: &Connection) -> DbResult<Vec<LocationWire>> {
    struct RawSub {
        id: i64,
        parent_id: Option<i64>,
        name: String,
        is_excluded: bool,
    }

    let mut loc_stmt = conn.prepare_cached(
        "SELECT id, path, date_added, sort_index FROM locations ORDER BY sort_index ASC, date_added ASC, id ASC",
    )?;
    let raw_locs = loc_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut sub_stmt = conn.prepare_cached(
        "SELECT location_id, id, parent_id, name, is_excluded
         FROM sublocations
         ORDER BY location_id ASC, sort_order ASC, id ASC",
    )?;
    let mut subs_by_loc: HashMap<String, HashMap<Option<i64>, Vec<RawSub>>> = HashMap::new();
    let mut sub_rows = sub_stmt.query([])?;
    while let Some(row) = sub_rows.next()? {
        let location_id: String = row.get(0)?;
        let item = RawSub {
            id: row.get(1)?,
            parent_id: row.get(2)?,
            name: row.get(3)?,
            is_excluded: row.get::<_, i64>(4)? != 0,
        };
        subs_by_loc
            .entry(location_id)
            .or_default()
            .entry(item.parent_id)
            .or_default()
            .push(item);
    }

    fn build_tree(
        parent_id: Option<i64>,
        by_parent: &HashMap<Option<i64>, Vec<RawSub>>,
    ) -> Vec<SubLocationWire> {
        let Some(children) = by_parent.get(&parent_id) else {
            return Vec::new();
        };
        children
            .iter()
            .map(|c| SubLocationWire {
                name: c.name.clone(),
                is_excluded: c.is_excluded,
                sub_locations: build_tree(Some(c.id), by_parent),
            })
            .collect()
    }

    let locations = raw_locs
        .into_iter()
        .map(|(id, path, date_added, index)| {
            let sub_locations = subs_by_loc
                .get(&id)
                .map(|m| build_tree(None, m))
                .unwrap_or_default();
            LocationWire {
                id,
                path,
                date_added,
                sub_locations,
                index,
            }
        })
        .collect();

    Ok(locations)
}

fn insert_sublocations(
    conn: &Connection,
    location_id: &str,
    parent_id: Option<i64>,
    sub_locations: &[SubLocationWire],
) -> DbResult<()> {
    for (idx, sub) in sub_locations.iter().enumerate() {
        conn.execute(
            "INSERT INTO sublocations (location_id, parent_id, name, is_excluded, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                location_id,
                parent_id,
                sub.name,
                i64::from(sub.is_excluded),
                idx as i64,
            ],
        )?;
        let row_id = conn.last_insert_rowid();
        if !sub.sub_locations.is_empty() {
            insert_sublocations(conn, location_id, Some(row_id), &sub.sub_locations)?;
        }
    }
    Ok(())
}

fn upsert_location(conn: &Connection, location: &LocationWire, allow_update: bool) -> DbResult<()> {
    let sp = RepoTx::begin(conn)?;
    let sql = if allow_update {
        "INSERT INTO locations (id, path, date_added, sort_index)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
           path = excluded.path,
           date_added = excluded.date_added,
           sort_index = excluded.sort_index"
    } else {
        "INSERT INTO locations (id, path, date_added, sort_index)
         VALUES (?1, ?2, ?3, ?4)"
    };
    sp.execute(
        sql,
        params![
            location.id,
            location.path,
            location.date_added,
            location.index
        ],
    )?;
    sp.execute(
        "DELETE FROM sublocations WHERE location_id = ?1",
        [&location.id],
    )?;
    insert_sublocations(&sp, &location.id, None, &location.sub_locations)?;
    sp.commit()?;
    Ok(())
}

pub fn create_location(conn: &Connection, location: &LocationWire) -> DbResult<()> {
    upsert_location(conn, location, false)
}

pub fn save_location(conn: &Connection, location: &LocationWire) -> DbResult<()> {
    upsert_location(conn, location, true)
}

/// Removes a location and all its associated files inside a single transaction.
/// FK `ON DELETE CASCADE` clears `file_tags`, `file_palette`, and `sublocations`.
pub fn remove_location(conn: &Connection, location_id: &str) -> DbResult<()> {
    let sp = RepoTx::begin(conn)?;
    sp.execute("DELETE FROM files WHERE location_id = ?1", [location_id])?;
    sp.execute("DELETE FROM locations WHERE id = ?1", [location_id])?;
    sp.commit()?;
    Ok(())
}

fn serialize_camel_enum<T: serde::Serialize>(val: &T) -> DbResult<String> {
    let json = serde_json::to_value(val)?;
    json.as_str()
        .map(ToString::to_string)
        .ok_or_else(|| DbError::InvalidInput("expected string enum serialization".into()))
}

fn deserialize_camel_enum<T: serde::de::DeserializeOwned>(s: &str) -> DbResult<T> {
    Ok(serde_json::from_value(serde_json::Value::String(
        s.to_string(),
    ))?)
}

pub fn fetch_searches(conn: &Connection) -> DbResult<Vec<SavedSearchWire>> {
    let mut search_stmt = conn.prepare_cached(
        "SELECT id, name, match_any, sort_index FROM saved_searches ORDER BY sort_index ASC, id ASC",
    )?;
    let raw_searches = search_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)? != 0,
                row.get::<_, i64>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut crit_stmt = conn.prepare_cached(
        "SELECT search_id, key, value_type, operator, value_json
         FROM saved_search_criteria
         ORDER BY search_id ASC, position ASC, id ASC",
    )?;
    let mut criteria_by_search: HashMap<String, Vec<SearchCriteriaWire>> = HashMap::new();
    let mut crit_rows = crit_stmt.query([])?;
    while let Some(row) = crit_rows.next()? {
        let search_id: String = row.get(0)?;
        let key_str: String = row.get(1)?;
        let value_type_str: String = row.get(2)?;
        let operator_str: String = row.get(3)?;
        let value_json: String = row.get(4)?;

        let crit = SearchCriteriaWire {
            key: deserialize_camel_enum::<FileColumn>(&key_str)?,
            value_type: deserialize_camel_enum::<SearchValueType>(&value_type_str)?,
            operator: deserialize_camel_enum::<SearchOperator>(&operator_str)?,
            value: serde_json::from_str(&value_json)?,
        };
        criteria_by_search.entry(search_id).or_default().push(crit);
    }

    Ok(raw_searches
        .into_iter()
        .map(|(id, name, match_any, index)| {
            let criteria = criteria_by_search.remove(&id).unwrap_or_default();
            SavedSearchWire {
                id,
                name,
                criteria,
                match_any,
                index,
            }
        })
        .collect())
}

fn upsert_search(conn: &Connection, search: &SavedSearchWire, allow_update: bool) -> DbResult<()> {
    let sp = RepoTx::begin(conn)?;
    let sql = if allow_update {
        "INSERT INTO saved_searches (id, name, match_any, sort_index)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           match_any = excluded.match_any,
           sort_index = excluded.sort_index"
    } else {
        "INSERT INTO saved_searches (id, name, match_any, sort_index)
         VALUES (?1, ?2, ?3, ?4)"
    };
    sp.execute(
        sql,
        params![
            search.id,
            search.name,
            i64::from(search.match_any),
            search.index
        ],
    )?;
    sp.execute(
        "DELETE FROM saved_search_criteria WHERE search_id = ?1",
        [&search.id],
    )?;

    let mut crit_stmt = sp.prepare_cached(
        "INSERT INTO saved_search_criteria (search_id, position, key, value_type, operator, value_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?;
    for (pos, crit) in search.criteria.iter().enumerate() {
        let key_str = crit.key.as_str();
        let value_type_str = serialize_camel_enum(&crit.value_type)?;
        let operator_str = serialize_camel_enum(&crit.operator)?;
        let value_json = serde_json::to_string(&crit.value)?;
        crit_stmt.execute(params![
            search.id,
            pos as i64,
            key_str,
            value_type_str,
            operator_str,
            value_json
        ])?;
    }
    drop(crit_stmt);
    sp.commit()?;
    Ok(())
}

pub fn create_search(conn: &Connection, search: &SavedSearchWire) -> DbResult<()> {
    upsert_search(conn, search, false)
}

pub fn save_search(conn: &Connection, search: &SavedSearchWire) -> DbResult<()> {
    upsert_search(conn, search, true)
}

pub fn remove_search(conn: &Connection, search_id: &str) -> DbResult<()> {
    conn.execute("DELETE FROM saved_searches WHERE id = ?1", [search_id])?;
    Ok(())
}

/// Returns `(total_files, untagged_files)`.
pub fn count_files(conn: &Connection) -> DbResult<(u64, u64)> {
    let (total, untagged): (i64, i64) = conn.query_row(
        "SELECT
           COUNT(*),
           COALESCE(SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id) THEN 1 ELSE 0 END), 0)
         FROM files f",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok((total as u64, untagged as u64))
}

/// Clears all persistent tables inside a single transaction and re-creates the root tag.
pub fn clear(conn: &Connection) -> DbResult<()> {
    let sp = RepoTx::begin(conn)?;
    sp.execute_batch(
        "DELETE FROM file_palette;
         DELETE FROM file_tags;
         DELETE FROM files;
         DELETE FROM sublocations;
         DELETE FROM locations;
         DELETE FROM saved_search_criteria;
         DELETE FROM saved_searches;
         DELETE FROM tags;
         DELETE FROM app_meta;",
    )?;
    ensure_root_tag(&sp)?;
    sp.commit()?;
    Ok(())
}
