use std::path::Path;
use image::{imageops::FilterType, DynamicImage, ImageBuffer, RgbaImage};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateItem {
    pub path: String,
    pub hash: String,
    pub distance_to_first: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub hash: String,
    pub files: Vec<DuplicateItem>,
}

/// Computes a 64-bit difference hash (dHash) for an image.
/// Resizes to 9x8 grayscale, then compares adjacent horizontal pixels.
pub fn compute_dhash(img: &DynamicImage) -> u64 {
    let gray = img.resize_exact(9, 8, FilterType::Nearest).to_luma8();
    let mut hash: u64 = 0;
    let mut bit_index = 0;

    for y in 0..8 {
        for x in 0..8 {
            let left = gray.get_pixel(x, y)[0];
            let right = gray.get_pixel(x + 1, y)[0];
            if left > right {
                hash |= 1 << bit_index;
            }
            bit_index += 1;
        }
    }
    hash
}

/// Calculates Hamming distance between two 64-bit hashes.
pub fn hamming_distance(h1: u64, h2: u64) -> u32 {
    (h1 ^ h2).count_ones()
}

/// Helper to load an image from path (handles normal formats and EXR).
pub fn load_image_for_hash<P: AsRef<Path>>(path: P) -> Result<DynamicImage, String> {
    let p = path.as_ref();
    if !p.exists() {
        return Err(format!("File does not exist: {}", p.display()));
    }

    if let Some(ext) = p.extension().and_then(|s| s.to_str()) {
        if ext.eq_ignore_ascii_case("exr") {
            let path_str = p.to_str().ok_or_else(|| "Invalid UTF-8 in path".to_string())?;
            let exr_data = crate::commands::exr::decode_exr_image(path_str.to_string())?;
            let rgba: RgbaImage = ImageBuffer::from_raw(
                exr_data.width as u32,
                exr_data.height as u32,
                exr_data.rgba_bytes,
            )
            .ok_or_else(|| "Failed to construct ImageBuffer from EXR bytes".to_string())?;
            return Ok(DynamicImage::ImageRgba8(rgba));
        }
    }

    image::open(p).map_err(|e| format!("Failed to open image {}: {}", p.display(), e))
}

/// Computes the 64-bit perceptual hash (dHash) for a single image file.
#[tauri::command]
pub async fn compute_image_hash(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let img = load_image_for_hash(&path)?;
        let hash = compute_dhash(&img);
        Ok(format!("{:016x}", hash))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Scans a list of image paths in parallel, computes perceptual hashes,
/// and groups images that have a Hamming distance <= max_distance.
#[tauri::command]
pub async fn find_duplicate_images(
    paths: Vec<String>,
    max_distance: Option<u32>,
) -> Result<Vec<DuplicateGroup>, String> {
    let distance_threshold = max_distance.unwrap_or(0);

    tokio::task::spawn_blocking(move || {
        // Parallel computation of hashes using Rayon
        let hashed_images: Vec<(String, u64)> = paths
            .par_iter()
            .filter_map(|p| {
                load_image_for_hash(p)
                    .ok()
                    .map(|img| (p.clone(), compute_dhash(&img)))
            })
            .collect();

        // Cluster by hamming distance
        let mut visited = vec![false; hashed_images.len()];
        let mut groups = Vec::new();

        for i in 0..hashed_images.len() {
            if visited[i] {
                continue;
            }
            visited[i] = true;
            let (ref base_path, base_hash) = hashed_images[i];
            let mut group_items = vec![DuplicateItem {
                path: base_path.clone(),
                hash: format!("{:016x}", base_hash),
                distance_to_first: 0,
            }];

            for j in (i + 1)..hashed_images.len() {
                if visited[j] {
                    continue;
                }
                let (ref other_path, other_hash) = hashed_images[j];
                let dist = hamming_distance(base_hash, other_hash);
                if dist <= distance_threshold {
                    visited[j] = true;
                    group_items.push(DuplicateItem {
                        path: other_path.clone(),
                        hash: format!("{:016x}", other_hash),
                        distance_to_first: dist,
                    });
                }
            }

            if group_items.len() >= 2 {
                groups.push(DuplicateGroup {
                    hash: format!("{:016x}", base_hash),
                    files: group_items,
                });
            }
        }

        Ok(groups)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, RgbImage};

    #[test]
    fn test_compute_dhash_identical_images() {
        let img1 = DynamicImage::ImageRgb8(RgbImage::from_fn(100, 100, |x, y| {
            image::Rgb([(x % 256) as u8, (y % 256) as u8, 128])
        }));
        let img2 = DynamicImage::ImageRgb8(RgbImage::from_fn(200, 200, |x, y| {
            image::Rgb([((x / 2) % 256) as u8, ((y / 2) % 256) as u8, 128])
        }));

        let h1 = compute_dhash(&img1);
        let h2 = compute_dhash(&img2);
        let dist = hamming_distance(h1, h2);

        assert_eq!(dist, 0);
    }

    #[test]
    fn test_compute_dhash_different_images() {
        let img1 = DynamicImage::ImageRgb8(RgbImage::from_fn(50, 50, |x, _y| {
            image::Rgb([if x < 25 { 255 } else { 0 }, 0, 0])
        }));
        let img2 = DynamicImage::ImageRgb8(RgbImage::from_fn(50, 50, |x, _y| {
            image::Rgb([if x >= 25 { 255 } else { 0 }, 0, 0])
        }));

        let h1 = compute_dhash(&img1);
        let h2 = compute_dhash(&img2);
        let dist = hamming_distance(h1, h2);

        assert!(dist > 0);
    }

    #[test]
    fn test_hamming_distance() {
        assert_eq!(hamming_distance(0, 0), 0);
        assert_eq!(hamming_distance(0b1010, 0b1010), 0);
        assert_eq!(hamming_distance(0b1010, 0b1011), 1);
        assert_eq!(hamming_distance(0b0000, 0b1111), 4);
    }
}
