# EXR Nativo (Tauri) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decode EXR images natively in the Tauri runtime (gamut + gamma mapping to sRGB), keeping the WASM decoder as the fallback in Electron/web dev.

**Architecture:** Port the WASM color pipeline (`wasm/exr-decoder/src/color.rs`: `ColorMapper`, `SRGB_CHROMATICITIES`, `SRGB_TO_XYZ`, `XYZ_TO_SRGB`) into `src-tauri/src/color.rs`. Rewrite `decode_exr_image` in `src-tauri/src/commands/exr.rs` to read the file's `chromaticities` attribute via `MetaData::read_from_file` and map pixels with `ColorMapper` (instead of the current plain `clamp`). On the frontend, `ExrLoader` gains a `decodePath(path)` method that calls `invoke('decode_exr_image', { path })`, and `util.ts` routes between path-decode (Tauri) and buffer-decode (Electron) through a shared `decodeImage` helper.

**Tech Stack:** Rust (`exr` 1.74.2, `serde`), Tauri 2 `invoke`, TypeScript 4.9, Jest (`ts-jest`, node env), `tempfile` (dev-dependency).

**Working branch:** `feat/exr-native` (commit message: `feat(tauri): integra decode EXR nativo no frontend (Closes #17)`).

---

### Task 1: Port the color pipeline to `src-tauri`

**Files:**
- Create: `src-tauri/src/color.rs`
- Modify: `src-tauri/src/lib.rs:1-3`

Reference (do not modify): `wasm/exr-decoder/src/color.rs`.

- [ ] **Step 1: Write the failing tests first**

Create `src-tauri/src/color.rs` containing **only** the test module below, plus `pub mod color;` in `src-tauri/src/lib.rs`:

```rust
#[cfg(test)]
mod test {
    use super::{calc_color_space_conversion_rgb_to_xyz, SRGB_CHROMATICITIES, SRGB_TO_XYZ, XYZ_TO_SRGB};

    #[test]
    fn correct_matrix() {
        let m = calc_color_space_conversion_rgb_to_xyz(SRGB_CHROMATICITIES);
        assert_eq!(m.0, SRGB_TO_XYZ.0);
        let im = m.invert();
        assert_eq!(im.0, XYZ_TO_SRGB.0);
    }

    #[test]
    fn gamma_compresses_linear_srgb() {
        use super::gamma_compress_s_rgb;
        // The linear values 0.5/0.25/0.125 must stay strictly below 1.0 after compression.
        let [r, g, b] = gamma_compress_s_rgb([0.5, 0.25, 0.125]);
        assert!(r < 1.0 && g < 1.0 && b < 1.0);
        assert!(r > 0.7 && g > 0.5 && b > 0.35);
    }

    #[test]
    fn color_mapper_defaults_to_srgb() {
        use super::ColorMapper;
        let mapper = ColorMapper::new(SRGB_CHROMATICITIES);
        let [r, g, b] = mapper.map_gamut((0.5, 0.25, 0.125));
        assert_eq!((r, g, b), (0.735523, 0.537099, 0.388574));
        assert_eq!(ColorMapper::map_tone(1.0), 255);
        assert_eq!(ColorMapper::map_tone(0.0), 0);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --lib` (workdir `src-tauri`)
Expected: FAIL — `calc_color_space_conversion_rgb_to_xyz`, `SRGB_CHROMATICITIES`, etc. not found.

- [ ] **Step 3: Implement the module**

Add `pub mod color;` to `src-tauri/src/lib.rs` (after `pub mod services;`).

Create `src-tauri/src/color.rs` with the full port (keep the Ryan Juckett license header):

