import UiStore from '../src/frontend/stores/UiStore';
import FileStore from '../src/frontend/stores/FileStore';
import { RendererMessenger, DuplicateGroupDTO } from '../src/ipc/renderer';
import { ClientFile } from '../src/frontend/entities/File';

jest.mock('../src/ipc/renderer', () => ({
  RendererMessenger: {
    computeImageHash: jest.fn(async (path: string) => 'a1b2c3d4e5f60718'),
    findDuplicateImages: jest.fn(async (paths: string[], maxDistance?: number) => {
      if (paths.length < 2) return [];
      return [
        {
          hash: 'a1b2c3d4e5f60718',
          files: [
            { path: paths[0], hash: 'a1b2c3d4e5f60718', distanceToFirst: 0 },
            { path: paths[1], hash: 'a1b2c3d4e5f60718', distanceToFirst: 0 },
          ],
        },
      ];
    }),
  },
}));

describe('Duplicate Image Detection feature', () => {
  let backend: any;
  let rootStore: any;
  let fileStore: FileStore;
  let uiStore: UiStore;

  beforeEach(() => {
    jest.clearAllMocks();

    backend = {
      saveLocation: jest.fn(),
      saveFiles: jest.fn(),
      deleteFiles: jest.fn(),
      fetchFilesByKey: jest.fn(async () => []),
      fetchLocations: jest.fn(async () => []),
      saveFile: jest.fn(),
    };

    rootStore = {
      uiStore: {
        thumbnailDirectory: '/virtual/thumbnails',
        deselectFile: jest.fn(),
        fileSelection: new Set(),
      },
    };

    fileStore = new FileStore(backend, rootStore);
    uiStore = new UiStore(rootStore);
    rootStore.fileStore = fileStore;
    rootStore.uiStore = uiStore;
  });

  test('UiStore controls duplicate modal open and close state', () => {
    expect(uiStore.isDuplicatesModalOpen).toBe(false);

    uiStore.openDuplicatesModal();
    expect(uiStore.isDuplicatesModalOpen).toBe(true);

    uiStore.closeDuplicatesModal();
    expect(uiStore.isDuplicatesModalOpen).toBe(false);
  });

  test('RendererMessenger.findDuplicateImages calls native duplicate command', async () => {
    const paths = ['/virtual/img1.jpg', '/virtual/img1_copy.jpg'];
    const groups = await RendererMessenger.findDuplicateImages(paths, 0);

    expect(RendererMessenger.findDuplicateImages).toHaveBeenCalledWith(paths, 0);
    expect(groups.length).toBe(1);
    expect(groups[0].files.length).toBe(2);
    expect(groups[0].hash).toBe('a1b2c3d4e5f60718');
  });

  test('RendererMessenger.computeImageHash returns hash string', async () => {
    const hash = await RendererMessenger.computeImageHash('/virtual/img1.jpg');
    expect(RendererMessenger.computeImageHash).toHaveBeenCalledWith('/virtual/img1.jpg');
    expect(hash).toBe('a1b2c3d4e5f60718');
  });
});
