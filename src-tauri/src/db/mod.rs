pub mod color;
pub mod migrations;
pub mod repo;
pub mod search;
pub mod wire;

#[cfg(test)]
mod integration_tests;

use std::path::Path;

use rusqlite::functions::FunctionFlags;
use rusqlite::Connection;

use self::wire::DbResult;

/// Normalizes leading Windows ASCII drive letters to uppercase (`c:\` -> `C:\`, `c:/` -> `C:/`),
/// leaving UNC paths, POSIX paths, and relative paths unchanged.
pub fn normalize_drive_letter(path: &str) -> String {
    let bytes = path.as_bytes();
    if bytes.len() >= 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes.len() == 2 || bytes[2] == b'\\' || bytes[2] == b'/')
    {
        let upper = (bytes[0] as char).to_ascii_uppercase();
        let mut out = String::with_capacity(path.len());
        out.push(upper);
        out.push_str(&path[1..]);
        out
    } else {
        path.to_string()
    }
}

/// Applies SQLite connection PRAGMAs and registers Unicode case-folding scalar functions
/// required by `search.rs`. Must be called on every opened SQLite connection.
pub fn configure_connection(conn: &Connection) -> DbResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA temp_store = MEMORY;
         PRAGMA cache_size = -32768;
         PRAGMA busy_timeout = 5000;",
    )?;

    let flags = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;

    conn.create_scalar_function("u_lower", 1, flags, |ctx| {
        let value: Option<String> = ctx.get(0)?;
        Ok(value.map(|s| s.to_lowercase()))
    })?;

    conn.create_scalar_function("u_contains_ci", 2, flags, |ctx| {
        let haystack: Option<String> = ctx.get(0)?;
        let needle: Option<String> = ctx.get(1)?;
        let h = haystack.unwrap_or_default().to_lowercase();
        let n = needle.unwrap_or_default().to_lowercase();
        Ok(h.contains(&n))
    })?;

    conn.create_scalar_function("u_starts_with_ci", 2, flags, |ctx| {
        let haystack: Option<String> = ctx.get(0)?;
        let prefix: Option<String> = ctx.get(1)?;
        let h = haystack.unwrap_or_default().to_lowercase();
        let p = prefix.unwrap_or_default().to_lowercase();
        Ok(h.starts_with(&p))
    })?;

    Ok(())
}

/// Opens a file-backed SQLite connection, configures PRAGMAs/functions, applies pending migrations,
/// and ensures the `root` tag exists.
pub fn open_connection(path: &Path) -> DbResult<Connection> {
    let mut conn = Connection::open(path)?;
    configure_connection(&conn)?;
    migrations::run_migrations(&mut conn)?;
    repo::ensure_root_tag(&conn)?;
    Ok(conn)
}

/// Opens an isolated in-memory SQLite connection for tests, with all PRAGMAs, Unicode functions,
/// schema migrations, and root tag initialized.
pub fn open_in_memory() -> DbResult<Connection> {
    let mut conn = Connection::open_in_memory()?;
    configure_connection(&conn)?;
    migrations::run_migrations(&mut conn)?;
    repo::ensure_root_tag(&conn)?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_windows_drive_letters_only() {
        assert_eq!(normalize_drive_letter(r"c:\art\img.png"), r"C:\art\img.png");
        assert_eq!(normalize_drive_letter("d:/art/img.png"), "D:/art/img.png");
        assert_eq!(normalize_drive_letter("C:/art/img.png"), "C:/art/img.png");
        assert_eq!(normalize_drive_letter("e:"), "E:");
        assert_eq!(
            normalize_drive_letter(r"\\server\share\img.png"),
            r"\\server\share\img.png"
        );
        assert_eq!(
            normalize_drive_letter("/mnt/art/img.png"),
            "/mnt/art/img.png"
        );
        assert_eq!(normalize_drive_letter("foo:bar.jpg"), "foo:bar.jpg");
    }

    #[test]
    fn configures_pragmas_and_unicode_functions() {
        let conn = open_in_memory().unwrap();
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fk, 1);

        let lower: String = conn
            .query_row("SELECT u_lower('AÇÃO É ÚNICA')", [], |r| r.get(0))
            .unwrap();
        assert_eq!(lower, "ação é única");

        let contains_ci: bool = conn
            .query_row(
                "SELECT u_contains_ci('Árvore de Café', 'café')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(contains_ci);

        let starts_ci: bool = conn
            .query_row("SELECT u_starts_with_ci('Überwald', 'über')", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(starts_ci);
    }
}
