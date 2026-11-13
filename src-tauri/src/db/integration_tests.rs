use chrono::{Duration as ChronoDuration, Local, TimeZone};
use serde_json::json;
use tempfile::tempdir;

use super::repo::*;
use super::wire::*;
use super::{open_connection, open_in_memory};

const SUPPORTED_IMG_EXTENSIONS: &[&str] = &[
    "gif", "png", "apng", "jpg", "jpeg", "jfif", "webp", "tif", "tiff", "bmp", "ico", "svg", "psd",
    "kra", "exr", "mp4", "webm", "mov", "mkv", "ogg", "avi",
];

fn make_file(id: &str) -> FileWire {
    let ts = 1_750_000_000_000_i64;
    FileWire {
        id: id.to_string(),
        ino: format!("ino_{id}"),
        location_id: "loc1".to_string(),
        relative_path: format!("{id}.jpg"),
        absolute_path: format!("c:/test/{id}.jpg"),
        tags: Vec::new(),
        size: 1024,
        width: 640,
        height: 480,
        date_added: ts,
        date_modified: ts,
        date_created: ts,
        date_last_indexed: ts,
        name: format!("{id}.jpg"),
        extension: "jpg".to_string(),
        description: None,
        rating: Some(0),
        duration: None,
        palette: None,
    }
}

fn make_tag(id: &str, name: &str) -> TagWire {
    TagWire {
        id: id.to_string(),
        name: name.to_string(),
        date_added: 1_750_000_000_000,
        color: "#ff0000".to_string(),
        sub_tags: Vec::new(),
        is_hidden: false,
    }
}

fn crit(
    key: FileColumn,
    value_type: SearchValueType,
    operator: SearchOperator,
    value: serde_json::Value,
) -> SearchCriteriaWire {
    SearchCriteriaWire {
        key,
        value_type,
        operator,
        value,
    }
}

