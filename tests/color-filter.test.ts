import { FIXED_COLORS, getNearestColorId, paletteContainsColor } from '../common/color';
import { OrderDirection } from '../src/api/data-storage-search';
import { FileDTO } from '../src/api/file';
import Backend from '../src/backend/backend';
import { dbInit } from '../src/backend/config';

describe('Color filter', () => {
  describe('getNearestColorId', () => {
    it('should have exactly 12 fixed colors with unique ids', () => {
      expect(FIXED_COLORS).toHaveLength(12);
      const ids = new Set(FIXED_COLORS.map((c) => c.id));
      expect(ids.size).toBe(12);
    });

    it('should match each fixed color reference to itself', () => {
      for (const color of FIXED_COLORS) {
        expect(getNearestColorId(...color.rgb)).toBe(color.id);
      }
    });

    it('should map a clearly blue RGB to the blue id', () => {
      expect(getNearestColorId(10, 20, 250)).toBe('blue');
    });

    it('should map a clearly red RGB to the red id', () => {
      expect(getNearestColorId(250, 20, 20)).toBe('red');
    });
  });

  describe('paletteContainsColor', () => {
    it('should return false for undefined or empty palette', () => {
      expect(paletteContainsColor(undefined, 'blue')).toBe(false);
      expect(paletteContainsColor([], 'blue')).toBe(false);
    });

    it('should return true when the color appears in any palette position', () => {
      const palette = [
        { r: 200, g: 200, b: 200, percentage: 0.6 },
        { r: 13, g: 80, b: 220, percentage: 0.2 },
        { r: 255, g: 255, b: 255, percentage: 0.2 },
      ];
      expect(paletteContainsColor(palette, 'blue')).toBe(true);
    });

    it('should return false when the color is not in the palette', () => {
      const palette = [{ r: 200, g: 200, b: 200, percentage: 1.0 }];
      expect(paletteContainsColor(palette, 'red')).toBe(false);
    });
  });
});

describe('Backend palette search', () => {
  let TEST_DATABASE_ID_COUNTER = 0;

  function test(name: string, test: (backend: Backend) => Promise<void>) {
    it(name, async () => {
      const db = dbInit(`Test_Palette_${TEST_DATABASE_ID_COUNTER++}`);
      const backend = await Backend.init(db, () => {});
      await test(backend);
    });
  }

  function createMockFile(id: string, palette: FileDTO['palette']): FileDTO {
    return {
      absolutePath: `c:/test/${id}.jpg`,
      relativePath: `${id}.jpg`,
      locationId: 'Default location',
      name: `${id}.jpg`,
      size: 42,
      width: 640,
      height: 480,
      dateAdded: new Date(),
      dateModified: new Date(),
      dateCreated: new Date(),
      dateLastIndexed: new Date(),
      extension: 'jpg',
      ino: id,
      id,
      tags: [],
      palette,
    };
  }

  test('should search files by palette color in any position', async (backend) => {
    const blueFile = createMockFile('0', [{ r: 10, g: 30, b: 240, percentage: 0.5 }]);
    const redFile = createMockFile('1', [{ r: 240, g: 20, b: 20, percentage: 0.5 }]);
    await backend.createFilesFromPath('c:/test', [blueFile, redFile]);

    const result = await backend.searchFiles(
      {
        key: 'palette',
        operator: 'contains',
        value: 'blue',
        valueType: 'color',
      },
      'id',
      OrderDirection.Asc,
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('0');
  });

  test('should support notContains palette search', async (backend) => {
    const blueFile = createMockFile('0', [{ r: 10, g: 30, b: 240, percentage: 0.5 }]);
    const redFile = createMockFile('1', [{ r: 240, g: 20, b: 20, percentage: 0.5 }]);
    await backend.createFilesFromPath('c:/test', [blueFile, redFile]);

    const result = await backend.searchFiles(
      {
        key: 'palette',
        operator: 'notContains',
        value: 'blue',
        valueType: 'color',
      },
      'id',
      OrderDirection.Asc,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  test('should not match files without a palette', async (backend) => {
    const noPaletteFile = createMockFile('0', undefined);
    await backend.createFilesFromPath('c:/test', [noPaletteFile]);

    const result = await backend.searchFiles(
      {
        key: 'palette',
        operator: 'contains',
        value: 'blue',
        valueType: 'color',
      },
      'id',
      OrderDirection.Asc,
    );
    expect(result).toHaveLength(0);
  });
});
