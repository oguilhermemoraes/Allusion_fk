import { OrderDirection } from '../src/api/data-storage-search';
import { FileDTO } from '../src/api/file';
import Backend from '../src/backend/backend';
import { dbInit } from '../src/backend/config';

describe('Search by description', () => {
  let TEST_DATABASE_ID_COUNTER = 0;

  function makeFileDTO(overrides: Partial<FileDTO> = {}): FileDTO {
    return {
      id: '1',
      ino: 'ino1',
      locationId: 'loc',
      relativePath: 'a.jpg',
      absolutePath: 'c:/loc/a.jpg',
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
      ...overrides,
    };
  }

  function test(name: string, fn: (backend: Backend) => Promise<void>): void {
    it(name, async () => {
      const db = dbInit(`Test_Desc_${TEST_DATABASE_ID_COUNTER++}`);
      const backend = await Backend.init(db, () => {});
      await fn(backend);
    });
  }

  test('finds a file whose description contains the term', async (backend) => {
    await backend.createFilesFromPath('c:/loc', [
      makeFileDTO({ id: '1', description: 'my nano banana prompt' }),
      makeFileDTO({ id: '2' }),
    ]);
    const result = await backend.searchFiles(
      { key: 'description', valueType: 'string', operator: 'contains', value: 'banana' },
      'name',
      OrderDirection.Asc,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  test('is robust when a file has no description (undefined)', async (backend) => {
    await backend.createFilesFromPath('c:/loc', [
      makeFileDTO({ id: '1', description: 'apple' }),
      makeFileDTO({ id: '2' }),
    ]);
    const result = await backend.searchFiles(
      { key: 'description', valueType: 'string', operator: 'contains', value: 'apple' },
      'name',
      OrderDirection.Asc,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  test('or: name or description', async (backend) => {
    await backend.createFilesFromPath('c:/loc', [
      makeFileDTO({ id: '1', description: 'banana' }),
      makeFileDTO({ id: '2', name: 'banana.jpg' }),
      makeFileDTO({ id: '3' }),
    ]);
    const result = await backend.searchFiles(
      [
        { key: 'description', valueType: 'string', operator: 'contains', value: 'banana' },
        { key: 'name', valueType: 'string', operator: 'contains', value: 'banana' },
      ],
      'name',
      OrderDirection.Asc,
      true, // matchAny = OR
    );
    expect(result).toHaveLength(2);
  });
});