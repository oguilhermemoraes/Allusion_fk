import fse from 'fs-extra';
import { action, runInAction } from 'mobx';
import StreamZip from 'node-stream-zip';

import ExifIO from 'common/ExifIO';
import { thumbnailMaxSize } from 'common/config';
import { FileDTO, IMG_EXTENSIONS_TYPE } from '../../api/file';
import { ClientFile } from '../entities/File';
import ExrLoader from './ExrLoader';
import PsdLoader from './PSDLoader';
import { generateThumbnailUsingWorker } from './ThumbnailGeneration';
import TifLoader from './TifLoader';
import { generateThumbnail, getBlob } from './util';
import { generateNativeThumbnail } from '../services/nativeThumbnail';

type FormatHandlerType =
  | 'web'
  | 'tifLoader'
  | 'exrLoader'
  | 'psdLoader'
  | 'extractEmbeddedThumbnailOnly'
  | 'none';

const FormatHandlers: Record<IMG_EXTENSIONS_TYPE, FormatHandlerType> = {
  gif: 'web',
  png: 'web',
  apng: 'web',
  jpg: 'web',
  jpeg: 'web',
  jfif: 'web',
  webp: 'web',
  bmp: 'web',
  ico: 'web',
  svg: 'none',
  tif: 'tifLoader',
  tiff: 'tifLoader',
  psd: 'psdLoader',
  kra: 'extractEmbeddedThumbnailOnly',
  // xcf: 'extractEmbeddedThumbnailOnly',
  exr: 'exrLoader',
  // avif: 'sharp',
};

type ObjectURL = string;

class ImageLoader {
  private tifLoader: TifLoader;
  private exrLoader: ExrLoader;
  private psdLoader: PsdLoader;

  private srcBufferCache: WeakMap<ClientFile, ObjectURL> = new WeakMap();
  private bufferCacheTimer: WeakMap<ClientFile, number> = new WeakMap();
  // Thumbnails already resolved this session, keyed by their deterministic
  // thumbnail path (base path -> exact path that was displayed, including any
  // `?v=` cache-buster). Keying by PATH instead of ClientFile identity lets the
  // cache survive ClientFile recreation: switching folder/filter and coming
  // back creates new objects with the same thumbnail path, and without this the
  // whole grid would re-do disk I/O (and regenerate) on every context switch
  // (#74).
  private resolvedThumbnailPaths: Map<string, string> = new Map();
  // Deduplicate concurrent generation requests for the same file.
  private inFlightThumbnails: Map<ClientFile, Promise<boolean>> = new Map();

  constructor(private exifIO: ExifIO) {
    this.tifLoader = new TifLoader();
    this.exrLoader = new ExrLoader();
    this.psdLoader = new PsdLoader();
    this.ensureThumbnail = action(this.ensureThumbnail.bind(this));
  }

  async init(): Promise<void> {
    await Promise.all([this.tifLoader.init(), this.psdLoader.init()]);
  }

  needsThumbnail(file: FileDTO) {
    // Not using thumbnails for gifs, since they're mostly used for animations, which doesn't get preserved in thumbnails
    if (file.extension === 'gif') {
      return false;
    }

    return (
      FormatHandlers[file.extension] !== 'web' ||
      file.width > thumbnailMaxSize ||
      file.height > thumbnailMaxSize
    );
  }

