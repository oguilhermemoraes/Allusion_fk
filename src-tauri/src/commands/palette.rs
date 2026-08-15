use image::GenericImageView;
use serde::{Deserialize, Serialize};

/// A single dominant color in an image's palette, as `(r, g, b)` and the
/// fraction of sampled pixels it represents (0.0 - 1.0).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PaletteColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    /// Share of coverage, 0.0 - 1.0 (e.g. `0.42` = 42% of sampled pixels).
    pub percentage: f32,
}

/// Maximum number of dominant colors returned.
const MAX_COLORS: usize = 4;
/// Color buckets use 4 bits per channel -> 16 levels each (16^3 = 4096 buckets).
const BUCKET_BITS: u32 = 4;

/// Bucket key for a pixel: packs quantized rgb into a single `u32`.
/// Reducing each channel from 8 bits to 4 bits collapses similar colors into
/// the same bucket so the histogram is meaningful without huge memory use.
fn bucket_key(r: u8, g: u8, b: u8) -> u32 {
    let r = (r >> (8 - BUCKET_BITS)) as u32;
    let g = (g >> (8 - BUCKET_BITS)) as u32;
    let b = (b >> (8 - BUCKET_BITS)) as u32;
    (r << (BUCKET_BITS * 2)) | (g << BUCKET_BITS) | b
}

/// Reconstructs a representative color (the bucket center) from a bucket key.
fn bucket_center(key: u32) -> (u8, u8, u8) {
    let step = 256 >> BUCKET_BITS;
    let r = ((key >> (BUCKET_BITS * 2)) & 0x0F) as u8;
    let g = ((key >> BUCKET_BITS) & 0x0F) as u8;
    let b = (key & 0x0F) as u8;
    // center of the bucket, half-step added
    let half = (step >> 1) as u8;
    ((r * step as u8).saturating_add(half), (g * step as u8).saturating_add(half), (b * step as u8).saturating_add(half))
}

/// Extracts the `MAX_COLORS` dominant colors of an image, ordered by decreasing
/// coverage, skipping transparent pixels. Returns an empty vec when the image
/// has no opaque pixels.
pub fn extract_palette_from_pixels(img: &image::DynamicImage) -> Vec<PaletteColor> {
    let small = analysis_resize_to_rgba(img);
    if small.width() == 0 || small.height() == 0 {
        return Vec::new();
    }

    // 4096 buckets fit comfortably in a HashMap<u32, u32>.
    let mut histogram: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();
    let mut total: u32 = 0;

    for p in small.pixels() {
        let [r, g, b, a] = p.0;
        if a < 128 {
            continue; // skip transparent pixels
        }
        let key = bucket_key(r, g, b);
        *histogram.entry(key).or_insert(0) += 1;
        total += 1;
    }

    if total == 0 {
        return Vec::new();
    }

    // Sort buckets by count descending, take the top MAX_COLORS.
    let mut order: Vec<(u32, u32)> = histogram.into_iter().collect();
    order.sort_unstable_by(|a, b| b.1.cmp(&a.1));

    order
        .into_iter()
        .take(MAX_COLORS)
        .map(|(key, count)| {
            let (r, g, b) = bucket_center(key);
            PaletteColor {
                r,
                g,
                b,
                percentage: count as f32 / total as f32,
            }
        })
        .collect()
}

/// Downscales the image to a max edge of 64px (RGBA). Palette extraction runs
/// on this tiny copy so it stays cheap even for 8K originals.
fn analysis_resize_to_rgba(img: &image::DynamicImage) -> image::RgbaImage {
    const TARGET: u32 = 64;
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return image::RgbaImage::new(0, 0);
    }
    if w <= TARGET && h <= TARGET {
        return img.to_rgba8();
    }
    let (nw, nh) = if w >= h {
        (TARGET, ((h as u64 * TARGET as u64) / w as u64).max(1) as u32)
    } else {
        (((w as u64 * TARGET as u64) / h as u64).max(1) as u32, TARGET)
    };
    image::imageops::resize(img, nw, nh, image::imageops::FilterType::Triangle)
}

