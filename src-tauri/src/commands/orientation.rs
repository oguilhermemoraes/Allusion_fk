//! Suporte ao EXIF Orientation (tag 0x0112) para thumbnails e dimensões (#43).

use image::DynamicImage;

/// Valor do EXIF Orientation que indica imagem não rotacionada.
pub const ORIENTATION_NORMAL: u8 = 1;

/// Lê a tag EXIF Orientation (SHORT, IFD0) dos bytes de um JPEG ou TIFF, sem
/// decodificar a imagem. `None` quando ausente/ilegível.
pub fn read_exif_orientation(bytes: &[u8]) -> Option<u8> {
    let tiff = find_tiff(bytes)?;
    let value = read_orientation_from_ifd(tiff)?;
    (1..=8).contains(&value).then_some(value as u8)
}

/// Localiza o payload TIFF: dentro do APP1 "Exif\0\0" (JPEG) ou arquivo TIFF standalone.
fn find_tiff(bytes: &[u8]) -> Option<&[u8]> {
    if bytes.starts_with(&[0xFF, 0xD8]) {
        let mut i = 2usize;
        while i + 4 < bytes.len() {
            if bytes[i] != 0xFF { i += 1; continue; }
            let marker = bytes[i + 1];
            if marker == 0x01 || (0xD0..=0xD7).contains(&marker) || marker == 0xD9 || marker == 0xFF {
                i += 2; continue;
            }
            let seg_len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
            if marker == 0xE1 && seg_len >= 8 && i + 2 + seg_len <= bytes.len() {
                let payload = &bytes[i + 4..i + 2 + seg_len];
                if payload.len() >= 6 && &payload[0..6] == b"Exif\0\0" {
                    return Some(&payload[6..]);
                }
            }
            i += 2 + seg_len;
        }
        None
    } else if bytes.len() >= 8 && (bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*")) {
        Some(bytes)
    } else {
        None
    }
}

/// Lê a tag 0x0112 (SHORT) do IFD0 de um TIFF (LE ou BE).
fn read_orientation_from_ifd(tiff: &[u8]) -> Option<u16> {
    if tiff.len() < 8 { return None; }
    let le = tiff.starts_with(b"II");
    let read_u16 = |off: usize| -> Option<u16> {
        let b = tiff.get(off..off + 2)?;
        Some(if le { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) })
    };
    let read_u32 = |off: usize| -> Option<u32> {
        let b = tiff.get(off..off + 4)?;
        Some(if le { u32::from_le_bytes([b[0], b[1], b[2], b[3]]) } else { u32::from_be_bytes([b[0], b[1], b[2], b[3]]) })
    };
    let ifd0 = read_u32(4)? as usize;
    let count = read_u16(ifd0)? as usize;
    for entry in 0..count {
        let e = ifd0 + 2 + entry * 12;
        let tag = read_u16(e)?;
        if tag == 0x0112 {
            let typ = read_u16(e + 2)?;
            let count = read_u32(e + 4)?;
            if typ == 3 && count >= 1 {
                return read_u16(e + 8); // valor SHORT fica inline no campo Value
            }
            return None;
        }
    }
    None
}

/// Troca largura/altura quando a orientação 5-8 gira a imagem em 90°/270°.
pub fn oriented_dimensions(width: u32, height: u32, orientation: Option<u8>) -> (u32, u32) {
    match orientation {
        Some(5) | Some(6) | Some(7) | Some(8) => (height, width),
        _ => (width, height),
    }
}

