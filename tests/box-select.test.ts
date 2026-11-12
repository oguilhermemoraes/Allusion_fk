import { configure, observable, runInAction } from 'mobx';
import {
  computeMarqueeBox,
  computeIntersectedFiles,
  applyBoxSelection,
  shouldStartMarquee,
  snapshotSelection,
} from '../src/frontend/containers/ContentView/useBoxSelect';
import { ClientFile } from '../src/frontend/entities/File';

describe('Box Selection logic', () => {
  describe('computeMarqueeBox', () => {
    test('calculates correct box dragging top-left to bottom-right', () => {
      const box = computeMarqueeBox(10, 20, 100, 150, 500, 500);
      expect(box).toEqual({
        left: 10,
        top: 20,
        width: 90,
        height: 130,
      });
    });

    test('calculates correct box dragging bottom-right to top-left', () => {
      const box = computeMarqueeBox(100, 150, 10, 20, 500, 500);
      expect(box).toEqual({
        left: 10,
        top: 20,
        width: 90,
        height: 130,
      });
    });

    test('clamps box dimensions within container bounds', () => {
      const box = computeMarqueeBox(-20, -10, 600, 700, 500, 400);
      expect(box).toEqual({
        left: 0,
        top: 0,
        width: 500,
        height: 400,
      });
    });
  });

  describe('computeIntersectedFiles', () => {
    let mockContainer: HTMLDivElement;
    const mockFiles: ClientFile[] = [
      { id: '1', absolutePath: '/virtual/a.png' } as any,
      { id: '2', absolutePath: '/virtual/b.png' } as any,
      { id: '3', absolutePath: '/virtual/c.png' } as any,
    ];

    beforeEach(() => {
      const el1 = {
        dataset: { fileId: '1' },
        getBoundingClientRect: () => ({
          left: 10,
          top: 10,
          right: 110,
          bottom: 110,
        }),
      };

      const el2 = {
        dataset: { fileId: '2' },
        getBoundingClientRect: () => ({
          left: 130,
          top: 10,
          right: 230,
          bottom: 110,
        }),
      };

      const el3 = {
        dataset: { fileId: '3' },
        getBoundingClientRect: () => ({
          left: 250,
          top: 10,
          right: 350,
          bottom: 110,
        }),
      };

      mockContainer = {
        querySelectorAll: () => [el1, el2, el3],
      } as any;
    });

    test('finds all items intersecting the box', () => {
      // Box covers items 1 and 2
      const result = computeIntersectedFiles(mockContainer, 0, 200, 0, 150, mockFiles);
      expect(result.map((f) => f.id)).toEqual(['1', '2']);
    });

    test('returns empty array when no items intersect', () => {
      const result = computeIntersectedFiles(mockContainer, 400, 500, 0, 150, mockFiles);
      expect(result).toEqual([]);
    });
  });

  describe('applyBoxSelection', () => {
    const fileA: ClientFile = { id: 'a' } as any;
    const fileB: ClientFile = { id: 'b' } as any;
    const fileC: ClientFile = { id: 'c' } as any;

    test('replaces selection when no modifiers are active', () => {
      const target = { replace: jest.fn() };
      applyBoxSelection(
        new Set([fileA]),
        [fileB, fileC],
        { ctrlOrMeta: false, shift: false },
        target,
      );
      expect(target.replace).toHaveBeenCalledWith([fileB, fileC]);
    });

    test('adds to selection when Shift is active', () => {
      const target = { replace: jest.fn() };
      applyBoxSelection(
        new Set([fileA]),
        [fileB, fileC],
        { ctrlOrMeta: false, shift: true },
        target,
      );
      expect(target.replace).toHaveBeenCalledWith([fileA, fileB, fileC]);
    });

    test('toggles selection when Ctrl/Cmd is active', () => {
      const target = { replace: jest.fn() };
      // fileA was selected, fileB was not. Intersecting = [fileA, fileB].
      // Result: fileA toggles off, fileB toggles on -> [fileB]
      applyBoxSelection(
        new Set([fileA]),
        [fileA, fileB],
        { ctrlOrMeta: true, shift: false },
        target,
      );
      expect(target.replace).toHaveBeenCalledWith([fileB]);
    });
  });

  describe('shouldStartMarquee', () => {
    function makeTarget(closestResult: string | null): HTMLElement {
      return { closest: () => closestResult } as unknown as HTMLElement;
    }

    test('starts on empty background with primary button', () => {
      expect(
        shouldStartMarquee(
          { isSlideMode: false, fileSelection: new Set() },
          { button: 0, target: makeTarget(null) },
        ),
      ).toBe(true);
    });

    test('does not start in slide mode', () => {
      expect(
        shouldStartMarquee(
          { isSlideMode: true, fileSelection: new Set() },
          { button: 0, target: makeTarget(null) },
        ),
      ).toBe(false);
    });

    test('does not start on non-primary button', () => {
      expect(
        shouldStartMarquee(
          { isSlideMode: false, fileSelection: new Set() },
          { button: 2, target: makeTarget(null) },
        ),
      ).toBe(false);
    });

    test('does not start on a cell or interactive control', () => {
      expect(
        shouldStartMarquee(
          { isSlideMode: false, fileSelection: new Set() },
          { button: 0, target: makeTarget('[data-masonrycell]') },
        ),
      ).toBe(false);
    });

    test('reads observable UI state without MobX outside-reaction warnings', () => {
      configure({ observableRequiresReaction: true });
      try {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
          const uiStore = observable({
            isSlideMode: false,
            fileSelection: observable(new Set<unknown>()),
          });
          const event = { button: 0, target: makeTarget(null) };
          shouldStartMarquee(
            runInAction(() => uiStore),
            event,
          );
          runInAction(() =>
            snapshotSelection(uiStore.fileSelection as unknown as Set<ClientFile>),
          );

          const mobxWarnings = warnSpy.mock.calls.filter((args) =>
            String(args[0]).includes('reactive context'),
          );
          expect(mobxWarnings).toHaveLength(0);
        } finally {
          warnSpy.mockRestore();
        }
      } finally {
        configure({ observableRequiresReaction: false });
      }
    });
  });
});
