import { PaletteColorDTO } from '../src/api/file';

export interface FixedColor {
  /** Stable identifier, used as the criteria value and swatch key */
  id: string;
  /** Human readable label for tooltips and chip label */
  name: string;
  /** Reference hex color used to render the swatch */
  hex: string;
  /** Reference RGB color used for nearest-color matching */
  rgb: [number, number, number];
}

/**
 * The 12 fixed colors offered by the color filter (#67). Each fixed color is a
 * centroid; a palette color is matched to whichever centroid is nearest.
 */
export const FIXED_COLORS: FixedColor[] = [
  { id: 'red', name: 'Red', hex: '#E53935', rgb: [229, 57, 53] },
  { id: 'orange', name: 'Orange', hex: '#FB8C00', rgb: [251, 140, 0] },
  { id: 'yellow', name: 'Yellow', hex: '#FDD835', rgb: [253, 216, 53] },
  { id: 'green', name: 'Green', hex: '#43A047', rgb: [67, 160, 71] },
  { id: 'cyan', name: 'Cyan', hex: '#00ACC1', rgb: [0, 172, 193] },
  { id: 'blue', name: 'Blue', hex: '#1E88E5', rgb: [30, 136, 229] },
  { id: 'purple', name: 'Purple', hex: '#8E24AA', rgb: [142, 36, 170] },
  { id: 'magenta', name: 'Magenta', hex: '#D81B60', rgb: [216, 27, 96] },
  { id: 'brown', name: 'Brown', hex: '#6D4C41', rgb: [109, 76, 65] },
  { id: 'gray', name: 'Gray', hex: '#757575', rgb: [117, 117, 117] },
  { id: 'white', name: 'White', hex: '#FAFAFA', rgb: [250, 250, 250] },
  { id: 'black', name: 'Black', hex: '#212121', rgb: [33, 33, 33] },
];

/** Lookup of fixed colors by id, as { id: FixedColor } */
export const FIXED_COLORS_BY_ID: Record<string, FixedColor> = Object.fromEntries(
  FIXED_COLORS.map((c) => [c.id, c]),
);

/**
 * Returns the id of the fixed color nearest to the given RGB color.
 * Perceptual weighting is intentionally simple; palettes are already
 * quantized, so exact precision is not needed (#66).
 */
export function getNearestColorId(r: number, g: number, b: number): string {
  let bestId = FIXED_COLORS[0].id;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const fixed of FIXED_COLORS) {
    const distance = euclideanDistance([r, g, b], fixed.rgb);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = fixed.id;
    }
  }
  return bestId;
}

type RGB = [number, number, number];

function euclideanDistance(a: RGB, b: RGB) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Whether a file's palette contains the given fixed color in any position,
 * not just the dominant one (#67).
 */
export function paletteContainsColor(palette: PaletteColorDTO[] | undefined, colorId: string) {
  if (!palette || palette.length === 0) {
    return false;
  }
  return palette.some((c) => getNearestColorId(c.r, c.g, c.b) === colorId);
}
