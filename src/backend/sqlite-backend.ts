import { Channel, invoke } from '@tauri-apps/api/core';
import { IndexableType } from 'dexie';

import { DataStorage } from 'src/api/data-storage';
import { ConditionDTO, OrderBy, OrderDirection } from 'src/api/data-storage-search';
import { FileDTO, IMG_EXTENSIONS, PaletteColorDTO } from 'src/api/file';
import { FileSearchDTO } from 'src/api/file-search';
import { LocationDTO, SubLocationDTO } from 'src/api/location';
import { SearchCriteria } from 'src/api/search-criteria';
import { TagDTO } from 'src/api/tag';
import { ID } from 'src/api/id';

const WRITE_BATCH_SIZE = 2000;

interface FileWireDTO {
  id: ID;
  ino: string;
  locationId: ID;
  relativePath: string;
  absolutePath: string;
  tags: ID[];
  size: number;
  width: number;
  height: number;
  dateAdded: number;
  dateModified: number;
  dateCreated: number;
  dateLastIndexed: number;
  name: string;
  extension: string;
  description?: string;
  rating?: number;
  duration?: number;
  palette?: PaletteColorDTO[];
}

interface TagWireDTO {
  id: ID;
  name: string;
  dateAdded: number;
  color: string;
  subTags: ID[];
  isHidden: boolean;
}

interface LocationWireDTO {
  id: ID;
  path: string;
  dateAdded: number;
  subLocations: SubLocationDTO[];
  index: number;
}

interface SearchCriteriaWireDTO {
  key: keyof FileDTO;
  valueType: 'number' | 'date' | 'string' | 'array' | 'color';
  operator: string;
  value: unknown;
}

interface FileSearchWireDTO {
  id: ID;
  name: string;
  criteria: SearchCriteriaWireDTO[];
  matchAny: boolean;
  index: number;
}

function fileFromWire(wire: FileWireDTO): FileDTO {
  return {
    ...wire,
    extension: wire.extension as FileDTO['extension'],
    dateAdded: new Date(wire.dateAdded),
    dateModified: new Date(wire.dateModified),
    dateCreated: new Date(wire.dateCreated),
    dateLastIndexed: new Date(wire.dateLastIndexed),
  };
}

function fileToWire(file: FileDTO): FileWireDTO {
  return {
    ...file,
    dateAdded: file.dateAdded.getTime(),
    dateModified: file.dateModified.getTime(),
    dateCreated: file.dateCreated.getTime(),
    dateLastIndexed: file.dateLastIndexed.getTime(),
  };
}

function tagFromWire(wire: TagWireDTO): TagDTO {
  return {
    ...wire,
    dateAdded: new Date(wire.dateAdded),
  };
}

function tagToWire(tag: TagDTO): TagWireDTO {
  return {
    ...tag,
    dateAdded: tag.dateAdded.getTime(),
  };
}

function locationFromWire(wire: LocationWireDTO): LocationDTO {
  return {
    ...wire,
    dateAdded: new Date(wire.dateAdded),
  };
}

function locationToWire(location: LocationDTO): LocationWireDTO {
  return {
    ...location,
    dateAdded: location.dateAdded.getTime(),
  };
}

function criteriaToWire(criteria: SearchCriteria): SearchCriteriaWireDTO {
  const raw = criteria as unknown as {
    key: keyof FileDTO;
    valueType: SearchCriteriaWireDTO['valueType'];
    operator: string;
    value: unknown;
  };
  const value =
    raw.valueType === 'date' && raw.value instanceof Date ? raw.value.getTime() : raw.value;
  return {
    key: raw.key,
    valueType: raw.valueType,
    operator: raw.operator,
    value,
  };
}

function criteriaFromWire(wire: SearchCriteriaWireDTO): SearchCriteria {
  const value =
    wire.valueType === 'date' && typeof wire.value === 'number' ? new Date(wire.value) : wire.value;
  return {
    key: wire.key,
    valueType: wire.valueType,
    operator: wire.operator,
    value,
  } as unknown as SearchCriteria;
}

function searchToWire(search: FileSearchDTO): FileSearchWireDTO {
  return {
    id: search.id,
    name: search.name,
    criteria: search.criteria.map(criteriaToWire),
    matchAny: search.matchAny ?? false,
    index: search.index,
  };
}

function searchFromWire(wire: FileSearchWireDTO): FileSearchDTO {
  return {
    id: wire.id,
    name: wire.name,
    criteria: wire.criteria.map(criteriaFromWire),
    matchAny: wire.matchAny,
    index: wire.index,
  };
}

function normalizeCriteriaList(
  criteria: SearchCriteria | [SearchCriteria, ...SearchCriteria[]],
): SearchCriteriaWireDTO[] {
  const list = Array.isArray(criteria) ? criteria : [criteria];
  return list.map(criteriaToWire);
}

