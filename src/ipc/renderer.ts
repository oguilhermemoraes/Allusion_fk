import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import path from 'path';
import {
  DragExportMessage,
  PreviewFilesMessage,
  StoreFileMessage,
  StoreFileReplyMessage,
  ThemeMessage,
  SYSTEM_PATHS,
  WindowSystemButtonPress,
} from './messages';

const isTauri = (): boolean =>
  typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

export interface DuplicateItemDTO {
  path: string;
  hash: string;
  distanceToFirst: number;
}

export interface DuplicateGroupDTO {
  hash: string;
  files: DuplicateItemDTO[];
}

export class RendererMessenger {
  static initialized = () => {
    tauriInvoke('app_initialized', {}).catch(() => {});
  };

  static clearDatabase = () => {
    if (isTauri()) {
      window.location.reload();
    }
  };

  static toggleDevTools = () => {
    if (isTauri()) {
      tauriInvoke('open_devtools', {}).catch(() => {});
    }
  };

  static reload = (_frontEndOnly?: boolean) => {
    if (isTauri()) {
      window.location.reload();
    }
  };

  static showOpenDialog = async (options: any): Promise<any> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { open } = require('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: options?.properties?.includes('openDirectory'),
        multiple: options?.properties?.includes('multiSelections'),
        filters: options?.filters,
      });
      if (!selected) {
        return { canceled: true, filePaths: [] };
      }
      const filePaths = Array.isArray(selected) ? selected : [selected];
      return { canceled: false, filePaths };
    } catch (e) {
      return { canceled: false, filePaths: [] };
    }
  };

  static showMessageBox = async (options: any): Promise<any> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { message } = require('@tauri-apps/plugin-dialog');
      const buttons: string[] = options?.buttons ?? ['OK'];
      const stripAmp = (label: string) => label.replace(/&/g, '');
      const [b0, b1, b2] = buttons.map(stripAmp);
      let tauriButtons: any;
      if (b1 === undefined) {
        tauriButtons = { ok: b0 };
      } else if (b2 === undefined) {
        tauriButtons = { ok: b0, cancel: b1 };
      } else {
        tauriButtons = { yes: b0, no: b1, cancel: b2 };
      }
      const kind =
        options?.type === 'error' ? 'error' : options?.type === 'warning' ? 'warning' : 'info';
      const result = await message(options?.message ?? '', {
        title: options?.title,
        kind,
        buttons: tauriButtons,
      });
      const index = buttons.map(stripAmp).findIndex((label) => label === result);
      return {
        response: index === -1 ? (result === 'Cancel' ? buttons.length - 1 : 0) : index,
        checkboxChecked: false,
      };
    } catch (e) {
      return { response: 0, checkboxChecked: false };
    }
  };

  static showMessageBoxSync = async (): Promise<number> => {
    return 0;
  };

  static getPath = async (name: SYSTEM_PATHS): Promise<string> => {
    try {
      return await tauriInvoke<string>('get_path', { name });
    } catch (e) {
      return '/tmp/allusion';
    }
  };

  static trashFile = async (absolutePath: string): Promise<Error | undefined> => {
    return tauriInvoke('move_to_trash', { path: absolutePath })
      .then(() => undefined)
      .catch((e) => new Error(String(e)));
  };

  static openExternal = async (url: string): Promise<void> => {
    if (!isTauri()) {
      return;
    }
    try {
      await tauriInvoke('open_external', { url });
    } catch (error) {
      console.error('Could not open externally', url, error);
    }
  };

  static showItemInFolder = async (absolutePath: string): Promise<void> => {
    if (!isTauri()) {
      return;
    }
    try {
      await tauriInvoke('reveal_in_dir', { path: absolutePath });
    } catch (error) {
      console.error('Could not reveal in folder', absolutePath, error);
    }
  };

  static copyImageToClipboard = async (absolutePath: string): Promise<void> => {
    if (!isTauri()) {
      return;
    }
    try {
      await tauriInvoke('copy_image_to_clipboard', { path: absolutePath });
    } catch (error) {
      console.error('Could not copy image to clipboard', absolutePath, error);
    }
  };

  static createFolder = async (parentPath: string, folderName: string): Promise<string> => {
    if (isTauri()) {
      return await tauriInvoke<string>('create_folder', { parentPath, folderName });
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fse = require('fs-extra');
    const target = path.join(parentPath, folderName);
    await fse.ensureDir(target);
    return target;
  };

  static renamePath = async (oldPath: string, newName: string): Promise<string> => {
    if (isTauri()) {
      return await tauriInvoke<string>('rename_path', { oldPath, newName });
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fse = require('fs-extra');
    const target = path.join(path.dirname(oldPath), newName);
    await fse.move(oldPath, target);
    return target;
  };

  static computeImageHash = async (path: string): Promise<string> => {
    if (isTauri()) {
      return await tauriInvoke<string>('compute_image_hash', { path });
    }
    return '';
  };

  static findDuplicateImages = async (
    paths: string[],
    maxDistance?: number,
  ): Promise<DuplicateGroupDTO[]> => {
    if (isTauri()) {
      return await tauriInvoke<DuplicateGroupDTO[]>('find_duplicate_images', {
        paths,
        maxDistance,
      });
    }
    return [];
  };

  static setFullScreen = async (isFullScreen: boolean) => {
    if (isTauri()) {
      getCurrentWindow()
        .setFullscreen(isFullScreen)
        .catch(() => {});
    }
  };

  static isFullScreen = (): boolean => {
    return false;
  };

  static onFullScreenChanged = (cb: (val: boolean) => void): void => {
    if (isTauri()) {
      getCurrentWindow()
        .onResized(() => {
          getCurrentWindow()
            .isFullscreen()
            .then(cb)
            .catch(() => {});
        })
        .catch(() => {});
    }
  };

  static setZoomFactor = (level: number): void => {
    // Lazy import so `@tauri-apps/api/webview` (which crashes in a Node/jest env)
    // is only loaded at runtime inside Tauri.
    if (isTauri()) {
      import('@tauri-apps/api/webview')
        .then(({ getCurrentWebview }) => getCurrentWebview().setZoom(level))
        .catch(() => {});
    }
  };

  static getZoomFactor = (): number => {
    return 1;
  };

  static setTheme = (_msg: ThemeMessage): void => {
    // Native theme (Electron `nativeTheme`). Tauri follows the OS theme; no-op until #58.
  };

  static storeFile = (msg: StoreFileMessage): Promise<StoreFileReplyMessage> => {
    return Promise.resolve({ downloadPath: path.join(msg.directory, msg.filenameWithExt) });
  };

  static startDragExport = (_msg: DragExportMessage): void => {
    // Drag-out has no Tauri equivalent; cut per #62.
  };

  static sendPreviewFiles = (_msg: PreviewFilesMessage): void => {
    // Quick View: to be migrated to Tauri multi-window in #58.
  };

  static onReceivePreviewFiles = (_cb: (msg: PreviewFilesMessage) => void): void => {
    // Quick View: to be migrated to Tauri multi-window in #58.
  };

  static onClosedPreviewWindow = (_cb: () => void): void => {
    // Quick View: to be migrated to Tauri multi-window in #58.
  };

  static onMaximize = (cb: () => void): (() => void) => {
    if (!isTauri()) {
      return () => {};
    }
    let dispose: (() => void) | undefined;
    getCurrentWindow()
      .onResized(() => {
        getCurrentWindow()
          .isMaximized()
          .then((maximized) => {
            if (maximized) {
              cb();
            }
          })
          .catch(() => {});
      })
      .then((unlisten) => {
        dispose = unlisten;
      })
      .catch(() => {});
    return () => dispose?.();
  };

  static onUnmaximize = (cb: () => void): (() => void) => {
    if (!isTauri()) {
      return () => {};
    }
    let dispose: (() => void) | undefined;
    getCurrentWindow()
      .onResized(() => {
        getCurrentWindow()
          .isMaximized()
          .then((maximized) => {
            if (!maximized) {
              cb();
            }
          })
          .catch(() => {});
      })
      .then((unlisten) => {
        dispose = unlisten;
      })
      .catch(() => {});
    return () => dispose?.();
  };

  static onFocus = (cb: () => void): (() => void) => {
    if (!isTauri()) {
      return () => {};
    }
    let dispose: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload }) => {
        if (payload) {
          cb();
        }
      })
      .then((unlisten) => {
        dispose = unlisten;
      })
      .catch(() => {});
    return () => dispose?.();
  };

  static onBlur = (cb: () => void): (() => void) => {
    if (!isTauri()) {
      return () => {};
    }
    let dispose: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload }) => {
        if (!payload) {
          cb();
        }
      })
      .then((unlisten) => {
        dispose = unlisten;
      })
      .catch(() => {});
    return () => dispose?.();
  };

  static pressWindowSystemButton = (button: WindowSystemButtonPress) => {
    if (button === WindowSystemButtonPress.Minimize) {
      tauriInvoke('window_minimize').catch(() => {});
    } else if (
      button === WindowSystemButtonPress.Maximize ||
      button === WindowSystemButtonPress.Restore
    ) {
      tauriInvoke('window_toggle_maximize').catch(() => {});
    } else if (button === WindowSystemButtonPress.Close) {
      tauriInvoke('window_close').catch(() => {});
    }
  };

  static isMaximized = async (): Promise<boolean> => {
    if (!isTauri()) {
      return false;
    }
    return getCurrentWindow()
      .isMaximized()
      .catch(() => false);
  };

  static getVersion = (): string => {
    return '1.0.0-rc.10';
  };

  static checkForUpdates = async (): Promise<void> => {
    // electron-updater is removed (see #34). No-op until an updater is decided for Tauri.
  };

  static isCheckUpdatesOnStartupEnabled = (): boolean => {
    return false;
  };

  static toggleCheckUpdatesOnStartup = (): void => {
    // electron-updater is removed (see #34).
  };

  static getDefaultThumbnailDirectory = async () => {
    // `getPath('temp')` may fall back to the relative `/tmp/allusion` when the
    // Tauri `get_path` command fails. Building the thumbnail dir from that
    // produces a relative path that the asset protocol can never serve (403),
    // and it used to get persisted. Fall back to userData so the result is
    // always an absolute path.
    let userDataPath = await RendererMessenger.getPath('temp');
    if (!/^[a-zA-Z]:[\\/]/.test(userDataPath)) {
      userDataPath = await RendererMessenger.getPath('userData');
    }
    return path.join(userDataPath, 'Allusion', 'thumbnails');
  };

  static getDefaultBackupDirectory = async () => {
    const userDataPath = await RendererMessenger.getPath('userData');
    return path.join(userDataPath, 'backups');
  };

  static getThemesDirectory = async () => {
    const userDataPath = await RendererMessenger.getPath('userData');
    return path.join(userDataPath, 'themes');
  };
}
