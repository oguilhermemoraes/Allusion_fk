import { observable } from 'mobx';

import { FileDTO } from '../src/api/file';
import { ClientFile, mergeMovedFile, toPlainPalette } from '../src/frontend/entities/File';

jest.mock('path', () => {
  const actual = jest.requireActual('path');
  return { __esModule: true, default: actual };
});

function makeFileDTO(overrides: Partial<FileDTO> = {}): FileDTO {
  return {
    id: '1',
    ino: 'ino1',
    locationId: 'loc',
    relativePath: 'a.jpg',
    absolutePath: 'C:/loc/a.jpg',
    tags: [],
    dateAdded: new Date(),
    dateModified: new Date(),
    dateLastIndexed: new Date(),
    name: 'a.jpg',
    extension: 'jpg',
    size: 1,
    width: 1,
    height: 1,
    dateCreated: new Date(),
    palette: [
      { r: 10, g: 20, b: 30, percentage: 0.5 },
      { r: 200, g: 100, b: 50, percentage: 0.25 },
    ],
    ...overrides,
  };
}

function makeStore(): any {
  return {
    getLocation: () => ({ path: 'C:/loc' }),
    getTags: () => [],
    save: () => {},
  };
}

describe('Palette DTO clone-safe (regressão DataCloneError do move #36)', () => {
  it('structuredClone aceita o serialize() de um arquivo com palette observável', () => {
    const file = new ClientFile(makeStore(), makeFileDTO());
    const ser = file.serialize();

    expect(() => structuredClone(ser)).not.toThrow();
    expect(ser.palette).toEqual([
      { r: 10, g: 20, b: 30, percentage: 0.5 },
      { r: 200, g: 100, b: 50, percentage: 0.25 },
    ]);
  });

  it('toPlainPalette remove proxies do MobX', () => {
    const proxied = observable([
      { r: 1, g: 2, b: 3, percentage: 1 },
      { r: 4, g: 5, b: 6, percentage: 0.5 },
    ]);
    const plain = toPlainPalette(proxied);
    expect(() => structuredClone(plain)).not.toThrow();
    expect(plain).toEqual([
      { r: 1, g: 2, b: 3, percentage: 1 },
      { r: 4, g: 5, b: 6, percentage: 0.5 },
    ]);
  });

  it('mergeMovedFile produz um DTO clone-safe (usado pelo handleMove)', () => {
    const oldFile = makeFileDTO();
    const newFile = makeFileDTO({
      name: 'b.jpg',
      relativePath: 'b.jpg',
      absolutePath: 'C:/loc/b.jpg',
    });
    const merged = mergeMovedFile(oldFile, newFile);
    expect(() => structuredClone(merged)).not.toThrow();
    expect(merged.palette).toEqual(oldFile.palette);
  });
});
