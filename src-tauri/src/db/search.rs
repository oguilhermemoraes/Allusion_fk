use chrono::{DateTime, Duration, Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone};
use rusqlite::types::Value as SqlValue;

use super::normalize_drive_letter;
use super::wire::{
    DbError, DbResult, FileColumn, SearchCriteriaWire, SearchOperator, SearchValueType,
    MAX_TAG_DEPTH,
};

pub const SQLITE_VAR_CHUNK_SIZE: usize = 900;

#[derive(Debug, Clone)]
pub struct BuiltSearchQuery {
    pub cte_clause: String,
    pub where_clause: String,
    pub params: Vec<SqlValue>,
}

/// Translates `SearchCriteriaWire[]` into parameterized SQL fragments (`WITH RECURSIVE` CTEs +
/// `WHERE` predicate + ordered parameter binds). Never interpolates criterion values into SQL.
pub fn build_search_query(
    criteria: &[SearchCriteriaWire],
    match_any: bool,
) -> DbResult<BuiltSearchQuery> {
    if criteria.is_empty() {
        return Ok(BuiltSearchQuery {
            cte_clause: String::new(),
            where_clause: "1 = 1".to_string(),
            params: Vec::new(),
        });
    }

    let mut ctes = Vec::new();
    let mut cte_params = Vec::new();
    let mut predicates = Vec::with_capacity(criteria.len());
    let mut where_params = Vec::new();

    for crit in criteria {
        let pred = match crit.key {
            FileColumn::Tags => translate_tag_criterion(
                crit,
                ctes.len(),
                &mut ctes,
                &mut cte_params,
                &mut where_params,
            )?,
            FileColumn::Palette => translate_color_criterion(crit, &mut where_params)?,
            col => match crit.value_type {
                SearchValueType::String => {
                    translate_string_criterion(col, crit, &mut where_params)?
                }
                SearchValueType::Number => {
                    translate_number_criterion(col, crit, &mut where_params)?
                }
                SearchValueType::Date => translate_date_criterion(col, crit, &mut where_params)?,
                SearchValueType::Array | SearchValueType::Color => {
                    return Err(DbError::InvalidInput(format!(
                        "unsupported valueType {:?} for scalar column '{}'",
                        crit.value_type,
                        col.as_str()
                    )));
                }
            },
        };
        predicates.push(format!("({pred})"));
    }

    let cte_clause = if ctes.is_empty() {
        String::new()
    } else {
        format!("WITH RECURSIVE {} ", ctes.join(", "))
    };
    let combinator = if match_any { " OR " } else { " AND " };
    let where_clause = predicates.join(combinator);

    let mut params = cte_params;
    params.extend(where_params);

    Ok(BuiltSearchQuery {
        cte_clause,
        where_clause,
        params,
    })
}

/// Appends chunked `col IN (?, ...)` predicates so arbitrarily long lists never exceed SQLite's
/// bind variable limit. Caller guarantees `items` is non-empty.
pub(crate) fn append_chunked_in_clause(
    column_expr: &str,
    items: &[String],
    params: &mut Vec<SqlValue>,
) -> String {
    let mut parts = Vec::new();
    for chunk in items.chunks(SQLITE_VAR_CHUNK_SIZE) {
        let placeholders = vec!["?"; chunk.len()].join(", ");
        parts.push(format!("{column_expr} IN ({placeholders})"));
        for item in chunk {
            params.push(SqlValue::Text(item.clone()));
        }
    }
    if parts.len() == 1 {
        parts.into_iter().next().unwrap_or_default()
    } else {
        format!("({})", parts.join(" OR "))
    }
}

