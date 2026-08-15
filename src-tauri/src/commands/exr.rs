use exr::prelude::{read_first_rgba_layer_from_file, MetaData};
use serde::{Deserialize, Serialize};
use std::cell::Cell;
use std::rc::Rc;

use crate::color::{ColorMapper, SRGB_CHROMATICITIES};

#[derive(Debug, Serialize, Deserialize)]
pub struct ExrImageBuffer {
    pub width: usize,
    pub height: usize,
    pub rgba_bytes: Vec<u8>,
}

/// Decodes an EXR image into an RGBA8 buffer, mapping gamut + gamma to sRGB.
fn decode_exr(path: &str) -> Result<ExrImageBuffer, String> {
    let chromaticities = MetaData::read_from_file(path, false)
        .map_err(|e| e.to_string())?
        .headers[0]
        .shared_attributes
        .chromaticities
        .unwrap_or(SRGB_CHROMATICITIES);
    let color_mapper = Rc::new(ColorMapper::new(chromaticities));

    let width = Rc::new(Cell::new(0usize));

    let image = read_first_rgba_layer_from_file(
        path,
        {
            let width = Rc::clone(&width);
            move |resolution, _| {
                width.set(resolution.width());
                vec![0u8; resolution.width() * resolution.height() * 4]
            }
        },
        {
            let color_mapper = Rc::clone(&color_mapper);
            move |buffer, position, (r, g, b, a): (f32, f32, f32, f32)| {
                let index = (position.y() * width.get() + position.x()) * 4;
                let [r, g, b] = color_mapper.map_gamut((r, g, b));
                buffer[index] = ColorMapper::map_tone(r);
                buffer[index + 1] = ColorMapper::map_tone(g);
                buffer[index + 2] = ColorMapper::map_tone(b);
                buffer[index + 3] = ColorMapper::map_tone(a);
            }
        },
    )
    .map_err(|e| e.to_string())?;

    Ok(ExrImageBuffer {
        width: image.layer_data.size.width(),
        height: image.layer_data.size.height(),
        rgba_bytes: image.layer_data.channel_data.pixels,
    })
}

#[tauri::command]
pub fn decode_exr_image(path: String) -> Result<ExrImageBuffer, String> {
    decode_exr(&path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_solid_exr(path: &std::path::Path) {
        // Linear sRGB (0.5, 0.25, 0.125, 1.0), 2x2 image.
        exr::prelude::write_rgba_file(path, 2, 2, |_x, _y| {
            (0.5f32, 0.25f32, 0.125f32, 1.0f32)
        })
        .unwrap();
    }

    #[test]
    fn decodes_rgba_exr_with_gamma_mapping() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("solid.exr");
        write_solid_exr(&path);

        let result = decode_exr(path.to_str().unwrap()).unwrap();
        assert_eq!(result.width, 2);
        assert_eq!(result.height, 2);
        assert_eq!(result.rgba_bytes.len(), 2 * 2 * 4);

        // Gamma-compressed sRGB for linear (0.5, 0.25, 0.125, 1.0).
        let expected = [187u8, 136, 99, 255];
        for pixel in result.rgba_bytes.chunks(4) {
            for (i, value) in pixel.iter().enumerate() {
                assert!(
                    (*value as i16 - expected[i] as i16).abs() <= 1,
                    "channel {}: got {}, expected ~{}",
                    i,
                    value,
                    expected[i]
                );
            }
        }
    }

    #[test]
    fn returns_error_for_missing_file() {
        assert!(decode_exr("definitely/missing/never.exr").is_err());
    }
}
