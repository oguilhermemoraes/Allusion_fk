import { convertFileSrc } from '@tauri-apps/api/core';
import { isTauri } from 'common/tauri';
import { encodeFilePath } from 'common/fs';

jest.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: jest.fn((p: string) => `http://asset.localhost/${encodeURIComponent(p)}`),
  invoke: jest.fn(),
}));

jest.mock('common/tauri', () => ({
  isTauri: jest.fn(() => true),
}));

jest.mock('src/frontend/services/shell', () => ({
  openExternal: jest.fn(),
}));

jest.mock('src/frontend/components/VideoPlayer', () => () => null);
jest.mock('src/frontend/containers/Inspector', () => () => null);
jest.mock('src/frontend/containers/ContentView/Commands', () => ({
  CommandDispatcher: jest.fn(),
}));
jest.mock('src/frontend/containers/ContentView/SlideMode/ZoomPan', () => ({
  __esModule: true,
  default: () => null,
  CONTAINER_DEFAULT_STYLE: {},
}));
jest.mock(
  'widgets',
  () => ({
    Button: () => null,
    IconSet: { ARROW_LEFT: null, ARROW_RIGHT: null },
    Split: () => null,
  }),
  { virtual: true },
);

import {
  rememberPreloadedSource,
  takePreloadedSource,
} from 'src/frontend/containers/ContentView/SlideMode';

const mockedIsTauri = isTauri as unknown as jest.Mock;
const mockedConvertFileSrc = convertFileSrc as unknown as jest.Mock;

describe('SlideMode preload source encoding', () => {
  beforeEach(() => {
    mockedIsTauri.mockReturnValue(true);
    mockedConvertFileSrc.mockImplementation(
      (p: string) => `http://asset.localhost/${encodeURIComponent(p)}`,
    );
  });

  it('stores raw unencoded path in preload cache so ZoomableImage encodes it only once', () => {
    const rawPath = 'D:/Images/folder name/photo 01.png';

    // Simulate SlideView preload storing the raw path (not encodeFilePath(rawPath))
    rememberPreloadedSource('file-1', rawPath, [1920, 1080]);

    const preloaded = takePreloadedSource('file-1');
    expect(preloaded).toEqual({
      src: rawPath,
      dimension: [1920, 1080],
    });

    // ZoomableImage encodes `preloaded.src` once when rendering <img>
    const finalSrc = encodeFilePath(preloaded ? preloaded.src : '');
    expect(mockedConvertFileSrc).toHaveBeenCalledTimes(1);
    expect(mockedConvertFileSrc).toHaveBeenCalledWith(rawPath);
    expect(finalSrc).toBe(`http://asset.localhost/${encodeURIComponent(rawPath)}`);
    expect(finalSrc).not.toContain('http%3A%2F%2Fasset.localhost');

    // Consuming once removes it from the cache
    expect(takePreloadedSource('file-1')).toBeUndefined();
  });

  it('evicts the oldest preloaded entry when exceeding the cache limit', () => {
    for (let i = 0; i < 14; i++) {
      rememberPreloadedSource(`file-${i}`, `D:/Images/${i}.png`, [100, 100]);
    }

    // Limit is 12: file-0 and file-1 should have been evicted
    expect(takePreloadedSource('file-0')).toBeUndefined();
    expect(takePreloadedSource('file-1')).toBeUndefined();
    expect(takePreloadedSource('file-2')).toEqual({
      src: 'D:/Images/2.png',
      dimension: [100, 100],
    });
  });
});