fn translate_tag_criterion(
    crit: &SearchCriteriaWire,
    cte_index: usize,
    ctes: &mut Vec<String>,
    cte_params: &mut Vec<SqlValue>,
    where_params: &mut Vec<SqlValue>,
) -> DbResult<String> {
    if crit.value_type != SearchValueType::Array {
        return Err(DbError::InvalidInput(format!(
            "tags criterion requires valueType 'array', got {:?}",
            crit.value_type
        )));
    }
    let arr = crit
        .value
        .as_array()
        .ok_or_else(|| DbError::InvalidInput("tags criterion value must be an array".into()))?;
    let mut ids = Vec::with_capacity(arr.len());
    for entry in arr {
        let s = entry.as_str().ok_or_else(|| {
            DbError::InvalidInput("tags criterion elements must be strings".into())
        })?;
        ids.push(s.to_string());
    }

    match crit.operator {
        SearchOperator::Contains if ids.is_empty() => {
            Ok("NOT EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id)".to_string())
        }
        SearchOperator::NotContains if ids.is_empty() => {
            Ok("EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id)".to_string())
        }
        SearchOperator::Contains => {
            let in_expr = append_chunked_in_clause("ft.tag_id", &ids, where_params);
            Ok(format!(
                "EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id AND {in_expr})"
            ))
        }
        SearchOperator::NotContains => {
            let in_expr = append_chunked_in_clause("ft.tag_id", &ids, where_params);
            Ok(format!(
                "NOT EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id AND {in_expr})"
            ))
        }
        SearchOperator::ContainsRecursively if ids.is_empty() => {
            Ok("NOT EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id)".to_string())
        }
        SearchOperator::ContainsNotRecursively if ids.is_empty() => {
            Ok("EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id)".to_string())
        }
        SearchOperator::ContainsRecursively | SearchOperator::ContainsNotRecursively => {
            let cte_name = format!("target_tags_{cte_index}");
            let mut base_selects = Vec::new();
            for chunk in ids.chunks(SQLITE_VAR_CHUNK_SIZE) {
                let placeholders = vec!["?"; chunk.len()].join(", ");
                base_selects.push(format!(
                    "SELECT id, 0 FROM tags WHERE id IN ({placeholders})"
                ));
                for id in chunk {
                    cte_params.push(SqlValue::Text(id.clone()));
                }
            }
            let base_sql = base_selects.join(" UNION ");
            ctes.push(format!(
                "{cte_name}(id, depth) AS ({base_sql} UNION ALL \
                 SELECT t.id, tt.depth + 1 FROM tags t \
                 JOIN {cte_name} tt ON t.parent_id = tt.id \
                 WHERE tt.depth < {MAX_TAG_DEPTH})"
            ));
            let exists_kw = if matches!(crit.operator, SearchOperator::ContainsRecursively) {
                "EXISTS"
            } else {
                "NOT EXISTS"
            };
            Ok(format!(
                "{exists_kw} (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id AND ft.tag_id IN (SELECT id FROM {cte_name}))"
            ))
        }
        other => Err(DbError::InvalidInput(format!(
            "unsupported operator {other:?} for tags criterion"
        ))),
    }
}

fn translate_color_criterion(
    crit: &SearchCriteriaWire,
    params: &mut Vec<SqlValue>,
) -> DbResult<String> {
    if crit.value_type != SearchValueType::Color {
        return Err(DbError::InvalidInput(format!(
            "palette criterion requires valueType 'color', got {:?}",
            crit.value_type
        )));
    }
    let color_id = crit
        .value
        .as_str()
        .ok_or_else(|| DbError::InvalidInput("palette criterion value must be a string".into()))?
        .to_string();

    let exists_kw = match crit.operator {
        SearchOperator::Contains => "EXISTS",
        SearchOperator::NotContains => "NOT EXISTS",
        other => {
            return Err(DbError::InvalidInput(format!(
                "unsupported operator {other:?} for palette criterion"
            )));
        }
    };
    params.push(SqlValue::Text(color_id));
    Ok(format!(
        "{exists_kw} (SELECT 1 FROM file_palette fp WHERE fp.file_id = f.id AND fp.color_id = ?)"
    ))
}

fn scalar_col_expr(col: FileColumn, coalesce_fallback: Option<&str>) -> DbResult<String> {
    let raw = col.sql_column().ok_or_else(|| {
        DbError::InvalidInput(format!(
            "column '{}' cannot be queried as scalar",
            col.as_str()
        ))
    })?;
    if col.is_nullable() {
        if let Some(fallback) = coalesce_fallback {
            return Ok(format!("COALESCE({raw}, {fallback})"));
        }
    }
    Ok(raw.to_string())
}

