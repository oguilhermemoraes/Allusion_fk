import UiStore from '../src/frontend/stores/UiStore';

describe('UiStore.clampFirstItem', () => {
  function makeStore(listLength: number): UiStore {
    const uiStore = new UiStore({
      fileStore: { fileList: new Array(listLength) },
    } as any);
    return uiStore;
  }

  test('clamps firstItem to the last valid index when the list shrinks', () => {
    const uiStore = makeStore(3);
    uiStore.firstItem = 5;

    uiStore.clampFirstItem();

    expect(uiStore.firstItem).toBe(2);
  });

  test('resets firstItem to 0 when the list is empty', () => {
    const uiStore = makeStore(0);
    uiStore.firstItem = 4;

    uiStore.clampFirstItem();

    expect(uiStore.firstItem).toBe(0);
  });

  test('leaves firstItem untouched when it is in bounds', () => {
    const uiStore = makeStore(3);
    uiStore.firstItem = 1;

    uiStore.clampFirstItem();

    expect(uiStore.firstItem).toBe(1);
  });

  test('clamps negative firstItem to 0', () => {
    const uiStore = makeStore(3);
    uiStore.firstItem = -2;

    uiStore.clampFirstItem();

    expect(uiStore.firstItem).toBe(0);
  });
});

describe('UiStore grid spacing preferences', () => {
  function makeStore(): UiStore {
    return new UiStore({ fileStore: { fileList: [] } } as any);
  }

  test('setGridGap clamps to [0, 32]', () => {
    const uiStore = makeStore();

    uiStore.setGridGap(40);
    expect(uiStore.gridGap).toBe(32);

    uiStore.setGridGap(-3);
    expect(uiStore.gridGap).toBe(0);

    uiStore.setGridGap(12);
    expect(uiStore.gridGap).toBe(12);
  });

  test('setGridGap ignores non-finite values', () => {
    const uiStore = makeStore();
    uiStore.setGridGap(12);

    uiStore.setGridGap(NaN);
    expect(uiStore.gridGap).toBe(12);

    uiStore.setGridGap(Infinity);
    expect(uiStore.gridGap).toBe(12);
  });

  test('setGridBorderRadius ignores non-finite values', () => {
    const uiStore = makeStore();
    uiStore.setGridBorderRadius(8);

    uiStore.setGridBorderRadius(NaN);
    expect(uiStore.gridBorderRadius).toBe(8);

    uiStore.setGridBorderRadius(-Infinity);
    expect(uiStore.gridBorderRadius).toBe(8);
  });

  test('setGridBorderRadius clamps to [0, 24]', () => {
    const uiStore = makeStore();

    uiStore.setGridBorderRadius(100);
    expect(uiStore.gridBorderRadius).toBe(24);

    uiStore.setGridBorderRadius(-1);
    expect(uiStore.gridBorderRadius).toBe(0);

    uiStore.setGridBorderRadius(8);
    expect(uiStore.gridBorderRadius).toBe(8);
  });

  test('setGridBorderWidth clamps to [0, 8]', () => {
    const uiStore = makeStore();

    uiStore.setGridBorderWidth(20);
    expect(uiStore.gridBorderWidth).toBe(8);

    uiStore.setGridBorderWidth(-2);
    expect(uiStore.gridBorderWidth).toBe(0);

    uiStore.setGridBorderWidth(3);
    expect(uiStore.gridBorderWidth).toBe(3);
  });

  test('setGridBorderWidth ignores non-finite values', () => {
    const uiStore = makeStore();
    uiStore.setGridBorderWidth(4);

    uiStore.setGridBorderWidth(NaN);
    expect(uiStore.gridBorderWidth).toBe(4);

    uiStore.setGridBorderWidth(-Infinity);
    expect(uiStore.gridBorderWidth).toBe(4);
  });

  test('grid spacing is included in the persisted preferences', () => {
    const uiStore = makeStore();

    uiStore.setGridGap(16);
    uiStore.setGridBorderRadius(10);
    uiStore.setGridBorderWidth(3);

    const prefs = uiStore.getPersistentPreferences();

    expect(prefs.gridGap).toBe(16);
    expect(prefs.gridBorderRadius).toBe(10);
    expect(prefs.gridBorderWidth).toBe(3);
  });
});