/// Tauri command: extract the dominant palette from a local image file.
///
/// Decoding a full-size photo to raw RGBA is memory-heavy, so this reuses the
/// same RAM discipline as the thumbnail pipeline (#42).
#[tauri::command]
pub async fn extract_palette(path: String) -> Result<Vec<PaletteColor>, String> {
    // Keep it cheap and predictable; a palette pass should not hold a thumbnail
    // decode slot since it re-decodes independently.
    tauri::async_runtime::spawn_blocking(move || extract_palette_from_file(&path))
        .await
        .map_err(|e| format!("palette task failed: {e}"))?
}

pub fn extract_palette_from_file(path: &str) -> Result<Vec<PaletteColor>, String> {
    match image::open(path) {
        Ok(img) => Ok(extract_palette_from_pixels(&img)),
        Err(e) => Err(format!("failed to decode image: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(r: u8, g: u8, b: u8) -> image::DynamicImage {
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(20, 20, image::Rgba([r, g, b, 255])))
    }

    #[test]
    fn single_color_image_returns_that_color() {
        let palette = extract_palette_from_pixels(&solid(200, 50, 30));
        assert_eq!(palette.len(), 1);
        let c = &palette[0];
        // bucket center of 200 -> 200/16=12.5 -> 12 buckets => 12*16+8=200
        assert!((c.r as i32 - 200).abs() <= 8);
        assert!((c.g as i32 - 50).abs() <= 8);
        assert!((c.b as i32 - 30).abs() <= 8);
        assert!((c.percentage - 1.0).abs() < f32::EPSILON * 2.0);
    }

    #[test]
    fn two_color_image_returns_two_colors_ordered() {
        // 3/4 red, 1/4 blue -> red dominant
        let mut img = image::RgbaImage::new(20, 20);
        for (x, y, p) in img.enumerate_pixels_mut() {
            *p = if x < 15 {
                image::Rgba([255, 0, 0, 255])
            } else {
                image::Rgba([0, 0, 255, 255])
            };
        }
        let palette = extract_palette_from_pixels(&image::DynamicImage::ImageRgba8(img));
        assert_eq!(palette.len(), 2);
        assert!(palette[0].percentage > palette[1].percentage);
        // first is the red block
        assert!(palette[0].r > palette[1].r);
    }

    #[test]
    fn transparent_pixels_are_skipped() {
        // fully transparent image -> no colors
        let img = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            10,
            10,
            image::Rgba([255, 255, 255, 0]),
        ));
        assert!(extract_palette_from_pixels(&img).is_empty());
    }

    #[test]
    fn returns_at_most_four_colors() {
        // many different colors -> capped at MAX_COLORS
        let mut img = image::RgbaImage::new(100, 100);
        for (x, y, p) in img.enumerate_pixels_mut() {
            *p = image::Rgba([(x % 16 * 17) as u8, (y % 16 * 17) as u8, (x % 3 * 85) as u8, 255]);
        }
        let palette = extract_palette_from_pixels(&image::DynamicImage::ImageRgba8(img));
        assert!(palette.len() <= MAX_COLORS);
        assert!(!palette.is_empty());
    }

    #[test]
    fn errors_on_missing_file() {
        assert!(extract_palette_from_file("C:/nope/does-not-exist.jpg").is_err());
    }

    #[test]
    fn handles_real_jpg() {
        let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let path = manifest
            .parent()
            .unwrap()
            .join("resources/test_images/small_jpg.jpg");
        let palette = extract_palette_from_file(&path.to_string_lossy()).unwrap();
        assert!(!palette.is_empty());
        let sum: f32 = palette.iter().map(|c| c.percentage).sum();
        assert!(sum <= 1.0);
    }
}