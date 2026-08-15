import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../common/tauri';
import { ClientLocation } from '../src/frontend/entities/Location';

jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

jest.mock('@tauri-apps/api/event', () => ({
  listen: jest.fn(),
}));

jest.mock('../src/frontend/services/TauriFolderWatcher', () => ({
  tauriFolderWatcher: {
    startWatching: jest.fn(),
  },
}));

jest.mock('../src/frontend/workers/folderWatcherFactory', () => ({
  createFolderWatcherWorker: jest.fn(),
}));

jest.mock('../common/tauri', () => ({
  isTauri: jest.fn(),
}));

const mockedInvoke = invoke as unknown as jest.Mock;
const mockedIsTauri = isTauri as unknown as jest.Mock;

describe('Location scan_library', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedIsTauri.mockReset();
  });

  test('invokes scan_library and maps ScannedFile array when isTauri is true', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockResolvedValue([
      {
        absolute_path: '/photos/cat.png',
        size: 1024,
        date_modified: 1600000000000,
        date_created: 1600000000000,
        ino: '12345',
      },
      {
        absolute_path: '/photos/dog.jpg',
        size: 2048,
        date_modified: 1600000005000,
        date_created: 1600000005000,
        ino: '67890',
      },
    ]);

    const location = new ClientLocation(
      {} as any,
      'loc-1',
      '/photos',
      new Date(),
      [],
      ['png' as any, 'jpg' as any],
      0,
    );

    const files = await (location as any).watch('/photos');

    expect(mockedInvoke).toHaveBeenCalledWith('scan_library', {
      path: '/photos',
      extensions: location.extensions,
    });
    expect(files).toHaveLength(2);
    expect(files[0]).toEqual({
      absolutePath: '/photos/cat.png',
      size: 1024,
      dateModified: new Date(1600000000000),
      dateCreated: new Date(1600000000000),
      ino: '12345',
    });
  });
});
