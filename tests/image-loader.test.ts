import fse from 'fs-extra';
import ImageLoader from '../src/frontend/image/ImageLoader';
import { generateThumbnailUsingWorker } from '../src/frontend/image/ThumbnailGeneration';
import { generateThumbnail } from '../src/frontend/image/util';
import { generateNativeThumbnail } from '../src/frontend/services/nativeThumbnail';
import { NativeThumbnailResult } from '../src/frontend/services/nativeThumbnail';
import ExifIO from '../common/ExifIO';

jest.mock('../src/frontend/image/ThumbnailGeneration', () => ({
  __esModule: true,
  generateThumbnailUsingWorker: jest.fn(async () => {}),
}));

jest.mock('../src/frontend/image/util', () => ({
  __esModule: true,
  generateThumbnail: jest.fn(async () => {}),
  getBlob: jest.fn(async () => 'blob:src'),
}));

jest.mock('../src/frontend/services/nativeThumbnail', () => ({
  __esModule: true,
  generateNativeThumbnail: jest.fn(),
  extractNativePalette: jest.fn(),
}));

jest.mock('../src/frontend/image/TifLoader', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ init: jest.fn(async () => {}) })),
}));

jest.mock('../src/frontend/image/ExrLoader', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ init: jest.fn(async () => {}) })),
}));

jest.mock('../src/frontend/image/PSDLoader', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ init: jest.fn(async () => {}) })),
}));

jest.mock('fs-extra', () => ({
  __esModule: true,
  default: {
    pathExists: jest.fn(),
    stat: jest.fn(),
    readFile: jest.fn(),
    outputFile: jest.fn(),
    remove: jest.fn(),
  },
}));

jest.mock('../common/ExifIO', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    extractThumbnail: jest.fn(async () => true),
    getDimensions: jest.fn(async () => ({ width: 0, height: 0 })),
  })),
}));

const mockedFse = fse as unknown as {
  pathExists: jest.Mock;
  stat: jest.Mock;
};
const mockedNative = generateNativeThumbnail as unknown as jest.Mock;
const mockedWorker = generateThumbnailUsingWorker as unknown as jest.Mock;
const mockedUtilGenerate = generateThumbnail as unknown as jest.Mock;

function makeFile(extension: string, thumbnailPath = 'C:/thumbs/photo-123.webp') {
  return {
    extension,
    absolutePath: `C:/img/photo.${extension}`,
    thumbnailPath,
    setPalette: jest.fn(),
  } as any;
}

describe('ImageLoader.getImageSrc', () => {
  let loader: ImageLoader;

  beforeEach(() => {
    jest.clearAllMocks();
    loader = new ImageLoader(new (ExifIO as any)() as any);
  });

  test('returns undefined for an undefined file instead of throwing', async () => {
    await expect(loader.getImageSrc(undefined as any)).resolves.toBeUndefined();
  });
});

