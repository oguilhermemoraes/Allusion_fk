use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ImageDimension {
    pub width: u16,
    pub height: u16,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct TransformResult {
    pub width: u32,
    pub height: u32,
    pub top: u32,
    pub left: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LayoutResult {
    pub total_height: u32,
    pub transforms: Vec<TransformResult>,
}

const MIN_ASPECT_RATIO: u32 = 100 / 3;

#[derive(Clone, Copy)]
struct AspectRatio {
    width: u8,
    height: u8,
}

impl AspectRatio {
    fn new(src_width: u16, src_height: u16) -> AspectRatio {
        let (width, height) = correct_aspect_ratio(src_width, src_height);
        AspectRatio { width, height }
    }

    fn correct_width(&self, height: u32) -> u32 {
        (height * u32::from(self.width)).div_int(u32::from(self.height))
    }

    fn correct_height(&self, width: u32) -> u32 {
        (width * u32::from(self.height)).div_int(u32::from(self.width))
    }
}

/// For images with extreme aspect ratios (very narrow or wide), crop them a
/// little so they are at most `MIN_ASPECT_RATIO` times as wide/long as they are
/// long/wide. Mirrors the WASM `correct_aspect_ratio`.
fn correct_aspect_ratio(w: u16, h: u16) -> (u8, u8) {
    if w == 0 || h == 0 {
        return (1, 1);
    }
    if w > h {
        let height = (100 * u32::from(h))
            .div_int(u32::from(w))
            .max(MIN_ASPECT_RATIO) as u8;
        (100, height)
    } else if h > w {
        let width = (100 * u32::from(w))
            .div_int(u32::from(h))
            .max(MIN_ASPECT_RATIO) as u8;
        (width, 100)
    } else {
        (1, 1)
    }
}

/// Rounded integer division, identical to the WASM masonry implementation.
trait DivInt<Rhs = Self> {
    type Output;

    fn div_int(self, rhs: Rhs) -> Self::Output;
}

impl DivInt for u16 {
    type Output = Self;

    #[inline]
    fn div_int(self, rhs: Self) -> Self::Output {
        (self.saturating_add(rhs >> 1)) / rhs
    }
}

impl DivInt for u32 {
    type Output = Self;

    #[inline]
    fn div_int(self, rhs: Self) -> Self::Output {
        (self.saturating_add(rhs >> 1)) / rhs
    }
}

fn empty_result() -> LayoutResult {
    LayoutResult {
        total_height: 0,
        transforms: vec![],
    }
}

#[tauri::command]
pub fn compute_masonry_horizontal(
    dimensions: Vec<ImageDimension>,
    thumbnail_size: u16,
    padding: u16,
    container_width: u16,
) -> Result<LayoutResult, String> {
    if dimensions.is_empty() || thumbnail_size == 0 {
        return Ok(empty_result());
    }

    let container_width_calc = container_width.max(thumbnail_size);
    let height = u32::from(thumbnail_size);
    let max_width = u32::from(container_width_calc);
    let container_width_f32 = f32::from(container_width_calc);
    let padding_val = u32::from(padding);

    let num_items = dimensions.len();
    let aspect_ratios: Vec<AspectRatio> = dimensions
        .iter()
        .map(|dim| AspectRatio::new(dim.width, dim.height))
        .collect();

    let mut transforms = vec![
        TransformResult { width: 0, height: 0, top: 0, left: 0 };
        num_items
    ];

    let mut top = 0u32;
    let mut row_width = 0u32;
    let mut start = 0usize;

    for end in 0..num_items {
        let width = aspect_ratios[end].correct_width(height);

        transforms[end] = TransformResult {
            width,
            height,
            top,
            left: row_width,
        };

        row_width += width + padding_val;

        if row_width > max_width {
            // width | height | top | left  (top is intentionally not scaled)
            let factor = container_width_f32 / f32::from(row_width as u16);
            for transform in transforms.iter_mut().take(end + 1).skip(start) {
                transform.width = (transform.width as f32 * factor) as u32;
                transform.height = (transform.height as f32 * factor) as u32;
                transform.left = (transform.left as f32 * factor) as u32;
            }

            row_width = 0;
            start = end + 1;
            top += transforms[end].height + padding_val;
        }
    }

    let total_height = if row_width == 0 {
        top
    } else {
        top + height + padding_val
    };

    Ok(LayoutResult {
        total_height,
        transforms,
    })
}

#[tauri::command]
pub fn compute_masonry_vertical(
    dimensions: Vec<ImageDimension>,
    thumbnail_size: u16,
    padding: u16,
    container_width: u16,
) -> Result<LayoutResult, String> {
    if dimensions.is_empty() || thumbnail_size == 0 {
        return Ok(empty_result());
    }

    let container_width_calc = container_width.max(thumbnail_size);
    let n_columns = container_width_calc.div_int(thumbnail_size) as usize;
    let column_width = u32::from(container_width_calc.div_int(n_columns as u16));
    let padding_val = u32::from(padding);
    let item_width = column_width.saturating_sub(padding_val);

    let mut col_heights = vec![0u32; n_columns];
    let mut transforms = Vec::with_capacity(dimensions.len());

    for dim in dimensions {
        let aspect_ratio = AspectRatio::new(dim.width, dim.height);
        let height = aspect_ratio.correct_height(item_width);

        let (shortest_col, &min_h) = col_heights
            .iter()
            .enumerate()
            .min_by_key(|&(_, &h)| h)
            .unwrap_or((0, &0));

        let top = min_h;
        let left = shortest_col as u32 * column_width;

        col_heights[shortest_col] = top + height + padding_val;

        transforms.push(TransformResult {
            width: item_width,
            height,
            top,
            left,
        });
    }

    let total_height = *col_heights.iter().max().unwrap_or(&0);

    Ok(LayoutResult {
        total_height,
        transforms,
    })
}

#[tauri::command]
pub fn compute_masonry_grid(
    num_items: usize,
    thumbnail_size: u16,
    padding: u16,
    container_width: u16,
) -> Result<LayoutResult, String> {
    if num_items == 0 || thumbnail_size == 0 {
        return Ok(empty_result());
    }

    let container_width_calc = container_width.max(thumbnail_size);
    let n_columns = container_width_calc.div_int(thumbnail_size) as usize;
    let row_height = u32::from(container_width_calc.div_int(n_columns as u16));
    let item_size = row_height.saturating_sub(u32::from(padding));

    let mut transforms = Vec::with_capacity(num_items);
    let mut top = 0u32;
    let mut left = 0u32;

    for index in 0..num_items {
        transforms.push(TransformResult {
            width: item_size,
            height: item_size,
            top,
            left,
        });

        if (index + 1) % n_columns == 0 {
            top += row_height;
            left = 0;
        } else {
            left += row_height;
        }
    }

    let total_height = if num_items % n_columns == 0 {
        top
    } else {
        top + row_height
    };

    Ok(LayoutResult {
        total_height,
        transforms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grid_matches_reference_layout() {
        // Values computed by hand from the WASM compute_grid algorithm.
        let result = compute_masonry_grid(5, 100, 8, 250).unwrap();
        assert_eq!(result.total_height, 166);
        assert_eq!(
            result.transforms,
            vec![
                TransformResult { width: 75, height: 75, top: 0, left: 0 },
                TransformResult { width: 75, height: 75, top: 0, left: 83 },
                TransformResult { width: 75, height: 75, top: 0, left: 166 },
                TransformResult { width: 75, height: 75, top: 83, left: 0 },
                TransformResult { width: 75, height: 75, top: 83, left: 83 },
            ]
        );
    }

    #[test]
    fn grid_returns_empty_for_zero_items() {
        let result = compute_masonry_grid(0, 100, 8, 250).unwrap();
        assert_eq!(result.total_height, 0);
        assert!(result.transforms.is_empty());
    }

    #[test]
    fn horizontal_matches_reference_layout() {
        let result = compute_masonry_horizontal(
            vec![
                ImageDimension { width: 100, height: 50 },
                ImageDimension { width: 100, height: 50 },
            ],
            100,
            8,
            250,
        )
        .unwrap();
        assert_eq!(result.total_height, 68);
        assert_eq!(
            result.transforms,
            vec![
                TransformResult { width: 120, height: 60, top: 0, left: 0 },
                TransformResult { width: 120, height: 60, top: 0, left: 125 },
            ]
        );
    }

    #[test]
    fn vertical_matches_reference_layout() {
        let result = compute_masonry_vertical(
            vec![
                ImageDimension { width: 100, height: 50 },
                ImageDimension { width: 50, height: 100 },
                ImageDimension { width: 100, height: 100 },
            ],
            100,
            8,
            320,
        )
        .unwrap();
        assert_eq!(result.total_height, 206);
        assert_eq!(
            result.transforms,
            vec![
                TransformResult { width: 99, height: 50, top: 0, left: 0 },
                TransformResult { width: 99, height: 198, top: 0, left: 107 },
                TransformResult { width: 99, height: 99, top: 0, left: 214 },
            ]
        );
    }

    #[test]
    fn correct_aspect_ratio_clamps_extreme_ratios() {
        assert_eq!(correct_aspect_ratio(100, 1), (100, 33));
        assert_eq!(correct_aspect_ratio(1, 100), (33, 100));
        assert_eq!(correct_aspect_ratio(100, 100), (1, 1));
    }
}