```rust
/******************************************************************************
  Copyright (c) 2010 Ryan Juckett
  http://www.ryanjuckett.com/

  This software is provided 'as-is', without any express or implied
  warranty. In no event will the authors be held liable for any damages
  arising from the use of this software.

  Permission is granted to anyone to use this software for any purpose,
  including commercial applications, and to alter it and redistribute it
  freely, subject to the following restrictions:

  1. The origin of this software must not be misrepresented; you must not
     claim that you wrote the original software. If you use this software
     in a product, an acknowledgment in the product documentation would be
     appreciated but is not required.

  2. Altered source versions must be plainly marked as such, and must not be
     misrepresented as being the original software.

  3. This notice may not be removed or altered from any source
     distribution.
******************************************************************************/

//! https://www.ryanjuckett.com/rgb-color-space-conversion/
//! Port of `wasm/exr-decoder/src/color.rs` for the native Tauri runtime.

use exr::{math::Vec2, meta::attribute::Chromaticities};

pub const SRGB_CHROMATICITIES: Chromaticities = Chromaticities {
    red: Vec2(0.64, 0.33),
    green: Vec2(0.30, 0.60),
    blue: Vec2(0.15, 0.06),
    white: Vec2(0.3127, 0.3290), // D65
};

pub const SRGB_TO_XYZ: Matrix3 = Matrix3([
    [0.4123909, 0.35758442, 0.18048081],
    [0.21263906, 0.71516883, 0.07219232],
    [0.019330805, 0.11919476, 0.9505322],
]);

pub const XYZ_TO_SRGB: Matrix3 = Matrix3([
    [3.2409692, -1.5373828, -0.49861068],
    [-0.96924347, 1.8759671, 0.04155507],
    [0.05563009, -0.20397688, 1.0569714],
]);

pub type Vec3 = [f32; 3];

pub struct Matrix3([[f32; 3]; 3]);

impl Matrix3 {
    fn invert(&self) -> Matrix3 {
        let [[a, b, c], [d, e, f], [g, h, i]] = self.0;
        // calculate the minors for the first row
        let minor00 = e * i - f * h;
        let minor01 = f * g - d * i;
        let minor02 = d * h - e * g;

        // calculate the determinant
        let determinant = a * minor00 + b * minor01 + c * minor02;

        // check if the input is a singular matrix (non-invertable)
        // (note that the epsilon here was arbitrarily chosen)
        debug_assert!(!(determinant > -0.000001 && determinant < 0.000001));

        // the inverse of inMat is (1 / determinant) * adjoint(inMat)
        let inv_det = determinant.recip();
        Matrix3([
            [
                inv_det * minor00,
                inv_det * (c * h - b * i),
                inv_det * (b * f - c * e),
            ],
            [
                inv_det * minor01,
                inv_det * (a * i - c * g),
                inv_det * (c * d - a * f),
            ],
            [
                inv_det * minor02,
                inv_det * (b * g - a * h),
                inv_det * (a * e - b * d),
            ],
        ])
    }

    fn mul_vec(&self, in_vec: Vec3) -> Vec3 {
        self.0
            .map(|xyz| xyz[0].mul_add(in_vec[0], xyz[1].mul_add(in_vec[1], xyz[2] * in_vec[2])))
    }
}

fn calc_color_space_conversion_rgb_to_xyz(
    Chromaticities {
        red,
        green,
        blue,
        white,
    }: Chromaticities,
) -> Matrix3 {
    // generate xyz chromaticity coordinates (x + y + z = 1) from xy coordinates
    let rz = 1.0 - (red.x() + red.y());
    let gz = 1.0 - (green.x() + green.y());
    let bz = 1.0 - (blue.x() + blue.y());

    // Convert white xyz coordinate to XYZ coordinate by letting that the white
    // point have and XYZ relative luminance of 1.0. Relative luminance is the Y
    // component of and XYZ color.
    //   XYZ = xyz * (Y / y)
    let w = {
        let wz = 1.0 - (white.x() + white.y());
        [white.x() / white.y(), white.y() / white.y(), wz / white.y()]
    };

    // Solve for the transformation matrix 'M' from RGB to XYZ
    // * We know that the columns of M are equal to the unknown XYZ values of r, g and b.
    // * We know that the XYZ values of r, g and b are each a scaled version of the known
    //   corresponding xyz chromaticity values.
    // * We know the XYZ value of white based on its xyz value and the assigned relative
    //   luminance of 1.0.
    // * We know the RGB value of white is (1,1,1).
    //
    //   white_XYZ = M * white_RGB
    //
    //       [r.x g.x b.x]
    //   N = [r.y g.y b.y]
    //       [r.z g.z b.z]
    //
    //       [sR 0  0 ]
    //   S = [0  sG 0 ]
    //       [0  0  sB]
    //
    //   M = N * S
    //   white_XYZ = N * S * white_RGB
    //   N^-1 * white_XYZ = S * white_RGB = (sR,sG,sB)
    //
    // We now have an equation for the components of the scale matrix 'S' and
    // can compute 'M' from 'N' and 'S'

    let mut matrix = Matrix3([
        [red.x(), green.x(), blue.x()],
        [red.y(), green.y(), blue.y()],
        [rz, gz, bz],
    ]);
    let scale = matrix.invert().mul_vec(w);
    for xyz in matrix.0.iter_mut() {
        xyz[0] *= scale[0];
        xyz[1] *= scale[1];
        xyz[2] *= scale[2];
    }
    matrix
}

/// Convert a linear sRGB color to an sRGB color.
fn gamma_compress_s_rgb(mut color: Vec3) -> Vec3 {
    // Convert a linear sRGB color channel to a sRGB color channel.
    for c in color.iter_mut() {
        let linear = *c;
        *c = if linear <= 0.0031308 {
            12.92 * linear
        } else {
            1.055 * linear.powf(2.4f32.recip()) - 0.055
        };
    }
    color
}

pub struct ColorMapper {
    color_to_xyz: Matrix3,
    xyz_to_color: Matrix3,
}

impl ColorMapper {
    pub fn new(chromaticities: Chromaticities) -> ColorMapper {
        ColorMapper {
            color_to_xyz: if chromaticities == SRGB_CHROMATICITIES {
                SRGB_TO_XYZ
            } else {
                calc_color_space_conversion_rgb_to_xyz(chromaticities)
            },
            xyz_to_color: XYZ_TO_SRGB,
        }
    }

    /// Maps linear RGB to SRGB and applies SRGB gamma correction.
    pub fn map_gamut(&self, (red, green, blue): (f32, f32, f32)) -> Vec3 {
        // The passed color must be non-linear because the exr format does not assume a viewing
        // condition which requires applying a transfer function.
        let linear_rgb = [red, green, blue];
        let xyz = self.color_to_xyz.mul_vec(linear_rgb);

        // Very few browsers actually support color spaces other than SRGB. In the future a
        // transfer function must be passed to use the display color space.
        let linear_rgb = self.xyz_to_color.mul_vec(xyz);
        gamma_compress_s_rgb(linear_rgb)
    }

    /// Compress any possible f32 into the range of [0,1] and then convert it to an unsigned byte.
    pub fn map_tone(linear: f32) -> u8 {
        // Gamma correction is already applied in ColorMapper::map_gamut.
        (linear * 255.0) as u8
    }
}

#[cfg(test)]
mod test {
    use super::{
        calc_color_space_conversion_rgb_to_xyz, gamma_compress_s_rgb, ColorMapper,
        SRGB_CHROMATICITIES, SRGB_TO_XYZ, XYZ_TO_SRGB,
    };

    #[test]
    fn correct_matrix() {
        let m = calc_color_space_conversion_rgb_to_xyz(SRGB_CHROMATICITIES);
        assert_eq!(m.0, SRGB_TO_XYZ.0);
        let im = m.invert();
        assert_eq!(im.0, XYZ_TO_SRGB.0);
    }

    #[test]
    fn gamma_compresses_linear_srgb() {
        let [r, g, b] = gamma_compress_s_rgb([0.5, 0.25, 0.125]);
        assert!(r < 1.0 && g < 1.0 && b < 1.0);
        assert!(r > 0.7 && g > 0.5 && b > 0.35);
    }

    #[test]
    fn color_mapper_matches_wasm_reference() {
        // Byte-for-byte the same as the WASM decoder for linear sRGB (0.5, 0.25, 0.125, 1.0).
        let mapper = ColorMapper::new(SRGB_CHROMATICITIES);
        let [r, g, b] = mapper.map_gamut((0.5, 0.25, 0.125));
        assert_eq!(
            (ColorMapper::map_tone(r), ColorMapper::map_tone(g), ColorMapper::map_tone(b)),
            (187, 136, 99)
        );
        assert_eq!(ColorMapper::map_tone(1.0), 255);
        assert_eq!(ColorMapper::map_tone(0.0), 0);
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --lib` (workdir `src-tauri`)
Expected: 3 passed (correct_matrix, gamma_compresses_linear_srgb, color_mapper_matches_wasm_reference).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/color.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): porta color pipeline do decodificador EXR (ColorMapper)"
```

---

### Task 2: Add the `tempfile` dev-dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the dev-dependency**

Append to `src-tauri/Cargo.toml`:

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Verify it resolves**

Run: `cargo check` (workdir `src-tauri`)
Expected: compiles (tempfile downloads and builds).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "chore(tauri): adiciona tempfile como dev-dependency"
```

