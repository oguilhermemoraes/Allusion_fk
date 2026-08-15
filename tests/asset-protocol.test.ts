import { convertFileSrc } from '@tauri-apps/api/core';
import { isTauri } from '../common/tauri';
import { encodeFilePath } from '../common/fs';
import { registerAssetScope, registerThumbnailScope } from '../src/frontend/services/assetScope';

jest.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: jest.fn(),
  invoke: jest.fn(),
}));

jest.mock('../common/tauri', () => ({
  isTauri: jest.fn(),
}));

const mockedIsTauri = isTauri as unknown as jest.Mock;
const mockedConvertFileSrc = convertFileSrc as unknown as jest.Mock;
const mockedInvoke = jest.requireMock('@tauri-apps/api/core').invoke as jest.Mock;

describe('encodeFilePath (asset protocol)', () => {
  beforeEach(() => {
    mockedIsTauri.mockReset();
    mockedConvertFileSrc.mockReset();
  });

  test('returns blob/data URLs unchanged', () => {
    expect(encodeFilePath('blob:some-id')).toBe('blob:some-id');
    expect(encodeFilePath('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
  });

  test('falls back to file:// URLs outside of Tauri', () => {
    mockedIsTauri.mockReturnValue(false);
    expect(encodeFilePath('C:/Images/foo.jpg')).toBe('file://C:/Images/foo.jpg');
  });

  test('uses convertFileSrc for local paths inside Tauri', () => {
    mockedIsTauri.mockReturnValue(true);
    mockedConvertFileSrc.mockReturnValue('asset://localhost/%2FC%3A%2FImages%2Ffoo.jpg');
    const result = encodeFilePath('C:/Images/foo.jpg');
    expect(mockedConvertFileSrc).toHaveBeenCalledWith('C:/Images/foo.jpg');
    expect(result).toBe('asset://localhost/%2FC%3A%2FImages%2Ffoo.jpg');
  });

  test('keeps query params (cache busters) outside of convertFileSrc', () => {
    mockedIsTauri.mockReturnValue(true);
    mockedConvertFileSrc.mockReturnValue('asset://localhost/thumbs/foo-123.webp');
    const result = encodeFilePath('C:/thumbs/foo-123.webp?v=1');
    expect(mockedConvertFileSrc).toHaveBeenCalledWith('C:/thumbs/foo-123.webp');
    expect(result).toBe('asset://localhost/thumbs/foo-123.webp?v=1');
  });
});

describe('registerAssetScope', () => {
  beforeEach(() => {
    mockedIsTauri.mockReset();
    mockedInvoke.mockReset();
  });

  test('invokes register_asset_scope with the paths when in Tauri', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockResolvedValue(1);
    await registerAssetScope(['C:/Library', 'D:/Pictures']);
    expect(mockedInvoke).toHaveBeenCalledWith('register_asset_scope', {
      paths: ['C:/Library', 'D:/Pictures'],
    });
  });

  test('does not invoke anything outside of Tauri', async () => {
    mockedIsTauri.mockReturnValue(false);
    await registerAssetScope(['C:/Library']);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  test('filters out empty paths', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockResolvedValue(0);
    await registerAssetScope(['', 'C:/Library', undefined as unknown as string]);
    expect(mockedInvoke).toHaveBeenCalledWith('register_asset_scope', {
      paths: ['C:/Library'],
    });
  });
});

describe('registerThumbnailScope', () => {
  beforeEach(() => {
    mockedIsTauri.mockReset();
    mockedInvoke.mockReset();
  });

  test('registers the thumbnail directory when in Tauri', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockResolvedValue(1);
    await registerThumbnailScope('C:/Users/test/AppData/Local/Temp/Allusion/thumbnails');
    expect(mockedInvoke).toHaveBeenCalledWith('register_asset_scope', {
      paths: ['C:/Users/test/AppData/Local/Temp/Allusion/thumbnails'],
    });
  });

  test('does not invoke anything outside of Tauri', async () => {
    mockedIsTauri.mockReturnValue(false);
    await registerThumbnailScope('C:/Users/test/thumbnails');
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});

describe('tauri.conf.json asset scope', () => {
  test('covers the default thumbnail directory under $TEMP', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const conf = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../src-tauri/tauri.conf.json'), 'utf-8'),
    );
    const allow = conf.app.security.assetProtocol.scope.allow;
    expect(allow).toContain('$TEMP/Allusion/**/*');
    expect(allow).toContain('$APPDATA/**/*');
  });
});
