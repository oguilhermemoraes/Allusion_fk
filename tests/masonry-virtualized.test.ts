jest.mock('widgets', () => ({}), { virtual: true });
jest.mock('../src/frontend/containers/ContentView/Commands', () => ({
  CommandDispatcher: class {},
}));

import {
  computeRenderRegion,
  Layouter,
} from '../src/frontend/containers/ContentView/Masonry/layout-helpers';
import { observeViewportResize } from '../src/frontend/containers/ContentView/Masonry/VirtualizedRenderer';
import {
  clearThumbnailCachesForFile,
  getCachedThumbnailSrc,
  hasLoadedThumbnailSrc,
  markThumbnailSrcLoaded,
  setCachedThumbnailSrc,
} from '../src/frontend/containers/ContentView/GalleryItem';
import { ClientFile } from '../src/frontend/entities/File';

const linearLayout: Layouter = {
  getTransform: (i) => [100, 100, i * 100, 0],
};

describe('masonry > virtualized visibility & thumbnail reuse', () => {
  describe('initial 0x0 viewport -> resized viewport', () => {
    it('expands the render region when viewport transitions from 0x0 to non-zero height', () => {
      const initial = computeRenderRegion(0, 0, 0, 50, linearLayout);
      expect(initial.start).toBe(0);
      expect(initial.end).toBe(0);

      const resized = computeRenderRegion(0, 500, 0, 50, linearLayout);
      expect(resized.start).toBe(0);
      expect(resized.end).toBeGreaterThan(0);
    });
  });

  describe('observeViewportResize', () => {
    const originalResizeObserver = globalThis.ResizeObserver;

    afterEach(() => {
      globalThis.ResizeObserver = originalResizeObserver;
    });

    it('observes the viewport, invokes callback on resize, and disconnects on cleanup', () => {
      let observerCallback: ResizeObserverCallback | undefined;
      const observeMock = jest.fn();
      const disconnectMock = jest.fn();

      globalThis.ResizeObserver = jest.fn((cb: ResizeObserverCallback) => {
        observerCallback = cb;
        return {
          observe: observeMock,
          unobserve: jest.fn(),
          disconnect: disconnectMock,
        } as unknown as ResizeObserver;
      }) as unknown as typeof ResizeObserver;

      const fakeViewport = {} as Element;
      const onResize = jest.fn();

      const cleanup = observeViewportResize(fakeViewport, onResize);
      expect(observeMock).toHaveBeenCalledWith(fakeViewport);
      expect(onResize).not.toHaveBeenCalled();

      // Simulate ResizeObserver firing after initial mount layout or window resize
      observerCallback?.([], {} as ResizeObserver);
      expect(onResize).toHaveBeenCalledTimes(1);

      cleanup?.();
      expect(disconnectMock).toHaveBeenCalledTimes(1);
    });

    it('returns undefined when viewport is null or ResizeObserver is unavailable', () => {
      expect(observeViewportResize(null, jest.fn())).toBeUndefined();

      // Simulate environment without ResizeObserver
      (globalThis as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
        undefined;
      expect(observeViewportResize({} as Element, jest.fn())).toBeUndefined();
    });
  });

  describe('GalleryItem thumbnail reuse cache for reused ClientFile instances', () => {
    it('preserves resolved src and loaded state across remounts of the same ClientFile', () => {
      const reusedFile = { id: 'file-1' } as ClientFile;
      const thumbPath = 'C:/thumbs/file-1.jpg?v=1';
      const encodedSrc = 'http://asset.localhost/C%3A%2Fthumbs%2Ffile-1.jpg%3Fv%3D1';

      expect(getCachedThumbnailSrc(reusedFile, true, thumbPath, true, false)).toBeUndefined();
      expect(hasLoadedThumbnailSrc(reusedFile, encodedSrc)).toBe(false);

      setCachedThumbnailSrc(reusedFile, true, thumbPath, thumbPath);
      markThumbnailSrcLoaded(reusedFile, encodedSrc);

      // Reused ClientFile after folder switch A -> B -> A hits cache synchronously
      expect(getCachedThumbnailSrc(reusedFile, true, thumbPath, true, false)).toBe(thumbPath);
      expect(hasLoadedThumbnailSrc(reusedFile, encodedSrc)).toBe(true);
    });

    it('invalidates cached src when broken, unmounted, or thumbnail mode/path changes', () => {
      const file = { id: 'file-2' } as ClientFile;
      const thumbPath = 'C:/thumbs/file-2.jpg';

      setCachedThumbnailSrc(file, true, thumbPath, thumbPath);

      expect(getCachedThumbnailSrc(file, true, thumbPath, false, false)).toBeUndefined();
      expect(getCachedThumbnailSrc(file, true, thumbPath, true, true)).toBeUndefined();
      expect(getCachedThumbnailSrc(file, false, thumbPath, true, false)).toBeUndefined();
      expect(getCachedThumbnailSrc(file, true, `${thumbPath}?v=1`, true, false)).toBeUndefined();

      clearThumbnailCachesForFile(file);
      expect(getCachedThumbnailSrc(file, true, thumbPath, true, false)).toBeUndefined();
    });
  });
});
