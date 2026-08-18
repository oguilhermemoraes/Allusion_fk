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
        video.onloadedmetadata = null;
        video.onerror = null;
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      };

      video.onloadedmetadata = () => {
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
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      const fileUrl = encodeFilePath(videoPath);
      video.src = fileUrl;

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout generating video thumbnail for ${videoPath}`));
      }, 5000);

      const cleanup = () => {
        clearTimeout(timeout);
        video.onloadedmetadata = null;
        video.onseeked = null;
        video.onerror = null;
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      };

      video.onloadedmetadata = () => {
        const duration = video.duration || 0;
        // Seek to ~0.5 second or 25% of duration to get a representative non-black frame
        const seekTime = duration > 1.0 ? 0.5 : duration * 0.25;
        video.currentTime = seekTime;
      };

      video.onseeked = async () => {
        try {
          const width = video.videoWidth;
          const height = video.videoHeight;
          const duration = video.duration || 0;

          if (width === 0 || height === 0) {
            cleanup();
            reject(new Error('Video dimensions are 0'));
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
            reject(new Error('Failed to get canvas 2d context'));
            return;
          }

          ctx.drawImage(video, 0, 0, scaledW, scaledH);

          canvas.toBlob(
            async (blob) => {
              cleanup();
              if (!blob) {
                reject(new Error('Failed to create blob from canvas'));
                return;
              }
              try {
                const arrayBuffer = await blob.arrayBuffer();
                await fse.outputFile(thumbnailPath, Buffer.from(arrayBuffer));
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
        reject(new Error(`Failed to load video element for ${videoPath}`));
      };
    });
  });
}
