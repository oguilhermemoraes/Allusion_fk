import { invoke } from '@tauri-apps/api/core';
import { isTauri } from 'common/tauri';
import { PaletteColorDTO } from '../../api/file';

// Mirrors the JS thumbnail worker pool limit: don't decode more than 4 large
// images at once, so RAM spikes during grid rendering stay bounded.
const MAX_CONCURRENT = 4;
let inFlight = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}
function release(): void {
  inFlight -= 1;
  const next = waiters.shift();
  if (next) {
    next();
  }
}

/** Result of a native thumbnail pass (mirrors the Rust `GenerateThumbnailResult`). */
export type NativeThumbnailResult = {
  /** `true` when the thumbnail was generated, `false` on a cache hit. */
  generated: boolean;
  /** Dominant colors extracted from the thumbnail buffer. Empty on a cache hit. */
  palette: PaletteColorDTO[];
};

/**
 * Generates a WebP thumbnail natively in Rust (decode + downscale + encode).
 * Returns `undefined` when running outside of Tauri or when the native
 * generation failed (caller should fall back to the JS pipeline).
 */
export async function generateNativeThumbnail(
  path: string,
  outPath: string,
  targetSize: number,
): Promise<NativeThumbnailResult | undefined> {
  if (!isTauri()) {
    return undefined;
  }
  await acquire();
  try {
    // Tauri binds command args by parameter name; `generate_thumbnail`
    // takes a single struct param, so the fields must be wrapped in `params`.
    return await invoke('generate_thumbnail', { params: { path, outPath, targetSize } });
  } catch (e) {
    console.debug('Native thumbnail generation failed, falling back to JS', path, e);
    return undefined;
  } finally {
    release();
  }
}

/**
 * Extracts the dominant palette of an image in isolation (Rust `extract_palette`).
 * Used for the palette backfill of already-indexed images.
 * Returns `undefined` when running outside of Tauri or when the image cannot be decoded.
 */
export async function extractNativePalette(path: string): Promise<PaletteColorDTO[] | undefined> {
  if (!isTauri()) {
    return undefined;
  }
  await acquire();
  try {
    return await invoke('extract_palette', { path });
  } catch (e) {
    console.debug('Native palette extraction failed', path, e);
    return undefined;
  } finally {
    release();
  }
}
