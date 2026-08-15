import { FileDTO } from '../src/api/file';
import { ClientFile, mergeMovedFile } from '../src/frontend/entities/File';

// tsconfig usa allowSyntheticDefaultImports (não esModuleInterop), então o
// "import Path from 'path'" do ClientFile viraria undefined no runtime do jest.
// Mockamos o módulo 'path' expondo o módulo real como default export.
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

describe('ClientFile description', () => {
  it('serializes description round-trip', () => {
    const dto = makeFileDTO({ description: 'my prompt' });
    const file = new ClientFile(makeStore(), dto);
    expect(file.description).toBe('my prompt');
    expect(file.serialize().description).toBe('my prompt');
  });
});

describe('ClientFile description auto-save', () => {
  it('persists when description changes via the save path', async () => {
    const saved: FileDTO[] = [];
    const store = {
      ...makeStore(),
      save: (dto: FileDTO) => saved.push(dto),
      getLocation: () => ({ path: 'C:/loc' }),
      getTags: () => [],
    };
    const file = new ClientFile(store as any, makeFileDTO());
    file.setDescription('nano banana');
    await new Promise((r) => setTimeout(r, 700));
    expect(saved.some((s) => s.description === 'nano banana')).toBe(true);
  });
});

describe('mergeMovedFile', () => {
  it('preserves description', () => {
    const oldFile = makeFileDTO({ description: 'prompt A' });
    const newFile = makeFileDTO({
      name: 'b.jpg',
      relativePath: 'b.jpg',
      absolutePath: 'C:/loc/b.jpg',
    });
    const merged = mergeMovedFile(oldFile, newFile);
    expect(merged.description).toBe('prompt A');
  });
});