import { invoke } from '@tauri-apps/api/core';

import { FileDTO } from 'src/api/file';
import { FileSearchDTO } from 'src/api/file-search';
import { LocationDTO } from 'src/api/location';
import { TagDTO } from 'src/api/tag';
import { DB_NAME, dbInit } from './config';
import { FileWireDTO, fileToWire, locationToWire, searchToWire, tagToWire } from './sqlite-backend';

export const MIGRATION_BATCH_SIZE = 1000;

export type MigrationState = 'none' | 'in_progress' | 'completed' | 'skipped';

export interface DexieMigrationResult {
  state: 'completed' | 'skipped';
  totalFiles: number;
  migratedFiles: number;
  ignoredTagRefs: number;
  orphanLocationFiles: number;
}

export interface DexieMigrationOptions {
  onBeforeStart?: (totalFiles: number) => void;
  onProgress?: (done: number, total: number) => void;
}

interface MigrateFilesBatchResult {
  migratedCount: number;
  ignoredTagRefs: number;
  orphanLocationFiles: number;
}

type LegacyFileRow = Partial<FileDTO> &
  Pick<
    FileDTO,
    | 'id'
    | 'locationId'
    | 'relativePath'
    | 'absolutePath'
    | 'tags'
    | 'size'
    | 'width'
    | 'height'
    | 'dateAdded'
    | 'dateModified'
    | 'name'
    | 'extension'
  >;

interface LegacyFileWireDTO extends Omit<FileWireDTO, 'dateCreated' | 'dateLastIndexed'> {
  dateCreated?: number;
  dateLastIndexed?: number;
}

function toDate(value: Date | number | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toOptionalEpochMs(value: Date | number | string | undefined): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function legacyFileToWire(row: LegacyFileRow): LegacyFileWireDTO {
  if (row.dateCreated !== undefined && row.dateLastIndexed !== undefined) {
    return fileToWire({
      ...row,
      ino: row.ino ?? '',
      dateAdded: toDate(row.dateAdded),
      dateModified: toDate(row.dateModified),
      dateCreated: toDate(row.dateCreated),
      dateLastIndexed: toDate(row.dateLastIndexed),
    } as FileDTO);
  }

  return {
    id: row.id,
    ino: row.ino ?? '',
    locationId: row.locationId,
    relativePath: row.relativePath,
    absolutePath: row.absolutePath,
    tags: Array.isArray(row.tags) ? row.tags : [],
    size: row.size,
    width: row.width,
    height: row.height,
    dateAdded: toDate(row.dateAdded).getTime(),
    dateModified: toDate(row.dateModified).getTime(),
    dateCreated: toOptionalEpochMs(row.dateCreated),
    dateLastIndexed: toOptionalEpochMs(row.dateLastIndexed),
    name: row.name,
    extension: row.extension,
    description: row.description,
    rating: row.rating,
    duration: row.duration,
    palette: row.palette,
  };
}

function readFilesBatch(
  idb: IDBDatabase,
  lastKey: IDBValidKey | undefined,
  batchSize: number,
): Promise<{ rows: LegacyFileRow[]; lastKey: IDBValidKey | undefined }> {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction('files', 'readonly');
    const store = tx.objectStore('files');
    const range = lastKey !== undefined ? IDBKeyRange.lowerBound(lastKey, true) : null;
    const req = store.openCursor(range);
    const rows: LegacyFileRow[] = [];
    let batchLastKey: IDBValidKey | undefined = lastKey;

    req.onerror = () => reject(req.error ?? new Error('Failed to iterate IndexedDB files cursor'));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve({ rows, lastKey: batchLastKey });
        return;
      }
      rows.push(cursor.value as LegacyFileRow);
      batchLastKey = cursor.key;
      if (rows.length >= batchSize) {
        // Returning without calling cursor.continue() lets the readonly IDB transaction
        // finish cleanly before any async Tauri invoke() runs.
        resolve({ rows, lastKey: batchLastKey });
        return;
      }
      cursor.continue();
    };
  });
}

async function dexieDatabaseExists(name: string): Promise<boolean> {
  if (typeof indexedDB === 'undefined') {
    return false;
  }
  if (typeof indexedDB.databases === 'function') {
    const dbs = await indexedDB.databases();
    return dbs.some((entry) => entry.name === name);
  }
  return true;
}

