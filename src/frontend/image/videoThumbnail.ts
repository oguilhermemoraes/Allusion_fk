import fse from 'fs-extra';
import { encodeFilePath } from 'common/fs';

export interface VideoMetadata {
  width: number;
  height: number;
  duration: number;
}

let videoQueuePromise: Promise<any> = Promise.resolve();

function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = videoQueuePromise.then(() => fn(), () => fn());
  videoQueuePromise = result.then(() => {}, () => {});
  return result;
}

/**
 * Extracts metadata (dimensions, duration) from a video file using an offscreen video element.
 * Processed strictly 1-at-a-time through a mutex queue to prevent CPU/decoder spikes.
 */
export async function getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  // If in non-browser / test environment
  if (typeof document === 'undefined') {
    return { width: 0, height: 0, duration: 0 };
  }

  return runExclusive(() => {
    return new Promise<VideoMetadata>((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      const fileUrl = encodeFilePath(videoPath);
      video.src = fileUrl;

      const timeout = setTimeout(() => {
        cleanup();
        resolve({ width: 0, height: 0, duration: 0 });
      }, 3000);

      const cleanup = () => {
        clearTimeout(timeout);
        video.onloadeddata = null;
        video.onerror = null;
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      };

      // `loadeddata` instead of `loadedmetadata`: some MP4s report duration
      // while still having 0x0 dimensions at the metadata stage, which used to
      // persist 0-width/height records that broke the grid aspect ratio. At
      // the data stage both dimensions are guaranteed.
      video.onloadeddata = () => {
        const duration = video.duration || 0;
        const width = video.videoWidth || 0;
        const height = video.videoHeight || 0;
        cleanup();
        resolve({ width, height, duration });
      };

      video.onerror = () => {
        cleanup();
        resolve({ width: 0, height: 0, duration: 0 });
      };
    });
  });
}

/**
 * Generates a WebP thumbnail frame from a video file and writes it to thumbnailPath.
 * Processed strictly 1-at-a-time through a mutex queue to prevent CPU/decoder spikes.
 */
export async function generateVideoThumbnail(
  videoPath: string,
  thumbnailPath: string,
  targetSize: number = 320,
): Promise<VideoMetadata> {
  // If in non-browser / test environment
  if (typeof document === 'undefined') {
    return { width: 0, height: 0, duration: 0 };
  }

    return runExclusive(() => {
    return new Promise<VideoMetadata>((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      // Required to draw frames onto a canvas without tainting it: the asset://
      // origin differs from the window origin, and `canvas.toBlob()` throws a
      // SecurityError on non-origin-clean bitmaps. The Tauri asset protocol
      // responds with `Access-Control-Allow-Origin: <window-origin>`, so a CORS
      // request succeeds and keeps the canvas clean.
      video.crossOrigin = 'anonymous';

      const fileUrl = encodeFilePath(videoPath);
      video.src = fileUrl;

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`[video-thumb] timeout (5s) waiting for first frame of ${videoPath}`));
      }, 5000);

      const cleanup = () => {
        clearTimeout(timeout);
        video.onloadeddata = null;
        video.onerror = null;
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      };

      // Capture the FIRST decoded frame instead of seeking: seeking depends on
      // range-request behavior and moov placement, and never firing `seeked`
      // silently kills thumbnail generation. `loadeddata` fires as soon as the
      // first frame is available at the current position, which for local files
      // is effectively immediate.
      video.onloadeddata = () => {
        try {
          const width = video.videoWidth;
          const height = video.videoHeight;
          const duration = video.duration || 0;

          if (width === 0 || height === 0) {
            cleanup();
            reject(new Error('[video-thumb] decoded frame has zero dimensions'));
            return;
          }

          let scaledW = width;
          let scaledH = height;
          if (Math.max(width, height) > targetSize) {
            if (width >= height) {
              scaledW = targetSize;
              scaledH = Math.max(1, Math.round((height * targetSize) / width));
            } else {
              scaledH = targetSize;
              scaledW = Math.max(1, Math.round((width * targetSize) / height));
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = scaledW;
          canvas.height = scaledH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            cleanup();
            reject(new Error('[video-thumb] failed to get canvas 2d context'));
            return;
          }

          ctx.drawImage(video, 0, 0, scaledW, scaledH);

          canvas.toBlob(
            async (blob) => {
              cleanup();
              if (!blob) {
                reject(new Error('[video-thumb] canvas.toBlob returned null'));
                return;
              }
              try {
                const arrayBuffer = await blob.arrayBuffer();
                // NOTE: no `Buffer` here — the Tauri WebView has no Node
                // globals. The fs shim accepts ArrayBuffer/Uint8Array.
                await fse.outputFile(thumbnailPath, new Uint8Array(arrayBuffer));
                resolve({ width, height, duration });
              } catch (err) {
                reject(err);
              }
            },
            'image/webp',
            0.8,
          );
        } catch (err) {
          cleanup();
          reject(err);
        }
      };

      video.onerror = () => {
        cleanup();
        reject(new Error(`[video-thumb] failed to load video element for ${videoPath}`));
      };
    });
  });
}
