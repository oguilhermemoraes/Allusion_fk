import { IThumbnailMessage, IThumbnailMessageResponse } from '../image/ThumbnailGeneration';
import { generateAndStoreThumbnail } from '../image/thumbnailWorkerCore';

// The worker context
const ctx: Worker = self as any;

// Set up a queue of thumbnails that need to be processed
// Without a queue, I've had to restart my computer since everything froze
// (not 100% sure whether that was the cause)
// TODO: Max queue length, so that when the user scrolls a lot, the most recent images will show up earlier?
// (-> discard old requests)
const queue: IThumbnailMessage[] = [];
const MAX_PARALLEL_THUMBNAILS = 4; // Related to amount of workers. Currently 4 workers with 4 thumbs in parallel = 16 thumbs parallel total
let curParallelThumbnails = 0;

async function processMessage(data: IThumbnailMessage) {
  const { filePath, thumbnailFilePath, fileId, sourceBuffer } = data;
  try {
    // console.log('Processing thumbnail message', { data, curParallelThumbnails, queue });
    if (curParallelThumbnails < MAX_PARALLEL_THUMBNAILS) {
      curParallelThumbnails++;
      const result = await generateAndStoreThumbnail(filePath, thumbnailFilePath, sourceBuffer);

      let response: IThumbnailMessageResponse;
      if (typeof result === 'string') {
        // Written by the worker itself (no sourceBuffer) or fallback to the real file
        response = { fileId, thumbnailPath: result || filePath };
      } else {
        // Tauri: the worker has no filesystem access; return the bytes so the
        // main thread can write the thumbnail to disk.
        response = {
          fileId,
          thumbnailPath: result.thumbnailFilePath,
          thumbnailBuffer: result.thumbnailData,
        };
      }
      ctx.postMessage(response);
      curParallelThumbnails--;
    } else {
      queue.push(data);
    }
  } catch (err) {
    curParallelThumbnails--;
    console.error('Could not generate image thumbnail', filePath, err);
    // If an error occurs, just load the real file
    ctx.postMessage({ fileId, thumbnailPath: filePath });
  }
  if (curParallelThumbnails < MAX_PARALLEL_THUMBNAILS && queue.length > 0) {
    processMessage(queue.shift()!); // "pop" from the queue. First elements are at the start, so shift em
  }
}

// Respond to message from parent thread
ctx.addEventListener('message', async (event) => {
  await processMessage(event.data);
});