#[test]
fn round_trip_all_entities_and_counts() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("allusion.db");
    let conn = open_connection(&db_path).unwrap();

    // Locations + nested sublocations round-trip
    let loc = LocationWire {
        id: "loc1".to_string(),
        path: r"C:\Pictures".to_string(),
        date_added: 1_700_000_000_000,
        sub_locations: vec![
            SubLocationWire {
                name: "References".to_string(),
                is_excluded: false,
                sub_locations: vec![SubLocationWire {
                    name: "NSFW".to_string(),
                    is_excluded: true,
                    sub_locations: Vec::new(),
                }],
            },
            SubLocationWire {
                name: "Archive".to_string(),
                is_excluded: false,
                sub_locations: Vec::new(),
            },
        ],
        index: 0,
    };
    create_location(&conn, &loc).unwrap();
    let locs = fetch_locations(&conn).unwrap();
    assert_eq!(locs, vec![loc.clone()]);

    let mut updated_loc = loc;
    updated_loc.index = 2;
    updated_loc.sub_locations.pop();
    save_location(&conn, &updated_loc).unwrap();
    assert_eq!(fetch_locations(&conn).unwrap(), vec![updated_loc]);

    // Tags round-trip
    let t1 = make_tag("t1", "Concept Art");
    create_tag(&conn, &t1).unwrap();
    let tags = fetch_tags(&conn).unwrap();
    assert_eq!(tags[0].id, ROOT_TAG_ID);
    assert_eq!(tags[0].sub_tags, vec!["t1"]);
    assert_eq!(tags[1].name, "Concept Art");

    // Files round-trip (drive letter normalized c:/ -> C:/)
    let mut f1 = make_file("f1");
    f1.tags = vec!["t1".to_string()];
    f1.description = Some("A watercolor dragon".to_string());
    f1.rating = Some(4);
    f1.duration = Some(12.5);
    f1.palette = Some(vec![
        PaletteColorWire {
            r: 15,
            g: 130,
            b: 230,
            percentage: 0.65,
        },
        PaletteColorWire {
            r: 235,
            g: 50,
            b: 45,
            percentage: 0.35,
        },
    ]);
    let f2 = make_file("f2");

    create_files_from_path(&conn, "c:/test", &[f1.clone(), f2.clone()]).unwrap();
    // Duplicate absolutePath via create_files_from_path is ignored without overwriting
    let mut dup_f1 = make_file("f1_dup");
    dup_f1.absolute_path = f1.absolute_path.clone();
    dup_f1.rating = Some(1);
    create_files_from_path(&conn, "c:/test", &[dup_f1]).unwrap();

    let fetched =
        fetch_files(&conn, OrderByField::Id, OrderDirectionWire::Asc, None, None).unwrap();
    assert_eq!(fetched.len(), 2);
    assert_eq!(fetched[0].absolute_path, "C:/test/f1.jpg");
    assert_eq!(fetched[0].tags, vec!["t1"]);
    assert_eq!(
        fetched[0].description.as_deref(),
        Some("A watercolor dragon")
    );
    assert_eq!(fetched[0].rating, Some(4));
    assert_eq!(fetched[0].duration, Some(12.5));
    assert_eq!(fetched[0].palette.as_ref().map(Vec::len), Some(2));
    assert_eq!(fetched[1].palette, None);

    // fetch_files_by_id + fetch_files_by_key (with lowercase drive normalization)
    let by_id = fetch_files_by_id(&conn, &["f1".to_string()]).unwrap();
    assert_eq!(by_id.len(), 1);
    assert_eq!(by_id[0].id, "f1");

    let by_path = fetch_files_by_key(
        &conn,
        FileKeyField::AbsolutePath,
        &WireValue::Str("c:/test/f1.jpg".to_string()),
    )
    .unwrap();
    assert_eq!(by_path.len(), 1);
    assert_eq!(by_path[0].id, "f1");

    // save_files updates metadata, tags, and palette
    let mut edited = fetched[0].clone();
    edited.rating = Some(5);
    edited.tags = Vec::new();
    edited.palette = None;
    save_files(&conn, &[edited]).unwrap();
    let after_save = fetch_files_by_id(&conn, &["f1".to_string()]).unwrap();
    assert_eq!(after_save[0].rating, Some(5));
    assert!(after_save[0].tags.is_empty());
    assert_eq!(after_save[0].palette, None);

    // count_files (now both f1 and f2 are untagged)
    assert_eq!(count_files(&conn).unwrap(), (2, 2));

    // SavedSearch round-trip
    let search = SavedSearchWire {
        id: "s1".to_string(),
        name: "High rated dragons".to_string(),
        criteria: vec![
            crit(
                FileColumn::Rating,
                SearchValueType::Number,
                SearchOperator::GreaterThanOrEquals,
                json!(4),
            ),
            crit(
                FileColumn::Description,
                SearchValueType::String,
                SearchOperator::Contains,
                json!("dragon"),
            ),
        ],
        match_any: false,
        index: 0,
    };
    create_search(&conn, &search).unwrap();
    assert_eq!(fetch_searches(&conn).unwrap(), vec![search.clone()]);

    let mut search_v2 = search;
    search_v2.match_any = true;
    search_v2.name = "Dragons or high rated".to_string();
    save_search(&conn, &search_v2).unwrap();
    assert_eq!(fetch_searches(&conn).unwrap(), vec![search_v2]);

    remove_search(&conn, "s1").unwrap();
    assert!(fetch_searches(&conn).unwrap().is_empty());

    // remove_files & clear
    remove_files(&conn, &["f1".to_string()]).unwrap();
    assert_eq!(count_files(&conn).unwrap(), (1, 1));
    clear(&conn).unwrap();
    assert_eq!(count_files(&conn).unwrap(), (0, 0));
    assert_eq!(fetch_tags(&conn).unwrap().len(), 1);
    assert_eq!(fetch_tags(&conn).unwrap()[0].id, ROOT_TAG_ID);
    drop(conn);

    // Idempotent reopen on disk
    let reopened = open_connection(&db_path).unwrap();
    assert_eq!(fetch_tags(&reopened).unwrap()[0].id, ROOT_TAG_ID);
}