fn translate_string_criterion(
    col: FileColumn,
    crit: &SearchCriteriaWire,
    params: &mut Vec<SqlValue>,
) -> DbResult<String> {
    let raw = crit
        .value
        .as_str()
        .ok_or_else(|| DbError::InvalidInput("string criterion value must be a string".into()))?;
    let val = if col == FileColumn::AbsolutePath {
        normalize_drive_letter(raw).into_owned()
    } else {
        raw.to_string()
    };

    let col_expr = scalar_col_expr(col, Some("''"))?;

    match crit.operator {
        SearchOperator::Equals => {
            params.push(SqlValue::Text(val));
            Ok(format!("{col_expr} = ?"))
        }
        SearchOperator::NotEqual => {
            params.push(SqlValue::Text(val));
            Ok(format!("{col_expr} != ?"))
        }
        SearchOperator::EqualsIgnoreCase => {
            params.push(SqlValue::Text(val));
            Ok(format!("u_lower({col_expr}) = u_lower(?)"))
        }
        SearchOperator::StartsWith => {
            if val.is_empty() {
                return Ok("1 = 1".to_string());
            }
            if let Some(upper) = next_prefix_upper_bound(&val) {
                params.push(SqlValue::Text(val));
                params.push(SqlValue::Text(upper));
                Ok(format!("{col_expr} >= ? AND {col_expr} < ?"))
            } else {
                params.push(SqlValue::Text(val.clone()));
                params.push(SqlValue::Text(val));
                Ok(format!("SUBSTR({col_expr}, 1, LENGTH(?)) = ?"))
            }
        }
        SearchOperator::StartsWithIgnoreCase => {
            params.push(SqlValue::Text(val));
            Ok(format!("u_starts_with_ci({col_expr}, ?) = 1"))
        }
        SearchOperator::NotStartsWith => {
            params.push(SqlValue::Text(val));
            Ok(format!("u_starts_with_ci({col_expr}, ?) = 0"))
        }
        SearchOperator::Contains => {
            params.push(SqlValue::Text(val));
            Ok(format!("u_contains_ci({col_expr}, ?) = 1"))
        }
        SearchOperator::NotContains => {
            params.push(SqlValue::Text(val));
            Ok(format!("u_contains_ci({col_expr}, ?) = 0"))
        }
        other => Err(DbError::InvalidInput(format!(
            "unsupported string operator {other:?} on column '{}'",
            col.as_str()
        ))),
    }
}

fn translate_number_criterion(
    col: FileColumn,
    crit: &SearchCriteriaWire,
    params: &mut Vec<SqlValue>,
) -> DbResult<String> {
    let sql_val = if let Some(n) = crit.value.as_i64() {
        SqlValue::Integer(n)
    } else if let Some(f) = crit.value.as_f64() {
        if !f.is_finite() {
            return Err(DbError::InvalidInput(
                "numeric criterion value must be finite".into(),
            ));
        }
        SqlValue::Real(f)
    } else {
        return Err(DbError::InvalidInput(
            "number criterion value must be a finite number".into(),
        ));
    };

    let col_expr = scalar_col_expr(col, Some("0.0"))?;
    let op_str = match crit.operator {
        SearchOperator::Equals => "=",
        SearchOperator::NotEqual => "!=",
        SearchOperator::SmallerThan => "<",
        SearchOperator::SmallerThanOrEquals => "<=",
        SearchOperator::GreaterThan => ">",
        SearchOperator::GreaterThanOrEquals => ">=",
        other => {
            return Err(DbError::InvalidInput(format!(
                "unsupported number operator {other:?} on column '{}'",
                col.as_str()
            )));
        }
    };

    params.push(sql_val);
    Ok(format!("{col_expr} {op_str} ?"))
}

fn translate_date_criterion(
    col: FileColumn,
    crit: &SearchCriteriaWire,
    params: &mut Vec<SqlValue>,
) -> DbResult<String> {
    let ts_ms = parse_epoch_ms(&crit.value)?;
    let (day_start, day_end) = local_day_bounds_ms(ts_ms)?;
    let col_expr = scalar_col_expr(col, None)?;

    match crit.operator {
        SearchOperator::Equals => {
            params.push(SqlValue::Integer(day_start));
            params.push(SqlValue::Integer(day_end));
            Ok(format!("{col_expr} >= ? AND {col_expr} <= ?"))
        }
        SearchOperator::NotEqual => {
            params.push(SqlValue::Integer(day_start));
            params.push(SqlValue::Integer(day_end));
            Ok(format!("{col_expr} < ? OR {col_expr} > ?"))
        }
        SearchOperator::SmallerThan => {
            params.push(SqlValue::Integer(day_start));
            Ok(format!("{col_expr} < ?"))
        }
        SearchOperator::SmallerThanOrEquals => {
            params.push(SqlValue::Integer(day_end));
            Ok(format!("{col_expr} <= ?"))
        }
        SearchOperator::GreaterThan => {
            params.push(SqlValue::Integer(day_end));
            Ok(format!("{col_expr} > ?"))
        }
        SearchOperator::GreaterThanOrEquals => {
            params.push(SqlValue::Integer(day_start));
            Ok(format!("{col_expr} >= ?"))
        }
        other => Err(DbError::InvalidInput(format!(
            "unsupported date operator {other:?} on column '{}'",
            col.as_str()
        ))),
    }
}

