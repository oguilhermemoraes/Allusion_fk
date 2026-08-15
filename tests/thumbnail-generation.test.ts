import fse from 'fs-extra';
import { isTauri } from '../common/tauri';
import {
  generateThumbnailUsingWorker,
  setupWorkerListener,
} from '../src/frontend/image/ThumbnailGeneration';
import { createThumbnailWorkers } from '../src/frontend/image/thumbnailWorkerFactory';
import { ClientFile } from '../src/frontend/entities/File';

jest.mock('fs-extra', () => {
  const api = {
    pathExists: jest.fn(),
    readFile: jest.fn(),
    outputFile: jest.fn(),
    readdir: jest.fn(),
    move: jest.fn(),
  };
  return Object.assign(api, { __esModule: true, default: api });
});

jest.mock('../common/tauri', () => ({
  isTauri: jest.fn(),
}));

jest.mock('../src/frontend/image/thumbnailWorkerFactory', () => ({
  createThumbnailWorkers: jest.fn(() => {
    const arr: FakeWorker[] = [];
    for (let i = 0; i < 4; i++) {
      arr.push(makeFakeWorker());
    }
    return arr;
  }),
}));

function makeFakeWorker(): FakeWorker {
  return {
    postMessage: jest.fn(),
    onmessage: null,
    onerror: null,
    terminate: jest.fn(),
  };
}

type FakeWorker = {
  postMessage: jest.Mock;
  onmessage: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  terminate: jest.Mock;
};

const mockedFse = fse as unknown as {
  pathExists: jest.Mock;
  readFile: jest.Mock;
  outputFile: jest.Mock;
};
const mockedIsTauri = isTauri as unknown as jest.Mock;
const mockedCreate = createThumbnailWorkers as unknown as jest.Mock;

let fakes: FakeWorker[];
beforeAll(() => {
  jest.useFakeTimers();
  fakes = mockedCreate.mock.results[0].value as FakeWorker[];
});
const workers = (): FakeWorker[] => fakes;

/** Returns the fake worker that received the postMessage in the current test. */
const postedWorker = (): FakeWorker => workers().find((w) => w.postMessage.mock.calls.length > 0)!;

const makeFile = (id: string, absolutePath: string) =>
  ({ id, absolutePath }) as unknown as ClientFile;

beforeEach(() => {
  mockedIsTauri.mockReset();
  mockedFse.pathExists.mockReset();
  mockedFse.readFile.mockReset();
  mockedFse.outputFile.mockReset();
  for (const w of workers()) {
    w.postMessage.mockClear();
    w.onmessage = null;
    w.onerror = null;
  }
});

describe('generateThumbnailUsingWorker (main thread orchestration)', () => {
  test('posts a message without sourceBuffer when not in Tauri (Electron)', async () => {
    const file = makeFile('1', 'C:/img/a.jpg');
    const promise = generateThumbnailUsingWorker(file, 'C:/thumbs/a-1.webp');

    expect(postedWorker()).toBeDefined();
    const msg = postedWorker().postMessage.mock.calls[0][0];
    expect(msg).toMatchObject({
      filePath: 'C:/img/a.jpg',
      thumbnailFilePath: 'C:/thumbs/a-1.webp',
      fileId: '1',
    });
    expect(msg.sourceBuffer).toBeUndefined();
    expect(mockedFse.readFile).not.toHaveBeenCalled();

    setupWorkerListener(postedWorker() as unknown as Worker);
    postedWorker().onmessage!({ data: { fileId: '1', thumbnailPath: 'C:/thumbs/a-1.webp' } });
    await expect(promise).resolves.toBeUndefined();
  });

  test('reads source bytes and sends them as sourceBuffer when in Tauri', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedFse.readFile.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    const file = makeFile('2', 'C:/img/b.png');

    const promise = generateThumbnailUsingWorker(file, 'C:/thumbs/b-1.webp');
    await Promise.resolve();

    expect(mockedFse.readFile).toHaveBeenCalledWith('C:/img/b.png');
    const msg = postedWorker().postMessage.mock.calls[0][0];
    expect(msg.filePath).toBe('C:/img/b.png');
    expect(Array.from(msg.sourceBuffer)).toEqual([1, 2, 3, 4]);

    setupWorkerListener(postedWorker() as unknown as Worker);
    postedWorker().onmessage!({ data: { fileId: '2', thumbnailPath: 'C:/thumbs/b-1.webp' } });
    await expect(promise).resolves.toBeUndefined();
  });

  test('resolves successfully when the worker responds without a buffer (Electron write-in-worker path)', async () => {
    const file = makeFile('3', 'C:/img/c.png');
    const promise = generateThumbnailUsingWorker(file, 'C:/thumbs/c-1.webp');

    setupWorkerListener(postedWorker() as unknown as Worker);
    postedWorker().onmessage!({ data: { fileId: '3', thumbnailPath: 'C:/thumbs/c-1.webp' } });
    await expect(promise).resolves.toBeUndefined();
    expect(mockedFse.outputFile).not.toHaveBeenCalled();
  });
});

describe('setupWorkerListener (main thread write-back for Tauri)', () => {
  test('writes thumbnailBuffer via fse before resolving when present', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedFse.outputFile.mockResolvedValue(undefined);

    const file = makeFile('10', 'C:/img/d.jpg');
    const promise = generateThumbnailUsingWorker(file, 'C:/thumbs/d-1.webp');
    await Promise.resolve();
    const w = postedWorker();
    setupWorkerListener(w as unknown as Worker);

    const bytes = new Uint8Array([9, 8, 7]);
    w.onmessage!({
      data: { fileId: '10', thumbnailPath: 'C:/thumbs/d-1.webp', thumbnailBuffer: bytes },
    });

    await expect(promise).resolves.toBeUndefined();
    expect(mockedFse.outputFile).toHaveBeenCalledWith('C:/thumbs/d-1.webp', bytes);
  });

  test('resolves as failure (rejects) when writing the thumbnail buffer fails', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedFse.outputFile.mockRejectedValue(new Error('write denied'));

    const file = makeFile('11', 'C:/img/e.jpg');
    const promise = generateThumbnailUsingWorker(file, 'C:/thumbs/e-1.webp');
    await Promise.resolve();
    const w = postedWorker();
    setupWorkerListener(w as unknown as Worker);

    const bytes = new Uint8Array([1]);
    w.onmessage!({
      data: { fileId: '11', thumbnailPath: 'C:/thumbs/e-1.webp', thumbnailBuffer: bytes },
    });

    await expect(promise).rejects.toBeUndefined();
  });

  test('resolves as failure (rejects) when the worker reports an error', async () => {
    const file = makeFile('12', 'C:/img/f.png');
    const promise = generateThumbnailUsingWorker(file, 'C:/thumbs/f-1.webp');
    const w = postedWorker();
    setupWorkerListener(w as unknown as Worker);

    w.onerror!({ message: '12' });
    await expect(promise).rejects.toBeUndefined();
  });
});
