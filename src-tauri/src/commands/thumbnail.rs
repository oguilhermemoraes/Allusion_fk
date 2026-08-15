use image::GenericImageView;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use super::palette::{extract_palette_from_pixels, PaletteColor};

/// Bounds the number of concurrent native thumbnail decodes.
///
/// Each decode turns a full-size image into raw RGBA in memory (a single 8K photo
/// is ~130 MB), and Tokio's blocking pool can spawn up to 512 threads by default.
/// Without this limit, opening a large library decodes dozens of 4K/8K images at
/// once and RAM explodes (see issue #42). 4 mirrors the pool limit used by the JS
/// thumbnail worker (`nativeThumbnail.ts`).
static DECODE_SEMAPHORE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateThumbnailParams {
    pub path: String,
    pub out_path: String,
    pub target_size: u32,
}

/// A successful thumbnail pass: whether the file was generated (or was a cache hit)
/// plus the dominant palette extracted from the very buffer used for the thumbnail.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateThumbnailResult {
    /// `true` when the thumbnail was generated, `false` on a cache hit.
    pub generated: bool,
    /// Dominant colors of the image (oldest first by coverage). Empty on a cache
    /// hit, since the image is not decoded at all in that case.
    pub palette: Vec<PaletteColor>,
}

/// Generates a WebP thumbnail (largest dimension clamped to `target_size`) for a local image.
///
/// Returns `Ok(false)` when the thumbnail already exists on disk (cache hit, nothing done),
/// `Ok(true)` when it was generated and `Err` when the image cannot be decoded.
#[tauri::command]
pub async fn generate_thumbnail(params: GenerateThumbnailParams) -> Result<GenerateThumbnailResult, String> {
    // Acquire a decode slot *before* spawning the blocking task: full-size images are
    // decoded to raw RGBA, so without this bound dozens of 4K/8K decodes can run at
    // once and exhaust RAM (Tokio's blocking pool defaults to 512 threads).
    let _permit = DECODE_SEMAPHORE
        .acquire()
        .await
        .map_err(|e| format!("thumbnail semaphore closed: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        generate_thumbnail_impl(&params.path, &params.out_path, params.target_size)
    })
    .await
    .map_err(|e| format!("thumbnail task failed: {e}"))?
}

fn generate_thumbnail_impl(
    path: &str,
    out_path: &str,
    target_size: u32,
) -> Result<GenerateThumbnailResult, String> {
    let out = Path::new(out_path);
    if out.exists() {
        return Ok(GenerateThumbnailResult {
            generated: false,
            palette: Vec::new(),
        });
    }

    let mut img = image::open(path).map_err(|e| format!("failed to decode image: {e}"))?;
    let (width, height) = img.dimensions();
    if width == 0 || height == 0 {
        return Err("empty image".to_string());
    }

    if width.max(height) > target_size.max(1) {
        let (new_width, new_height) = scale_dimensions(width, height, target_size.max(1));
        img = image::DynamicImage::ImageRgba8(image::imageops::resize(
            &img,
            new_width,
            new_height,
            image::imageops::FilterType::Triangle,
        ));
    }

    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create thumbnail dir: {e}"))?;
    }

    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut buffer = Vec::new();
    #[allow(deprecated)]
    {
        let encoder = image::codecs::webp::WebPEncoder::new_with_quality(
            &mut buffer,
            image::codecs::webp::WebPQuality::lossy(75),
        );
        encoder
            .encode(&rgba, w, h, image::ColorType::Rgba8)
            .map_err(|e| format!("failed to encode webp: {e}"))?;
    }
    fs::write(out, &buffer).map_err(|e| format!("failed to write thumbnail: {e}"))?;

    // Palette extraction reuses the (already downscaled) thumbnail buffer: the full-size
    // image has been decoded exactly once, inside the RAM semaphore (see issue #42).
    let palette = extract_palette_from_pixels(&img);
    Ok(GenerateThumbnailResult {
        generated: true,
        palette,
    })
}