#[test]
fn tag_hierarchy_reorder_dual_save_order_and_orphan_reattachment() {
    let conn = open_in_memory().unwrap();

    for (id, name) in [
        ("p1", "Parent 1"),
        ("p2", "Parent 2"),
        ("c1", "Child 1"),
        ("c2", "Child 2"),
        ("c3", "Child 3"),
    ] {
        create_tag(&conn, &make_tag(id, name)).unwrap();
    }

    let mut root = make_tag(ROOT_TAG_ID, "Root");
    root.sub_tags = vec!["p1".to_string(), "p2".to_string()];
    save_tag(&conn, &root).unwrap();

    // Reorder children under p1
    let mut p1 = make_tag("p1", "Parent 1");
    p1.sub_tags = vec!["c3".to_string(), "c1".to_string(), "c2".to_string()];
    save_tag(&conn, &p1).unwrap();

    let mut p2 = make_tag("p2", "Parent 2");
    save_tag(&conn, &p2).unwrap();

    let tags = fetch_tags(&conn).unwrap();
    let found_p1 = tags.iter().find(|t| t.id == "p1").unwrap();
    assert_eq!(found_p1.sub_tags, vec!["c3", "c1", "c2"]);

    // Order A: move c1 from p1 -> p2 saving newParent (p2) BEFORE oldParent (p1)
    p2.sub_tags = vec!["c1".to_string()];
    p1.sub_tags = vec!["c3".to_string(), "c2".to_string()];
    save_tag(&conn, &p2).unwrap();
    save_tag(&conn, &p1).unwrap();

    let tags = fetch_tags(&conn).unwrap();
    assert_eq!(
        tags.iter().find(|t| t.id == "p2").unwrap().sub_tags,
        vec!["c1"]
    );
    assert_eq!(
        tags.iter().find(|t| t.id == "p1").unwrap().sub_tags,
        vec!["c3", "c2"]
    );

    // Order B: move c2 from p1 -> p2 saving oldParent (p1) BEFORE newParent (p2)
    p1.sub_tags = vec!["c3".to_string()];
    p2.sub_tags = vec!["c1".to_string(), "c2".to_string()];
    save_tag(&conn, &p1).unwrap();
    save_tag(&conn, &p2).unwrap();

    let tags = fetch_tags(&conn).unwrap();
    assert_eq!(
        tags.iter().find(|t| t.id == "p1").unwrap().sub_tags,
        vec!["c3"]
    );
    assert_eq!(
        tags.iter().find(|t| t.id == "p2").unwrap().sub_tags,
        vec!["c1", "c2"]
    );

    // Deleting p1 with ON DELETE SET NULL leaves c3 as orphan -> fetch_tags reattaches c3 to root
    remove_tags(&conn, &["p1".to_string()]).unwrap();
    let tags = fetch_tags(&conn).unwrap();
    let root_after = tags.iter().find(|t| t.id == ROOT_TAG_ID).unwrap();
    assert!(tags.iter().any(|t| t.id == "c3"));
    assert_eq!(root_after.sub_tags, vec!["p2", "c3"]);
}

#[test]
fn ported_backend_tag_api_and_merge_without_duplicates() {
    let conn = open_in_memory().unwrap();
    create_tag(&conn, &make_tag("tag1", "tag1 name")).unwrap();
    let db_tags = fetch_tags(&conn).unwrap();
    assert_eq!(db_tags.len(), 2);
    assert_eq!(db_tags[0].id, ROOT_TAG_ID);
    assert_eq!(db_tags[1].id, "tag1");

    // removeTags preserves surviving tags on files
    create_tag(&conn, &make_tag("tag2", "tag2 name")).unwrap();
    create_tag(&conn, &make_tag("tag3", "tag3 name")).unwrap();
    let mut f_all = make_file("f_all");
    f_all.tags = vec!["tag1".to_string(), "tag2".to_string(), "tag3".to_string()];
    let mut f_only_1 = make_file("f_only_1");
    f_only_1.tags = vec!["tag1".to_string()];
    create_files_from_path(&conn, "c:/test", &[f_all, f_only_1]).unwrap();

    remove_tags(&conn, &["tag1".to_string(), "tag3".to_string()]).unwrap();
    let files = fetch_files(&conn, OrderByField::Id, OrderDirectionWire::Asc, None, None).unwrap();
    assert_eq!(files[0].tags, vec!["tag2"]);
    assert!(files[1].tags.is_empty());

    // merge_tags: f_dup has BOTH removed and kept; f_src has ONLY removed
    create_tag(&conn, &make_tag("dup_old", "Old")).unwrap();
    let mut f_dup = make_file("f_dup");
    f_dup.tags = vec!["tag2".to_string(), "dup_old".to_string()];
    let mut f_src = make_file("f_src");
    f_src.tags = vec!["dup_old".to_string()];
    create_files_from_path(&conn, "c:/test", &[f_dup, f_src]).unwrap();

    merge_tags(&conn, "dup_old", "tag2").unwrap();
    let after_merge = fetch_tags(&conn).unwrap();
    assert!(!after_merge.iter().any(|t| t.id == "dup_old"));

    let merged_files =
        fetch_files(&conn, OrderByField::Id, OrderDirectionWire::Asc, None, None).unwrap();
    let fd = merged_files.iter().find(|f| f.id == "f_dup").unwrap();
    let fs = merged_files.iter().find(|f| f.id == "f_src").unwrap();
    assert_eq!(fd.tags, vec!["tag2"]);
    assert_eq!(fs.tags, vec!["tag2"]);
}

