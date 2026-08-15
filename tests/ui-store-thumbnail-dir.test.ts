import UiStore from '../src/frontend/stores/UiStore';

jest.mock('fs-extra', () => {
  const actual = jest.requireActual('fs-extra');
  const mod = { ...actual, ensureDirSync: jest.fn() };
  return { __esModule: true, default: mod };
});

const VALID_DEFAULT = 'C:/Users/test/AppData/Local/Temp/Allusion/thumbnails';

jest.mock('../src/ipc/renderer', () => ({
  RendererMessenger: {
    setTheme: jest.fn(),
    getDefaultThumbnailDirectory: jest.fn(() => Promise.resolve(VALID_DEFAULT)),
  },
}));

const PREFERENCES_KEY = 'preferences';

function storeWithPrefs(prefs: Record<string, unknown>): UiStore {
  const store: Record<string, string | null> = {
    [PREFERENCES_KEY]: JSON.stringify({ hotkeyMap: {}, ...prefs }),
  };
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
  return new UiStore({ fileStore: { fileList: [] } } as any);
}

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

describe('UiStore thumbnail directory recovery', () => {
  test('discards the broken /tmp fallback persisted during the Tauri migration', async () => {
    // This exact value was persisted when get_path('temp') failed; restoring it
    // made every thumbnail asset:// URL 403 Forbidden.
    const uiStore = storeWithPrefs({ thumbnailDirectory: '/tmp/allusion/Allusion/thumbnails' });

    uiStore.recoverPersistentPreferences();
    await flushAsync();

    expect(uiStore.thumbnailDirectory).not.toBe('/tmp/allusion/Allusion/thumbnails');
    expect(uiStore.thumbnailDirectory).toBe(VALID_DEFAULT);
  });

  test('restores an absolute thumbnail directory', () => {
    const uiStore = storeWithPrefs({ thumbnailDirectory: VALID_DEFAULT });

    uiStore.recoverPersistentPreferences();

    expect(uiStore.thumbnailDirectory).toBe(VALID_DEFAULT);
  });

  test('discards a bare relative thumbnail directory', async () => {
    const uiStore = storeWithPrefs({ thumbnailDirectory: 'Allusion\\thumbnails' });

    uiStore.recoverPersistentPreferences();
    await flushAsync();

    expect(uiStore.thumbnailDirectory).not.toBe('Allusion\\thumbnails');
    expect(uiStore.thumbnailDirectory).toBe(VALID_DEFAULT);
  });
});
