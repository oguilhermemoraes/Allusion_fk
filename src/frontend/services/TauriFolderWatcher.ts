import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export interface WatcherEventPayload {
  path: string;
  kind: 'create' | 'modify' | 'remove';
}

export class TauriFolderWatcher {
  private unlistenFn?: UnlistenFn;

  async startWatching(
    dirPath: string,
    onEvent: (payload: WatcherEventPayload) => void,
  ): Promise<void> {
    if (!this.unlistenFn) {
      this.unlistenFn = await listen<WatcherEventPayload>('watcher-event', (event) => {
        onEvent(event.payload);
      });
    }

    await invoke('watch_folder', { path: dirPath });
  }

  async stopWatching(dirPath: string): Promise<void> {
    await invoke('unwatch_folder', { path: dirPath });
  }

  destroy(): void {
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = undefined;
    }
  }
}

export const tauriFolderWatcher = new TauriFolderWatcher();
