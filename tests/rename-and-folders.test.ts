// tsconfig usa allowSyntheticDefaultImports (não esModuleInterop). O código usa
// tanto `import X from 'path'` (File.ts) quanto `import * as X from 'path'`
// (FileStore.ts, LocationStore.ts). O mock expõe o módulo real como default
// export E também as funções espalhadas, para ambos os estilos compilados pelo
// ts-jest continuarem funcionando no runtime do jest.
jest.mock('path', () => {
  const actual = jest.requireActual('path');
  return { ...actual, default: actual, __esModule: true };
});

import Path from 'path';
import FileStore from '../src/frontend/stores/FileStore';
import LocationStore from '../src/frontend/stores/LocationStore';
import { RendererMessenger } from '../src/ipc/renderer';
import { ClientFile } from '../src/frontend/entities/File';

jest.mock('../src/ipc/renderer', () => ({
  RendererMessenger: {
    renamePath: jest.fn(async (oldPath: string, newName: string) => {
      const parent = Path.dirname(oldPath);
      return Path.join(parent, newName);
    }),
    createFolder: jest.fn(async (parentPath: string, folderName: string) => {
      return Path.join(parentPath, folderName);
    }),
  },
}));

jest.mock('fs-extra', () => ({
  __esModule: true,
  default: {
    pathExists: jest.fn(async (p: string) => p.includes('already_exists')),
    move: jest.fn(async () => {}),
    ensureDir: jest.fn(async () => {}),
    remove: jest.fn(async () => {}),
  },
  pathExists: jest.fn(async (p: string) => p.includes('already_exists')),
  move: jest.fn(async () => {}),
  ensureDir: jest.fn(async () => {}),
  remove: jest.fn(async () => {}),
}));

jest.mock('../src/frontend/workers/folderWatcherFactory', () => ({
  createFolderWatcherWorker: jest.fn(() => ({
    postMessage: jest.fn(),
    terminate: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })),
}));

describe('Rename and Folder management', () => {
  let backend: any;
  let rootStore: any;
  let fileStore: FileStore;
  let locationStore: LocationStore;

  beforeEach(() => {
    jest.clearAllMocks();

    backend = {
      saveLocation: jest.fn(),
      saveFiles: jest.fn(),
      fetchFilesByKey: jest.fn(async () => []),
      fetchLocations: jest.fn(async () => []),
      saveFile: jest.fn(),
    };

    rootStore = {
      uiStore: {
        thumbnailDirectory: '/virtual/thumbnails',
        deselectFile: jest.fn(),
      },
    };

    fileStore = new FileStore(backend, rootStore);
    locationStore = new LocationStore(backend, rootStore);
    rootStore.fileStore = fileStore;
    rootStore.locationStore = locationStore;
  });

  describe('FileStore.renameFile', () => {
    test('renames file and preserves extension', async () => {
      const mockLocation = { id: 'loc-1', path: '/virtual/photos' };
      fileStore.getLocation = jest.fn(() => mockLocation as any);

      const fileData = {
        id: 'file-1',
        ino: 'file-1',
        name: 'vacation.jpg',
        extension: 'jpg',
        relativePath: '/vacation.jpg',
        size: 1000,
        width: 100,
        height: 100,
        locationId: 'loc-1',
        tags: [],
        dateAdded: new Date(),
        dateCreated: new Date(),
        dateModified: new Date(),
        dateLastIndexed: new Date(),
      };

      const clientFile = new ClientFile(fileStore, fileData as any);
      fileStore.fileList.push(clientFile);
      (fileStore as any).index.set(clientFile.id, 0);

      await fileStore.renameFile(clientFile, 'summer_vacation');

      expect(RendererMessenger.renamePath).toHaveBeenCalledWith(
        clientFile.absolutePath,
        'summer_vacation.jpg',
      );
      expect(fileStore.fileList[0].name).toBe('summer_vacation.jpg');
      expect(fileStore.fileList[0].filename).toBe('summer_vacation');
      expect(fileStore.fileList[0].extension).toBe('jpg');
    });

    test('throws when target filename already exists', async () => {
      const mockLocation = { id: 'loc-1', path: '/virtual/photos' };
      fileStore.getLocation = jest.fn(() => mockLocation as any);

      const clientFile = new ClientFile(fileStore, {
        id: 'file-2',
        ino: 'file-2',
        name: 'test.png',
        extension: 'png',
        relativePath: '/test.png',
        size: 500,
        width: 50,
        height: 50,
        locationId: 'loc-1',
        tags: [],
        dateAdded: new Date(),
        dateCreated: new Date(),
        dateModified: new Date(),
        dateLastIndexed: new Date(),
      } as any);

      await expect(
        fileStore.renameFile(clientFile, 'already_exists'),
      ).rejects.toThrow(/already exists/i);
    });
  });

  describe('LocationStore folder operations', () => {
    test('createSubFolder calls native command and refreshes location', async () => {
      const locPath = Path.normalize('/virtual/photos');
      const mockLocation = {
        id: 'loc-1',
        path: locPath,
        refreshSublocations: jest.fn(async () => {}),
      };
      locationStore.locationList.push(mockLocation as any);

      const created = await locationStore.createSubFolder(locPath, '2026');

      expect(RendererMessenger.createFolder).toHaveBeenCalledWith(locPath, '2026');
      expect(mockLocation.refreshSublocations).toHaveBeenCalled();
      expect(created).toBe(Path.join(locPath, '2026'));
    });

    test('renameFolder updates affected file paths in DB', async () => {
      const locPath = Path.normalize('/virtual/photos');
      const oldAlbumPath = Path.join(locPath, 'old_album');
      const oldFilePath = Path.join(oldAlbumPath, 'pic1.jpg');
      const newAlbumPath = Path.join(locPath, 'new_album');
      const newFilePath = Path.join(newAlbumPath, 'pic1.jpg');

      const mockLocation = {
        id: 'loc-1',
        path: locPath,
        refreshSublocations: jest.fn(async () => {}),
      };
      locationStore.locationList.push(mockLocation as any);

      backend.fetchFilesByKey = jest.fn(async () => [
        {
          id: 'f-1',
          absolutePath: oldFilePath,
          relativePath: Path.join('/old_album', 'pic1.jpg'),
        },
      ]);

      const renamed = await locationStore.renameFolder(
        oldAlbumPath,
        'new_album',
      );

      expect(RendererMessenger.renamePath).toHaveBeenCalledWith(
        oldAlbumPath,
        'new_album',
      );
      expect(backend.saveFiles).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'f-1',
          absolutePath: newFilePath,
        }),
      ]);
      expect(mockLocation.refreshSublocations).toHaveBeenCalled();
    });
  });
});
