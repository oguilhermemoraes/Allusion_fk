import { isTauri } from 'common/tauri';

/**
 * Registers directory roots in the Rust asset protocol scope so their files can
 * be served to the WebView via asset:// URLs (see src-tauri/src/commands/asset.rs).
 * No-op when not running inside Tauri (e.g. the jest environment).
 */
export async function registerAssetScope(paths: string[]): Promise<void> {
  if (!isTauri()) {
    return;
  }
  const validPaths = paths.filter((p) => typeof p === 'string' && p.length > 0);
  if (validPaths.length === 0) {
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { invoke } = require('@tauri-apps/api/core');
    await invoke('register_asset_scope', { paths: validPaths });
  } catch (e) {
    console.warn('Could not register asset scope:', e);
  }
}

/**
 * Registers the thumbnail directory in the asset protocol scope so generated
 * thumbnails can be served via asset:// URLs. No-op when not inside Tauri.
 */
export async function registerThumbnailScope(thumbnailDirectory: string): Promise<void> {
  await registerAssetScope([thumbnailDirectory]);
}
