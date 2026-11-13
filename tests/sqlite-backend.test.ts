import { OrderDirection } from '../src/api/data-storage-search';
import { FileDTO } from '../src/api/file';
import { LocationDTO } from '../src/api/location';
import { TagDTO } from '../src/api/tag';
import SqliteBackend from '../src/backend/sqlite-backend';

const mockInvoke = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  Channel: class MockChannel<T> {
    onmessage: (message: T) => void = () => {};
  },
}));

function makeFile(id: string, date: Date): FileDTO {
  return {
    id,
    ino: `ino_${id}`,
    locationId: 'loc1',
    relativePath: `${id}.jpg`,
    absolutePath: `C:/test/${id}.jpg`,
    tags: ['t1'],
    size: 1024,
    width: 800,
    height: 600,
    dateAdded: date,
    dateModified: date,
    dateCreated: date,
    dateLastIndexed: date,
    name: `${id}.jpg`,
    extension: 'jpg',
    rating: 4,
  };
}

describe('SqliteBackend', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('converts Date <-> epoch ms at the boundary for tags, locations, files, and date criteria', async () => {
    const ts = 1_750_000_000_000;
    const date = new Date(ts);
    const notifyChange = jest.fn();

    mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'db_init') {
        return { migrated: false, schemaVersion: 1 };
      }
      if (cmd === 'db_fetch_tags') {
        return [
          { id: 't1', name: 'Tag 1', dateAdded: ts, color: '', subTags: [], isHidden: false },
        ];
      }
      if (cmd === 'db_fetch_locations') {
        return [{ id: 'loc1', path: 'C:/test', dateAdded: ts, subLocations: [], index: 0 }];
      }
      if (cmd === 'db_fetch_files_by_key') {
        expect(args).toEqual({ key: 'dateAdded', value: ts });
        return [
          {
            ...makeFile('f1', date),
            dateAdded: ts,
            dateModified: ts,
            dateCreated: ts,
            dateLastIndexed: ts,
          },
        ];
      }
      return undefined;
    });

    const backend = await SqliteBackend.init(notifyChange);

    const tags = await backend.fetchTags();
    expect(tags[0].dateAdded).toBeInstanceOf(Date);
    expect(tags[0].dateAdded.getTime()).toBe(ts);

    const locs = await backend.fetchLocations();
    expect(locs[0].dateAdded).toBeInstanceOf(Date);
    expect(locs[0].dateAdded.getTime()).toBe(ts);

    const files = await backend.fetchFilesByKey('dateAdded', date);
    expect(files[0].dateAdded).toBeInstanceOf(Date);
    expect(files[0].dateAdded.getTime()).toBe(ts);

    const tagDto: TagDTO = {
      id: 't2',
      name: 'Tag 2',
      dateAdded: date,
      color: '',
      subTags: [],
      isHidden: false,
    };
    await backend.createTag(tagDto);
    expect(mockInvoke).toHaveBeenCalledWith('db_create_tag', {
      tag: { ...tagDto, dateAdded: ts },
    });

    const locDto: LocationDTO = {
      id: 'loc2',
      path: 'D:/art',
      dateAdded: date,
      subLocations: [],
      index: 1,
    };
    await backend.createLocation(locDto);
    expect(mockInvoke).toHaveBeenCalledWith('db_create_location', {
      location: { ...locDto, dateAdded: ts },
    });
  });

  it('waits for chunks that arrive after the invoke reply (Tauri 2 channel ordering)', async () => {
    const ts = 1_750_000_000_000;
    const date = new Date(ts);
    const wire1 = {
      ...makeFile('f1', date),
      dateAdded: ts,
      dateModified: ts,
      dateCreated: ts,
      dateLastIndexed: ts,
    };
    const wire2 = {
      ...makeFile('f2', date),
      dateAdded: ts,
      dateModified: ts,
      dateCreated: ts,
      dateLastIndexed: ts,
    };

    mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'db_init') {
        return { migrated: false, schemaVersion: 1 };
      }
      if (cmd === 'db_search_files') {
        const channel = args?.onChunk as { onmessage: (message: unknown[]) => void };
        // Reply first, deliver the chunks later: this is what made subfolder clicks show nothing.
        setTimeout(() => channel.onmessage([wire1]), 5);
        setTimeout(() => channel.onmessage([wire2]), 10);
        return { totalCount: 2 };
      }
      return undefined;
    });

    const backend = await SqliteBackend.init(jest.fn());
    const searched = await backend.searchFiles(
      { key: 'absolutePath', valueType: 'string', operator: 'startsWith', value: 'D:\\lib\\sub\\' },
      'dateAdded',
      OrderDirection.Desc,
    );
    expect(searched.map((f) => f.id)).toEqual(['f1', 'f2']);
  });

  it('assembles chunked Channel streams for fetchFiles and searchFiles', async () => {
    const ts = 1_750_000_000_000;
    const date = new Date(ts);
    const wire1 = {
      ...makeFile('f1', date),
      dateAdded: ts,
      dateModified: ts,
      dateCreated: ts,
      dateLastIndexed: ts,
    };
    const wire2 = {
      ...makeFile('f2', date),
      dateAdded: ts,
      dateModified: ts,
      dateCreated: ts,
      dateLastIndexed: ts,
    };

    mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'db_init') {
        return { migrated: false, schemaVersion: 1 };
      }
      if (cmd === 'db_fetch_files' || cmd === 'db_search_files') {
        const channel = args?.onChunk as { onmessage: (message: unknown[]) => void };
        channel.onmessage([wire1]);
        channel.onmessage([wire2]);
        return { totalCount: 2 };
      }
      return undefined;
    });

    const backend = await SqliteBackend.init(jest.fn());

    const fetched = await backend.fetchFiles('dateAdded', OrderDirection.Asc);
    expect(fetched.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(fetched[0].dateAdded).toBeInstanceOf(Date);

    const searched = await backend.searchFiles(
      { key: 'dateAdded', valueType: 'date', operator: 'equals', value: date },
      'name',
      OrderDirection.Desc,
      true,
    );
    expect(searched.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(mockInvoke).toHaveBeenCalledWith(
      'db_search_files',
      expect.objectContaining({
        criteria: [{ key: 'dateAdded', valueType: 'date', operator: 'equals', value: ts }],
        matchAny: true,
      }),
    );
  });

  it('calls notifyChange after every mutation', async () => {
    const notifyChange = jest.fn();
    mockInvoke.mockResolvedValue(0);

    const backend = await SqliteBackend.init(notifyChange);
    const now = new Date(1_750_000_000_000);
    const tag: TagDTO = {
      id: 't1',
      name: 'T',
      dateAdded: now,
      color: '',
      subTags: [],
      isHidden: false,
    };
    const file = makeFile('f1', now);
    const loc: LocationDTO = { id: 'l1', path: 'C:/a', dateAdded: now, subLocations: [], index: 0 };

    await backend.createTag(tag);
    await backend.saveTag(tag);
    await backend.removeTags(['t1']);
    await backend.mergeTags('t1', 't2');
    await backend.createFilesFromPath('C:/a', [file]);
    await backend.saveFiles([file]);
    await backend.removeFiles(['f1']);
    await backend.purgeUnsupportedExtensions();
    await backend.createLocation(loc);
    await backend.saveLocation(loc);
    await backend.removeLocation('l1');
    await backend.createSearch({ id: 's1', name: 'S', criteria: [], index: 0 });
    await backend.saveSearch({ id: 's1', name: 'S', criteria: [], index: 0 });
    await backend.removeSearch('s1');
    await backend.clear();

    expect(notifyChange).toHaveBeenCalledTimes(15);
  });
});
