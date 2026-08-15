import { MasonryNativeAdapter } from '../src/frontend/containers/ContentView/Masonry/MasonryNativeAdapter';

jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

import { invoke } from '@tauri-apps/api/core';

const mockedInvoke = invoke as jest.MockedFunction<typeof invoke>;

const imgs = [
  { width: 100, height: 50 },
  { width: 50, height: 100 },
  { width: 100, height: 100 },
];

describe('MasonryNativeAdapter', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  test('compute calls the vertical command and exposes transforms', async () => {
    mockedInvoke.mockResolvedValue({
      total_height: 206,
      transforms: [
        { width: 99, height: 50, top: 0, left: 0 },
        { width: 99, height: 198, top: 0, left: 107 },
        { width: 99, height: 99, top: 0, left: 214 },
      ],
    });

    const adapter = new MasonryNativeAdapter();
    const height = await adapter.compute(imgs as any, imgs.length, 320, {
      type: 'Vertical',
      thumbSize: 100,
      padding: 8,
    });

    expect(height).toBe(206);
    expect(mockedInvoke).toHaveBeenCalledWith('compute_masonry_vertical', {
      dimensions: imgs,
      thumbnailSize: 100,
      padding: 8,
      containerWidth: 320,
    });
    expect(adapter.getTransform(1)).toEqual([99, 198, 0, 107]);
  });

  test('compute calls the grid command for Grid type', async () => {
    mockedInvoke.mockResolvedValue({ total_height: 166, transforms: [] });

    const adapter = new MasonryNativeAdapter();
    await adapter.compute(imgs as any, imgs.length, 250, {
      type: 'Grid',
      thumbSize: 100,
      padding: 8,
    });

    expect(mockedInvoke).toHaveBeenCalledWith('compute_masonry_grid', {
      numItems: 3,
      thumbnailSize: 100,
      padding: 8,
      containerWidth: 250,
    });
  });

  test('compute calls the horizontal command for Horizontal type', async () => {
    mockedInvoke.mockResolvedValue({ total_height: 68, transforms: [] });

    const adapter = new MasonryNativeAdapter();
    await adapter.compute(imgs as any, imgs.length, 250, {
      type: 'Horizontal',
      thumbSize: 100,
      padding: 8,
    });

    expect(mockedInvoke).toHaveBeenCalledWith('compute_masonry_horizontal', {
      dimensions: imgs,
      thumbnailSize: 100,
      padding: 8,
      containerWidth: 250,
    });
  });

  test('recompute reuses the dimensions of the last compute', async () => {
    mockedInvoke.mockResolvedValue({ total_height: 206, transforms: [] });

    const adapter = new MasonryNativeAdapter();
    await adapter.compute(imgs as any, imgs.length, 320, {
      type: 'Vertical',
      thumbSize: 100,
      padding: 8,
    });
    mockedInvoke.mockClear();

    await adapter.recompute(300, { type: 'Vertical', thumbSize: 100, padding: 8 });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith('compute_masonry_vertical', {
      dimensions: imgs,
      thumbnailSize: 100,
      padding: 8,
      containerWidth: 300,
    });
  });

  test('compute forwards a zero padding instead of falling back to the default', async () => {
    mockedInvoke.mockResolvedValue({ total_height: 100, transforms: [] });

    const adapter = new MasonryNativeAdapter();
    await adapter.compute(imgs as any, imgs.length, 320, {
      type: 'Vertical',
      thumbSize: 100,
      padding: 0,
    });

    expect(mockedInvoke).toHaveBeenCalledWith('compute_masonry_vertical', {
      dimensions: imgs,
      thumbnailSize: 100,
      padding: 0,
      containerWidth: 320,
    });
  });

  test('recompute returns 0 before any compute', async () => {
    const adapter = new MasonryNativeAdapter();
    const height = await adapter.recompute(320, { type: 'Vertical' });
    expect(height).toBe(0);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  test('getTransform returns a zero placeholder before layout is computed', () => {
    const adapter = new MasonryNativeAdapter();
    expect(adapter.getTransform(0)).toEqual([0, 0, 0, 0]);
    expect(adapter.getTransform(999)).toEqual([0, 0, 0, 0]);
  });
});