---

### Task 3: Rewrite `decode_exr_image` with chromaticities + gamut/gamma mapping

**Files:**
- Modify: `src-tauri/src/commands/exr.rs`

Reference behavior: `wasm/exr-decoder/src/lib.rs` (reads `chromaticities` from the header, applies `ColorMapper::map_gamut` + `map_tone` per pixel).

- [ ] **Step 1: Write the failing tests first**

Replace `src-tauri/src/commands/exr.rs` with the code from the next step **plus** this test module at the bottom:

```rust
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --lib` (workdir `src-tauri`)
Expected: FAIL — `decode_exr` (the internal function) does not exist yet; the module references `ColorMapper`/`SRGB_CHROMATICITIES` that are not imported.

- [ ] **Step 3: Implement the module**

Replace `src-tauri/src/commands/exr.rs` with:

```rust
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
```

(Keep the `#[cfg(test)] mod tests` from Step 1 appended at the end of the file.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --lib` (workdir `src-tauri`)
Expected: 2 passed (decodes_rgba_exr_with_gamma_mapping, returns_error_for_missing_file) plus the 3 color tests from Task 1.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/exr.rs
git commit -m "feat(tauri): decode EXR aplica ColorMapper (gamut + gamma) via chromaticities"
```

---

### Task 4: `decodeImage` helper + Jest path mapping

**Files:**
- Modify: `jest.config.js`
- Modify: `src/frontend/image/util.ts`
- Test: `tests/image-decode.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/image-decode.test.ts`:

```ts
import { decodeImage } from '../src/frontend/image/util';
import fse from 'fs-extra';
import { isTauri } from '../common/tauri';

jest.mock('fs-extra', () => ({ readFile: jest.fn() }));
jest.mock('../common/tauri', () => ({ isTauri: jest.fn() }));

const mockedReadFile = fse.readFile as jest.MockedFunction<typeof fse.readFile>;
const mockedIsTauri = isTauri as jest.MockedFunction<typeof isTauri>;

const bufferDecoder = {
  decode: jest.fn(async (_buf: Buffer) => ({ width: 1, height: 1, data: 'buffer-decoded' })),
};

const pathDecoder = {
  decode: jest.fn(),
  decodePath: jest.fn(async (_path: string) => ({ width: 2, height: 2, data: 'path-decoded' })),
};

describe('decodeImage', () => {
  beforeEach(() => {
    mockedReadFile.mockReset();
    mockedIsTauri.mockReset();
    bufferDecoder.decode.mockClear();
    pathDecoder.decode.mockClear();
    pathDecoder.decodePath.mockClear();
  });

  test('reads the buffer and calls decoder.decode outside Tauri', async () => {
    mockedIsTauri.mockReturnValue(false);
    mockedReadFile.mockResolvedValue(Buffer.from('raw'));

    const result = await decodeImage(bufferDecoder as any, '/x/foo.exr');

    expect(mockedReadFile).toHaveBeenCalledWith('/x/foo.exr');
    expect(bufferDecoder.decode).toHaveBeenCalledWith(Buffer.from('raw'));
    expect(result).toEqual({ width: 1, height: 1, data: 'buffer-decoded' });
  });

  test('calls decoder.decodePath without reading the file in Tauri', async () => {
    mockedIsTauri.mockReturnValue(true);

    const result = await decodeImage(pathDecoder as any, '/x/foo.exr');

    expect(mockedReadFile).not.toHaveBeenCalled();
    expect(pathDecoder.decodePath).toHaveBeenCalledWith('/x/foo.exr');
    expect(result).toEqual({ width: 2, height: 2, data: 'path-decoded' });
  });

  test('falls back to buffer decode when decoder has no decodePath', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedReadFile.mockResolvedValue(Buffer.from('raw'));

    const result = await decodeImage(bufferDecoder as any, '/x/foo.exr');

    expect(mockedReadFile).toHaveBeenCalledWith('/x/foo.exr');
    expect(bufferDecoder.decode).toHaveBeenCalled();
    expect(result).toEqual({ width: 1, height: 1, data: 'buffer-decoded' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/image-decode.test.ts`
Expected: FAIL — `Cannot find module '../common/tauri'` resolves fine, but `common/core` / `common/config` aliases inside `util.ts` are not resolvable by Jest (no moduleNameMapper yet).

- [ ] **Step 3: Add the Jest module path mapping**

Modify `jest.config.js` to add a `moduleNameMapper`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: [
    // FIXME: I did not manage to get Dexie working in an actual Electron test environment. Testing in JavaScript is
    // cursed, so indexeddb is replaced by an in-memory implementation.
    'fake-indexeddb/auto',
    // Crypto module is not stable in the node version we use, nor can we use the browser.
    '<rootDir>/tests/setup/jest.crypto.js',
  ],
  moduleNameMapper: {
    '^common/(.*)$': '<rootDir>/common/$1',
    '^src/(.*)$': '<rootDir>/src/$1',
    '^wasm/(.*)$': '<rootDir>/wasm/$1',
  },
};
```

- [ ] **Step 4: Add the `decodeImage` helper**

> **Prerequisite:** `common/tauri.ts` (with `isTauri`) must exist. It is created by the masonry plan (`2026-08-01-masonry-native.md`, Task 1). If it does not exist yet, create it first with:
>
> ```ts
> /** True when running inside the Tauri WebView, where native Rust commands are available. */
> export const isTauri = (): boolean =>
>   typeof window !== 'undefined' &&
>   (('__TAURI_INTERNALS__' in window) || ('__TAURI__' in window));
> ```

Modify `src/frontend/image/util.ts`:

1. Add `PathDecoder` and the `decodeImage` helper. The `Loader`/`Decoder` interfaces stay as-is.

```ts
import { clamp } from 'common/core';
import fse from 'fs-extra';
import { thumbnailFormat } from 'common/config';
import { isTauri } from 'common/tauri';

