import { OrderDirection } from '../src/api/data-storage-search';
import { FileDTO } from '../src/api/file';
import Backend from '../src/backend/backend';
import { dbInit } from '../src/backend/config';

// tsconfig usa allowSyntheticDefaultImports (não esModuleInterop)
jest.mock('path', () => {
  const actual = jest.requireActual('path');
  return { __esModule: true, default: actual };
});

function makeFileDTO(overrides: Partial<FileDTO> & { id: string }): FileDTO {
  const ext = (overrides.extension ?? 'jpg') as FileDTO['extension'];
  return {
    ino: `ino_${overrides.id}`,
    locationId: 'loc',
    relativePath: `${overrides.id}.${ext}`,
    absolutePath: `C:/loc/${overrides.id}.${ext}`,
    tags: [],
    dateAdded: new Date(),
    dateModified: new Date(),
    dateLastIndexed: new Date(),
    name: `${overrides.id}.${ext}`,
    extension: ext,
    size: 1,
    width: 1,
    height: 1,
    dateCreated: new Date(),
    rating: 0,
    ...overrides,
  };
}

describe('#39 purgeUnsupportedExtensions', () => {
  let TEST_DATABASE_ID_COUNTER = 0;

  function makeBackend(): Promise<Backend> {
    const db = dbInit(`Test_Cleanup_${TEST_DATABASE_ID_COUNTER++}`);
    return Backend.init(db, () => {});
  }

  it('removes records with unsupported extensions and keeps supported ones', async () => {
    const backend = await makeBackend();
    await backend.createFilesFromPath('C:/loc', [
      makeFileDTO({ id: 'ok1', extension: 'jpg' }),
      makeFileDTO({ id: 'ghost1', extension: 'crdownload' as FileDTO['extension'] }),
      makeFileDTO({ id: 'ok2', extension: 'mp4' }),
      makeFileDTO({ id: 'ghost2', extension: 'tmp' as FileDTO['extension'] }),
      makeFileDTO({ id: 'ok3', extension: 'exr' }),
    ]);

    const removed = await backend.purgeUnsupportedExtensions();
    expect(removed).toBe(2);

    const remaining = await backend.fetchFiles('id', OrderDirection.Asc);
    expect(remaining.map((f) => f.id).sort()).toEqual(['ok1', 'ok2', 'ok3']);
  });

  it('is a no-op when the library has only supported files', async () => {
    const backend = await makeBackend();
    await backend.createFilesFromPath('C:/loc', [
      makeFileDTO({ id: 'a', extension: 'png' }),
      makeFileDTO({ id: 'b', extension: 'webm' }),
    ]);

    const removed = await backend.purgeUnsupportedExtensions();
    expect(removed).toBe(0);

    const remaining = await backend.fetchFiles('id', OrderDirection.Asc);
    expect(remaining.length).toBe(2);
  });
});

