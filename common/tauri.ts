/**
 * True when running inside the Tauri WebView, where native Rust commands
 * (tauri::invoke) are available. False in the jest environment and in plain
 * web development builds.
 */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
