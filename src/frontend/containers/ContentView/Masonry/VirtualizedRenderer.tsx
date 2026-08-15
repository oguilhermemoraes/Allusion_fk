import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { thumbnailMaxSize } from 'common/config';
import { useStore } from '../../../contexts/StoreContext';
import { ClientFile } from '../../../entities/File';
import useMountState from '../../../hooks/useMountState';
import { MasonryCell } from '../GalleryItem';
import { Layouter, computeRenderRegion, findViewportEdge } from './layout-helpers';

interface IRendererProps {
  containerHeight: number;
  containerWidth: number;
  images: ClientFile[];
  layout: Layouter;
  className?: string;
  /** Render images outside of the viewport within this margin (pixels) */
  overscan?: number;
  layoutUpdateDate: Date;
  padding?: number;
  /** The index of the currently selected image, or the "last selected" image when a range is selected */
  lastSelectionIndex: React.MutableRefObject<number | undefined>;
}

/**
 * This is the virtualized renderer: it only renders the items in the viewport.
 * It renders a scrollable viewport and a content element within it.
 */
const VirtualizedRenderer = observer(
  ({
    containerHeight,
    containerWidth,
    images,
    layout,
    className,
    overscan = 0,
    lastSelectionIndex,
    layoutUpdateDate,
    padding,
  }: IRendererProps) => {
    const { uiStore, fileStore } = useStore();
    const [, isMountedRef] = useMountState();
    const wrapperRef = useRef<HTMLDivElement>(null);
    const scrollAnchor = useRef<HTMLDivElement>(null);
    const [startRenderIndex, setStartRenderIndex] = useState(0);
    const [endRenderIndex, setEndRenderIndex] = useState(0);
    const numImages = images.length;
    const { isSlideMode, firstItem } = uiStore;

    const determineRenderRegion = useCallback(
      (numImages: number, overdraw: number, setFirstItem = true) => {
        if (!isMountedRef.current) {
          return;
        }
        const viewport = wrapperRef.current;
        const yOffset = viewport?.scrollTop || 0;
        const viewportHeight = viewport?.clientHeight || 0;

        const firstImageIndex = findViewportEdge(yOffset, numImages, layout);
        const { start, end } = computeRenderRegion(
          yOffset,
          viewportHeight,
          overdraw,
          numImages,
          layout,
        );

        // React bails out of the re-render when the value is unchanged, so calling
        // this from a rAF only renders again when the window actually moves.
        setStartRenderIndex(start);
        setEndRenderIndex(end);

        // store the first item in the viewport in the UIStore so that switching between view modes retains the scroll position
        if (setFirstItem) {
          uiStore.setFirstItem(firstImageIndex);
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    // Schedule the recomputation on the next animation frame instead of with a
    // time throttle: the render window then tracks the scroll position within a
    // single frame, so fast scrolls stay on already-mounted cells (#76).
    const rafIdRef = useRef(0);
    const scheduleRenderRegion = useCallback(() => {
      if (rafIdRef.current !== 0) {
        return;
      }
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = 0;
        determineRenderRegion(numImages, overscan, !isSlideMode);
      });
    }, [determineRenderRegion, numImages, overscan, isSlideMode]);

    // Cancel a pending frame on unmount
    useEffect(
      () => () => {
        if (rafIdRef.current !== 0) {
          cancelAnimationFrame(rafIdRef.current);
        }
      },
      [],
    );

    // Redetermine images in viewport when amount of images or the container dimensions change
    useLayoutEffect(() => {
      // setFirstItem = false: don't set the firstItem in view, so we can recover scroll position after layout updates,
      // in the useLayoutEffect with layoutUpdateDate dependency
      determineRenderRegion(numImages, overscan, false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [numImages, containerWidth, containerHeight]);

    const handleScroll = useCallback(() => scheduleRenderRegion(), [scheduleRenderRegion]);

    const scrollToIndex = useCallback(
      (index: number, block: 'nearest' | 'start' | 'end' | 'center' = 'nearest') => {
        if (!scrollAnchor.current) {
          return;
        }
        const [sWidth, sHeight, sTop, sLeft] = layout.getTransform(index);

        // Scroll to invisible element, positioned at selected item,
        // just for scroll automatisation with scrollIntoView
        scrollAnchor.current.style.transform = `translate(${sLeft}px,${
          // Correct for padding of masonry element, otherwise it doesn't completely scroll to the top.
          sTop === 0 && padding ? sTop - padding : sTop
        }px)`;
        scrollAnchor.current.style.width = sWidth + 'px';
        scrollAnchor.current.style.height = sHeight + 'px';
        // TODO: adding behavior: 'smooth' would be nice, but it's disorienting when layout changes a lot. Add threshold for when the delta firstItemIndex than X?
        // Also, it doesn't work when scrolling by keeping arrow key held down
        scrollAnchor.current.scrollIntoView({ block, inline: 'nearest' });
        scrollAnchor.current.style.transform = ''; // reset so that the scroll position can't become stuck at bottom when amount of shown images decreases
      },
      [layout, padding],
    );

    // The index currently selected image, or the "last selected" image when a range is selected,
    const lastSelIndex = lastSelectionIndex.current
      ? Math.min(lastSelectionIndex.current, numImages - 1)
      : undefined;

    // When layout updates, scroll to firstImage (e.g. resize or thumbnail size changed)
    // This also sets the initial scroll position on initial render, for when coming from another view mode
    useLayoutEffect(() => {
      runInAction(() => {
        scrollToIndex(uiStore.firstItem, 'start'); // keep the first item in view aligned at the start
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layoutUpdateDate]);

    // When selection changes, scroll to last selected image. Nice when using cursor keys for navigation
    const fileSelectionSize = uiStore.fileSelection.size;
    useLayoutEffect(() => {
      // But don't scroll when there are no files selected:
      // else you will scroll when the user deselects everything
      if (lastSelIndex !== undefined && fileSelectionSize > 0) {
        scrollToIndex(lastSelIndex);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastSelIndex, fileSelectionSize]);

    // While in slide mode, scroll to last shown image if not in view, for transition back to gallery
    useLayoutEffect(() => {
      if (isSlideMode) {
        scrollToIndex(firstItem, 'nearest');
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isSlideMode, firstItem]);

    return (
      // One div as the scrollable viewport
      <div className={className} onScroll={handleScroll} ref={wrapperRef}>
        {/* One div for the content */}
        <div style={{ width: containerWidth, height: containerHeight }}>
          {images.slice(startRenderIndex, endRenderIndex + 1).map((im, index) => {
            const fileListIndex = startRenderIndex + index;
            const transform = layout.getTransform(fileListIndex);
            return (
              <MasonryCell
                key={im.id}
                file={fileStore.fileList[fileListIndex]}
                mounted
                transform={transform}
                // Force to load the full resolution image when the img dimensions on screen are larger than the thumbnail image resolution
                // Otherwise you'll see very low res images. This is usually only the case for images with extreme aspect ratios
                // TODO: Not the best solution; could generate multiple thumbnails of other resolutions
                forceNoThumbnail={
                  transform[0] > thumbnailMaxSize ||
                  transform[1] > thumbnailMaxSize ||
                  // Not using thumbnails for gifs, since they're mostly used for animations, which doesn't get preserved in thumbnails
                  im.extension === 'gif'
                }
              />
            );
          })}
          <div ref={scrollAnchor} id="invis-last-selected-item-for-scroll" />
        </div>
      </div>
    );
  },
);

export default VirtualizedRenderer;
