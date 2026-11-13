import Dexie from 'dexie';

import { DB_NAME, dbInit } from '../src/backend/config';
import { MIGRATION_BATCH_SIZE, runDexieMigration } from '../src/backend/dexie-migration';
import { ROOT_TAG_ID } from '../src/api/tag';

const mockInvoke = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  Channel: class MockChannel<T> {
    onmessage: (message: T) => void = () => {};
  },
}));

describe('dexie-migration', () => {
  beforeEach(async () => {
    mockInvoke.mockReset();
    await Dexie.delete(DB_NAME);
  });

  afterAll(async () => {
    await Dexie.delete(DB_NAME);
  });

  it('skips migration when Allusion IndexedDB does not exist', async () => {
    mockInvoke.mockResolvedValue(undefined);

    const result = await runDexieMigration();

    expect(result.state).toBe('skipped');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('db_migration_skip');
  });

  it('skips migration when Allusion IndexedDB has only the root tag and no files/locations/searches', async () => {
    const db = dbInit(DB_NAME);
    await db.open();
    await db.table('tags').put({
      id: ROOT_TAG_ID,
      name: '',
      dateAdded: new Date('2025-01-01T00:00:00.000Z'),
      color: '',
      subTags: [],
      isHidden: false,
    });
    db.close();

    mockInvoke.mockResolvedValue(undefined);

    const result = await runDexieMigration();

    expect(result.state).toBe('skipped');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('db_migration_skip');
  });

  it('migrates 2500 files in batches <= 1000 with hierarchy, legacy record, missing tag, epoch ms dates, and keeps IndexedDB intact', async () => {
    const baseDate = new Date('2025-06-01T12:00:00.000Z');
    const db = dbInit(DB_NAME);
    await db.open();

    await db.table('tags').bulkPut([
      {
        id: ROOT_TAG_ID,
        name: '',
        dateAdded: baseDate,
        color: '',
        subTags: ['t_parent'],
        isHidden: false,
      },
      {
        id: 't_parent',
        name: 'Characters',
        dateAdded: baseDate,
        color: '#ff0000',
        subTags: ['t_child'],
        isHidden: false,
      },
      {
        id: 't_child',
        name: 'Dragons',
        dateAdded: baseDate,
        color: '#00ff00',
        subTags: [],
        isHidden: false,
      },
    ]);

    await db.table('locations').put({
      id: 'loc_1',
      path: 'C:/art',
      dateAdded: baseDate,
      subLocations: [{ name: 'refs', isExcluded: false, subLocations: [] }],
      index: 0,
    });

    await db.table('searches').put({
      id: 's_1',
      name: 'Saved',
      criteria: [{ key: 'name', valueType: 'string', operator: 'contains', value: 'dragon' }],
      matchAny: false,
      index: 0,
    });

    const totalFiles = 2500;
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < totalFiles; i++) {
      const id = `file_${String(i).padStart(4, '0')}`;
      const rowDate = new Date(baseDate.getTime() + i);
      if (i === 0) {
        // Legacy record missing rating, palette, and dateLastIndexed
        rows.push({
          id,
          ino: `ino_${i}`,
          locationId: i === 0 ? 'loc_1' : `loc_${i}`,
          relativePath: `${id}.png`,
          absolutePath: `C:/art/${id}.png`,
          tags: ['t_child'],
          size: 1000 + i,
          width: 800 + i,
          height: 600 + i,
          dateAdded: rowDate,
          dateModified: rowDate,
          dateCreated: rowDate,
          name: `${id}.png`,
          extension: 'png',
        });
      } else {
        rows.push({
          id,
          ino: `ino_${i}`,
          locationId: i === 0 ? 'loc_1' : `loc_${i}`,
          relativePath: `${id}.png`,
          absolutePath: `C:/art/${id}.png`,
          tags: i === 1 ? ['t_parent', 'nonexistent_tag'] : i % 50 === 0 ? ['t_parent'] : [],
          size: 1000 + i,
          width: 800 + i,
          height: 600 + i,
          dateAdded: rowDate,
          dateModified: rowDate,
          dateCreated: rowDate,
          dateLastIndexed: rowDate,
          name: `${id}.png`,
          extension: `ext_${i}`,
          description: null,
          rating: i,
          duration: null,
          palette: [],
        });
      }
    }
    await db.table('files').bulkPut(rows);
    db.close();

    const batchSizes: number[] = [];
    const seenIds = new Set<string>();
    const allWireFiles = new Map<string, Record<string, unknown>>();
    let metadataPayload: Record<string, unknown> | undefined;
    let finishPayload: Record<string, unknown> | undefined;

    mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'db_migrate_metadata') {
        metadataPayload = args;
        return undefined;
      }
      if (cmd === 'db_migrate_files_batch') {
        const files = (args?.files as Array<Record<string, unknown>>) ?? [];
        batchSizes.push(files.length);
        for (const f of files) {
          const id = f.id as string;
          seenIds.add(id);
          allWireFiles.set(id, f);
        }
        return {
          migratedCount: files.length,
          ignoredTagRefs: 0,
          orphanLocationFiles: 0,
        };
      }
      if (cmd === 'db_migration_finish') {
        finishPayload = args;
        return undefined;
      }
      return undefined;
    });

    const onBeforeStart = jest.fn();
    const onProgress = jest.fn();

    const result = await runDexieMigration({ onBeforeStart, onProgress });

    expect(result.state).toBe('completed');
    expect(result.totalFiles).toBe(totalFiles);
    expect(result.migratedFiles).toBe(totalFiles);

    expect(mockInvoke).toHaveBeenCalledWith('db_migration_begin');
    expect(batchSizes).toEqual([1000, 1000, 500]);
    expect(batchSizes.every((size) => size <= MIGRATION_BATCH_SIZE)).toBe(true);
    expect(seenIds.size).toBe(totalFiles);

    // Dates converted to epoch ms
    const wireTags = metadataPayload?.tags as Array<Record<string, unknown>>;
    expect(wireTags).toHaveLength(3);
    expect(wireTags[0].dateAdded).toBe(baseDate.getTime());

    const legacyWire = allWireFiles.get('file_0000')!;
    expect(typeof legacyWire.dateAdded).toBe('number');
    expect(legacyWire.dateAdded).toBe(baseDate.getTime());
    expect(legacyWire.rating).toBeUndefined();
    expect(legacyWire.palette).toBeUndefined();
    expect(legacyWire.dateLastIndexed).toBeUndefined();

    const missingTagWire = allWireFiles.get('file_0001')!;
    expect(missingTagWire.tags).toEqual(['t_parent', 'nonexistent_tag']);

    expect(finishPayload).toEqual({
      expected: {
        tags: 3,
        files: 2500,
        locations: 1,
        searches: 1,
      },
    });

    expect(onBeforeStart).toHaveBeenCalledWith(2500);
    expect(onProgress.mock.calls).toEqual([
      [1000, 2500],
      [2000, 2500],
      [2500, 2500],
    ]);

    // Verify IndexedDB remains intact
    const verifyDb = dbInit(DB_NAME);
    await verifyDb.open();
    expect(await verifyDb.table('files').count()).toBe(2500);
    expect(await verifyDb.table('tags').count()).toBe(3);
    expect(await verifyDb.table('locations').count()).toBe(1);
    expect(await verifyDb.table('searches').count()).toBe(1);
    verifyDb.close();
  }, 120000);
});
