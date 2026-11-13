import Path from 'path';
import { invoke } from '@tauri-apps/api/core';
import fse from 'fs-extra';
import { reaction } from 'mobx';

import { isTauri } from 'common/tauri';
import { OrderDirection } from '../src/api/data-storage-search';
import { FileDTO } from '../src/api/file';
import FileStore from '../src/frontend/stores/FileStore';
import LocationStore from '../src/frontend/stores/LocationStore';

jest.mock('react', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return { ...React, default: React };
});

jest.mock('path', () => {
  const Path = jest.requireActual('path') as typeof import('path');
  return { ...Path, default: Path };
});

jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

jest.mock('common/tauri', () => ({
  isTauri: jest.fn(() => false),
}));

jest.mock('fs-extra', () => {
  const api = {
    pathExists: jest.fn().mockResolvedValue(true),
    stat: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
    move: jest.fn().mockResolvedValue(undefined),
  };
  return Object.assign(api, { __esModule: true, default: api });
});

jest.mock('../src/frontend/components/Toaster', () => ({
  AppToaster: { show: jest.fn(), dismiss: jest.fn() },
}));

jest.mock('../src/frontend/services/nativeThumbnail', () => ({
  extractNativePalette: jest.fn().mockResolvedValue(undefined),
}));

const mockedInvoke = invoke as unknown as jest.Mock;
const mockedIsTauri = isTauri as unknown as jest.Mock;
const mockedFse = fse as unknown as {
  pathExists: jest.Mock;
};

const makeDto = (id: string, name = `${id}.jpg`, overrides: Partial<FileDTO> = {}): FileDTO => {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    ino: id,
    id,
    locationId: 'loc-1',
    relativePath: `/${name}`,
    absolutePath: `C:/photos/${name}`,
    tags: [],
    size: 100,
    width: 800,
    height: 600,
    dateAdded: now,
    dateCreated: now,
    dateModified: now,
    dateLastIndexed: now,
    name,
    extension: 'jpg',
    rating: 0,
    ...overrides,
  };
};

const makeRootStore = (backendOverrides: Record<string, jest.Mock> = {}) => {
  const backend = {
    fetchFiles: jest.fn().mockResolvedValue([]),
    removeFiles: jest.fn().mockResolvedValue(undefined),
    saveFiles: jest.fn().mockResolvedValue(undefined),
    countFiles: jest.fn().mockResolvedValue([0, 0]),
    ...backendOverrides,
  };
  const uiStore = {
    thumbnailDirectory: 'C:/thumbs',
    deselectFile: jest.fn(),
    clearFileSelection: jest.fn(),
    clearSearchCriteriaList: jest.fn(),
    clampFirstItem: jest.fn(),
    fileSelection: new Set(),
  };
  const tagStore = {
    tagList: [],
    get: jest.fn(() => undefined),
  };
  const imageLoader = {
    needsThumbnail: jest.fn(() => false),
    resumeThumbnailPath: jest.fn((p: string) => p),
  };
  const locationStore = {
    get: jest.fn(() => ({ id: 'loc-1', path: 'C:/photos', name: 'photos' })),
  };
  const rootStore = {
    uiStore,
    tagStore,
    imageLoader,
    locationStore,
  } as any;

  return { backend, rootStore, uiStore };
};

