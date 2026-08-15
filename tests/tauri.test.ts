import { isTauri } from '../common/tauri';

describe('isTauri', () => {
  afterEach(() => {
    delete (global as any).window;
  });

  test('returns false when window is undefined (node)', () => {
    expect(isTauri()).toBe(false);
  });

  test('returns false when Tauri globals are missing', () => {
    (global as any).window = {};
    expect(isTauri()).toBe(false);
  });

  test('returns true when __TAURI_INTERNALS__ is present', () => {
    (global as any).window = { __TAURI_INTERNALS__: {} };
    expect(isTauri()).toBe(true);
  });

  test('returns true when __TAURI__ is present', () => {
    (global as any).window = { __TAURI__: {} };
    expect(isTauri()).toBe(true);
  });
});
