import fse from 'fs-extra';
import { action } from 'mobx';
import path from 'path';
import { useEffect } from 'react';

import { thumbnailFormat } from 'common/config';
import { isTauri } from 'common/tauri';
import { ID } from '../../api/id';
import { ClientFile } from '../entities/File';
import { createThumbnailWorkers } from './thumbnailWorkerFactory';

export interface IThumbnailMessage {
  filePath: string;
  fileId: ID;
  thumbnailFilePath: string;
  thumbnailFormat: string;
  /**
   * Source file bytes, provided by the main thread when the worker cannot read
   * the file itself (Tauri: no filesystem access inside Web Workers).
   */
  sourceBuffer?: ArrayBuffer;
}

export interface IThumbnailMessageResponse {
  fileId: ID;
  thumbnailPath: string;
  /**
   * Thumbnail bytes produced by the worker when the main thread must perform
   * the write (Tauri: the worker has no filesystem access).
   */
  thumbnailBuffer?: ArrayBuffer;
}

// TODO: Look into offscreen canvas operators for thumbnail resizing.

// Set up multiple workers for max performance
const NUM_THUMBNAIL_WORKERS = 4;
const workers: Worker[] = createThumbnailWorkers(NUM_THUMBNAIL_WORKERS);

let lastSubmittedWorker = 0;

type Callback = (success: boolean) => void;
/** A map of File ID and a callback function for when thumbnail generation is finished or has failed */
const listeners = new Map<ID, Callback[]>();

/**
 * Generates a thumbnail in a Worker: {@link ../workers/thumbnailGenerator.worker}
 * When the worker is finished, the file.thumbnailPath will be updated with ?v=1,
 * causing the image to update in the view where ever it is used
 **/
export const generateThumbnailUsingWorker = action(
  async (file: ClientFile, thumbnailFilePath: string, timeout = 10000) => {
    // In Tauri, Web Workers don't have filesystem access (init scripts are
    // `for_main_frame_only`, so `window.__TAURI_INTERNALS__` never exists in
    // the worker). Read the source bytes here and let the worker decode them.
    let sourceBuffer: ArrayBuffer | undefined;
    if (isTauri()) {
      sourceBuffer = await fse.readFile(file.absolutePath);
    }

    const msg: IThumbnailMessage = {
      filePath: file.absolutePath,
      thumbnailFilePath,
      thumbnailFormat,
      fileId: file.id,
      sourceBuffer,
    };

    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        if (listeners.has(msg.fileId)) {
          reject();
          listeners.delete(msg.fileId);
        }
      }, timeout);

      // Might already be in progress if called earlier
      const existingListeners = listeners.get(file.id);
      if (existingListeners) {
        existingListeners.push((success) => (success ? resolve() : reject()));
        return;
      }

      // Otherwise, create a new listener and submit to a worker
      listeners.set(msg.fileId, [(success) => (success ? resolve() : reject())]);
      workers[lastSubmittedWorker].postMessage(msg);
      lastSubmittedWorker = (lastSubmittedWorker + 1) % workers.length;
    });
  },
);

/**
 * Binds a worker's message/error handlers. When the worker returns thumbnail
 * bytes (Tauri), writes them to disk on the main thread (where filesystem
 * access exists) before resolving the pending callbacks.
 * Returns a cleanup function.
 */
export const setupWorkerListener = (worker: Worker) => {
  worker.onmessage = async (e: { data: IThumbnailMessageResponse }) => {
    const { fileId, thumbnailPath, thumbnailBuffer } = e.data;

    let success = true;
    if (thumbnailBuffer) {
      try {
        await fse.outputFile(thumbnailPath, new Uint8Array(thumbnailBuffer));
      } catch (err) {
        console.error('Could not write thumbnail on main thread', thumbnailPath, err);
        success = false;
      }
    }

    const callbacks = listeners.get(fileId);
    if (callbacks) {
      callbacks.forEach((cb) => cb(success));
      listeners.delete(fileId);
    } else {
      console.debug(
        'No callbacks found for fileId after thumbnail message:',
        fileId,
        'Might have timed out',
      );
    }
  };

  worker.onerror = (err) => {
    console.error('Could not generate thumbnail', err);
    const fileId = err.message;

    const callbacks = listeners.get(fileId);
    if (callbacks) {
      callbacks.forEach((cb) => cb(false));
      listeners.delete(fileId);
    } else {
      console.debug(
        'No callbacks found for fileId after unsuccessful thumbnail creation:',
        fileId,
        'Might have timed out',
      );
    }
  };

  return () => {
    worker.onmessage = null;
    worker.onerror = null;
  };
};

/**
 * Listens and processes events from the Workers. Should only be used once in the entire app
 * TODO: no need for this to be a hook anymore, should just make a class out of it
 */
export const useWorkerListener = () => {
  useEffect(() => {
    const cleanups = workers.map((worker) => setupWorkerListener(worker));
    return () => {
      cleanups.forEach((cleanup) => cleanup());
      workers.forEach((worker) => worker.terminate());
    };
  }, []);
};

// Moves all thumbnail files from one directory to another
export const moveThumbnailDir = async (sourceDir: string, targetDir: string) => {
  if (!(await fse.pathExists(sourceDir)) || !(await fse.pathExists(targetDir))) {
    console.log('Source or target directory does not exist for moving thumbnails');
    return;
  }

  console.log('Moving thumbnails from ', sourceDir, ' to ', targetDir);

  const files = await fse.readdir(sourceDir);
  for (const file of files) {
    if (file.endsWith(thumbnailFormat)) {
      const oldPath = path.join(sourceDir, file);
      const newPath = path.join(targetDir, file);
      await fse.move(oldPath, newPath);
    }
  }
};
