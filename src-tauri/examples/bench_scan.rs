//! Benchmark de indexação do scanner Rust multithread (issue #23).
//!
//! Uso:
//!   cargo run --release --example bench_scan -- --generate <n> [<dir>]
//!   cargo run --release --example bench_scan -- <dir> [ext1,ext2,...]
//!
//! Modo `--generate`: cria um dataset sintético com `n` arquivos em um diretório
//! temporário e o varre, imprimindo `{"count":..., "elapsed_ms":...}`.

use allusion_lib::services::scanner;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

const EXTS: [&str; 8] = ["jpg", "png", "webp", "psd", "exr", "tif", "gif", "bmp"];

fn generate_dataset(count: usize, dir: &Path) -> Result<(), String> {
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    let start = Instant::now();
    let buf = vec![0u8; 2048];
    for i in 0..count {
        let ext = EXTS[i % EXTS.len()];
        let path = dir.join(format!("img_{i:06}.{ext}"));
        fs::write(&path, &buf).map_err(|e| e.to_string())?;
    }
    eprintln!(
        "generated {count} files in {} ms",
        start.elapsed().as_millis()
    );
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dir: PathBuf;
    let extensions: Option<Vec<String>>;

    if args.get(1).map(|s| s.as_str()) == Some("--generate") {
        let n: usize = args
            .get(2)
            .map(|s| s.parse().expect("count must be a number"))
            .expect("usage: bench_scan --generate <n> [<dir>]");
        dir = args
            .get(3)
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join(format!("allusion-bench-{n}")));
        generate_dataset(n, &dir).expect("failed to generate dataset");
        extensions = Some(EXTS.iter().map(|s| s.to_string()).collect());
    } else {
        dir = args
            .get(1)
            .map(PathBuf::from)
            .expect("usage: bench_scan <dir> [ext1,ext2,...]");
        extensions = args
            .get(2)
            .map(|csv| csv.split(',').map(|s| s.to_string()).collect());
    }

    let start = Instant::now();
    let result = scanner::scan_directory(&dir, extensions);
    let elapsed_ms = start.elapsed().as_millis();

    match result {
        Ok(files) => println!(r#"{{"count":{},"elapsed_ms":{}}}"#, files.len(), elapsed_ms),
        Err(e) => {
            eprintln!("scan error: {e}");
            std::process::exit(1);
        }
    }
}
