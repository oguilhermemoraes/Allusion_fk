import UiStore, { defaultHotkeyMap } from '../src/frontend/stores/UiStore';
import { RendererMessenger } from '../src/ipc/renderer';

describe('Copy image to clipboard feature', () => {
  let copySpy: jest.SpyInstance;

  beforeEach(() => {
    copySpy = jest.spyOn(RendererMessenger, 'copyImageToClipboard').mockImplementation(async () => {});
  });

  afterEach(() => {
    copySpy.mockRestore();
  });

  function makeStore(files: any[] = []): UiStore {
    const uiStore = new UiStore({
      fileStore: {
        fileList: files,
        getIndex: (id: any) => files.findIndex((f) => f.id === id),
      },
    } as any);
    return uiStore;
  }

  test('defaultHotkeyMap has copyImage mapped to mod + c', () => {
    expect(defaultHotkeyMap.copyImage).toBe('mod + c');
  });

  test('copyImageFile calls RendererMessenger.copyImageToClipboard with absolutePath', async () => {
    const uiStore = makeStore();
    const mockFile: any = {
      id: 1,
      absolutePath: '/virtual/photos/cat.jpg',
      isBroken: false,
    };

    await uiStore.copyImageFile(mockFile);

    expect(copySpy).toHaveBeenCalledTimes(1);
    expect(copySpy).toHaveBeenCalledWith('/virtual/photos/cat.jpg');
  });

  test('copyImageFile ignores broken files', async () => {
    const uiStore = makeStore();
    const mockBrokenFile: any = {
      id: 2,
      absolutePath: '/virtual/photos/broken.jpg',
      isBroken: true,
    };

    await uiStore.copyImageFile(mockBrokenFile);

    expect(copySpy).not.toHaveBeenCalled();
  });

  test('copySelectedImage copies the first selected file', async () => {
    const mockFile: any = {
      id: 10,
      absolutePath: '/virtual/gallery/landscape.png',
      isBroken: false,
    };

    const uiStore = makeStore([mockFile]);
    uiStore.selectFile(mockFile, false);

    await uiStore.copySelectedImage();

    expect(copySpy).toHaveBeenCalledWith('/virtual/gallery/landscape.png');
  });

  test('copySelectedImage does nothing if no file is selected', async () => {
    const uiStore = makeStore([]);

    await uiStore.copySelectedImage();

    expect(copySpy).not.toHaveBeenCalled();
  });

  test('processGlobalShortCuts triggers copySelectedImage on Ctrl+C', () => {
    const mockFile: any = {
      id: 5,
      absolutePath: '/virtual/art/drawing.png',
      isBroken: false,
    };

    const uiStore = makeStore([mockFile]);
    uiStore.selectFile(mockFile, false);

    const event = {
      key: 'c',
      which: 67,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      target: null,
      preventDefault: jest.fn(),
    } as any;

    uiStore.processGlobalShortCuts(event);

    expect(copySpy).toHaveBeenCalledWith('/virtual/art/drawing.png');
    expect(event.preventDefault).toHaveBeenCalled();
  });
});