export async function getDexieMigrationState(): Promise<MigrationState> {
  return invoke<MigrationState>('db_migration_state');
}

export async function runDexieMigration(
  options?: DexieMigrationOptions,
): Promise<DexieMigrationResult> {
  const exists = await dexieDatabaseExists(DB_NAME);
  if (!exists) {
    await invoke('db_migration_skip');
    return {
      state: 'skipped',
      totalFiles: 0,
      migratedFiles: 0,
      ignoredTagRefs: 0,
      orphanLocationFiles: 0,
    };
  }

  const db = dbInit(DB_NAME);
  await db.open();

  let migrationStarted = false;
  try {
    const [fileCount, locationCount, searchCount, tags] = await Promise.all([
      db.table<LegacyFileRow>('files').count(),
      db.table<LocationDTO>('locations').count(),
      db.table<FileSearchDTO>('searches').count(),
      db.table<TagDTO>('tags').toArray(),
    ]);

    const onlyRootOrEmptyTags = tags.length === 0 || (tags.length === 1 && tags[0]?.id === 'root');

    if (fileCount === 0 && locationCount === 0 && searchCount === 0 && onlyRootOrEmptyTags) {
      await invoke('db_migration_skip');
      return {
        state: 'skipped',
        totalFiles: 0,
        migratedFiles: 0,
        ignoredTagRefs: 0,
        orphanLocationFiles: 0,
      };
    }

    options?.onBeforeStart?.(fileCount);

    await invoke('db_migration_begin');
    migrationStarted = true;

    const [locations, searches] = await Promise.all([
      db.table<LocationDTO>('locations').toArray(),
      db.table<FileSearchDTO>('searches').toArray(),
    ]);

    const wireTags = tags.map((tag) =>
      tagToWire({
        ...tag,
        dateAdded: toDate(tag.dateAdded),
        subTags: Array.isArray(tag.subTags) ? tag.subTags : [],
        color: tag.color ?? '',
        isHidden: Boolean(tag.isHidden),
      }),
    );
    const wireLocations = locations.map((loc) =>
      locationToWire({
        ...loc,
        dateAdded: toDate(loc.dateAdded),
        subLocations: Array.isArray(loc.subLocations) ? loc.subLocations : [],
        index: loc.index ?? 0,
      }),
    );
    const wireSearches = searches.map((search) =>
      searchToWire({
        ...search,
        criteria: Array.isArray(search.criteria) ? search.criteria : [],
        matchAny: Boolean(search.matchAny),
        index: search.index ?? 0,
      }),
    );

    await invoke('db_migrate_metadata', {
      tags: wireTags,
      locations: wireLocations,
      searches: wireSearches,
    });

    const idb = db.backendDB();
    let lastKey: IDBValidKey | undefined;
    let migratedFiles = 0;
    let ignoredTagRefs = 0;
    let orphanLocationFiles = 0;

    while (true) {
      const { rows, lastKey: nextKey } = await readFilesBatch(idb, lastKey, MIGRATION_BATCH_SIZE);
      if (rows.length === 0) {
        break;
      }
      const wireBatch = rows.map(legacyFileToWire);
      const batchResult = await invoke<MigrateFilesBatchResult>('db_migrate_files_batch', {
        files: wireBatch,
      });
      migratedFiles += batchResult.migratedCount;
      ignoredTagRefs += batchResult.ignoredTagRefs;
      orphanLocationFiles += batchResult.orphanLocationFiles;
      lastKey = nextKey;
      options?.onProgress?.(migratedFiles, fileCount);
    }

    await invoke('db_migration_finish', {
      expected: {
        tags: tags.length,
        files: fileCount,
        locations: locations.length,
        searches: searches.length,
      },
    });

    return {
      state: 'completed',
      totalFiles: fileCount,
      migratedFiles,
      ignoredTagRefs,
      orphanLocationFiles,
    };
  } catch (err) {
    if (migrationStarted) {
      await invoke('db_clear').catch(() => undefined);
    }
    throw err;
  } finally {
    db.close();
  }
}
