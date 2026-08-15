# Masonry Nativo (Tauri) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute masonry/grid layouts via native Tauri Rust commands in the Tauri runtime, keeping the existing WASM worker as the fallback in Electron/web dev.

**Architecture:** A new `MasonryNativeAdapter` implements the same `Layouter` contract as `MasonryWorkerAdapter` but calls the existing Rust commands `compute_masonry_horizontal` / `compute_masonry_vertical` (refactored for exact WASM parity) plus a new `compute_masonry_grid`, through `@tauri-apps/api/core` `invoke`. A shared `isTauri()` helper in `common/tauri.ts` selects the adapter at module load in `MasonryRenderer`. Both adapters share the option types moved into `layout-helpers.ts`.

**Tech Stack:** Tauri 2 `invoke`, Rust (`serde`, `#[tauri::command]`), TypeScript 4.9, Jest (`ts-jest`, node env), MobX.

**Working branch:** `feat/masonry-native` (commit message: `feat(tauri): integra masonry nativo no frontend (Closes #16)`).

---

### Task 1: Central `isTauri()` helper

**Files:**
- Create: `common/tauri.ts`
- Test: `tests/tauri.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tauri.test.ts`:

```ts
import { isTauri } from '../common/tauri';

describe('isTauri', () => {
  afterEach(() => {
    delete (global as any).window;
  });

  test('returns false when window is undefined (node)', () => {
    expect(isTauri()).toBe(false);
  });

  test('returns false when Tauri globals are missing', () => {
    (global as any).window = {};
    expect(isTauri()).toBe(false);
  });

  test('returns true when __TAURI_INTERNALS__ is present', () => {
    (global as any).window = { __TAURI_INTERNALS__: {} };
    expect(isTauri()).toBe(true);
  });

  test('returns true when __TAURI__ is present', () => {
    (global as any).window = { __TAURI__: {} };
    expect(isTauri()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/tauri.test.ts`
Expected: FAIL — module `../common/tauri` not found (Cannot find module).

- [ ] **Step 3: Create the module**

Create `common/tauri.ts`:

```ts
/**
 * True when running inside the Tauri WebView, where native Rust commands
 * (tauri::invoke) are available. False in the Electron runtime and in plain
 * web development builds.
 */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' &&
  (('__TAURI_INTERNALS__' in window) || ('__TAURI__' in window));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/tauri.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add common/tauri.ts tests/tauri.test.ts
git commit -m "feat: centraliza isTauri em common/tauri.ts"
```

---

### Task 2: Parity refactor + `compute_masonry_grid` in Rust

**Files:**
- Rewrite: `src-tauri/src/commands/masonry.rs`
- Test: inline `#[cfg(test)]` module in `src-tauri/src/commands/masonry.rs`

Reference algorithm (do not modify): `wasm/masonry/src/layout.rs`. The Rust commands must produce byte-for-byte the same transforms as the WASM `compute_horizontal`, `compute_vertical` and `compute_grid` functions (rounded integer division via `div_int`, aspect-ratio clamping to `MIN_ASPECT_RATIO = 100 / 3`, `u16` truncation of `row_width` in the horizontal scale factor).

- [ ] **Step 1: Write the failing tests first**

Replace the whole `src-tauri/src/commands/masonry.rs` with the code in the next steps **plus** the following test module at the bottom:

```rust
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
                TransformResult { width: 120, height: 60, top: 0, left: 124 },
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --lib` (workdir `src-tauri`)
Expected: FAIL — `compute_masonry_grid` and `correct_aspect_ratio` not found; `TransformResult`/`ImageDimension` use unknown types.

- [ ] **Step 3: Implement the full module**

