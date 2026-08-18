import { OrderDirection } from '../src/api/data-storage-search';
import {
  FileDTO,
  IMAGE_EXTENSIONS,
  IMG_EXTENSIONS,
  isImageExtension,
  isVideoExtension,
  VIDEO_EXTENSIONS,
} from '../src/api/file';
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
    relativePath: `${id}.mp4`,
    absolutePath: `C:/loc/${id}.mp4`,
    tags: [],
    dateAdded: new Date(),
    dateModified: new Date(),
    dateLastIndexed: new Date(),
    name: `${id}.mp4`,
    extension: 'mp4',
    size: 1024 * 1024,
    width: 1920,
    height: 1080,
    dateCreated: new Date(),
    duration: 120,
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

describe('Video Extensions and Helpers', () => {
  it('correctly identifies video extensions', () => {
    expect(isVideoExtension('mp4')).toBe(true);
    expect(isVideoExtension('webm')).toBe(true);
    expect(isVideoExtension('mov')).toBe(true);
    expect(isVideoExtension('mkv')).toBe(true);
    expect(isVideoExtension('.mp4')).toBe(true);
    expect(isVideoExtension('MP4')).toBe(true);
    expect(isVideoExtension('png')).toBe(false);
    expect(isVideoExtension(undefined)).toBe(false);
  });

  it('correctly identifies image extensions', () => {
    expect(isImageExtension('png')).toBe(true);
    expect(isImageExtension('jpg')).toBe(true);
    expect(isImageExtension('webp')).toBe(true);
    expect(isImageExtension('mp4')).toBe(false);
    expect(isImageExtension(undefined)).toBe(false);
  });

  it('IMG_EXTENSIONS contains both image and video extensions', () => {
    VIDEO_EXTENSIONS.forEach((ext) => {
      expect((IMG_EXTENSIONS as readonly string[]).includes(ext)).toBe(true);
    });
    IMAGE_EXTENSIONS.forEach((ext) => {
      expect((IMG_EXTENSIONS as readonly string[]).includes(ext)).toBe(true);
    });
  });
});

describe('ClientFile video duration', () => {
  it('serializes duration properly', () => {
    const dto = makeFileDTO({ duration: 45.5 });
    const file = new ClientFile(makeStore(), dto);
    expect(file.duration).toBe(45.5);
    expect(file.serialize().duration).toBe(45.5);
  });

  it('preserves duration on mergeMovedFile', () => {
    const oldFile = makeFileDTO({ id: '1', duration: 60 });
    const newFile = makeFileDTO({
      id: '2',
      name: 'moved.mp4',
      relativePath: 'moved.mp4',
      absolutePath: 'C:/loc/moved.mp4',
      duration: undefined,
    });
    const merged = mergeMovedFile(oldFile, newFile);
    expect(merged.duration).toBe(60);
  });
});

describe('Database Video storage', () => {
  let TEST_DATABASE_ID_COUNTER = 0;

  it('persists and retrieves video files with duration', async () => {
    const db = dbInit(`Test_Video_${TEST_DATABASE_ID_COUNTER++}`);
    const backend = await Backend.init(db, () => {});

    await backend.createFilesFromPath('C:/loc', [
      makeFileDTO({ id: 'v1', name: 'clip1.mp4', duration: 90 }),
      makeFileDTO({ id: 'v2', name: 'clip2.webm', duration: 15 }),
    ]);

    const allFiles = await backend.fetchFiles('id', OrderDirection.Asc);
    expect(allFiles.length).toBe(2);
    expect(allFiles.find((f) => f.id === 'v1')?.duration).toBe(90);
    expect(allFiles.find((f) => f.id === 'v2')?.duration).toBe(15);
  });
});
