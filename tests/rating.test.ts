import { OrderDirection } from '../src/api/data-storage-search';
import { FileDTO } from '../src/api/file';
import Backend from '../src/backend/backend';
import { dbInit } from '../src/backend/config';
import { ClientFile, mergeMovedFile } from '../src/frontend/entities/File';

// tsconfig usa allowSyntheticDefaultImports (não esModuleInterop)
jest.mock('path', () => {
  const actual = jest.requireActual('path');
  return { __esModule: true, default: actual };
});

function makeFileDTO(overrides: Partial<FileDTO> = {}): FileDTO {
  const id = overrides.id ?? '1';
  return {
    id,
    ino: `ino_${id}`,
    locationId: 'loc',
    relativePath: `${id}.jpg`,
    absolutePath: `C:/loc/${id}.jpg`,
    tags: [],
    dateAdded: new Date(),
    dateModified: new Date(),
    dateLastIndexed: new Date(),
    name: `${id}.jpg`,
    extension: 'jpg',
    size: 1,
    width: 1,
    height: 1,
    dateCreated: new Date(),
    rating: 0,
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

describe('ClientFile rating', () => {
  it('serializes rating round-trip', () => {
    const dto = makeFileDTO({ rating: 4 });
    const file = new ClientFile(makeStore(), dto);
    expect(file.rating).toBe(4);
    expect(file.serialize().rating).toBe(4);
  });

  it('defaults missing rating to 0 (unrated)', () => {
    const dto = makeFileDTO({ rating: undefined });
    const file = new ClientFile(makeStore(), dto);
    expect(file.rating).toBe(0);
    expect(file.serialize().rating).toBe(0);
  });

  it('persists when rating changes via setRating', async () => {
    const saved: FileDTO[] = [];
    const store = {
      ...makeStore(),
      save: (dto: FileDTO) => saved.push(dto),
    };
    const file = new ClientFile(store as any, makeFileDTO());
    file.setRating(5);
    expect(file.rating).toBe(5);
    await new Promise((r) => setTimeout(r, 700));
    expect(saved.some((s) => s.rating === 5)).toBe(true);
  });

  it('mergeMovedFile preserves rating', () => {
    const oldFile = makeFileDTO({ rating: 5 });
    const newFile = makeFileDTO({
      id: '2',
      name: 'b.jpg',
      relativePath: 'b.jpg',
      absolutePath: 'C:/loc/b.jpg',
    });
    const merged = mergeMovedFile(oldFile, newFile);
    expect(merged.rating).toBe(5);
  });
});

describe('Database Search by rating', () => {
  let TEST_DATABASE_ID_COUNTER = 0;

  function test(name: string, fn: (backend: Backend) => Promise<void>): void {
    it(name, async () => {
      const db = dbInit(`Test_Rating_${TEST_DATABASE_ID_COUNTER++}`);
      const backend = await Backend.init(db, () => {});
      await fn(backend);
    });
  }

  test('filters files with rating >= 3', async (backend) => {
    await backend.createFilesFromPath('C:/loc', [
      makeFileDTO({ id: '1', rating: 5 }),
      makeFileDTO({ id: '2', rating: 3 }),
      makeFileDTO({ id: '3', rating: 2 }),
      makeFileDTO({ id: '4', rating: 0 }),
    ]);

    const result = await backend.searchFiles(
      { key: 'rating', valueType: 'number', operator: 'greaterThanOrEquals', value: 3 },
      'id',
      OrderDirection.Asc,
    );
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.id)).toEqual(['1', '2']);
  });

  test('filters unrated files (rating == 0)', async (backend) => {
    await backend.createFilesFromPath('C:/loc', [
      makeFileDTO({ id: '1', rating: 5 }),
      makeFileDTO({ id: '2', rating: 0 }),
      makeFileDTO({ id: '3', rating: undefined }),
    ]);

    const result = await backend.searchFiles(
      { key: 'rating', valueType: 'number', operator: 'equals', value: 0 },
      'id',
      OrderDirection.Asc,
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((f) => f.id === '2')).toBe(true);
  });
});
