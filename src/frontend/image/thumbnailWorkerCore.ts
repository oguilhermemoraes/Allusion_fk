import fse from 'fs-extra';

import { decodeThumbnailData } from './thumbnailDecoder';

/** The worker decoded the thumbnail but could not write it: the main thread must. */
export interface WorkerThumbnailWrite {
  thumbnailFilePath: string;
  thumbnailData: ArrayBuffer;
}

/**
 * Generates (and stores) a thumbnail.
 * - With `sourceBuffer` (Tauri): the worker has no filesystem access, so the
 *   main thread reads the source bytes, this function only decodes them and
 *   returns the bytes for the main thread to write.
 * - Without `sourceBuffer`: the worker has real filesystem access, so it
 *   short-circuits on an existing thumbnail, reads the source file and writes
 *   the output itself.
 */
export const generateAndStoreThumbnail = async (
  filePath: string,
  thumbnailFilePath: string,
  sourceBuffer?: ArrayBuffer,
): Promise<string | WorkerThumbnailWrite> => {
  if (!sourceBuffer) {
    // Could already exist: maybe generated in another worker, when the user scrolls up/down
    // repeatedly. Doesn't help if we want to deliberately overwrite the thumbnail, but
    // we don't have that currently.
    if (await fse.pathExists(thumbnailFilePath)) {
      return thumbnailFilePath;
    }
  }

  const input = sourceBuffer ? new Uint8Array(sourceBuffer) : await fse.readFile(filePath);
  const thumbnailData = await decodeThumbnailData(input);
  if (thumbnailData) {
    if (sourceBuffer) {
      // Tauri: return the bytes so the main thread can write them.
      return { thumbnailFilePath, thumbnailData };
    }
    // The fs-shim accepts ArrayBuffer/Uint8Array contents; avoid `Buffer`,
    // which is not polyfilled in the Tauri WebView bundle.
    await fse.outputFile(thumbnailFilePath, new Uint8Array(thumbnailData));
    return thumbnailFilePath;
  }
  return '';
};