fn scale_dimensions(width: u32, height: u32, target: u32) -> (u32, u32) {
    if width >= height {
        (target, ((height as u64 * target as u64) / width as u64).max(1) as u32)
    } else {
        (((width as u64 * target as u64) / height as u64).max(1) as u32, target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_images_dir() -> std::path::PathBuf {
        let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest.parent().unwrap().join("resources/test_images")
    }

    fn temp_out(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("allusion-thumb-{name}-{}", std::process::id()))
    }

    fn is_webp(buf: &[u8]) -> bool {
        buf.len() >= 12 && &buf[0..4] == b"RIFF" && &buf[8..12] == b"WEBP"
    }

    #[test]
    fn generates_webp_thumbnail_from_real_jpg() {
        let src = test_images_dir().join("small_jpg.jpg");
        let out = temp_out("jpg").join("thumb.webp");
        let _ = fs::remove_dir_all(out.parent().unwrap());

        let result =
            generate_thumbnail_impl(&src.to_string_lossy(), &out.to_string_lossy(), 100).unwrap();

        assert!(result.generated, "thumbnail should have been generated");
        assert!(out.exists());
        assert!(is_webp(&fs::read(&out).unwrap()));
        let _ = fs::remove_dir_all(out.parent().unwrap());
    }

    #[test]
    fn generates_webp_thumbnail_from_real_png() {
        let src = test_images_dir().join("transparant_png.png");
        let out = temp_out("png").join("thumb.webp");
        let _ = fs::remove_dir_all(out.parent().unwrap());

        let result =
            generate_thumbnail_impl(&src.to_string_lossy(), &out.to_string_lossy(), 100).unwrap();

        assert!(result.generated, "thumbnail should have been generated");
        assert!(is_webp(&fs::read(&out).unwrap()));
        let _ = fs::remove_dir_all(out.parent().unwrap());
    }

    #[test]
    fn scales_down_to_target_max_dimension() {
        let src = test_images_dir().join("10k_resolution.png");
        let out = temp_out("scale").join("thumb.webp");
        let _ = fs::remove_dir_all(out.parent().unwrap());

        let result =
            generate_thumbnail_impl(&src.to_string_lossy(), &out.to_string_lossy(), 200).unwrap();

        assert!(result.generated, "thumbnail should have been generated");
        let decoded = image::load_from_memory(&fs::read(&out).unwrap()).unwrap();
        let (w, h) = decoded.dimensions();
        assert!(w <= 200 && h <= 200, "expected <= 200px, got {w}x{h}");
        assert!(w >= 1 && h >= 1);
        let _ = fs::remove_dir_all(out.parent().unwrap());
    }

    #[test]
    fn returns_false_when_thumbnail_already_exists() {
        let src = test_images_dir().join("small_jpg.jpg");
        let out = temp_out("cache").join("thumb.webp");
        let _ = fs::remove_dir_all(out.parent().unwrap());
        fs::create_dir_all(out.parent().unwrap()).unwrap();
        fs::write(&out, b"already there").unwrap();

        let result =
            generate_thumbnail_impl(&src.to_string_lossy(), &out.to_string_lossy(), 100).unwrap();

        assert!(!result.generated, "cache hit should not regenerate");
        assert!(result.palette.is_empty(), "cache hit does not decode -> no palette");
        assert_eq!(fs::read(&out).unwrap(), b"already there");
        let _ = fs::remove_dir_all(out.parent().unwrap());
    }

    #[test]
    fn extracts_palette_alongside_generated_thumbnail() {
        let src = test_images_dir().join("small_jpg.jpg");
        let out = temp_out("palette").join("thumb.webp");
        let _ = fs::remove_dir_all(out.parent().unwrap());

        let result =
            generate_thumbnail_impl(&src.to_string_lossy(), &out.to_string_lossy(), 100).unwrap();

        assert!(result.generated);
        assert!(!result.palette.is_empty(), "real jpg should have a palette");
        let sum: f32 = result.palette.iter().map(|c| c.percentage).sum();
        assert!(sum > 0.0 && sum <= 1.0 + f32::EPSILON);
        let _ = fs::remove_dir_all(out.parent().unwrap());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn decode_waits_for_a_free_semaphore_permit() {
        use std::time::Duration;

        let src = test_images_dir().join("small_jpg.jpg");
        let out = temp_out("semaphore").join("thumb.webp");
        let _ = fs::remove_dir_all(out.parent().unwrap());

        let params = GenerateThumbnailParams {
            path: src.to_string_lossy().to_string(),
            out_path: out.to_string_lossy().to_string(),
            target_size: 100,
        };

        // Hold every permit of the decode semaphore, simulating all decode slots busy.
        let mut permits = Vec::new();
        while let Ok(permit) = DECODE_SEMAPHORE.try_acquire() {
            permits.push(permit);
        }
        assert!(
            !permits.is_empty(),
            "the decode semaphore should have permits to hold"
        );

        let task = tokio::spawn(generate_thumbnail(params));

        // The command must wait for a free permit instead of decoding unboundedly.
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert!(
            !task.is_finished(),
            "decode must not run while every permit is held (RAM protection, issue #42)"
        );

        drop(permits);
        let result = task.await.expect("task should finish without panicking");
        assert!(result.is_ok(), "thumbnail should succeed once a permit frees up");
        assert!(out.exists(), "thumbnail file should be written");
        let _ = fs::remove_dir_all(out.parent().unwrap());
    }

    #[test]
    fn errors_on_missing_source_file() {
        let out = temp_out("missing").join("thumb.webp");
        let result = generate_thumbnail_impl(
            "C:/definitely/not/here.jpg",
            &out.to_string_lossy(),
            100,
        );
        assert!(result.is_err());
    }
}
