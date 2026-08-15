import fse from 'fs-extra';
import { decodeThumbnailData } from '../src/frontend/image/thumbnailDecoder';
import { generateAndStoreThumbnail } from '../src/frontend/image/thumbnailWorkerCore';

jest.mock('fs-extra', () => {
  const api = {
    pathExists: jest.fn(),
    readFile: jest.fn(),
    outputFile: jest.fn(),
  };
  return Object.assign(api, { __esModule: true, default: api });
});

jest.mock('../src/frontend/image/thumbnailDecoder', () => ({
  decodeThumbnailData: jest.fn(),
}));

const mockedFse = fse as unknown as {
  pathExists: jest.Mock;
  readFile: jest.Mock;
  outputFile: jest.Mock;
};
const mockedDecode = decodeThumbnailData as unknown as jest.Mock;

beforeEach(() => {
  mockedFse.pathExists.mockReset();
  mockedFse.readFile.mockReset();
  mockedFse.outputFile.mockReset();
  mockedDecode.mockReset();
});

describe('generateAndStoreThumbnail (worker core)', () => {
  test('returns the existing thumbnail path without decoding when no sourceBuffer and the file already exists', async () => {
    mockedFse.pathExists.mockResolvedValue(true);

    const result = await generateAndStoreThumbnail('C:/img/a.jpg', 'C:/thumbs/a-1.webp');

    expect(result).toBe('C:/thumbs/a-1.webp');
    expect(mockedDecode).not.toHaveBeenCalled();
  });

  test('reads the source file, decodes and writes when no sourceBuffer (Electron)', async () => {
    mockedFse.pathExists.mockResolvedValue(false);
    mockedFse.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const data = new ArrayBuffer(4);
    mockedDecode.mockResolvedValue(data);

    const result = await generateAndStoreThumbnail('C:/img/a.jpg', 'C:/thumbs/a-1.webp');

    expect(mockedFse.readFile).toHaveBeenCalledWith('C:/img/a.jpg');
    expect(mockedFse.outputFile).toHaveBeenCalledWith('C:/thumbs/a-1.webp', new Uint8Array(data));
    expect(result).toBe('C:/thumbs/a-1.webp');
  });

  test('does not touch the filesystem when a sourceBuffer is provided (Tauri): returns bytes for the main thread', async () => {
    const source = new Uint8Array([5, 6, 7]).buffer;
    const data = new ArrayBuffer(8);
    mockedDecode.mockResolvedValue(data);

    const result = await generateAndStoreThumbnail('C:/img/a.jpg', 'C:/thumbs/a-1.webp', source);

    expect(mockedFse.pathExists).not.toHaveBeenCalled();
    expect(mockedFse.readFile).not.toHaveBeenCalled();
    expect(mockedFse.outputFile).not.toHaveBeenCalled();
    expect(mockedDecode).toHaveBeenCalledWith(new Uint8Array(source));
    expect(result).toEqual({
      thumbnailFilePath: 'C:/thumbs/a-1.webp',
      thumbnailData: data,
    });
  });

  test("returns '' when decoding produces no data", async () => {
    mockedFse.pathExists.mockResolvedValue(false);
    mockedFse.readFile.mockResolvedValue(new Uint8Array([1]));
    mockedDecode.mockResolvedValue(null);

    const result = await generateAndStoreThumbnail('C:/img/a.jpg', 'C:/thumbs/a-1.webp');

    expect(result).toBe('');
    expect(mockedFse.outputFile).not.toHaveBeenCalled();
  });
});