describe('ImageLoader.ensureThumbnail', () => {
  let loader: ImageLoader;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFse.pathExists.mockResolvedValue(false);
    loader = new ImageLoader(new (ExifIO as any)() as any);
  });

  test('uses native generation first for web formats when available', async () => {
    mockedNative.mockResolvedValue({ generated: true, palette: [] });
    const file = makeFile('jpg');

    const result = await loader.ensureThumbnail(file);

    expect(result).toBe(true);
    expect(mockedNative).toHaveBeenCalledWith('C:/img/photo.jpg', 'C:/thumbs/photo-123.webp', 600);
    expect(mockedWorker).not.toHaveBeenCalled();
    expect(file.thumbnailPath).toBe('C:/thumbs/photo-123.webp?v=1');
  });

  test('falls back to the worker when native generation is unavailable/fails for web formats', async () => {
    mockedNative.mockResolvedValue(undefined);
    const file = makeFile('jpg');

    await loader.ensureThumbnail(file);

    expect(mockedWorker).toHaveBeenCalledWith(file, 'C:/thumbs/photo-123.webp');
    expect(file.thumbnailPath).toBe('C:/thumbs/photo-123.webp?v=1');
  });

  test('uses native generation first for tiff, falling back to TifLoader', async () => {
    mockedNative.mockResolvedValue({ generated: true, palette: [] });
    await loader.ensureThumbnail(makeFile('tif'));
    expect(mockedUtilGenerate).not.toHaveBeenCalled();

    mockedNative.mockResolvedValue(undefined);
    await loader.ensureThumbnail(makeFile('tif', 'C:/thumbs/photo-tif.webp'));
    expect(mockedUtilGenerate).toHaveBeenCalledWith(
      expect.anything(),
      'C:/img/photo.tif',
      'C:/thumbs/photo-tif.webp',
      600,
    );
  });

  test('caches a verified thumbnail for the session, skipping repeated disk I/O', async () => {
    mockedNative.mockResolvedValue({ generated: true, palette: [] });
    const file = makeFile('jpg');

    const first = await loader.ensureThumbnail(file);
    expect(first).toBe(true);
    expect(mockedNative).toHaveBeenCalledTimes(1);

    mockedNative.mockClear();
    const second = await loader.ensureThumbnail(file);
    expect(second).toBe(false);
    expect(mockedNative).not.toHaveBeenCalled();
  });

  test('deduplicates concurrent generation for the same file', async () => {
    let resolveNative: (v: NativeThumbnailResult) => void = () => {};
    mockedNative.mockReturnValue(
      new Promise((resolve) => {
        resolveNative = resolve;
      }),
    );
    const file = makeFile('jpg');

    const p1 = loader.ensureThumbnail(file);
    const p2 = loader.ensureThumbnail(file);

    resolveNative({ generated: true, palette: [] });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(mockedNative).toHaveBeenCalledTimes(1);
  });

  test('persists the dominant palette after native generation', async () => {
    mockedNative.mockResolvedValue({
      generated: true,
      palette: [
        { r: 200, g: 50, b: 30, percentage: 0.8 },
        { r: 0, g: 0, b: 255, percentage: 0.2 },
      ],
    });
    const file = makeFile('jpg');

    await loader.ensureThumbnail(file);

    expect(file.setPalette).toHaveBeenCalledWith([
      { r: 200, g: 50, b: 30, percentage: 0.8 },
      { r: 0, g: 0, b: 255, percentage: 0.2 },
    ]);
  });

  test('does not overwrite the palette when native returns an empty one', async () => {
    mockedNative.mockResolvedValue({ generated: true, palette: [] });
    const file = makeFile('jpg');

    await loader.ensureThumbnail(file);

    expect(file.setPalette).not.toHaveBeenCalled();
  });

  test('does not persist a palette on the JS fallback path', async () => {
    mockedNative.mockResolvedValue(undefined);
    const file = makeFile('jpg');

    await loader.ensureThumbnail(file);

    expect(file.setPalette).not.toHaveBeenCalled();
  });

  test('keeps exr on the existing decode pipeline without native', async () => {
    const exrFile = makeFile('exr');

    await loader.ensureThumbnail(exrFile);

    expect(mockedNative).not.toHaveBeenCalled();
    expect(mockedUtilGenerate).toHaveBeenCalledWith(
      expect.anything(),
      'C:/img/photo.exr',
      'C:/thumbs/photo-123.webp',
      600,
    );
  });

  test('does not regenerate or re-encode the original for small files (thumbnailPath === absolutePath)', async () => {
    // `needsThumbnail()` is false for small web images, so filesFromBackend sets
    // thumbnailPath to the ORIGINAL path. Without the guard, ensureThumbnail
    // would decode + re-encode the original file (writing a thumbnail over it)
    // on every first mount of every small image (#80).
    const smallFile = makeFile('jpg', 'C:/img/photo.jpg');

    const result = await loader.ensureThumbnail(smallFile);

    expect(result).toBe(false);
    expect(mockedNative).not.toHaveBeenCalled();
    expect(mockedWorker).not.toHaveBeenCalled();
    expect(mockedFse.pathExists).not.toHaveBeenCalled();
    expect(mockedFse.stat).not.toHaveBeenCalled();

    // A recreated file (folder/filter switch) short-circuits via the session cache.
    const recreated = makeFile('jpg', 'C:/img/photo.jpg');
    await expect(loader.ensureThumbnail(recreated)).resolves.toBe(false);
  });

  test('returns early (no regeneration) when a fresh thumbnail already exists', async () => {
    mockedFse.pathExists.mockResolvedValue(true);
    const fileStats = { mtime: new Date('2020-01-01') };
    const thumbStats = { ctime: new Date('2020-01-02') };
    mockedFse.stat.mockImplementation((p: string) =>
      Promise.resolve(p.includes('thumb') ? thumbStats : fileStats),
    );

    const result = await loader.ensureThumbnail(makeFile('jpg'));

    expect(result).toBe(false);
    expect(mockedNative).not.toHaveBeenCalled();
    expect(mockedWorker).not.toHaveBeenCalled();
  });

  test('does not re-verify or regenerate when the ClientFile is recreated (same thumbnail path)', async () => {
    // Switching folder/filter and coming back recreates the ClientFile with the
    // same deterministic thumbnail path. The session cache must survive the
    // object recreation, otherwise the whole grid re-does disk I/O (and
    // possibly regenerates) → "grid full of loadings" (#74).
    mockedNative.mockResolvedValue({ generated: true, palette: [] });
    await loader.ensureThumbnail(makeFile('jpg'));
    expect(mockedNative).toHaveBeenCalledTimes(1);

    mockedNative.mockClear();
    mockedFse.pathExists.mockClear();
    mockedFse.stat.mockClear();

    const recreated = makeFile('jpg'); // new object, same absolutePath/thumbnailPath
    const result = await loader.ensureThumbnail(recreated);

    expect(result).toBe(false);
    expect(mockedNative).not.toHaveBeenCalled();
    expect(mockedFse.pathExists).not.toHaveBeenCalled();
    expect(mockedFse.stat).not.toHaveBeenCalled();
  });

  test('resumeThumbnailPath restores the exact cached path for recreated files', async () => {
    mockedNative.mockResolvedValue({ generated: true, palette: [] });
    await loader.ensureThumbnail(makeFile('jpg'));

    // Thumbnail was generated: restore the `?v=1` cache-buster so the browser
    // reuses the warm cache instead of re-decoding (#74).
    expect(loader.resumeThumbnailPath('C:/thumbs/photo-123.webp')).toBe(
      'C:/thumbs/photo-123.webp?v=1',
    );
    // Never resolved this session: keep the base path untouched.
    expect(loader.resumeThumbnailPath('C:/thumbs/other-999.webp')).toBe('C:/thumbs/other-999.webp');
  });

  test('resumeThumbnailPath keeps the unversioned path when a fresh thumbnail was only verified', async () => {
    mockedFse.pathExists.mockResolvedValue(true);
    const fileStats = { mtime: new Date('2020-01-01') };
    const thumbStats = { ctime: new Date('2020-01-02') };
    mockedFse.stat.mockImplementation((p: string) =>
      Promise.resolve(p.includes('thumb') ? thumbStats : fileStats),
    );

    await loader.ensureThumbnail(makeFile('jpg'));

    // The thumbnail already existed (no regeneration), so no `?v=` was applied;
    // resuming must return the exact same path to keep the browser cache warm.
    expect(loader.resumeThumbnailPath('C:/thumbs/photo-123.webp')).toBe('C:/thumbs/photo-123.webp');
  });
});
