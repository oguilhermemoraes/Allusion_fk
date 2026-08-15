use std::borrow::Cow;
use std::path::Path;
use arboard::{Clipboard, ImageData};

#[cfg(test)]
mod tests {
    use super::*;

    fn png_bytes(w: u32, h: u32) -> Vec<u8> {
        let mut b = vec![0u8; 33];
        b[0..8].copy_from_slice(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        b[16..20].copy_from_slice(&w.to_be_bytes());
        b[20..24].copy_from_slice(&h.to_be_bytes());
        b
    }

    fn jpeg_bytes(w: u16, h: u16) -> Vec<u8> {
        // FFD8 FF C0 00 11 08 hh hh ww ww ...
        let mut b = vec![0u8; 32];
        b[0] = 0xFF;
        b[1] = 0xD8;
        b[2] = 0xFF;
        b[3] = 0xC0;
        b[4..8].copy_from_slice(&[0x00, 0x11, 0x08, 0x00]);
        b[7..9].copy_from_slice(&h.to_be_bytes());
        b[9..11].copy_from_slice(&w.to_be_bytes());
        b
    }

    fn gif_bytes(w: u16, h: u16) -> Vec<u8> {
        let mut b = vec![0u8; 16];
        b[0..6].copy_from_slice(b"GIF89a");
        b[6..8].copy_from_slice(&w.to_le_bytes());
        b[8..10].copy_from_slice(&h.to_le_bytes());
        b
    }

    fn bmp_bytes(w: u32, h: u32) -> Vec<u8> {
        let mut b = vec![0u8; 26];
        b[0] = b'B';
        b[1] = b'M';
        b[18..22].copy_from_slice(&(w as i32).to_le_bytes());
        b[22..26].copy_from_slice(&(h as i32).to_le_bytes());
        b
    }

    #[test]
    fn reads_png_dimensions() {
        assert_eq!(read_dimensions(&png_bytes(640, 480)), Some((640, 480)));
    }

    #[test]
    fn reads_jpeg_dimensions() {
        assert_eq!(read_dimensions(&jpeg_bytes(800, 600)), Some((800, 600)));
    }

    #[test]
    fn reads_gif_dimensions() {
        assert_eq!(read_dimensions(&gif_bytes(320, 240)), Some((320, 240)));
    }

    #[test]
    fn reads_bmp_dimensions() {
        assert_eq!(read_dimensions(&bmp_bytes(1024, 768)), Some((1024, 768)));
    }

    #[test]
    fn returns_none_for_unknown_or_truncated() {
        assert_eq!(read_dimensions(&[]), None);
        assert_eq!(read_dimensions(b"hello world"), None);
    }

    #[test]
    fn reads_real_test_jpg() {
        let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let path = manifest
            .parent()
            .unwrap()
            .join("resources/test_images/small_jpg.jpg");
        let bytes = std::fs::read(&path).unwrap();
        let dims = read_dimensions(&bytes).expect("should read dimensions from small_jpg.jpg");
        assert!(dims.0 > 0 && dims.1 > 0);
    }

    #[test]
    fn reads_real_test_png() {
        let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let path = manifest
            .parent()
            .unwrap()
            .join("resources/test_images/10k_resolution.png");
        let bytes = std::fs::read(&path).unwrap();
        let dims = read_dimensions(&bytes).expect("should read dimensions from 10k_resolution.png");
        assert!(dims.0 > 0 && dims.1 > 0);
    }

    #[test]
    fn copies_image_to_clipboard_and_reads_back() {
        let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let path = manifest
            .parent()
            .unwrap()
            .join("resources/test_images/small_jpg.jpg");
        if let Ok(mut clip) = Clipboard::new() {
            let result = copy_image_to_clipboard(path.to_string_lossy().to_string());
            assert!(result.is_ok(), "copying image should succeed: {:?}", result.err());
            let img = clip.get_image();
            assert!(img.is_ok(), "clipboard should contain image: {:?}", img.err());
            let img_data = img.unwrap();
            assert!(img_data.width > 0 && img_data.height > 0);
        }
    }

    #[test]
    fn copy_image_fails_on_missing_file() {
        let result = copy_image_to_clipboard("C:/nonexistent/file.png".to_string());
        assert!(result.is_err());
    }
}

#[tauri::command]
pub fn get_image_dimensions(path: String) -> Result<(u32, u32), String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    read_dimensions(&bytes).ok_or_else(|| "Unsupported image format or corrupted file".to_string())
}