/// Computes the tightest exclusive upper bound string in UTF-8 / codepoint order for `prefix`.
pub(crate) fn next_prefix_upper_bound(prefix: &str) -> Option<String> {
    for (idx, ch) in prefix.char_indices().rev() {
        let next_code = match ch as u32 {
            0xD7FF => 0xE000,
            c if c < 0x10_FFFF => c + 1,
            _ => continue,
        };
        if let Some(next_ch) = char::from_u32(next_code) {
            let mut out = String::with_capacity(idx + next_ch.len_utf8());
            out.push_str(&prefix[..idx]);
            out.push(next_ch);
            return Some(out);
        }
    }
    None
}

fn parse_epoch_ms(value: &serde_json::Value) -> DbResult<i64> {
    if let Some(ms) = value.as_i64() {
        return Ok(ms);
    }
    if let Some(f) = value.as_f64() {
        if f.is_finite() {
            return Ok(f.trunc() as i64);
        }
    }
    if let Some(s) = value.as_str() {
        if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
            return Ok(dt.timestamp_millis());
        }
        if let Ok(ms) = s.parse::<i64>() {
            return Ok(ms);
        }
    }
    Err(DbError::InvalidInput(
        "date criterion value must be epoch ms integer or RFC3339 string".into(),
    ))
}

fn resolve_local_start_ms(date: NaiveDate) -> DbResult<i64> {
    let naive_start = date
        .and_hms_milli_opt(0, 0, 0, 0)
        .ok_or_else(|| DbError::InvalidInput("invalid local start date".into()))?;
    for offset_mins in 0..180 {
        let probe = naive_start + Duration::minutes(offset_mins);
        match Local.from_local_datetime(&probe) {
            LocalResult::Single(dt) => return Ok(dt.timestamp_millis()),
            LocalResult::Ambiguous(earliest, _) => return Ok(earliest.timestamp_millis()),
            LocalResult::None => continue,
        }
    }
    Err(DbError::InvalidInput(
        "could not resolve local midnight".into(),
    ))
}

fn resolve_local_end_ms(date: NaiveDate) -> DbResult<i64> {
    let naive_end = date
        .and_hms_milli_opt(23, 59, 59, 999)
        .ok_or_else(|| DbError::InvalidInput("invalid local end date".into()))?;
    for offset_mins in 0..180 {
        let probe: NaiveDateTime = naive_end - Duration::minutes(offset_mins);
        match Local.from_local_datetime(&probe) {
            LocalResult::Single(dt) => return Ok(dt.timestamp_millis()),
            LocalResult::Ambiguous(_, latest) => return Ok(latest.timestamp_millis()),
            LocalResult::None => continue,
        }
    }
    Err(DbError::InvalidInput(
        "could not resolve local end of day".into(),
    ))
}

/// Maps an epoch ms timestamp to `[00:00:00.000, 23:59:59.999]` of its local calendar date.
pub fn local_day_bounds_ms(ts_ms: i64) -> DbResult<(i64, i64)> {
    let dt_utc = DateTime::from_timestamp_millis(ts_ms)
        .ok_or_else(|| DbError::InvalidInput(format!("timestamp out of range: {ts_ms}")))?;
    let date = dt_utc.with_timezone(&Local).date_naive();
    Ok((resolve_local_start_ms(date)?, resolve_local_end_ms(date)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_upper_bound_handles_brackets_unicode_and_max_scalar() {
        assert_eq!(next_prefix_upper_bound("foo"), Some("fop".to_string()));
        assert_eq!(
            next_prefix_upper_bound("C:/folder [1]/"),
            Some("C:/folder [1]0".to_string())
        );
        assert_eq!(
            next_prefix_upper_bound("\u{D7FF}"),
            Some("\u{E000}".to_string())
        );
        assert_eq!(
            next_prefix_upper_bound("a\u{10FFFF}"),
            Some("b".to_string())
        );
        assert_eq!(next_prefix_upper_bound("\u{10FFFF}"), None);
    }

    #[test]
    fn local_day_bounds_span_same_calendar_day() {
        let now_ms = 1_760_000_000_000_i64;
        let (start, end) = local_day_bounds_ms(now_ms).unwrap();
        assert!(start <= now_ms);
        assert!(now_ms <= end);
        assert!(end - start >= 22 * 3_600_000);
        assert!(end - start <= 25 * 3_600_000);
    }
}