/// Aplica a orientação EXIF numa imagem decodificada (1 = identidade).
pub fn apply_exif_orientation(mut img: DynamicImage, orientation: u8) -> DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.fliph().rotate90(),
        6 => img.rotate90(),
        7 => img.fliph().rotate270(),
        8 => img.rotate270(),
        _ => img,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::GenericImageView;
    use image::ImageBuffer;

    /// Monta um JPEG sintético: FFD8 + APP1("Exif\0\0" + TIFF LE com 1 entry: tag 0x0112 = orientation) + SOF0 (w x h).
    fn jpeg_with_orientation(w: u16, h: u16, orientation: u8) -> Vec<u8> {
        let mut b: Vec<u8> = vec![];
        b.extend_from_slice(&[0xFF, 0xD8]); // SOI
        // TIFF header LE (II 2A 00, IFD0 @ 8)
        let mut tiff: Vec<u8> = vec![];
        tiff.extend_from_slice(b"II\x2A\x00");
        tiff.extend_from_slice(&8u32.to_le_bytes()); // offset IFD0
        tiff.extend_from_slice(&1u16.to_le_bytes()); // 1 entry
        // entry: tag 0x0112, type SHORT(3), count 1, value inline
        tiff.extend_from_slice(&0x0112u16.to_le_bytes());
        tiff.extend_from_slice(&3u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&u16::from(orientation).to_le_bytes());
        tiff.extend_from_slice(&[0, 0]); // padding do valor
        tiff.extend_from_slice(&0u32.to_le_bytes()); // next IFD
        // APP1
        let payload = [b"Exif\x00\x00".as_slice(), &tiff].concat();
        let seg_len = (payload.len() + 2) as u16;
        b.extend_from_slice(&[0xFF, 0xE1]);
        b.extend_from_slice(&seg_len.to_be_bytes());
        b.extend_from_slice(&payload);
        // SOF0: len 11, precision 8, h, w
        b.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x11, 0x08]);
        b.extend_from_slice(&h.to_be_bytes());
        b.extend_from_slice(&w.to_be_bytes());
        b.push(0x00); // componentes
        b
    }

    fn dummy_image(w: u32, h: u32) -> DynamicImage {
        DynamicImage::ImageRgba8(ImageBuffer::from_pixel(w, h, image::Rgba([10, 20, 30, 255])))
    }

    #[test]
    fn reads_orientation_from_synthetic_jpeg() {
        assert_eq!(read_exif_orientation(&jpeg_with_orientation(200, 100, 6)), Some(6));
        assert_eq!(read_exif_orientation(&jpeg_with_orientation(200, 100, 1)), Some(1));
    }

    #[test]
    fn returns_none_when_exif_absent() {
        let no_exif = [0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xC8, 0x00];
        assert_eq!(read_exif_orientation(&no_exif), None);
        assert_eq!(read_exif_orientation(b"not an image"), None);
    }

    #[test]
    fn reads_orientation_from_standalone_tiff() {
        let mut tiff: Vec<u8> = vec![];
        tiff.extend_from_slice(b"II\x2A\x00");
        tiff.extend_from_slice(&8u32.to_le_bytes());
        tiff.extend_from_slice(&1u16.to_le_bytes());
        tiff.extend_from_slice(&0x0112u16.to_le_bytes());
        tiff.extend_from_slice(&3u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&8u16.to_le_bytes());
        tiff.extend_from_slice(&[0, 0]);
        tiff.extend_from_slice(&0u32.to_le_bytes());
        assert_eq!(read_exif_orientation(&tiff), Some(8));
    }

    #[test]
    fn swaps_dimensions_only_for_quarter_rotations() {
        assert_eq!(oriented_dimensions(800, 600, Some(6)), (600, 800));
        assert_eq!(oriented_dimensions(800, 600, Some(5)), (600, 800));
        assert_eq!(oriented_dimensions(800, 600, Some(8)), (600, 800));
        assert_eq!(oriented_dimensions(800, 600, Some(7)), (600, 800));
        assert_eq!(oriented_dimensions(800, 600, Some(1)), (800, 600));
        assert_eq!(oriented_dimensions(800, 600, Some(3)), (800, 600));
        assert_eq!(oriented_dimensions(800, 600, None), (800, 600));
    }

    #[test]
    fn rotates_quarter_turns_and_flips() {
        let base = dummy_image(4, 2);
        let r90 = apply_exif_orientation(base.clone(), 6);
        assert_eq!(r90.dimensions(), (2, 4));
        let r270 = apply_exif_orientation(base.clone(), 8);
        assert_eq!(r270.dimensions(), (2, 4));
        let r180 = apply_exif_orientation(base.clone(), 3);
        assert_eq!(r180.dimensions(), (4, 2));
        let normal = apply_exif_orientation(base.clone(), 1);
        assert_eq!(normal.dimensions(), (4, 2));
        // flip não muda dimensões
        assert_eq!(apply_exif_orientation(base.clone(), 2).dimensions(), (4, 2));
        assert_eq!(apply_exif_orientation(base.clone(), 5).dimensions(), (2, 4));
        assert_eq!(apply_exif_orientation(base.clone(), 7).dimensions(), (2, 4));
    }
}