Replace `src-tauri/src/commands/masonry.rs` with:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageDimension {
    pub width: u16,
    pub height: u16,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
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
```

(Keep the `#[cfg(test)] mod tests` from Step 1 appended at the end of the file.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --lib` (workdir `src-tauri`)
Expected: 5 passed (grid layout, grid empty, horizontal, vertical, aspect ratio) plus any pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/masonry.rs
git commit -m "feat(tauri): adiciona compute_masonry_grid e paridade com WASM"
```

---

### Task 3: Register `compute_masonry_grid`

**Files:**
- Modify: `src-tauri/src/lib.rs:27-48`

- [ ] **Step 1: Add the command to the invoke handler**

In `src-tauri/src/lib.rs`, add `commands::masonry::compute_masonry_grid,` to the `tauri::generate_handler![...]` list, right after `commands::masonry::compute_masonry_vertical,`.

- [ ] **Step 2: Verify it compiles**

Run: `cargo check` (workdir `src-tauri`)
Expected: compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(tauri): registra compute_masonry_grid no invoke handler"
```

---

### Task 4: Shared masonry option types

**Files:**
- Modify: `src/frontend/containers/ContentView/Masonry/layout-helpers.ts`

- [ ] **Step 1: Add the shared types**

Append to `layout-helpers.ts`:

```ts
/** Masonry layout modes, shared by the WASM and native adapters. */
export type MasonryLayoutType = 'Vertical' | 'Horizontal' | 'Grid';

export interface MasonryOptions {
  type: MasonryLayoutType;
  thumbSize: number;
  padding: number;
}
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/containers/ContentView/Masonry/layout-helpers.ts
git commit -m "refactor(masonry): tipos MasonryOptions compartilhados em layout-helpers"
```

---

### Task 5: Update `MasonryWorkerAdapter` to the shared types

**Files:**
- Modify: `src/frontend/containers/ContentView/Masonry/MasonryWorkerAdapter.tsx`

- [ ] **Step 1: Apply the edits**

1. Replace the local `MasonryOptions` interface (lines 8-12) with an import, and import `MasonryLayoutType`:

```ts
import { ITransform, Layouter, MasonryLayoutType, MasonryOptions } from './layout-helpers';
```

2. Change `defaultOpts` to use the string union:

```ts
const defaultOpts: MasonryOptions = {
  type: 'Vertical',
  thumbSize: 300,
  padding: 8,
};
```

3. Add a conversion map after `defaultOpts`:

```ts
const MasonryTypeDict: Record<MasonryLayoutType, MasonryType> = {
  Vertical: MasonryType.Vertical,
  Horizontal: MasonryType.Horizontal,
  Grid: MasonryType.Grid,
};
```

4. In `compute` and `recompute`, convert the string type to the WASM enum when calling the worker (replace `opts.type || defaultOpts.type` with `MasonryTypeDict[opts.type || defaultOpts.type]` in both `worker.compute(...)` calls).

The final file should read:

```ts
import { runInAction } from 'mobx';

import { ClientFile } from '../../../entities/File';
// Force Webpack to include worker and WASM file in the build folder!
import { MasonryType, MasonryWorker, default as init } from 'wasm/packages/masonry';
import { ITransform, Layouter, MasonryLayoutType, MasonryOptions } from './layout-helpers';

const defaultOpts: MasonryOptions = {
  type: 'Vertical',
  thumbSize: 300,
  padding: 8,
};

const MasonryTypeDict: Record<MasonryLayoutType, MasonryType> = {
  Vertical: MasonryType.Vertical,
  Horizontal: MasonryType.Horizontal,
  Grid: MasonryType.Grid,
};

export class MasonryWorkerAdapter implements Layouter {
  private worker?: MasonryWorker;
  private memory?: WebAssembly.Memory;

  private prevNumImgs: number = 0;

  async initialize(numItems: number) {
    this.prevNumImgs = numItems;

    if (this.memory !== undefined && this.worker !== undefined) {
      return;
    }

    console.debug('initializing masonry worker...');
    const wasm = await init();
    this.memory = wasm.memory;

    const worker = new Worker(new URL('wasm/packages/masonry/worker.js', import.meta.url), {
      type: 'module',
    });
    worker.postMessage(this.memory);
    this.worker = new MasonryWorker(numItems);
  }

  async compute(
    imgs: ClientFile[],
    numImgs: number,
    containerWidth: number,
    opts: Partial<MasonryOptions>,
  ): Promise<number | undefined> {
    const worker = this.worker;
    if (worker === undefined) {
      return Promise.reject('Worker is uninitialized.');
    }

    if (this.prevNumImgs !== numImgs) {
      worker.resize(numImgs);
    }

    this.prevNumImgs = numImgs;
    runInAction(() => {
      for (let i = 0; i < imgs.length; i++) {
        worker.set_dimension(i, imgs[i].width, imgs[i].height);
      }
    });

    await worker.compute(
      containerWidth,
      MasonryTypeDict[opts.type || defaultOpts.type],
      opts.thumbSize || defaultOpts.thumbSize,
      opts.padding || defaultOpts.padding,
    );
    return worker.get_height();
  }

  async recompute(
    containerWidth: number,
    opts: Partial<MasonryOptions>,
  ): Promise<number | undefined> {
    if (this.worker === undefined) {
      return Promise.reject('Worker is uninitialized.');
    }
    await this.worker.compute(
      containerWidth,
      MasonryTypeDict[opts.type || defaultOpts.type],
      opts.thumbSize || defaultOpts.thumbSize,
      opts.padding || defaultOpts.padding,
    );
    return this.worker.get_height();
  }

  // This method will be available in the custom VirtualizedRenderer component as layout.getItemLayout
  getTransform(index: number): ITransform {
    if (this.worker === undefined || this.memory === undefined) {
      throw new Error('Worker is uninitialized.');
    }
    const ptr = this.worker.get_transform(index);
    return new Uint32Array(this.memory.buffer, ptr, 4) as unknown as ITransform;
  }
}
```

Note: the only behavioral changes vs. the original file are the shared `MasonryOptions` types and the `MasonryTypeDict` conversion.

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no new errors (the two `worker.compute` calls now pass a `MasonryType` value again).

- [ ] **Step 3: Commit**

```bash
git add src/frontend/containers/ContentView/Masonry/MasonryWorkerAdapter.tsx
git commit -m "refactor(masonry): adapter WASM usa tipos compartilhados"
```

---

### Task 6: `MasonryNativeAdapter` + Jest test

**Files:**
- Create: `src/frontend/containers/ContentView/Masonry/MasonryNativeAdapter.tsx`
- Test: `tests/masonry-native-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/masonry-native-adapter.test.ts`:

```ts
import { MasonryNativeAdapter } from '../src/frontend/containers/ContentView/Masonry/MasonryNativeAdapter';

jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

import { invoke } from '@tauri-apps/api/core';

const mockedInvoke = invoke as jest.MockedFunction<typeof invoke>;

const imgs = [
  { width: 100, height: 50 },
  { width: 50, height: 100 },
  { width: 100, height: 100 },
];

describe('MasonryNativeAdapter', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  test('compute calls the vertical command and exposes transforms', async () => {
    mockedInvoke.mockResolvedValue({
      total_height: 206,
      transforms: [
        { width: 99, height: 50, top: 0, left: 0 },
        { width: 99, height: 198, top: 0, left: 107 },
        { width: 99, height: 99, top: 0, left: 214 },
      ],
    });

    const adapter = new MasonryNativeAdapter();
    const height = await adapter.compute(imgs as any, imgs.length, 320, {
      type: 'Vertical',
      thumbSize: 100,
      padding: 8,
    });

    expect(height).toBe(206);
    expect(mockedInvoke).toHaveBeenCalledWith('compute_masonry_vertical', {
      dimensions: imgs,
      thumbnailSize: 100,
      padding: 8,
      containerWidth: 320,
    });
    expect(adapter.getTransform(1)).toEqual([99, 198, 0, 107]);
  });

  test('compute calls the grid command for Grid type', async () => {
    mockedInvoke.mockResolvedValue({ total_height: 166, transforms: [] });

    const adapter = new MasonryNativeAdapter();
    await adapter.compute(imgs as any, imgs.length, 250, {
      type: 'Grid',
      thumbSize: 100,
      padding: 8,
    });

    expect(mockedInvoke).toHaveBeenCalledWith('compute_masonry_grid', {
      numItems: 3,
      thumbnailSize: 100,
      padding: 8,
      containerWidth: 250,
    });
  });

  test('compute calls the horizontal command for Horizontal type', async () => {
    mockedInvoke.mockResolvedValue({ total_height: 68, transforms: [] });

    const adapter = new MasonryNativeAdapter();
    await adapter.compute(imgs as any, imgs.length, 250, {
      type: 'Horizontal',
      thumbSize: 100,
      padding: 8,
    });

    expect(mockedInvoke).toHaveBeenCalledWith('compute_masonry_horizontal', {
      dimensions: imgs,
      thumbnailSize: 100,
      padding: 8,
      containerWidth: 250,
    });
  });

  test('recompute reuses the dimensions of the last compute', async () => {
    mockedInvoke.mockResolvedValue({ total_height: 206, transforms: [] });

    const adapter = new MasonryNativeAdapter();
    await adapter.compute(imgs as any, imgs.length, 320, {
      type: 'Vertical',
      thumbSize: 100,
      padding: 8,
    });
    mockedInvoke.mockClear();

    await adapter.recompute(300, { type: 'Vertical', thumbSize: 100, padding: 8 });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith('compute_masonry_vertical', {
      dimensions: imgs,
      thumbnailSize: 100,
      padding: 8,
      containerWidth: 300,
    });
  });

  test('recompute returns 0 before any compute', async () => {
    const adapter = new MasonryNativeAdapter();
    const height = await adapter.recompute(320, { type: 'Vertical' });
    expect(height).toBe(0);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  test('getTransform throws when layout has not been computed', () => {
    const adapter = new MasonryNativeAdapter();
    expect(() => adapter.getTransform(0)).toThrow('Layout has not been computed yet.');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/masonry-native-adapter.test.ts`
Expected: FAIL — module `./MasonryNativeAdapter` not found.

- [ ] **Step 3: Create the adapter**

Create `src/frontend/containers/ContentView/Masonry/MasonryNativeAdapter.tsx`:

```ts
import { invoke } from '@tauri-apps/api/core';

import { ITransform, Layouter, MasonryLayoutType, MasonryOptions } from './layout-helpers';

interface Dimensioned {
  width: number;
  height: number;
}

const defaultOpts: MasonryOptions = {
  type: 'Vertical',
  thumbSize: 300,
  padding: 8,
};

interface NativeTransform {
  width: number;
  height: number;
  top: number;
  left: number;
}

interface NativeLayoutResult {
  total_height: number;
  transforms: NativeTransform[];
}

/**
 * Computes masonry layouts via native Tauri Rust commands.
 * Used in the Tauri runtime; the WASM MasonryWorkerAdapter remains the
 * fallback for Electron/web dev.
 */
export class MasonryNativeAdapter implements Layouter {
  private transforms: NativeTransform[] = [];
  private dimensions: Dimensioned[] = [];

  async initialize(_numItems: number): Promise<void> {
    // Native commands are stateless: nothing to set up.
  }

  async compute(
    imgs: Dimensioned[],
    numImgs: number,
    containerWidth: number,
    opts: Partial<MasonryOptions>,
  ): Promise<number | undefined> {
    this.dimensions = imgs
      .slice(0, numImgs)
      .map((img) => ({ width: img.width, height: img.height }));
    return this.computeLayout(containerWidth, opts);
  }

  async recompute(
    containerWidth: number,
    opts: Partial<MasonryOptions>,
  ): Promise<number | undefined> {
    if (this.dimensions.length === 0) {
      return Promise.resolve(0);
    }
    return this.computeLayout(containerWidth, opts);
  }

  getTransform(index: number): ITransform {
    const transform = this.transforms[index];
    if (transform === undefined) {
      throw new Error('Layout has not been computed yet.');
    }
    return [transform.width, transform.height, transform.top, transform.left];
  }

  private async computeLayout(
    containerWidth: number,
    opts: Partial<MasonryOptions>,
  ): Promise<number> {
    const type: MasonryLayoutType = opts.type || defaultOpts.type;
    const thumbSize = opts.thumbSize || defaultOpts.thumbSize;
    const padding = opts.padding || defaultOpts.padding;

    let result: NativeLayoutResult;
    if (type === 'Grid') {
      result = await invoke<NativeLayoutResult>('compute_masonry_grid', {
        numItems: this.dimensions.length,
        thumbnailSize: thumbSize,
        padding,
        containerWidth,
      });
    } else {
      const command =
        type === 'Vertical' ? 'compute_masonry_vertical' : 'compute_masonry_horizontal';
      result = await invoke<NativeLayoutResult>(command, {
        dimensions: this.dimensions,
        thumbnailSize: thumbSize,
        padding,
        containerWidth,
      });
    }

    this.transforms = result.transforms;
    return result.total_height;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/masonry-native-adapter.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/containers/ContentView/Masonry/MasonryNativeAdapter.tsx tests/masonry-native-adapter.test.ts
git commit -m "feat(masonry): MasonryNativeAdapter invoca comandos Rust nativos"
```

---

### Task 7: Wire the adapters in `MasonryRenderer`

**Files:**
- Modify: `src/frontend/containers/ContentView/Masonry/MasonryRenderer.tsx`

- [ ] **Step 1: Apply the edits**

1. Replace the imports (lines 8-11) — remove `MasonryType`, add the native adapter and `isTauri`:

```ts
import { debounce, throttle } from 'common/timeout';
import { isTauri } from 'common/tauri';
import { GalleryProps, getThumbnailSize } from '../utils';
import { MasonryLayoutType } from './layout-helpers';
import { MasonryNativeAdapter } from './MasonryNativeAdapter';
import { MasonryWorkerAdapter } from './MasonryWorkerAdapter';
import VirtualizedRenderer from './VirtualizedRenderer';
```

2. Change `ViewMethodLayoutDict` (lines 18-22) to the string union:

```ts
const ViewMethodLayoutDict: Record<SupportedViewMethod, MasonryLayoutType> = {
  [ViewMethod.MasonryVertical]: 'Vertical',
  [ViewMethod.MasonryHorizontal]: 'Horizontal',
  [ViewMethod.Grid]: 'Grid',
};
```

3. Replace the singleton (line 27):

```ts
const worker: MasonryNativeAdapter | MasonryWorkerAdapter = isTauri()
  ? new MasonryNativeAdapter()
  : new MasonryWorkerAdapter();
```

No other changes are needed: both adapters expose `initialize`, `compute`, `recompute` and `getTransform` with compatible signatures.

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Verify the production webpack build still works**

Run: `yarn production`
Expected: build completes (pre-existing fsevents/size warnings are OK).

- [ ] **Step 4: Commit**

```bash
git add src/frontend/containers/ContentView/Masonry/MasonryRenderer.tsx
git commit -m "feat(masonry): usa MasonryNativeAdapter no runtime Tauri (fallback WASM)"
```

---

### Task 8: Full validation

- [ ] **Step 1: Run the full test suites**

Run: `yarn test`
Expected: all tests pass (existing 31 + new tauri/masonry-native tests).

Run: `cargo test --lib` (workdir `src-tauri`)
Expected: all Rust tests pass.

Run: `npx tsc --noEmit`
Expected: no errors (ignore pre-existing errors under `node_modules/@types/filesystem`).

Run: `npx eslint src/frontend/containers/ContentView/Masonry/ common/tauri.ts --ext .ts,.tsx`
Expected: no lint errors.

Run: `yarn production`
Expected: webpack bundle builds successfully.

- [ ] **Step 2: Update the docs**

Append a short section to `docs/` (create `docs/tauri-masonry.md`) documenting the native command contract:

```md
# Masonry Nativo (Tauri)

Os comandos Rust `compute_masonry_horizontal`, `compute_masonry_vertical` e
`compute_masonry_grid` (em `src-tauri/src/commands/masonry.rs`) reproduzem
exatamente o algoritmo WASM (`wasm/masonry/src/layout.rs`): divisão inteira
arredondada (`div_int`), clamp de aspect ratio a `100/3` e transforms
`[width, height, top, left]`.

O frontend usa `MasonryNativeAdapter` quando `isTauri()` e `MasonryWorkerAdapter`
(WASM) como fallback (Electron/web dev). Argumentos Rust snake_case chegam como
camelCase no JS (`thumbnail_size` → `thumbnailSize`, `container_width` →
`containerWidth`).
```

- [ ] **Step 3: Commit**

```bash
git add docs/tauri-masonry.md
git commit -m "docs: documenta comando masonry nativo"
```

---

### Task 9: Ship the change

- [ ] **Step 1: Push and reference the issue**

```bash
git push origin feat/masonry-native
```

- [ ] **Step 2: Move the Kanban card**

```bash
node .agents/scripts/github_helper.js move 16 "Testando & Review"
```

- [ ] **Step 3: Update `bridge.md`**

Move issue #16 (Masonry nativo) from "Pedidos em aberto" to "Histórico" in `.agents/tasks/bridge.md`, noting the PR/commit `feat(tauri): integra masonry nativo no frontend (Closes #16)`.
