use std::fmt;

use serde::{Deserialize, Deserializer, Serialize};

#[derive(Debug)]
pub enum DbError {
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    InvalidInput(String),
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DbError::Sqlite(err) => write!(f, "SQLite error: {err}"),
            DbError::Json(err) => write!(f, "JSON error: {err}"),
            DbError::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
        }
    }
}

impl std::error::Error for DbError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            DbError::Sqlite(err) => Some(err),
            DbError::Json(err) => Some(err),
            DbError::InvalidInput(_) => None,
        }
    }
}

impl From<rusqlite::Error> for DbError {
    fn from(err: rusqlite::Error) -> Self {
        DbError::Sqlite(err)
    }
}

impl From<serde_json::Error> for DbError {
    fn from(err: serde_json::Error) -> Self {
        DbError::Json(err)
    }
}

pub type DbResult<T> = Result<T, DbError>;

pub const ROOT_TAG_ID: &str = "root";
pub const MAX_TAG_DEPTH: u32 = 32;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaletteColorWire {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileWire {
    pub id: String,
    pub ino: String,
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
    pub date_created: i64,
    pub date_last_indexed: i64,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagWire {
    pub id: String,
    pub name: String,
    pub date_added: i64,
    pub color: String,
    #[serde(default)]
    pub sub_tags: Vec<String>,
    pub is_hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubLocationWire {
    pub name: String,
    pub is_excluded: bool,
    #[serde(default)]
    pub sub_locations: Vec<SubLocationWire>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocationWire {
    pub id: String,
    pub path: String,
    pub date_added: i64,
    #[serde(default)]
    pub sub_locations: Vec<SubLocationWire>,
    pub index: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedSearchWire {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub criteria: Vec<SearchCriteriaWire>,
    #[serde(default)]
    pub match_any: bool,
    pub index: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchCriteriaWire {
    pub key: FileColumn,
    pub value_type: SearchValueType,
    pub operator: SearchOperator,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SearchValueType {
    Number,
    Date,
    String,
    Array,
    Color,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SearchOperator {
    Equals,
    EqualsIgnoreCase,
    NotEqual,
    StartsWith,
    StartsWithIgnoreCase,
    NotStartsWith,
    Contains,
    NotContains,
    ContainsRecursively,
    ContainsNotRecursively,
    SmallerThan,
    SmallerThanOrEquals,
    GreaterThan,
    GreaterThanOrEquals,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileColumn {
    Id,
    Ino,
    LocationId,
    RelativePath,
    AbsolutePath,
    Tags,
    Size,
    Width,
    Height,
    DateAdded,
    DateModified,
    DateCreated,
    DateLastIndexed,
    Name,
    Extension,
    Description,
    Rating,
    Duration,
    Palette,
}

impl FileColumn {
    /// Returns the qualified SQLite column expression on alias `f` for scalar columns.
    pub fn sql_column(self) -> Option<&'static str> {
        match self {
            FileColumn::Id => Some("f.id"),
            FileColumn::Ino => Some("f.ino"),
            FileColumn::LocationId => Some("f.location_id"),
            FileColumn::RelativePath => Some("f.relative_path"),
            FileColumn::AbsolutePath => Some("f.absolute_path"),
            FileColumn::Size => Some("f.size"),
            FileColumn::Width => Some("f.width"),
            FileColumn::Height => Some("f.height"),
            FileColumn::DateAdded => Some("f.date_added"),
            FileColumn::DateModified => Some("f.date_modified"),
            FileColumn::DateCreated => Some("f.date_created"),
            FileColumn::DateLastIndexed => Some("f.date_last_indexed"),
            FileColumn::Name => Some("f.name"),
            FileColumn::Extension => Some("f.extension"),
            FileColumn::Description => Some("f.description"),
            FileColumn::Rating => Some("f.rating"),
            FileColumn::Duration => Some("f.duration"),
            FileColumn::Tags | FileColumn::Palette => None,
        }
    }

    pub fn is_nullable(self) -> bool {
        matches!(self, FileColumn::Description | FileColumn::Duration)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            FileColumn::Id => "id",
            FileColumn::Ino => "ino",
            FileColumn::LocationId => "locationId",
            FileColumn::RelativePath => "relativePath",
            FileColumn::AbsolutePath => "absolutePath",
            FileColumn::Tags => "tags",
            FileColumn::Size => "size",
            FileColumn::Width => "width",
            FileColumn::Height => "height",
            FileColumn::DateAdded => "dateAdded",
            FileColumn::DateModified => "dateModified",
            FileColumn::DateCreated => "dateCreated",
            FileColumn::DateLastIndexed => "dateLastIndexed",
            FileColumn::Name => "name",
            FileColumn::Extension => "extension",
            FileColumn::Description => "description",
            FileColumn::Rating => "rating",
            FileColumn::Duration => "duration",
            FileColumn::Palette => "palette",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OrderByField {
    Id,
    Ino,
    LocationId,
    RelativePath,
    AbsolutePath,
    Tags,
    Size,
    Width,
    Height,
    DateAdded,
    DateModified,
    DateCreated,
    DateLastIndexed,
    Name,
    Extension,
    Description,
    Rating,
    Duration,
    Palette,
    Random,
}

impl OrderByField {
    pub fn order_clause(self, direction: OrderDirectionWire) -> String {
        let dir = direction.as_sql();
        match self {
            OrderByField::Name => format!("f.name COLLATE NOCASE {dir}, f.id ASC"),
            OrderByField::AbsolutePath => format!("f.absolute_path {dir}"),
            OrderByField::Extension => format!("f.extension {dir}, f.name COLLATE NOCASE ASC"),
            OrderByField::Size => format!("f.size {dir}, f.id ASC"),
            OrderByField::DateAdded => format!("f.date_added {dir}, f.id ASC"),
            OrderByField::DateModified => format!("f.date_modified {dir}, f.id ASC"),
            OrderByField::DateCreated => format!("f.date_created {dir}, f.id ASC"),
            OrderByField::DateLastIndexed => format!("f.date_last_indexed {dir}, f.id ASC"),
            OrderByField::Width => format!("f.width {dir}, f.id ASC"),
            OrderByField::Height => format!("f.height {dir}, f.id ASC"),
            OrderByField::Rating => format!("f.rating {dir}, f.id ASC"),
            OrderByField::Duration => format!("COALESCE(f.duration, 0.0) {dir}, f.id ASC"),
            OrderByField::Ino => format!("f.ino {dir}, f.id ASC"),
            OrderByField::LocationId => format!("f.location_id {dir}, f.id ASC"),
            OrderByField::RelativePath => format!("f.relative_path {dir}, f.id ASC"),
            OrderByField::Description => format!("COALESCE(f.description, '') {dir}, f.id ASC"),
            OrderByField::Id | OrderByField::Tags | OrderByField::Palette => format!("f.id {dir}"),
            OrderByField::Random => "RANDOM()".to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum OrderDirectionWire {
    Asc = 0,
    Desc = 1,
}

impl OrderDirectionWire {
    pub fn as_sql(self) -> &'static str {
        match self {
            OrderDirectionWire::Asc => "ASC",
            OrderDirectionWire::Desc => "DESC",
        }
    }
}

impl<'de> Deserialize<'de> for OrderDirectionWire {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct Visitor;

        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = OrderDirectionWire;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("0, 1, 'asc', or 'desc'")
            }

            fn visit_u64<E>(self, v: u64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                match v {
                    0 => Ok(OrderDirectionWire::Asc),
                    1 => Ok(OrderDirectionWire::Desc),
                    _ => Err(E::custom(format!("invalid OrderDirection number: {v}"))),
                }
            }

            fn visit_i64<E>(self, v: i64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                match v {
                    0 => Ok(OrderDirectionWire::Asc),
                    1 => Ok(OrderDirectionWire::Desc),
                    _ => Err(E::custom(format!("invalid OrderDirection number: {v}"))),
                }
            }

            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                match v.to_ascii_lowercase().as_str() {
                    "asc" | "0" => Ok(OrderDirectionWire::Asc),
                    "desc" | "1" => Ok(OrderDirectionWire::Desc),
                    _ => Err(E::custom(format!("invalid OrderDirection string: {v}"))),
                }
            }
        }

        deserializer.deserialize_any(Visitor)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileKeyField {
    Id,
    Ino,
    LocationId,
    RelativePath,
    AbsolutePath,
    Name,
    Extension,
    Size,
    Width,
    Height,
    DateAdded,
    DateModified,
    DateCreated,
    DateLastIndexed,
    Description,
    Rating,
    Duration,
}

impl FileKeyField {
    pub fn sql_column(self) -> &'static str {
        match self {
            FileKeyField::Id => "f.id",
            FileKeyField::Ino => "f.ino",
            FileKeyField::LocationId => "f.location_id",
            FileKeyField::RelativePath => "f.relative_path",
            FileKeyField::AbsolutePath => "f.absolute_path",
            FileKeyField::Name => "f.name",
            FileKeyField::Extension => "f.extension",
            FileKeyField::Size => "f.size",
            FileKeyField::Width => "f.width",
            FileKeyField::Height => "f.height",
            FileKeyField::DateAdded => "f.date_added",
            FileKeyField::DateModified => "f.date_modified",
            FileKeyField::DateCreated => "f.date_created",
            FileKeyField::DateLastIndexed => "f.date_last_indexed",
            FileKeyField::Description => "f.description",
            FileKeyField::Rating => "f.rating",
            FileKeyField::Duration => "f.duration",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum WireValue {
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
}