  /**
   * Ensures a thumbnail exists, will return instantly if already exists.
   * @param file The file to generate a thumbnail for
   * @returns Whether a thumbnail had to be generated
   * @throws When a thumbnail does not exist and cannot be generated
   */
  async ensureThumbnail(file: ClientFile): Promise<boolean> {
    // The observable reads below must run inside an action, otherwise MobX
    // (configured with `observableRequiresReaction`) warns on every read during
    // scroll. `runInAction` covers the synchronous span only, so the `.then`
    // continuation gets its own `runInAction`.
    return runInAction(() => {
      const thumbnailPath = stripVersion(file.thumbnailPath);
      // When the file is small enough that the original is used directly as the
      // thumbnail (`needsThumbnail() === false` in FileStore.filesFromBackend),
      // there is nothing to generate. Without this guard, verifyAndGenerateThumbnail
      // would decode + re-encode the ORIGINAL file (and write a thumbnail over
      // it) on every first mount of every small image — a major source of disk
      // I/O and placeholder flicker when navigating (#80).
      if (thumbnailPath === file.absolutePath) {
        this.resolvedThumbnailPaths.set(thumbnailPath, file.thumbnailPath);
        return false;
      }
      // Once we've resolved a thumbnail this session, don't re-validate it on
      // every (re)mount or after the ClientFile was recreated (folder/filter
      // switch): it's the main source of the placeholder flicker / grid full of
      // loadings (#74).
      if (this.resolvedThumbnailPaths.has(thumbnailPath)) {
        return false;
      }
      // Deduplicate: concurrent requests for the same file share one in-flight job.
      const inFlight = this.inFlightThumbnails.get(file);
      if (inFlight) {
        return inFlight;
      }
      const pending = this.verifyAndGenerateThumbnail(file)
        .then((generated) =>
          runInAction(() => {
            // Remember the exact path that was displayed (it may carry a
            // `?v=` cache-buster after generation), keyed by the stable base
            // path.
            this.resolvedThumbnailPaths.set(thumbnailPath, file.thumbnailPath);
            return generated;
          }),
        )
        .finally(() => {
          this.inFlightThumbnails.delete(file);
        });
      this.inFlightThumbnails.set(file, pending);
      return pending;
    });
  }

  /**
   * Restore the exact thumbnail path a file displayed this session, so that
   * recreated ClientFiles (folder/filter switch) reuse the same URL and the
   * browser cache stays warm instead of re-decoding (#74).
   * @param basePath The deterministic thumbnail path (without any `?v=`).
   */
  resumeThumbnailPath(basePath: string): string {
    return this.resolvedThumbnailPaths.get(basePath) ?? basePath;
  }

  private async verifyAndGenerateThumbnail(file: ClientFile): Promise<boolean> {
    const { extension, absolutePath, thumbnailPath } = {
      extension: file.extension,
      absolutePath: file.absolutePath,
      // remove ?v=1 that might have been added after the thumbnail was generated earlier
      thumbnailPath: stripVersion(file.thumbnailPath),
    };

    if (await fse.pathExists(thumbnailPath)) {
      // Web formats produce a deterministic downscale of the source, so a
      // present thumbnail is always current. Only formats with mutable sources
      // (PSD, KRA, ...) need the mtime comparison. Skipping the two `stat`
      // calls turns the first sighting of each file from 3 IPC round-trips
      // (pathExists + 2 stats) into 1, which is what makes scrolling into new
      // cells stutter (#80).
      if (FormatHandlers[extension] === 'web') {
        return false;
      }
      const fileStats = await fse.stat(absolutePath);
      const thumbStats = await fse.stat(thumbnailPath);
      if (fileStats.mtime < thumbStats.ctime) {
        return false; // if file mod date is before thumbnail creation date, keep using the same thumbnail
      }
    }

    const handlerType = FormatHandlers[extension];
    switch (handlerType) {
      case 'web':
      case 'tifLoader': {
        // Try the native Rust pipeline first; fall back to the JS/Worker one when unavailable or failing
        const nativeResult = await generateNativeThumbnail(
          absolutePath,
          thumbnailPath,
          thumbnailMaxSize,
        );
        if (nativeResult) {
          updateThumbnailPath(file, thumbnailPath);
          // Palette is extracted from the same native decode (see #66); persist it
          // so the DB is up-to-date before the grid needs the colors.
          if (nativeResult.palette.length > 0) {
            file.setPalette(nativeResult.palette);
          }
        } else {
          console.debug('[tauri-diag] native thumbnail failed, falling back to JS', {
            absolutePath,
            thumbnailPath,
          });
          if (handlerType === 'web') {
            await generateThumbnailUsingWorker(file, thumbnailPath);
          } else {
            await generateThumbnail(this.tifLoader, absolutePath, thumbnailPath, thumbnailMaxSize);
          }
          updateThumbnailPath(file, thumbnailPath);
        }
        break;
      }
      case 'exrLoader':
        await generateThumbnail(this.exrLoader, absolutePath, thumbnailPath, thumbnailMaxSize);
        updateThumbnailPath(file, thumbnailPath);
        break;
      case 'extractEmbeddedThumbnailOnly':
        let success = false;
        // Custom logic for specific file formats
        if (extension === 'kra') {
          success = await this.extractKritaThumbnail(absolutePath, thumbnailPath);
        } else {
          // Fallback to extracting thumbnail using exiftool (works for PSD and some other formats)
          success = await this.exifIO.extractThumbnail(absolutePath, thumbnailPath);
        }
        if (!success) {
          // There might not be an embedded thumbnail
          throw new Error('Could not generate or extract thumbnail');
        } else {
          updateThumbnailPath(file, thumbnailPath);
        }
        break;
      case 'psdLoader':
        await generateThumbnail(this.psdLoader, absolutePath, thumbnailPath, thumbnailMaxSize);
        updateThumbnailPath(file, thumbnailPath);
        break;
      case 'none':
        // No thumbnail for this format
        file.setThumbnailPath(file.absolutePath);
        break;
      default:
        console.warn('Unsupported extension', file.absolutePath, file.extension);
        throw new Error('Unsupported extension ' + file.absolutePath);
    }
    return true;
  }