describe('FileStore LRU cache, batch existence, and boot deduplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedIsTauri.mockReturnValue(false);
    mockedFse.pathExists.mockResolvedValue(true);
  });

  test('reuses ClientFile instances across folder switches (A -> B -> A) and preserves state', async () => {
    const { backend, rootStore } = makeRootStore();
    const store = new FileStore(backend as any, rootStore, 10);

    const dtoA1 = makeDto('a1', 'a1.jpg');
    const dtoA2 = makeDto('a2', 'a2.jpg');
    const dtoB1 = makeDto('b1', 'b1.jpg');

    await store.updateFromBackend([dtoA1, dtoA2]);
    const origA1 = store.fileList[0];
    const origA2 = store.fileList[1];
    origA1.setThumbnailPath('C:/thumbs/a1.webp?v=2');
    const disposeA1 = jest.spyOn(origA1, 'dispose');
    const disposeA2 = jest.spyOn(origA2, 'dispose');

    // Switch to folder B: A's ClientFiles must NOT be disposed
    await store.updateFromBackend([dtoB1]);
    expect(disposeA1).not.toHaveBeenCalled();
    expect(disposeA2).not.toHaveBeenCalled();

    // Switch back to folder A: exact same ClientFile instances are reused
    await store.updateFromBackend([dtoA1, dtoA2]);
    expect(store.fileList[0]).toBe(origA1);
    expect(store.fileList[1]).toBe(origA2);
    expect(store.fileList[0].thumbnailPath).toBe('C:/thumbs/a1.webp?v=2');
    expect(store.fileList[0].isBroken).toBe(false);
    // Already verified (isBroken === false), so no redundant existence check
    expect(mockedFse.pathExists).toHaveBeenCalledTimes(3); // a1, a2, b1 once each
  });

  test('evicts LRU entries and calls dispose() only on eviction or explicit delete/clear', async () => {
    const { backend, rootStore } = makeRootStore();
    const store = new FileStore(backend as any, rootStore, 2);

    const dto1 = makeDto('1');
    const dto2 = makeDto('2');
    const dto3 = makeDto('3');

    await store.updateFromBackend([dto1, dto2]);
    const file1 = store.fileList[0];
    const file2 = store.fileList[1];
    const dispose1 = jest.spyOn(file1, 'dispose');
    const dispose2 = jest.spyOn(file2, 'dispose');

    // Touch file1 so file2 becomes LRU
    await store.updateFromBackend([dto1]);
    expect(dispose2).not.toHaveBeenCalled();

    // Load dto3 -> cache exceeds 2 -> file2 (LRU) is evicted and disposed
    await store.updateFromBackend([dto3]);
    expect(dispose2).toHaveBeenCalledTimes(1);
    expect(dispose1).not.toHaveBeenCalled();

    // Explicit clearFileList() disposes remaining cached entries
    store.clearFileList();
    expect(dispose1).toHaveBeenCalledTimes(1);
  });

  test('never evicts active files even when fileList.length exceeds maxCacheSize', async () => {
    const { backend, rootStore } = makeRootStore();
    const store = new FileStore(backend as any, rootStore, 2);

    await store.updateFromBackend([makeDto('1'), makeDto('2'), makeDto('3')]);
    const spies = store.fileList.map((f) => jest.spyOn(f, 'dispose'));

    spies.forEach((s) => expect(s).not.toHaveBeenCalled());
  });

  test('uses single paths_exist IPC call and single runInAction in Tauri', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockResolvedValue([true, false]);

    const { backend, rootStore } = makeRootStore();
    const store = new FileStore(backend as any, rootStore, 10);

    let missingCountEmissions = 0;
    const stopReaction = reaction(
      () => store.numMissingFiles,
      () => {
        missingCountEmissions += 1;
      },
    );

    await store.updateFromBackend([makeDto('1', 'ok.jpg'), makeDto('2', 'missing.jpg')]);
    stopReaction();

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith('paths_exist', {
      paths: [Path.join('C:/photos', 'ok.jpg'), Path.join('C:/photos', 'missing.jpg')],
    });
    expect(mockedFse.pathExists).not.toHaveBeenCalled();
    expect(store.fileList[0].isBroken).toBe(false);
    expect(store.fileList[1].isBroken).toBe(true);
    expect(store.numMissingFiles).toBe(1);
    expect(missingCountEmissions).toBe(1);
  });

  test('fileListLastModified does not bump for identical list, but bumps on reorder/subset', async () => {
    const { backend, rootStore } = makeRootStore();
    const store = new FileStore(backend as any, rootStore, 10);

    const dto1 = makeDto('1');
    const dto2 = makeDto('2');

    await store.updateFromBackend([dto1, dto2]);
    const t1 = store.fileListLastModified;

    // Identical list -> no bump
    await store.updateFromBackend([dto1, dto2]);
    expect(store.fileListLastModified).toBe(t1);

    // Reordered reused ClientFiles -> bumps so MasonryRenderer recomputes layout
    await store.updateFromBackend([dto2, dto1]);
    expect(store.fileListLastModified).not.toBe(t1);
    const t2 = store.fileListLastModified;

    // Subset of reused ClientFiles -> bumps
    await store.updateFromBackend([dto1]);
    expect(store.fileListLastModified).not.toBe(t2);
  });

  test('reuses boot fetchFiles result across fetchAllFiles, watchLocations, and backfillPalettes', async () => {
    const bootFiles = [makeDto('1', 'one.jpg', { palette: [{ r: 1, g: 2, b: 3, percentage: 1 }] })];
    const { backend, rootStore } = makeRootStore({
      fetchFiles: jest.fn().mockResolvedValue(bootFiles),
    });

    const fileStore = new FileStore(backend as any, rootStore, 10);
    const locationStore = new LocationStore(backend as any, {
      ...rootStore,
      fileStore,
    });
    jest
      .spyOn(locationStore, 'get')
      .mockReturnValue({ id: 'loc-1', path: 'C:/photos', name: 'photos' } as any);
    rootStore.fileStore = fileStore;
    rootStore.locationStore = locationStore;

    // Launch concurrently as RootStore.main does
    await Promise.all([fileStore.fetchAllFiles(), locationStore.watchLocations()]);
    await fileStore.backfillPalettes();

    expect(backend.fetchFiles).toHaveBeenCalledTimes(1);
    expect(backend.fetchFiles).toHaveBeenCalledWith('dateAdded', OrderDirection.Desc);
  });
});
