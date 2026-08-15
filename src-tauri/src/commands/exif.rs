use exif::{In, Reader, Tag, Value};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ExifData {
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    pub iso: Option<u32>,
    pub f_number: Option<f32>,
    pub exposure_time: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub make: Option<String>,
    pub focal_length: Option<String>,
    pub software: Option<String>,
    pub artist: Option<String>,
    pub copyright: Option<String>,
    pub image_description: Option<String>,
}

fn display_string(exif: &exif::Exif, field: Option<&exif::Field>) -> Option<String> {
    field.map(|f| f.display_value().with_unit(exif).to_string())
}

fn read_tag(exif: &exif::Exif, tag: Tag) -> Option<&exif::Field> {
    exif.get_field(tag, In::PRIMARY)
}

#[tauri::command]
pub fn read_exif_metadata(path: String) -> Result<ExifData, String> {
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut bufreader = std::io::BufReader::new(file);
    let exifreader = Reader::new();

    let mut data = ExifData::default();

    if let Ok(exif) = exifreader.read_from_container(&mut bufreader) {
        data.camera_model = display_string(&exif, read_tag(&exif, Tag::Model));
        data.make = display_string(&exif, read_tag(&exif, Tag::Make));
        data.lens = display_string(&exif, read_tag(&exif, Tag::LensModel));
        data.software = display_string(&exif, read_tag(&exif, Tag::Software));
        data.artist = display_string(&exif, read_tag(&exif, Tag::Artist));
        data.copyright = display_string(&exif, read_tag(&exif, Tag::Copyright));
        data.image_description = display_string(&exif, read_tag(&exif, Tag::ImageDescription));
        data.focal_length = display_string(&exif, read_tag(&exif, Tag::FocalLength));
        data.exposure_time = display_string(&exif, read_tag(&exif, Tag::ExposureTime));

        if let Some(field) = read_tag(&exif, Tag::PhotographicSensitivity) {
            if let Value::Short(ref v) = field.value {
                if let Some(&first) = v.first() {
                    data.iso = Some(first as u32);
                }
            }
        }
        if let Some(field) = read_tag(&exif, Tag::FNumber) {
            if let Value::Rational(ref v) = field.value {
                if let Some(r) = v.first() {
                    data.f_number = Some(r.to_f32());
                }
            }
        }
        if let Some(field) = read_tag(&exif, Tag::PixelXDimension) {
            if let Value::Long(ref v) = field.value {
                if let Some(&w) = v.first() {
                    data.width = Some(w);
                }
            }
        }
        if let Some(field) = read_tag(&exif, Tag::PixelYDimension) {
            if let Value::Long(ref v) = field.value {
                if let Some(&h) = v.first() {
                    data.height = Some(h);
                }
            }
        }
    }

    Ok(data)
}
