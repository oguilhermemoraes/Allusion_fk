export function createFolderWatcherWorker(): Worker {
  return new Worker(new URL('src/frontend/workers/folderWatcher.worker', import.meta.url));
}
