import { decodeImage } from '../src/frontend/image/util';
import fse from 'fs-extra';
import { isTauri } from '../common/tauri';

jest.mock('fs-extra', () => ({
  __esModule: true,
  default: {
    readFile: jest.fn(),
  },
  readFile: jest.fn(),
}));

jest.mock('../common/tauri', () => ({
  __esModule: true,
  isTauri: jest.fn(),
}));

const mockedReadFile = fse.readFile as unknown as jest.Mock;
const mockedIsTauri = isTauri as unknown as jest.Mock;

const bufferDecoder = {
  decode: jest.fn(async (_buf: Buffer) => ({ width: 1, height: 1, data: 'buffer-decoded' })),
};

const pathDecoder = {
  decode: jest.fn(),
  decodePath: jest.fn(async (_path: string) => ({ width: 2, height: 2, data: 'path-decoded' })),
};

describe('decodeImage', () => {
  beforeEach(() => {
    mockedReadFile.mockReset();
    mockedIsTauri.mockReset();
    bufferDecoder.decode.mockClear();
    pathDecoder.decode.mockClear();
    pathDecoder.decodePath.mockClear();
  });

  test('reads the buffer and calls decoder.decode outside Tauri', async () => {
    mockedIsTauri.mockReturnValue(false);
    mockedReadFile.mockResolvedValue(Buffer.from('raw'));

    const result = await decodeImage(bufferDecoder as any, '/x/foo.exr');

    expect(mockedReadFile).toHaveBeenCalledWith('/x/foo.exr');
    expect(bufferDecoder.decode).toHaveBeenCalledWith(Buffer.from('raw'));
    expect(result).toEqual({ width: 1, height: 1, data: 'buffer-decoded' });
  });

  test('calls decoder.decodePath without reading the file in Tauri', async () => {
    mockedIsTauri.mockReturnValue(true);

    const result = await decodeImage(pathDecoder as any, '/x/foo.exr');

    expect(mockedReadFile).not.toHaveBeenCalled();
    expect(pathDecoder.decodePath).toHaveBeenCalledWith('/x/foo.exr');
    expect(result).toEqual({ width: 2, height: 2, data: 'path-decoded' });
  });

  test('falls back to buffer decode when decoder has no decodePath', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedReadFile.mockResolvedValue(Buffer.from('raw'));

    const result = await decodeImage(bufferDecoder as any, '/x/foo.exr');

    expect(mockedReadFile).toHaveBeenCalledWith('/x/foo.exr');
    expect(bufferDecoder.decode).toHaveBeenCalled();
    expect(result).toEqual({ width: 1, height: 1, data: 'buffer-decoded' });
  });
});
