import fse from 'fs-extra';
import { getThumbnailPath } from 'common/fs';
import FileStore from '../src/frontend/stores/FileStore';

// ts-jest emits `require('react').default` (no esModuleInterop in tsconfig),
// so default-imports of React are undefined here. Provide the module object as
// `.default` so transitively-imported modules can load and run their top-level
// `React.createContext(...)`.
jest.mock('react', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return { ...React, default: React };
});

jest.mock('path', () => {
  const Path = jest.requireActual('path') as typeof import('path');
  return { ...Path, default: Path };
});

jest.mock('fs-extra', () => {
  const api = {
    pathExists: jest.fn(),
    stat: jest.fn(),
    remove: jest.fn(),
    move: jest.fn(),
  };
  return Object.assign(api, { __esModule: true, default: api });
});

// Keep the test focused on FileStore's delete flow: the store only instantiates
// real ClientFiles while hydrating from the backend (not exercised here).
jest.mock('../src/frontend/entities/File', () => ({
  ClientFile: class {},
  mergeMovedFile: jest.fn(),
  toPlainPalette: jest.fn(),
}));

jest.mock('../src/frontend/components/Toaster', () => ({
  AppToaster: { show: jest.fn() },
}));

const mockedFse = fse as unknown as {
  pathExists: jest.Mock;
  remove: jest.Mock;
};

const makeBackend = () => ({
  removeFiles: jest.fn().mockResolvedValue(undefined),
  fetchFiles: jest.fn().mockResolvedValue([]),
});

const makeUiStore = () => ({
  thumbnailDirectory: 'C:/thumbs',
  deselectFile: jest.fn(),
  clearFileSelection: jest.fn(),
  clearSearchCriteriaList: jest.fn(),
  fileSelection: new Set(),
});

const makeStore = () => {
  const backend = makeBackend();
  const uiStore = makeUiStore();
  const store = new FileStore(
    backend as any,
    { uiStore, tagStore: { tagList: [], get: () => undefined } } as any,
  );
  return { store, backend, uiStore };
};

const makeFile = (id: string, absolutePath: string): any => ({
  id,
  absolutePath,
  dispose: jest.fn(),
});

describe('FileStore.deleteFiles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFse.pathExists.mockResolvedValue(false);
    mockedFse.remove.mockResolvedValue(undefined);
  });

  test('is a no-op for an empty list', async () => {
    const { store, backend } = makeStore();
    await store.deleteFiles([]);
    expect(backend.removeFiles).not.toHaveBeenCalled();
  });

  test('removes records, disposes files, deselects them and refetches the list', async () => {
    const { store, backend, uiStore } = makeStore();
    const a = makeFile('1', 'C:/img/a.jpg');
    const b = makeFile('2', 'C:/img/b.jpg');
    store.fileList.push(a, b);

    await store.deleteFiles([a, b]);

    expect(backend.removeFiles).toHaveBeenCalledWith(['1', '2']);
    expect(a.dispose).toHaveBeenCalled();
    expect(b.dispose).toHaveBeenCalled();
    expect(uiStore.deselectFile).toHaveBeenCalledWith(a);
    expect(uiStore.deselectFile).toHaveBeenCalledWith(b);
    // refetch() re-runs fetchAllFiles -> fetchFiles returns [] -> list cleared
    expect(backend.fetchFiles).toHaveBeenCalled();
    expect(store.fileList).toHaveLength(0);
  });

  test('deletes the thumbnail file from disk when it exists', async () => {
    const { store } = makeStore();
    const a = makeFile('1', 'C:/img/a.jpg');
    mockedFse.pathExists.mockResolvedValue(true);

    await store.deleteFiles([a]);

    const thumb = getThumbnailPath('C:/img/a.jpg', 'C:/thumbs');
    expect(mockedFse.pathExists).toHaveBeenCalledWith(thumb);
    expect(mockedFse.remove).toHaveBeenCalledWith(thumb);
  });

  test('does not remove the thumbnail when it is not on disk', async () => {
    const { store } = makeStore();
    mockedFse.pathExists.mockResolvedValue(false);

    await store.deleteFiles([makeFile('1', 'C:/img/a.jpg')]);

    expect(mockedFse.remove).not.toHaveBeenCalled();
  });

  test('does not throw when the backend removal fails', async () => {
    const { store, backend } = makeStore();
    backend.removeFiles.mockRejectedValueOnce(new Error('boom'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(store.deleteFiles([makeFile('1', 'C:/img/a.jpg')])).resolves.toBeUndefined();

    errorSpy.mockRestore();
  });
});

describe('FileStore.removeFilesByIds', () => {
  test('is a no-op for an empty list', async () => {
    const { store, backend } = makeStore();
    await store.removeFilesByIds([]);
    expect(backend.removeFiles).not.toHaveBeenCalled();
  });

  test('removes the records without refetching the store state', async () => {
    const { store, backend } = makeStore();
    await store.removeFilesByIds(['1', '2']);
    expect(backend.removeFiles).toHaveBeenCalledWith(['1', '2']);
    expect(backend.fetchFiles).not.toHaveBeenCalled();
  });
});