export interface Loader extends Decoder {
  init: () => Promise<void>;
}

export interface Decoder {
  decode: (buffer: Buffer) => Promise<ImageData>;
}

/** Decoders that can also decode a file directly from its path (Tauri native commands). */
export interface PathDecoder extends Decoder {
  decodePath: (path: string) => Promise<ImageData>;
}

/**
 * Decodes an image using the native path decoder in the Tauri runtime,
 * or by reading the file buffer (WASM) otherwise.
 */
export async function decodeImage(decoder: Decoder, path: string): Promise<ImageData> {
  if (isTauri() && 'decodePath' in decoder) {
    return (decoder as PathDecoder).decodePath(path);
  }
  const buf = await fse.readFile(path);
  return decoder.decode(buf);
}
```

2. Replace the buffer reads in `getBlob` and `generateThumbnail`:

```ts
/** Returns a string that can be used as img src attribute */
export async function getBlob(decoder: Decoder, path: string): Promise<string> {
  const data = await decodeImage(decoder, path);
  const blob = await new Promise<Blob>((resolve, reject) =>
    dataToCanvas(data).toBlob(
      (blob) => (blob !== null ? resolve(blob) : reject()),
      'image/avif',
      1.0,
    ),
  );
  return URL.createObjectURL(blob);
}