  async getImageSrc(file: ClientFile | undefined): Promise<string | undefined> {
    if (!file) {
      return undefined;
    }
    const handlerType = FormatHandlers[file.extension];
    switch (handlerType) {
      case 'web':
        return file.absolutePath;
      case 'tifLoader': {
        const src =
          this.srcBufferCache.get(file) ?? (await getBlob(this.tifLoader, file.absolutePath));
        // Store in cache for a while, so it loads quicker when going back and forth
        this.updateCache(file, src);
        return src;
      }
      case 'exrLoader': {
        const src =
          this.srcBufferCache.get(file) ?? (await getBlob(this.exrLoader, file.absolutePath));
        // Store in cache for a while, so it loads quicker when going back and forth
        this.updateCache(file, src);
        return src;
      }
      case 'psdLoader':
        const src =
          this.srcBufferCache.get(file) ?? (await getBlob(this.psdLoader, file.absolutePath));
        this.updateCache(file, src);
        return src;
      // TODO: krita has full image also embedded (mergedimage.png)
      case 'extractEmbeddedThumbnailOnly':
      case 'none':
        return undefined;
      default:
        console.warn('Unsupported extension', file.absolutePath, file.extension);
        return undefined;
    }
  }

  /** Returns 0 for width and height if they can't be determined */
  async getImageResolution(absolutePath: string): Promise<{ width: number; height: number }> {
    // ExifTool should be able to read the resolution from any image file
    const dimensions = await this.exifIO.getDimensions(absolutePath);

    // User report: Resolution can't be found for PSD files.
    // Can't reproduce myself, but putting a check in place anyway. Maybe due to old PSD format?
    // Read the actual file using the PSD loader and get the resolution from there.
    if (
      absolutePath.toLowerCase().endsWith('psd') &&
      (dimensions.width === 0 || dimensions.height === 0)
    ) {
      try {
        const psdData = await this.psdLoader.decode(await fse.readFile(absolutePath));
        dimensions.width = psdData.width;
        dimensions.height = psdData.height;
      } catch (e) {}
    }

    return dimensions;
  }

  private async extractKritaThumbnail(absolutePath: string, outputPath: string) {
    const zip = new StreamZip.async({ file: absolutePath });
    let success = false;
    console.debug('Extracting thumbnail from', absolutePath);
    try {
      const count = await zip.extract('preview.png', outputPath);
      success = count === 1;
    } catch (e) {
      console.error('Could not extract thumbnail from .kra file', absolutePath, e);
    } finally {
      zip.close().catch(console.warn);
    }
    return success;
  }

  private updateCache(file: ClientFile, src: ObjectURL) {
    this.srcBufferCache.set(file, src);
    const timer = this.bufferCacheTimer.get(file);
    clearTimeout(timer);
    this.bufferCacheTimer.set(
      file,
      window.setTimeout(() => {
        URL.revokeObjectURL(src);
        this.srcBufferCache.delete(file);
      }, 60_000),
    );
  }
}

export default ImageLoader;

// Update the thumbnail path to re-render the image where ever it is used in React
const updateThumbnailPath = action((file: ClientFile, thumbnailPath: string) => {
  file.thumbnailPath = `${thumbnailPath}?v=1`;
});

// Removes the `?v=` cache-buster suffix (e.g. `?v=1`) that may be appended to a
// thumbnail path after generation. The base path is deterministic per source
// file, so it can be used as the stable session-cache key.
const stripVersion = (path: string): string => path.split('?v=')[0];
