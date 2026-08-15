import { RendererMessenger } from 'src/ipc/renderer';

/**
 * Drop-in replacement for the `electron` `shell` API used by the frontend.
 * Routes through Tauri commands (`open_external` / `reveal_in_dir`) instead of
 * a native shell. Mirrors only the methods the codebase uses.
 */
export const openExternal = (url: string): Promise<void> => RendererMessenger.openExternal(url);

export const showItemInFolder = (absolutePath: string): void => {
  RendererMessenger.showItemInFolder(absolutePath);
};
