import {
  findDroppedFileMatches,
  getDropEffect,
  isAcceptableType,
  parseFilePathsPayload,
} from '../src/frontend/containers/Outliner/LocationsPanel/dnd';
import { DnDFileType } from '../src/frontend/contexts/TagDnDContext';
import { ClientFile } from '../src/frontend/entities/File';

// ts-jest emits `require('react').default` (no esModuleInterop in tsconfig),
// so default-imports of React are undefined here. Provide the module object as
// `.default` so context modules (DropContext, TagDnDContext) can load and run
// their top-level `React.createContext(...)`.
jest.mock('react', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return { ...React, default: React };
});

describe('DnDFileType payload parsing', () => {
  test('parses a JSON array of paths', () => {
    expect(parseFilePathsPayload(JSON.stringify(['C:/a.jpg', 'C:/b.png']))).toEqual([
      'C:/a.jpg',
      'C:/b.png',
    ]);
  });

  test('returns [] for an invalid payload', () => {
    expect(parseFilePathsPayload('not-json')).toEqual([]);
    expect(parseFilePathsPayload('')).toEqual([]);
  });
});

describe('isAcceptableType with DnDFileType', () => {
  test('accepts the internal file MIME type', () => {
    const e = { dataTransfer: { types: [DnDFileType] } } as unknown as React.DragEvent;
    expect(isAcceptableType(e)).toBe(true);
  });
});

describe('getDropEffect', () => {
  test('uses move for internal Allusion drags so drop is not cancelled', () => {
    const e = {
      dataTransfer: { types: [DnDFileType, 'chromium/x-drag-id'] },
    } as unknown as React.DragEvent;
    expect(getDropEffect(e)).toBe('move');
  });

  test('uses copy for external OS drops', () => {
    const e = { dataTransfer: { types: ['Files'] } } as unknown as React.DragEvent;
    expect(getDropEffect(e)).toBe('copy');
  });
});

describe('findDroppedFileMatches', () => {
  const makeFile = (id: string, absolutePath: string) =>
    ({ id, absolutePath } as unknown as ClientFile);

  test('returns matching files for string paths', () => {
    const fs = { fileList: [makeFile('1', 'C:/loc/a.jpg'), makeFile('2', 'C:/loc/b.png')] } as any;
    const matches = findDroppedFileMatches(['C:/loc/a.jpg', 'C:/loc/b.png'], fs);
    expect(matches).toBeTruthy();
    expect((matches as ClientFile[]).map((m) => m.id)).toEqual(['1', '2']);
  });

  test('returns false when one path has no match (fallback to import)', () => {
    const fs = { fileList: [makeFile('1', 'C:/loc/a.jpg')] } as any;
    expect(findDroppedFileMatches(['C:/loc/a.jpg', 'C:/external/new.png'], fs)).toBe(false);
  });
});