function normalizeKeyValue(value: IndexableType): string | number | boolean {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

export class SqliteBackend implements DataStorage {
  private notifyChange: () => void;

  private constructor(notifyChange: () => void) {
    this.notifyChange = notifyChange;
  }

  static async init(notifyChange: () => void): Promise<SqliteBackend> {
    await invoke('db_init');
    return new SqliteBackend(notifyChange);
  }

  async fetchTags(): Promise<TagDTO[]> {
    const tags = await invoke<TagWireDTO[]>('db_fetch_tags');
    return tags.map(tagFromWire);
  }

  async fetchFiles(order: OrderBy<FileDTO>, fileOrder: OrderDirection): Promise<FileDTO[]> {
    const result: FileDTO[] = [];
    const onChunk = new Channel<FileWireDTO[]>();
    onChunk.onmessage = (chunk) => {
      for (const item of chunk) {
        result.push(fileFromWire(item));
      }
    };
    await invoke('db_fetch_files', { order, direction: fileOrder, onChunk });
    return result;
  }

  async fetchFilesByID(ids: ID[]): Promise<FileDTO[]> {
    const files = await invoke<FileWireDTO[]>('db_fetch_files_by_id', { ids });
    return files.map(fileFromWire);
  }

  async fetchFilesByKey(key: keyof FileDTO, value: IndexableType): Promise<FileDTO[]> {
    const files = await invoke<FileWireDTO[]>('db_fetch_files_by_key', {
      key,
      value: normalizeKeyValue(value),
    });
    return files.map(fileFromWire);
  }

  async fetchLocations(): Promise<LocationDTO[]> {
    const locations = await invoke<LocationWireDTO[]>('db_fetch_locations');
    return locations.map(locationFromWire);
  }

  async fetchSearches(): Promise<FileSearchDTO[]> {
    const searches = await invoke<FileSearchWireDTO[]>('db_fetch_searches');
    return searches.map(searchFromWire);
  }

  async searchFiles(
    criteria: ConditionDTO<FileDTO> | [ConditionDTO<FileDTO>, ...ConditionDTO<FileDTO>[]],
    order: OrderBy<FileDTO>,
    fileOrder: OrderDirection,
    matchAny = false,
  ): Promise<FileDTO[]> {
    const result: FileDTO[] = [];
    const onChunk = new Channel<FileWireDTO[]>();
    onChunk.onmessage = (chunk) => {
      for (const item of chunk) {
        result.push(fileFromWire(item));
      }
    };
    await invoke('db_search_files', {
      criteria: normalizeCriteriaList(
        criteria as SearchCriteria | [SearchCriteria, ...SearchCriteria[]],
      ),
      order,
      direction: fileOrder,
      matchAny,
      onChunk,
    });
    return result;
  }

  async createTag(tag: TagDTO): Promise<void> {
    await invoke('db_create_tag', { tag: tagToWire(tag) });
    this.notifyChange();
  }

  async createFilesFromPath(path: string, files: FileDTO[]): Promise<void> {
    for (let i = 0; i < files.length; i += WRITE_BATCH_SIZE) {
      const batch = files.slice(i, i + WRITE_BATCH_SIZE).map(fileToWire);
      await invoke('db_create_files_from_path', { path, files: batch });
    }
    this.notifyChange();
  }

  async createLocation(location: LocationDTO): Promise<void> {
    await invoke('db_create_location', { location: locationToWire(location) });
    this.notifyChange();
  }

  async createSearch(search: FileSearchDTO): Promise<void> {
    await invoke('db_create_search', { search: searchToWire(search) });
    this.notifyChange();
  }

  async saveTag(tag: TagDTO): Promise<void> {
    await invoke('db_save_tag', { tag: tagToWire(tag) });
    this.notifyChange();
  }

  async saveFiles(files: FileDTO[]): Promise<void> {
    for (let i = 0; i < files.length; i += WRITE_BATCH_SIZE) {
      const batch = files.slice(i, i + WRITE_BATCH_SIZE).map(fileToWire);
      await invoke('db_save_files', { files: batch });
    }
    this.notifyChange();
  }

  async saveLocation(location: LocationDTO): Promise<void> {
    await invoke('db_save_location', { location: locationToWire(location) });
    this.notifyChange();
  }

  async saveSearch(search: FileSearchDTO): Promise<void> {
    await invoke('db_save_search', { search: searchToWire(search) });
    this.notifyChange();
  }

  async removeTags(tags: ID[]): Promise<void> {
    await invoke('db_remove_tags', { tagIds: tags });
    this.notifyChange();
  }

  async mergeTags(tagToBeRemoved: ID, tagToMergeWith: ID): Promise<void> {
    await invoke('db_merge_tags', { tagToBeRemoved, tagToMergeWith });
    this.notifyChange();
  }

  async removeFiles(files: ID[]): Promise<void> {
    await invoke('db_remove_files', { fileIds: files });
    this.notifyChange();
  }

  async purgeUnsupportedExtensions(): Promise<number> {
    const removed = await invoke<number>('db_purge_unsupported_extensions', {
      supportedExtensions: IMG_EXTENSIONS,
    });
    this.notifyChange();
    return removed;
  }

  async removeLocation(location: ID): Promise<void> {
    await invoke('db_remove_location', { locationId: location });
    this.notifyChange();
  }

  async removeSearch(search: ID): Promise<void> {
    await invoke('db_remove_search', { searchId: search });
    this.notifyChange();
  }

  async countFiles(): Promise<[fileCount: number, untaggedFileCount: number]> {
    return invoke<[number, number]>('db_count_files');
  }

  async clear(): Promise<void> {
    await invoke('db_clear');
    this.notifyChange();
  }
}

export default SqliteBackend;
