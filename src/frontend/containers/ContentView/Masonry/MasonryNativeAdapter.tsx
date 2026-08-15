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
 * Single adapter: the WASM MasonryWorkerAdapter was removed in #31.
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
    const transform = this.transforms.at(index);
    if (transform === undefined) {
      // Layout is computed asynchronously via `invoke`; the renderer can
      // synchronously ask for a transform mid-recompute (e.g. after a file
      // list change). Match the WASM adapter's non-throwing behaviour
      // (uninitialized WASM memory reads as zeros) instead of crashing the
      // gallery through React's error boundary.
      return [0, 0, 0, 0];
    }
    return [transform.width, transform.height, transform.top, transform.left];
  }

  private async computeLayout(
    containerWidth: number,
    opts: Partial<MasonryOptions>,
  ): Promise<number> {
    const type: MasonryLayoutType = opts.type ?? defaultOpts.type;
    const thumbSize = opts.thumbSize ?? defaultOpts.thumbSize;
    const padding = opts.padding ?? defaultOpts.padding;

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