#[tauri::command]
pub fn copy_image_to_clipboard(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    let is_exr = p
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("exr"))
        .unwrap_or(false);

    let (width, height, rgba_bytes) = if is_exr {
        let exr_data = crate::commands::exr::decode_exr_image(path)?;
        (exr_data.width, exr_data.height, exr_data.rgba_bytes)
    } else {
        let dyn_img = image::open(&path).map_err(|e| format!("Failed to open image {}: {}", path, e))?;
        let rgba = dyn_img.into_rgba8();
        let (w, h) = rgba.dimensions();
        (w as usize, h as usize, rgba.into_raw())
    };

    let img_data = ImageData {
        width,
        height,
        bytes: Cow::Borrowed(&rgba_bytes),
    };

    let mut clipboard = Clipboard::new().map_err(|e| format!("Failed to initialize clipboard: {}", e))?;
    clipboard
        .set_image(img_data)
        .map_err(|e| format!("Failed to copy image to clipboard: {}", e))?;

    Ok(())
}

/// Extrai largura/altura a partir do cabeçalho de formatos comuns de imagem,
/// sem decodificar o arquivo completo. Retorna `None` se o formato não for reconhecido.
pub fn read_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 16 {
        return None;
    }

    // PNG: magic + IHDR (8 sig bytes, then length(4) + "IHDR" + width(4) + height(4))
    if bytes[0] == 0x89 && &bytes[1..4] == b"PNG" {
        if bytes.len() < 24 {
            return None;
        }
        let w = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
        let h = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
        return Some((w, h));
    }

    // GIF: "GIF87a"/"GIF89a" + logical screen width/height (LE u16)
    if &bytes[0..3] == b"GIF" {
        let w = u16::from_le_bytes([bytes[6], bytes[7]]) as u32;
        let h = u16::from_le_bytes([bytes[8], bytes[9]]) as u32;
        return Some((w, h));
    }

    // BMP: "BM" + offset 18: width (i32 LE), 22: height (i32 LE)
    if bytes[0] == b'B' && bytes[1] == b'M' {
        if bytes.len() < 26 {
            return None;
        }
        let w = i32::from_le_bytes([bytes[18], bytes[19], bytes[20], bytes[21]]);
        let h = i32::from_le_bytes([bytes[22], bytes[23], bytes[24], bytes[25]]);
        return Some((w.max(0) as u32, h.abs() as u32));
    }

    // JPEG: FFD8 ... FFCx SOF marker, scan for start-of-frame segments
    if bytes[0] == 0xFF && bytes[1] == 0xD8 {
        let mut i = 2usize;
        while i + 9 < bytes.len() {
            if bytes[i] != 0xFF {
                i += 1;
                continue;
            }
            let marker = bytes[i + 1];
            if marker == 0x01 || (0xD0..=0xD7).contains(&marker) || marker == 0xD9 || marker == 0xFF {
                i += 2;
                continue;
            }
            // SOF0-SOF15 (excluding DHT C4, DAC CC, DNL DC... simplified)
            let is_sof = (0xC0..=0xCF).contains(&marker) && marker != 0xC4 && marker != 0xCC;
            if is_sof && i + 9 < bytes.len() {
                let h = u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]) as u32;
                let w = u16::from_be_bytes([bytes[i + 7], bytes[i + 8]]) as u32;
                return Some((w, h));
            }
            let seg_len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
            i += 2 + seg_len;
        }
    }

    None
}