#[test]
fn ported_description_search_and_string_operators() {
    let conn = open_in_memory().unwrap();

    let mut f1 = make_file("1");
    f1.name = "Alpha [100%]_Cafe.jpg".to_string();
    f1.absolute_path = "c:/loc/Sub [A]/Alpha [100%]_Cafe.jpg".to_string();
    f1.description = Some("My Nano Banana Prompt — Árvore".to_string());

    let mut f2 = make_file("2");
    f2.name = "banana.jpg".to_string();
    f2.absolute_path = "c:/loc/Other/banana.jpg".to_string();
    f2.description = None;

    let mut f3 = make_file("3");
    f3.name = "alpha_lower.jpg".to_string();
    f3.absolute_path = "c:/loc/Sub [A]/alpha_lower.jpg".to_string();
    f3.description = Some("Apple cider".to_string());

    create_files_from_path(&conn, "c:/loc", &[f1, f2, f3]).unwrap();

    // description contains & null robustness
    let r = search_files(
        &conn,
        &[crit(
            FileColumn::Description,
            SearchValueType::String,
            SearchOperator::Contains,
            json!("banana"),
        )],
        OrderByField::Name,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        r.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["1"]
    );

    // OR: name or description
    let r = search_files(
        &conn,
        &[
            crit(
                FileColumn::Description,
                SearchValueType::String,
                SearchOperator::Contains,
                json!("banana"),
            ),
            crit(
                FileColumn::Name,
                SearchValueType::String,
                SearchOperator::Contains,
                json!("banana"),
            ),
        ],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        true,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        r.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["1", "2"]
    );

    // Case-sensitive equals & startsWith (RFC 9.2 item 3)
    let r = search_files(
        &conn,
        &[crit(
            FileColumn::Name,
            SearchValueType::String,
            SearchOperator::Equals,
            json!("Alpha [100%]_Cafe.jpg"),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        r.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["1"]
    );

    let r = search_files(
        &conn,
        &[crit(
            FileColumn::Name,
            SearchValueType::String,
            SearchOperator::StartsWith,
            json!("Alpha"),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        r.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["1"]
    );

    // Folder prefix with `[` / `%` and lowercase drive query matching normalized path
    let r = search_files(
        &conn,
        &[crit(
            FileColumn::AbsolutePath,
            SearchValueType::String,
            SearchOperator::StartsWith,
            json!("c:/loc/Sub [A]/"),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        r.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["1", "3"]
    );

    // Unicode case-insensitive equalsIgnoreCase, startsWithIgnoreCase, contains
    let r = search_files(
        &conn,
        &[crit(
            FileColumn::Name,
            SearchValueType::String,
            SearchOperator::EqualsIgnoreCase,
            json!("alpha [100%]_cafe.jpg"),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        r.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["1"]
    );

    let r = search_files(
        &conn,
        &[crit(
            FileColumn::Description,
            SearchValueType::String,
            SearchOperator::Contains,
            json!("árvore"),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        r.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["1"]
    );

    let r = search_files(
        &conn,
        &[crit(
            FileColumn::Description,
            SearchValueType::String,
            SearchOperator::StartsWithIgnoreCase,
            json!("my nano"),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        r.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["1"]
    );

    // Negative operators treat NULL description as '' so f2 still matches!
    let r = search_files(
        &conn,
        &[crit(
            FileColumn::Description,
            SearchValueType::String,
            SearchOperator::NotContains,
            json!("apple"),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        r.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["1", "2"]
    );

    let r = search_files(
        &conn,
        &[crit(
            FileColumn::Description,
            SearchValueType::String,
            SearchOperator::NotStartsWith,
            json!("my "),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        r.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["2", "3"]
    );

    let r = search_files(
        &conn,
        &[crit(
            FileColumn::Description,
            SearchValueType::String,
            SearchOperator::NotEqual,
            json!("Apple cider"),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        r.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["1", "2"]
    );
}

#[test]
fn ported_color_filter_and_rating_and_numeric_operators() {
    let conn = open_in_memory().unwrap();

    let mut blue = make_file("1");
    blue.rating = Some(5);
    blue.size = 100;
    blue.duration = Some(10.0);
    blue.palette = Some(vec![
        PaletteColorWire {
            r: 200,
            g: 200,
            b: 200,
            percentage: 0.6,
        },
        PaletteColorWire {
            r: 10,
            g: 30,
            b: 240,
            percentage: 0.4,
        },
    ]);

    let mut red = make_file("2");
    red.rating = Some(3);
    red.size = 200;
    red.duration = Some(20.0);
    red.palette = Some(vec![PaletteColorWire {
        r: 240,
        g: 20,
        b: 20,
        percentage: 1.0,
    }]);

    let mut unrated_no_pal = make_file("3");
    unrated_no_pal.rating = None;
    unrated_no_pal.size = 300;
    unrated_no_pal.duration = None;
    unrated_no_pal.palette = None;

    let mut rated_zero = make_file("4");
    rated_zero.rating = Some(0);
    rated_zero.size = 400;
    rated_zero.palette = None;

    create_files_from_path(&conn, "c:/test", &[blue, red, unrated_no_pal, rated_zero]).unwrap();

    // Palette contains/notContains including empty string
    let r = search_files(
        &conn,
        &[crit(
            FileColumn::Palette,
            SearchValueType::Color,
            SearchOperator::Contains,
            json!("blue"),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        r.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["1"]
    );

    let r = search_files(
        &conn,
        &[crit(
            FileColumn::Palette,
            SearchValueType::Color,
            SearchOperator::NotContains,
            json!("blue"),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        r.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["2", "3", "4"]
    );

    let r = search_files(
        &conn,
        &[crit(
            FileColumn::Palette,
            SearchValueType::Color,
            SearchOperator::Contains,
            json!(""),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert!(r.is_empty());

    // Ported rating tests: rating >= 3 and rating == 0
    let r = search_files(
        &conn,
        &[crit(
            FileColumn::Rating,
            SearchValueType::Number,
            SearchOperator::GreaterThanOrEquals,
            json!(3),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        r.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["1", "2"]
    );

    let r = search_files(
        &conn,
        &[crit(
            FileColumn::Rating,
            SearchValueType::Number,
            SearchOperator::Equals,
            json!(0),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        r.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["3", "4"]
    );

    // Remaining numeric operators (<, <=, >, !=) + COALESCE on nullable duration
    let ops_expected: &[(FileColumn, SearchOperator, serde_json::Value, &[&str])] = &[
        (
            FileColumn::Size,
            SearchOperator::NotEqual,
            json!(200),
            &["1", "3", "4"],
        ),
        (
            FileColumn::Size,
            SearchOperator::SmallerThan,
            json!(300),
            &["1", "2"],
        ),
        (
            FileColumn::Size,
            SearchOperator::SmallerThanOrEquals,
            json!(300),
            &["1", "2", "3"],
        ),
        (
            FileColumn::Size,
            SearchOperator::GreaterThan,
            json!(200),
            &["3", "4"],
        ),
        (
            FileColumn::Duration,
            SearchOperator::Equals,
            json!(0.0),
            &["3", "4"],
        ),
        (
            FileColumn::Duration,
            SearchOperator::GreaterThan,
            json!(15.0),
            &["2"],
        ),
    ];
    for (col, op, val, expected) in ops_expected {
        let res = search_files(
            &conn,
            &[crit(*col, SearchValueType::Number, *op, val.clone())],
            OrderByField::Id,
            OrderDirectionWire::Asc,
            false,
            None,
            None,
        )
        .unwrap();
        let got: Vec<&str> = res.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(got, *expected, "failed for {col:?} {op:?} {val}");
    }
}

#[test]
fn date_operators_fix_equals_and_bound_by_local_calendar_day() {
    let conn = open_in_memory().unwrap();

    let day2_noon = Local
        .with_ymd_and_hms(2025, 6, 15, 12, 0, 0)
        .single()
        .unwrap();
    let day1_late = day2_noon - ChronoDuration::days(1);
    let day2_early = Local
        .with_ymd_and_hms(2025, 6, 15, 0, 5, 0)
        .single()
        .unwrap();
    let day2_late = Local
        .with_ymd_and_hms(2025, 6, 15, 23, 55, 0)
        .single()
        .unwrap();
    let day3_early = day2_noon + ChronoDuration::days(1);

    for (id, dt) in [
        ("d1", day1_late),
        ("d2_a", day2_early),
        ("d2_b", day2_late),
        ("d3", day3_early),
    ] {
        let mut f = make_file(id);
        f.date_added = dt.timestamp_millis();
        create_files_from_path(&conn, "c:/test", &[f]).unwrap();
    }

    let query_val = json!(day2_noon.timestamp_millis());
    let cases: &[(SearchOperator, &[&str])] = &[
        // Regression test for Dexie's `||` bug on Equals: only day2 matches!
        (SearchOperator::Equals, &["d2_a", "d2_b"]),
        (SearchOperator::NotEqual, &["d1", "d3"]),
        (SearchOperator::SmallerThan, &["d1"]),
        (SearchOperator::SmallerThanOrEquals, &["d1", "d2_a", "d2_b"]),
        (SearchOperator::GreaterThan, &["d3"]),
        (SearchOperator::GreaterThanOrEquals, &["d2_a", "d2_b", "d3"]),
    ];

    for (op, expected) in cases {
        let res = search_files(
            &conn,
            &[crit(
                FileColumn::DateAdded,
                SearchValueType::Date,
                *op,
                query_val.clone(),
            )],
            OrderByField::Id,
            OrderDirectionWire::Asc,
            false,
            None,
            None,
        )
        .unwrap();
        let got: Vec<&str> = res.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(got, *expected, "date operator {op:?} mismatch");
    }
}

#[test]
fn tag_operators_and_recursive_cte_and_cycle_guard() {
    let conn = open_in_memory().unwrap();

    for (id, name) in [
        ("animal", "Animal"),
        ("mammal", "Mammal"),
        ("cat", "Cat"),
        ("plant", "Plant"),
    ] {
        create_tag(&conn, &make_tag(id, name)).unwrap();
    }

    let mut animal = make_tag("animal", "Animal");
    animal.sub_tags = vec!["mammal".to_string()];
    save_tag(&conn, &animal).unwrap();
    let mut mammal = make_tag("mammal", "Mammal");
    mammal.sub_tags = vec!["cat".to_string()];
    save_tag(&conn, &mammal).unwrap();

    let mut f_animal = make_file("f_animal");
    f_animal.tags = vec!["animal".to_string()];
    let mut f_cat = make_file("f_cat");
    f_cat.tags = vec!["cat".to_string()];
    let mut f_plant = make_file("f_plant");
    f_plant.tags = vec!["plant".to_string()];
    let f_untagged = make_file("f_untagged");

    create_files_from_path(&conn, "c:/test", &[f_animal, f_cat, f_plant, f_untagged]).unwrap();

    // Empty array = untagged / any-tag
    let untagged = search_files(
        &conn,
        &[crit(
            FileColumn::Tags,
            SearchValueType::Array,
            SearchOperator::Contains,
            json!([]),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        untagged.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["f_untagged"]
    );

    let tagged = search_files(
        &conn,
        &[crit(
            FileColumn::Tags,
            SearchValueType::Array,
            SearchOperator::NotContains,
            json!([]),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        tagged.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["f_animal", "f_cat", "f_plant"]
    );

    // Non-recursive contains vs containsRecursively + containsNotRecursively
    let direct_animal = search_files(
        &conn,
        &[crit(
            FileColumn::Tags,
            SearchValueType::Array,
            SearchOperator::Contains,
            json!(["animal"]),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        direct_animal
            .iter()
            .map(|f| f.id.as_str())
            .collect::<Vec<_>>(),
        vec!["f_animal"]
    );

    let rec_animal = search_files(
        &conn,
        &[crit(
            FileColumn::Tags,
            SearchValueType::Array,
            SearchOperator::ContainsRecursively,
            json!(["animal"]),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        rec_animal.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["f_animal", "f_cat"]
    );

    let not_rec_animal = search_files(
        &conn,
        &[crit(
            FileColumn::Tags,
            SearchValueType::Array,
            SearchOperator::ContainsNotRecursively,
            json!(["animal"]),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        not_rec_animal
            .iter()
            .map(|f| f.id.as_str())
            .collect::<Vec<_>>(),
        vec!["f_plant", "f_untagged"]
    );

    // Cycle safety: introduce parent cycle animal -> mammal -> cat -> animal; CTE must terminate!
    conn.execute("UPDATE tags SET parent_id = 'cat' WHERE id = 'animal'", [])
        .unwrap();
    let rec_cycle = search_files(
        &conn,
        &[crit(
            FileColumn::Tags,
            SearchValueType::Array,
            SearchOperator::ContainsRecursively,
            json!(["animal"]),
        )],
        OrderByField::Id,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        rec_cycle.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["f_animal", "f_cat"]
    );
}

#[test]
fn ported_purge_unsupported_extensions_and_remove_location_cascade() {
    let conn = open_in_memory().unwrap();
    create_tag(&conn, &make_tag("t1", "Tag")).unwrap();

    create_location(
        &conn,
        &LocationWire {
            id: "loc_a".to_string(),
            path: "C:/loc_a".to_string(),
            date_added: 1,
            sub_locations: vec![SubLocationWire {
                name: "sub".to_string(),
                is_excluded: false,
                sub_locations: Vec::new(),
            }],
            index: 0,
        },
    )
    .unwrap();
    create_location(
        &conn,
        &LocationWire {
            id: "loc_b".to_string(),
            path: "C:/loc_b".to_string(),
            date_added: 2,
            sub_locations: Vec::new(),
            index: 1,
        },
    )
    .unwrap();

    let mut ok1 = make_file("ok1");
    ok1.location_id = "loc_a".to_string();
    ok1.absolute_path = "C:/loc_a/ok1.jpg".to_string();
    ok1.tags = vec!["t1".to_string()];
    ok1.palette = Some(vec![PaletteColorWire {
        r: 255,
        g: 0,
        b: 0,
        percentage: 1.0,
    }]);

    let mut ghost1 = make_file("ghost1");
    ghost1.location_id = "loc_a".to_string();
    ghost1.absolute_path = "C:/loc_a/ghost1.crdownload".to_string();
    ghost1.extension = "crdownload".to_string();

    let mut ghost2 = make_file("ghost2");
    ghost2.location_id = "loc_a".to_string();
    ghost2.absolute_path = "C:/loc_a/ghost2.tmp".to_string();
    ghost2.extension = "tmp".to_string();

    let mut ok_b = make_file("ok_b");
    ok_b.location_id = "loc_b".to_string();
    ok_b.absolute_path = "C:/loc_b/ok_b.exr".to_string();
    ok_b.extension = "exr".to_string();
    ok_b.tags = vec!["t1".to_string()];
    ok_b.palette = Some(vec![PaletteColorWire {
        r: 0,
        g: 0,
        b: 255,
        percentage: 1.0,
    }]);

    create_files_from_path(&conn, "C:/", &[ok1, ghost1, ghost2, ok_b]).unwrap();

    let removed = purge_unsupported_extensions(&conn, SUPPORTED_IMG_EXTENSIONS).unwrap();
    assert_eq!(removed, 2);
    assert_eq!(
        purge_unsupported_extensions(&conn, SUPPORTED_IMG_EXTENSIONS).unwrap(),
        0
    );

    // remove_location deletes loc_a, its sublocations, ok1, ok1's file_tags & file_palette, keeping loc_b!
    remove_location(&conn, "loc_a").unwrap();

    let remaining_locs = fetch_locations(&conn).unwrap();
    assert_eq!(remaining_locs.len(), 1);
    assert_eq!(remaining_locs[0].id, "loc_b");

    let remaining_files =
        fetch_files(&conn, OrderByField::Id, OrderDirectionWire::Asc, None, None).unwrap();
    assert_eq!(remaining_files.len(), 1);
    assert_eq!(remaining_files[0].id, "ok_b");

    let file_tags_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM file_tags", [], |r| r.get(0))
        .unwrap();
    let file_palette_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM file_palette", [], |r| r.get(0))
        .unwrap();
    assert_eq!(file_tags_count, 1);
    assert_eq!(file_palette_count, 1);
}

#[test]
#[ignore]
fn bench_scale() {
    run_scale_bench(10_000);
    run_scale_bench(30_000);
}

fn run_scale_bench(total: usize) {
    use std::time::Instant;

    struct Rng(u64);
    impl Rng {
        fn next_u64(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            self.0 = x;
            x
        }
        fn next_usize(&mut self, upper: usize) -> usize {
            (self.next_u64() as usize) % upper
        }
    }

    let dir = tempdir().unwrap();
    let db_path = dir.path().join(format!("bench_{total}.db"));
    let conn = open_connection(&db_path).unwrap();

    // 300 hierarchical tags: t_000..t_299 (roots t_000..t_009 with 3 levels underneath)
    for i in 0..300_usize {
        create_tag(
            &conn,
            &make_tag(&format!("t_{i:03}"), &format!("Tag {i:03}")),
        )
        .unwrap();
    }
    let mut root = make_tag(ROOT_TAG_ID, "Root");
    root.sub_tags = (0..10).map(|i| format!("t_{i:03}")).collect();
    save_tag(&conn, &root).unwrap();
    for p in 0..60_usize {
        let mut parent = make_tag(&format!("t_{p:03}"), &format!("Tag {p:03}"));
        let start = 10 + p * 4;
        if start + 4 <= 300 {
            parent.sub_tags = (start..start + 4).map(|i| format!("t_{i:03}")).collect();
            save_tag(&conn, &parent).unwrap();
        }
    }

    let exts = ["jpg", "png", "webp", "mp4", "psd", "exr"];
    let palette_pool = [
        PaletteColorWire {
            r: 229,
            g: 57,
            b: 53,
            percentage: 0.45,
        },
        PaletteColorWire {
            r: 30,
            g: 136,
            b: 229,
            percentage: 0.30,
        },
        PaletteColorWire {
            r: 67,
            g: 160,
            b: 71,
            percentage: 0.15,
        },
        PaletteColorWire {
            r: 253,
            g: 216,
            b: 53,
            percentage: 0.10,
        },
    ];

    let batch_size = 2_000_usize;
    let mut rng = Rng(42);
    let base_ts = 1_750_000_000_000_i64;

    let t_insert = Instant::now();
    for start in (0..total).step_by(batch_size) {
        let end = (start + batch_size).min(total);
        let mut batch = Vec::with_capacity(end - start);
        for i in start..end {
            let ext = exts[rng.next_usize(exts.len())];
            let has_tags = rng.next_usize(10) != 0;
            let tags = if has_tags {
                vec![
                    format!("t_{:03}", rng.next_usize(300)),
                    format!("t_{:03}", rng.next_usize(300)),
                    format!("t_{:03}", rng.next_usize(300)),
                ]
            } else {
                Vec::new()
            };
            let description = if i % 3 == 0 {
                Some(format!(
                    "concept study {} watercolor landscape lighting reference",
                    i
                ))
            } else {
                None
            };
            let palette = if i % 10 != 0 {
                Some(palette_pool.to_vec())
            } else {
                None
            };

            batch.push(FileWire {
                id: format!("file_{i:06}"),
                ino: format!("ino_{i}"),
                location_id: format!("loc_{}", i % 5),
                relative_path: format!("folder_{}/img_{i:06}.{ext}", i % 100),
                absolute_path: format!(
                    "C:/library/loc_{}/folder_{}/img_{i:06}.{ext}",
                    i % 5,
                    i % 100
                ),
                tags,
                size: 100_000 + (rng.next_u64() % 20_000_000) as i64,
                width: 1920,
                height: 1080,
                date_added: base_ts + i as i64,
                date_modified: base_ts + i as i64,
                date_created: base_ts + i as i64,
                date_last_indexed: base_ts,
                name: if i % 500 == 0 {
                    format!("landscape_hero_{i:06}.{ext}")
                } else {
                    format!("character_study_{i:06}.{ext}")
                },
                extension: ext.to_string(),
                description,
                rating: Some((i % 6) as i64),
                duration: if ext == "mp4" { Some(18.5) } else { None },
                palette,
            });
        }
        create_files_from_path(&conn, "C:/library", &batch).unwrap();
    }
    let insert_elapsed = t_insert.elapsed();
    assert_eq!(count_files(&conn).unwrap().0, total as u64);

    // Search 1: Leaf tag contains
    let t_s1 = Instant::now();
    let res1 = search_files(
        &conn,
        &[crit(
            FileColumn::Tags,
            SearchValueType::Array,
            SearchOperator::Contains,
            json!(["t_150"]),
        )],
        OrderByField::DateAdded,
        OrderDirectionWire::Desc,
        false,
        None,
        None,
    )
    .unwrap();
    let s1_elapsed = t_s1.elapsed();

    // Search 2: Recursive parent tag CTE containsRecursively
    let t_s2 = Instant::now();
    let res2 = search_files(
        &conn,
        &[crit(
            FileColumn::Tags,
            SearchValueType::Array,
            SearchOperator::ContainsRecursively,
            json!(["t_001"]),
        )],
        OrderByField::DateAdded,
        OrderDirectionWire::Desc,
        false,
        None,
        None,
    )
    .unwrap();
    let s2_elapsed = t_s2.elapsed();

    // Search 3: Name contains + rating >= 4
    let t_s3 = Instant::now();
    let res3 = search_files(
        &conn,
        &[
            crit(
                FileColumn::Name,
                SearchValueType::String,
                SearchOperator::Contains,
                json!("landscape_hero"),
            ),
            crit(
                FileColumn::Rating,
                SearchValueType::Number,
                SearchOperator::GreaterThanOrEquals,
                json!(4),
            ),
        ],
        OrderByField::Name,
        OrderDirectionWire::Asc,
        false,
        None,
        None,
    )
    .unwrap();
    let s3_elapsed = t_s3.elapsed();

    println!(
        "BENCH_{total} insert={:.2}ms ({:.0} files/s) | tag_contains={} ({:.2}ms) | tag_recursive_cte={} ({:.2}ms) | name_plus_rating={} ({:.2}ms)",
        insert_elapsed.as_secs_f64() * 1000.0,
        total as f64 / insert_elapsed.as_secs_f64(),
        res1.len(),
        s1_elapsed.as_secs_f64() * 1000.0,
        res2.len(),
        s2_elapsed.as_secs_f64() * 1000.0,
        res3.len(),
        s3_elapsed.as_secs_f64() * 1000.0,
    );
    assert!(!res1.is_empty());
    assert!(res2.len() >= res1.len() || !res2.is_empty());
    assert!(!res3.is_empty());
}