export async function generateThumbnail(
  decoder: Decoder,
  inputPath: string,
  outputPath: string,
  thumbnailSize: number,
): Promise<void> {
  // TODO: merge this functionality with the thumbnail worker: it's basically duplicate code
  const data = await decodeImage(decoder, inputPath);
  const sampledCanvas = getSampledCanvas(dataToCanvas(data), thumbnailSize);
  const quality = computeQuality(sampledCanvas, thumbnailSize);
  const blobBuffer = await new Promise<ArrayBuffer>((resolve, reject) =>
    sampledCanvas.toBlob(
      (blob) => (blob !== null ? resolve(blob.arrayBuffer()) : reject()),
      `image/${thumbnailFormat}`,
      quality, // Allows to further compress image
    ),
  );
  return fse.writeFile(outputPath, Buffer.from(blobBuffer));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest tests/image-decode.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Verify existing tests still pass**

Run: `yarn test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add jest.config.js src/frontend/image/util.ts tests/image-decode.test.ts
git commit -m "feat(exr): decodeImage roteia decode por path (Tauri) ou buffer (WASM)"
```

---

### Task 5: `ExrLoader.decodePath` via native command

**Files:**
- Modify: `src/frontend/image/ExrLoader.ts`

- [ ] **Step 1: Apply the edits**

Replace `src/frontend/image/ExrLoader.ts` with:

```ts
import { invoke } from '@tauri-apps/api/core';
import { default as init, decode } from 'wasm/packages/exr/exr_decoder';
import { Loader, PathDecoder } from './util';

interface NativeExrImage {
  width: number;
  height: number;
  rgba_bytes: number[];
}

class ExrLoader implements Loader, PathDecoder {
  async init(): Promise<void> {
    await init(new URL('wasm/packages/exr/exr_decoder_bg.wasm', import.meta.url));
  }

  decode(buffer: Buffer): Promise<ImageData> {
    return Promise.resolve(decode(buffer));
  }

  async decodePath(path: string): Promise<ImageData> {
    const image = await invoke<NativeExrImage>('decode_exr_image', { path });
    return new ImageData(new Uint8ClampedArray(image.rgba_bytes), image.width, image.height);
  }
}

export default ExrLoader;
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Verify the production webpack build**

Run: `yarn production`
Expected: build completes (pre-existing fsevents/size warnings are OK).

- [ ] **Step 4: Commit**

```bash
git add src/frontend/image/ExrLoader.ts
git commit -m "feat(exr): ExrLoader decodifica por path via comando Rust no Tauri"
```

---

### Task 6: Full validation

- [ ] **Step 1: Run the full test suites**

Run: `yarn test`
Expected: all tests pass (existing 31 + tauri/masonry + image-decode).

Run: `cargo test --lib` (workdir `src-tauri`)
Expected: all Rust tests pass (existing + color + exr).

Run: `npx tsc --noEmit`
Expected: no errors (ignore pre-existing errors under `node_modules/@types/filesystem`).

Run: `npx eslint src/frontend/image/ common/tauri.ts --ext .ts,.tsx`
Expected: no lint errors.

Run: `yarn production`
Expected: webpack bundle builds successfully.

- [ ] **Step 2: Update the docs**

Append a short section to `docs/` (create `docs/tauri-exr.md`):

```md
# EXR Nativo (Tauri)

O comando `decode_exr_image` (em `src-tauri/src/commands/exr.rs`) decodifica um
EXR para RGBA8 aplicando a pipeline de cor portada de
`wasm/exr-decoder/src/color.rs` (`ColorMapper`): lê `chromaticities` do header,
converte o gamut para sRGB e aplica gamma correction. O resultado é idêntico ao
decodificador WASM.

O frontend usa `ExrLoader.decodePath` (invoke `decode_exr_image`) quando
`isTauri()`, e o decode WASM por buffer como fallback (Electron/web dev). A
escolha é feita por `decodeImage` em `src/frontend/image/util.ts`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/tauri-exr.md
git commit -m "docs: documenta comando EXR nativo"
```

---

### Task 7: Ship the change

- [ ] **Step 1: Push and reference the issue**

```bash
git push origin feat/exr-native
```

- [ ] **Step 2: Move the Kanban card**

```bash
node .agents/scripts/github_helper.js move 17 "Testando & Review"
```

- [ ] **Step 3: Update `bridge.md`**

Move issue #17 (EXR nativo) from "Pedidos em aberto" to "Histórico" in `.agents/tasks/bridge.md`, noting the PR/commit `feat(tauri): integra decode EXR nativo no frontend (Closes #17)`.
