import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../common/tauri';
import {
  extractNativePalette,
  generateNativeThumbnail,
  NativeThumbnailResult,
} from '../src/frontend/services/nativeThumbnail';

jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

jest.mock('../common/tauri', () => ({
  isTauri: jest.fn(),
}));

const mockedInvoke = invoke as unknown as jest.Mock;
const mockedIsTauri = isTauri as unknown as jest.Mock;

describe('generateNativeThumbnail', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedIsTauri.mockReset();
  });

  test('returns undefined without invoking when not in Tauri', async () => {
    mockedIsTauri.mockReturnValue(false);
    const result = await generateNativeThumbnail('C:/img/a.jpg', 'C:/thumbs/a-1.webp', 600);
    expect(result).toBeUndefined();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  test('invokes generate_thumbnail with the right args when in Tauri', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockResolvedValue({ generated: true, palette: [] });
    const result = await generateNativeThumbnail('C:/img/a.jpg', 'C:/thumbs/a-1.webp', 600);
    expect(result).toEqual({ generated: true, palette: [] });
    expect(mockedInvoke).toHaveBeenCalledWith('generate_thumbnail', {
      params: { path: 'C:/img/a.jpg', outPath: 'C:/thumbs/a-1.webp', targetSize: 600 },
    });
  });

  test('returns undefined when the native command fails (so the JS pipeline can fall back)', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockRejectedValue(new Error('decode failed'));
    const result = await generateNativeThumbnail('C:/img/a.jpg', 'C:/thumbs/a-1.webp', 400);
    expect(result).toBeUndefined();
  });

  test('returns rich native result with palette when generated', async () => {
    mockedIsTauri.mockReturnValue(true);
    const nativeResult: NativeThumbnailResult = {
      generated: true,
      palette: [
        { r: 200, g: 50, b: 30, percentage: 0.8 },
        { r: 0, g: 0, b: 255, percentage: 0.2 },
      ],
    };
    mockedInvoke.mockResolvedValue(nativeResult);
    const result = await generateNativeThumbnail('C:/img/b.jpg', 'C:/thumbs/b-1.webp', 600);
    expect(result).toBe(nativeResult);
  });
});

describe('extractNativePalette', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedIsTauri.mockReset();
  });

  test('does not invoke when not in Tauri', async () => {
    mockedIsTauri.mockReturnValue(false);
    const result = await extractNativePalette('C:/img/a.jpg');
    expect(result).toBeUndefined();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  test('invokes extract_palette with the image path', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockResolvedValue([{ r: 1, g: 2, b: 3, percentage: 1 }]);
    const result = await extractNativePalette('C:/img/a.jpg');
    expect(mockedInvoke).toHaveBeenCalledWith('extract_palette', { path: 'C:/img/a.jpg' });
    expect(result).toEqual([{ r: 1, g: 2, b: 3, percentage: 1 }]);
  });

  test('returns undefined when the native command fails', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockRejectedValue(new Error('decode failed'));
    const result = await extractNativePalette('C:/img/a.jpg');
    expect(result).toBeUndefined();
  });
});
