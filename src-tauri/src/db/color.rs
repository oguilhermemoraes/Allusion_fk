/// Fixed color centroids matching `common/color.ts` `FIXED_COLORS`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FixedColor {
    pub id: &'static str,
    pub name: &'static str,
    pub hex: &'static str,
    pub rgb: [u8; 3],
}

pub const FIXED_COLORS: [FixedColor; 12] = [
    FixedColor {
        id: "red",
        name: "Red",
        hex: "#E53935",
        rgb: [229, 57, 53],
    },
    FixedColor {
        id: "orange",
        name: "Orange",
        hex: "#FB8C00",
        rgb: [251, 140, 0],
    },
    FixedColor {
        id: "yellow",
        name: "Yellow",
        hex: "#FDD835",
        rgb: [253, 216, 53],
    },
    FixedColor {
        id: "green",
        name: "Green",
        hex: "#43A047",
        rgb: [67, 160, 71],
    },
    FixedColor {
        id: "cyan",
        name: "Cyan",
        hex: "#00ACC1",
        rgb: [0, 172, 193],
    },
    FixedColor {
        id: "blue",
        name: "Blue",
        hex: "#1E88E5",
        rgb: [30, 136, 229],
    },
    FixedColor {
        id: "purple",
        name: "Purple",
        hex: "#8E24AA",
        rgb: [142, 36, 170],
    },
    FixedColor {
        id: "magenta",
        name: "Magenta",
        hex: "#D81B60",
        rgb: [216, 27, 96],
    },
    FixedColor {
        id: "brown",
        name: "Brown",
        hex: "#6D4C41",
        rgb: [109, 76, 65],
    },
    FixedColor {
        id: "gray",
        name: "Gray",
        hex: "#757575",
        rgb: [117, 117, 117],
    },
    FixedColor {
        id: "white",
        name: "White",
        hex: "#FAFAFA",
        rgb: [250, 250, 250],
    },
    FixedColor {
        id: "black",
        name: "Black",
        hex: "#212121",
        rgb: [33, 33, 33],
    },
];

/// Computes the nearest fixed palette color id using Euclidean RGB distance,
/// matching `getNearestColorId` in `common/color.ts`.
pub fn nearest_color_id(r: u8, g: u8, b: u8) -> &'static str {
    let mut best_id = FIXED_COLORS[0].id;
    let mut best_dist_sq = u32::MAX;

    for color in &FIXED_COLORS {
        let dr = i32::from(r) - i32::from(color.rgb[0]);
        let dg = i32::from(g) - i32::from(color.rgb[1]);
        let db = i32::from(b) - i32::from(color.rgb[2]);
        let dist_sq = (dr * dr + dg * dg + db * db) as u32;
        if dist_sq < best_dist_sq {
            best_dist_sq = dist_sq;
            best_id = color.id;
        }
    }

    best_id
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_exact_centroids_and_nearby_colors() {
        for fc in &FIXED_COLORS {
            assert_eq!(nearest_color_id(fc.rgb[0], fc.rgb[1], fc.rgb[2]), fc.id);
        }
        assert_eq!(nearest_color_id(255, 0, 0), "red");
        assert_eq!(nearest_color_id(0, 255, 0), "green");
        assert_eq!(nearest_color_id(0, 0, 255), "blue");
        assert_eq!(nearest_color_id(255, 255, 255), "white");
        assert_eq!(nearest_color_id(0, 0, 0), "black");
        assert_eq!(nearest_color_id(250, 145, 10), "orange");
        assert_eq!(nearest_color_id(120, 120, 120), "gray");
    }
}
