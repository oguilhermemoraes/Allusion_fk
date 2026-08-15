export type ITransform = Readonly<[width: number, height: number, top: number, left: number]>;

export interface Layouter {
  getTransform: (index: number) => ITransform;
}

/**
 * Performs a binary search that finds the index of the first (or last) image at a specified height.
 * Assumes images are ordered linearly in top-offset. This is not always the case (vertical masonry),
 * but should be close enough, in combination with rendering a little more than what's in the viewport.
 * @param height The query height
 * @param length The amount of images
 * @param layout The layout of the images
 * @param overshoot Whether to overshoot: return the first or last image at the specified height
 */
export function findViewportEdge(height: number, length: number, layout: Layouter): number {
  if (height <= 0) {
    return 0;
  } // easy base case

  // TODO: Could exploit the assumption that the images are ordered linearly in top-offset,
  // by making the initial guess at height/maxHeight
  // Alternatively, instead of searching at runtime, preprocess top-offsets of images
  // in an O(1) look-up table when the layout is (re)computed

  let iteration = 1;
  let nextLookup = Math.round(length / 2);
  while (true) {
    iteration++;
    let stepSize = length / Math.pow(2, iteration);
    if (stepSize < 1) {
      return nextLookup;
    }
    stepSize = Math.round(stepSize);
    const [, tHeight, tTop] = layout.getTransform(nextLookup);
    if (tTop > height) {
      if (tTop + tHeight > height) {
        // looked up too far, go back:
        nextLookup -= stepSize;
      } else {
        // TODO: this image is intersecting with the target heigth: check whether to over/undershoot
        return nextLookup;
      }
    } else {
      if (tTop + tHeight > height) {
        // TODO: this image is intersecting with the target heigth: check whether to over/undershoot
        return nextLookup;
      } else {
        nextLookup += stepSize;
      }
    }
  }
}

/** Masonry layout modes, shared by the WASM and native adapters. */
export type MasonryLayoutType = 'Vertical' | 'Horizontal' | 'Grid';

export interface MasonryOptions {
  type: MasonryLayoutType;
  thumbSize: number;
  padding: number;
}

/** Hard limit on how many images the renderer will mount at once (safety). */
export const MAX_RENDERED_IMAGES = 512;

/**
 * Computes the slice of images the renderer should mount for a scroll position.
 *
 * The rendered window always extends at least one full viewport beyond each
 * edge (in addition to any caller-provided `overdraw`). That buffer is the
 * grid's "memory" of what's on screen: fast scrolls that exceed a time-throttled
 * recomputation still land on already-mounted cells, instead of blank
 * placeholders / re-decoded thumbnails.
 * @param scrollTop Current scroll offset of the viewport
 * @param viewportHeight Height of the visible viewport
 * @param overdraw Extra margin provided by the caller (e.g. thumbnail-driven)
 * @param numImages Total amount of images in the layout
 * @param layout The layout to query
 */
export function computeRenderRegion(
  scrollTop: number,
  viewportHeight: number,
  overdraw: number,
  numImages: number,
  layout: Layouter,
): { start: number; end: number } {
  const buffer = Math.max(overdraw, viewportHeight);
  const start = findViewportEdge(scrollTop - buffer, numImages, layout);
  const end = findViewportEdge(scrollTop + viewportHeight + buffer, numImages, layout);
  return { start, end: Math.min(end, start + MAX_RENDERED_IMAGES) };
}
