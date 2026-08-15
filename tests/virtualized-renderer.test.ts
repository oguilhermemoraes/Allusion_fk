import {
  computeRenderRegion,
  findViewportEdge,
  Layouter,
} from '../src/frontend/containers/ContentView/Masonry/layout-helpers';

// Simple linear layout: One image per row
const linearLayout: Layouter = {
  // first image [0, 10], second [10, 20], third: [20, 30], ...
  getTransform: (i) => [10, 10, i * 10, 0],
};

// Multiple images per row, with different heights
const dynamicLayout: Layouter = {
  // first image [0, 10], second [10, 20], third: [20, 30], ...
  getTransform: (i) => [10, 10, Math.floor(i / 4) * 10 + i, (i % 4) * 10],
};

describe('masonry > renderer', () => {
  describe('binarySearch', () => {
    describe('linear layout', () => {
      it('should return 0 when viewport is at the top', () => {
        const index = findViewportEdge(0, 10, linearLayout);
        expect(index).toBe(0);
      });
      it('should correctly find the second image at height 15', () => {
        const index = findViewportEdge(15, 10, linearLayout);
        expect(index).toBe(1);
      });
      it('should correctly find the last image at max height', () => {
        const index = findViewportEdge(999, 10, linearLayout);
        expect(index).toBe(9);
      });
    });
    describe('dynamic layout', () => {
      it('should return 0 when viewport is at the top', () => {
        const index = findViewportEdge(0, 10, dynamicLayout);
        expect(index).toBe(0);
      });
      // TODO: More tests, after implementing over/under-shooting
    });
  });

  describe('computeRenderRegion', () => {
    it('renders the first rows when scrolled to the top', () => {
      // 10px rows, 100px viewport -> window = [-buffer, 100+buffer],
      // buffer = max(overdraw, viewportHeight) = 100.
      const { start, end } = computeRenderRegion(0, 100, 0, 10, linearLayout);
      expect(start).toBe(0);
      expect(end).toBe(9); // everything fits
    });

    it('keeps at least one full viewport of buffer beyond each edge', () => {
      const viewportHeight = 50;
      const scrollTop = 500;
      const { start, end } = computeRenderRegion(scrollTop, viewportHeight, 0, 10000, linearLayout);
      // start backs off one viewport, not beyond the first image.
      // (binary search can land one row off the exact boundary)
      expect(start * 10).toBeLessThanOrEqual(scrollTop - viewportHeight + 10);
      expect(start).toBeLessThanOrEqual(Math.ceil(scrollTop / 10));
      // end reaches one viewport past the bottom:
      expect(end * 10).toBeGreaterThanOrEqual(scrollTop + viewportHeight * 2 - 10);
    });

    it('uses the caller overdraw when it exceeds the viewport height', () => {
      const { start, end } = computeRenderRegion(1000, 50, 400, 1000, linearLayout);
      expect(start * 10).toBeLessThanOrEqual(1000 - 400 + 10);
      expect(end * 10).toBeGreaterThanOrEqual(1000 + 50 + 400 - 10);
    });

    it('never renders more than the hard limit of images', () => {
      const { start, end } = computeRenderRegion(50000, 6000, 0, 20000, linearLayout);
      // 10px rows: the (unbounded) end would be ~6200, so the 512 cap applies.
      expect(end - start).toBe(512);
      expect(end).toBe(start + 512);
    });

    it('clamps the start at the top of the list', () => {
      const { start, end } = computeRenderRegion(10, 100, 0, 50, linearLayout);
      expect(start).toBe(0);
      expect(end).toBeGreaterThan(0);
    });
  });
});
