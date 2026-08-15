import { action } from 'mobx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../contexts/StoreContext';
import { ClientFile } from '../../entities/File';

export interface MarqueeBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function computeMarqueeBox(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  maxWidth: number,
  maxHeight: number,
): MarqueeBox {
  const minX = Math.max(0, Math.min(startX, currentX));
  const maxX = Math.min(maxWidth, Math.max(startX, currentX));
  const minY = Math.max(0, Math.min(startY, currentY));
  const maxY = Math.min(maxHeight, Math.max(startY, currentY));
  return {
    left: minX,
    top: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function computeIntersectedFiles(
  container: HTMLElement,
  minClientX: number,
  maxClientX: number,
  minClientY: number,
  maxClientY: number,
  fileList: ClientFile[],
): ClientFile[] {
  const items = container.querySelectorAll<HTMLElement>('[data-file-id]');
  const intersected: ClientFile[] = [];
  items.forEach((item) => {
    const fileId = item.dataset.fileId;
    if (!fileId) {
      return;
    }
    const rect = item.getBoundingClientRect();
    const intersects = !(
      rect.right < minClientX ||
      rect.left > maxClientX ||
      rect.bottom < minClientY ||
      rect.top > maxClientY
    );
    if (intersects) {
      const file = fileList.find((f) => f.id === fileId);
      if (file) {
        intersected.push(file);
      }
    }
  });
  return intersected;
}

export function applyBoxSelection(
  initialSelection: Set<ClientFile>,
  intersectedFiles: ClientFile[],
  modifiers: { ctrlOrMeta: boolean; shift: boolean },
  targetSelection: { replace: (files: ClientFile[]) => void },
): void {
  if (modifiers.ctrlOrMeta) {
    const next = new Set(initialSelection);
    for (const file of intersectedFiles) {
      if (initialSelection.has(file)) {
        next.delete(file);
      } else {
        next.add(file);
      }
    }
    targetSelection.replace(Array.from(next));
  } else if (modifiers.shift) {
    const next = new Set(initialSelection);
    for (const file of intersectedFiles) {
      next.add(file);
    }
    targetSelection.replace(Array.from(next));
  } else {
    targetSelection.replace(intersectedFiles);
  }
}

export function useBoxSelect(containerRef: React.RefObject<HTMLDivElement>) {
  const { uiStore, fileStore } = useStore();
  const [marquee, setMarquee] = useState<MarqueeBox | null>(null);
  const isDraggingRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(
    null,
  );
  const initialSelectionRef = useRef<Set<ClientFile>>(new Set());

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (uiStore.isSlideMode || e.button !== 0) {
        return;
      }

      // If clicked on an actual item/cell or interactive control, do not start marquee
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          '[data-masonrycell], [role="row"], button, input, textarea, a, .popover, .menu, .dialog',
        )
      ) {
        return;
      }

      const container = containerRef.current;
      if (!container) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const relativeX = e.clientX - containerRect.left;
      const relativeY = e.clientY - containerRect.top;

      startPosRef.current = {
        x: relativeX,
        y: relativeY,
        clientX: e.clientX,
        clientY: e.clientY,
      };
      initialSelectionRef.current = new Set(uiStore.fileSelection);
      isDraggingRef.current = false;
    },
    [uiStore, containerRef],
  );

  useEffect(() => {
    const handleMouseMove = action((e: MouseEvent) => {
      if (!startPosRef.current || !containerRef.current) {
        return;
      }

      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      const currentRelX = e.clientX - containerRect.left;
      const currentRelY = e.clientY - containerRect.top;

      const deltaX = e.clientX - startPosRef.current.clientX;
      const deltaY = e.clientY - startPosRef.current.clientY;

      if (!isDraggingRef.current) {
        if (Math.hypot(deltaX, deltaY) >= 4) {
          isDraggingRef.current = true;
        } else {
          return;
        }
      }

      const box = computeMarqueeBox(
        startPosRef.current.x,
        startPosRef.current.y,
        currentRelX,
        currentRelY,
        containerRect.width,
        containerRect.height,
      );
      setMarquee(box);

      // Auto-scroll near edges
      const scrollable = container.querySelector<HTMLElement>('.masonry') || container;
      if (scrollable) {
        if (e.clientY < containerRect.top + 30) {
          scrollable.scrollTop -= 10;
        } else if (e.clientY > containerRect.bottom - 30) {
          scrollable.scrollTop += 10;
        }
      }

      // Calculate intersection with mounted cells in viewport
      const minClientX = Math.min(startPosRef.current.clientX, e.clientX);
      const maxClientX = Math.max(startPosRef.current.clientX, e.clientX);
      const minClientY = Math.min(startPosRef.current.clientY, e.clientY);
      const maxClientY = Math.max(startPosRef.current.clientY, e.clientY);

      const intersectedFiles = computeIntersectedFiles(
        container,
        minClientX,
        maxClientX,
        minClientY,
        maxClientY,
        fileStore.fileList,
      );

      applyBoxSelection(
        initialSelectionRef.current,
        intersectedFiles,
        { ctrlOrMeta: e.ctrlKey || e.metaKey, shift: e.shiftKey },
        uiStore.fileSelection,
      );
    });

    const handleMouseUp = action(() => {
      if (isDraggingRef.current) {
        setMarquee(null);
        startPosRef.current = null;
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 50);
      } else if (startPosRef.current) {
        setMarquee(null);
        startPosRef.current = null;
        isDraggingRef.current = false;
      }
    });

    const handleKeyDown = action((e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDraggingRef.current) {
        uiStore.fileSelection.replace(Array.from(initialSelectionRef.current));
        setMarquee(null);
        startPosRef.current = null;
        isDraggingRef.current = false;
      }
    });

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [uiStore, fileStore, containerRef]);

  return {
    marquee,
    handleMouseDown,
    isBoxSelecting: isDraggingRef,
  };
}
