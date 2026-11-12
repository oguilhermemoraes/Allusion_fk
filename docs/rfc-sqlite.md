# RFC — Migração de Persistência Dexie para SQLite Nativo

- **Status**: Em revisão — Etapa 1 de `FEAT-Migrar-DB-para-SQLite`
- **Issues relacionadas**: `#9`, `#45`
- **Decisão base**: SQLite nativo em Rust via `rusqlite` com feature `bundled` e modo `WAL`, exposto por comandos Tauri `invoke()`. Não utilizar `tauri-plugin-sql`. As interfaces [`DataStorage`](../src/api/data-storage.ts) e [`DataBackup`](../src/api/data-backup.ts) e a UI React permanecem inalteradas nesta migração.

---

## 1. Inventário de Uso de `DataStorage` e `DataBackup`

Hoje o backend de persistência roda integralmente no processo WebView sobre Dexie/IndexedDB (`src/backend/config.ts:7`, `src/backend/backend.ts:28`). Os consumidores diretos de `DataStorage` estão concentrados em `src/frontend/stores/*Store.ts` e na inicialização em `src/renderer.tsx:45-53`.

### 1.1 Inventário por Método de `DataStorage`

| Método em `src/api/data-storage.ts` | Chamadores Diretos | Volume Típico em 150k | Frequência | Hot Path |
| :--- | :--- | :--- | :--- | :--- |
| `fetchTags()` (`:19`) | `TagStore.init` (`TagStore.ts:30`) via `RootStore.main` (`RootStore.ts:77`) e `RootStore.preview` (`RootStore.ts:155`) | 10 a 2.000 tags | 1x no boot | Boot crítico |
| `fetchFiles(order, fileOrder)` (`:20`) | `FileStore.fetchAllFiles` (`FileStore.ts:253`), `FileStore.fetchMissingFiles` (`FileStore.ts:293`), `FileStore.backfillPalettes` (`FileStore.ts:650`), `LocationStore.watchLocations` (`LocationStore.ts:115`) | 100% da biblioteca, até 150k linhas | Boot 2x a 3x, toda troca de ordenação, limpeza de busca e refetch sem filtros | **Sim — crítico** |
| `fetchFilesByID(ids)` (`:21`) | Nenhum chamador ativo em `src/` — apenas implementado em `Backend.fetchFilesByID` (`backend.ts:88-93`) | 1 a N IDs | Inativo hoje | Não |
| `fetchFilesByKey(key, value)` (`:22`) | `FileStore.findFilesByAbsolutePath` (`FileStore.ts:196`) via `useFileDnD.ts:185`; `LocationStore.renameFolder` (`LocationStore.ts:429`); `LocationStore.addFile` (`LocationStore.ts:562`) | 0–1 linha em `absolutePath`/`ino`; até toda uma location em `locationId` | Eventos de watcher, DnD de mover arquivo, rename de pasta | Médio em importação/watch |
| `fetchLocations()` (`:23`) | `LocationStore.init` (`LocationStore.ts:75`) via `RootStore.main` (`RootStore.ts:74`) e `RootStore.preview` (`RootStore.ts:152`) | 1 a 30 locations + árvore de sublocations | 1x no boot | Boot crítico |
| `fetchSearches()` (`:24`) | `SearchStore.init` (`SearchStore.ts:28`) via `RootStore.main` (`RootStore.ts:80`) | 0 a 100 buscas salvas | 1x no boot | Boot crítico |
| `searchFiles(criteria, order, fileOrder, matchAny)` (`:25-30`) | `FileStore.fetchUntaggedFiles` (`FileStore.ts:267`), `FileStore.fetchFilesByQuery` (`FileStore.ts:353`), `FileStore.deleteFilesByExtension` (`FileStore.ts:226`), `LocationStore.findLocationFiles` (`LocationStore.ts:599`), `LocationStore.removeSublocationFiles` (`LocationStore.ts:608`) | 0 a 150k linhas | Toda digitação/seleção de tag, clique em pasta/cor, saved search, troca de ordenação em query | **Sim — crítico** |
| `createTag(tag)` (`:31`) | `TagStore.create` (`TagStore.ts:95`) | 1 linha | Baixa — ação explícita do usuário | Não |
| `createFilesFromPath(path, files)` (`:32`) | `LocationStore.watchLocations` (`LocationStore.ts:278`), `LocationStore.initLocation` (`LocationStore.ts:506`), `LocationStore.addFile` (`LocationStore.ts:573`) | 1 arquivo no watcher até 150k no import inicial | Boot scan, adicionar location, watcher | **Sim em bulk import** |
| `createLocation(location)` (`:33`) | `LocationStore.create` (`LocationStore.ts:390`) | 1 location | Rara | Não |
| `createSearch(search)` (`:34`) | `SearchStore.create` (`SearchStore.ts:48`), `SearchStore.duplicate` (`SearchStore.ts:68`) | 1 busca | Rara | Não |
| `saveTag(tag)` (`:35`) | `TagStore.save` (`TagStore.ts:159`) via reaction 500ms em `ClientTag` (`Tag.ts:50-58`) | 1 linha + `subTags` | Baixa; rajadas em reordenação/cor múltipla (`UiStore.ts:596-603,643-656`) | Não |
| `saveFiles(files)` (`:36`) | `FileStore.saveFilesToSave` (`FileStore.ts:435`) via debounce 100ms + reaction 500ms (`File.ts:121-132`); chamadas diretas em `FileStore.backfillPalettes` (`:670`), `LocationStore.watchLocations` (`:245,267,309`), `LocationStore.changeLocationPath` (`:354`), `LocationStore.renameFolder` (`:445`) | 1 a dezenas de milhares de arquivos | Alta interativamente ao taguear/avaliar/gerar thumbs e paleta; rajadas em backfill/move | **Sim — escrita em lote** |
| `saveLocation(location)` (`:37`) | `LocationStore.save` (`LocationStore.ts:101`) e `LocationStore.changeLocationPath` (`LocationStore.ts:367`) | 1 location + árvore de sublocations | Boot via `refreshSublocations` (`Location.ts:267`), exclusão de subpasta (`Location.ts:208`), reordenação (`LocationStore.ts:627`) | Não |
| `saveSearch(search)` (`:38`) | `SearchStore.save` (`SearchStore.ts:100`) via `SearchStore.reorder` (`:95`) e `SearchItemDialog.tsx:56` | 1 busca | Rara | Não |
| `removeTags(tags)` (`:39`) | `TagStore.delete` (`TagStore.ts:116`), `TagStore.deleteTags` (`TagStore.ts:137`) | 1 a dezenas de tags + vínculos em arquivos | Rara | Não |
| `mergeTags(tagToBeRemoved, tagToMergeWith)` (`:40`) | `TagStore.merge` (`TagStore.ts:150`) | 1 tag removida, atualização nos arquivos afetados | Rara | Não |
| `removeFiles(files)` (`:41`) | `FileStore.removeFilesByIds` (`:191`), `FileStore.deleteFiles` (`:208`), `FileStore.deleteFilesByExtension` (`:228`), `LocationStore.watchLocations` (`:269`), `LocationStore.removeSublocationFiles` (`:609`), `Backend.purgeUnsupportedExtensions` (`backend.ts:240`) | 1 a milhares de IDs | Média/baixa | Não, exceto lote grande |
| `purgeUnsupportedExtensions()` (`:43`) | `LocationStore.watchLocations` (`LocationStore.ts:328`) | Hoje lê 100% da tabela `files` em memória (`backend.ts:234`) para filtrar em JS | 1x no boot | Gargalo evitável no boot |
| `removeLocation(location)` (`:44`) | `LocationStore.delete` (`LocationStore.ts:515`) | 1 location + todos os seus arquivos | Rara | Não |
| `removeSearch(search)` (`:45`) | `SearchStore.remove` (`SearchStore.ts:55`) | 1 busca | Rara | Não |
| `countFiles()` (`:46`) | `FileStore.refetchFileCounts` (`FileStore.ts:637`) via `RootStore.main` (`:98`), `LocationStore.initLocation` (`:510`), `LocationStore.delete` (`:527`) | 2 inteiros escalares | Baixa; boot quando há filtro salvo | Não |
| `clear()` (`:47`) | `RootStore.clearDatabase` (`RootStore.ts:186`) via `ClearDbButton` (`ErrorBoundary.tsx:34`) | Todo o banco | Muito rara | Não |

### 1.2 Consumidores de `DataBackup` e Ciclo de Boot

- **`Backend.init` (`src/backend/backend.ts:47-65`)**: garante que a tag raiz `id = 'root'` (`ROOT_TAG_ID` em `src/api/tag.ts:3`) exista quando `tags` está vazia.
- **`BackupScheduler` (`src/backend/backup-scheduler.ts:27-141`)**:
  - `schedule()` é chamado via callback `notifyChange()` ao final de toda mutação (`src/renderer.tsx:49`, `src/backend/backend.ts:138-294`), com debounce de 10s (`backup-scheduler.ts:104`) e janela mínima `AUTO_BACKUP_TIMEOUT = 10 min` (`src/backend/config.ts:11`).
  - `backupToFile(path)`, `restoreFromFile(path)` e `peekFile(path)` são expostos via `RootStore` (`RootStore.ts:173-183`) para a tela `ImportExport` (`src/frontend/containers/Settings/ImportExport.tsx:29,45,99`).
- **Observação crítica sobre o fluxo atual de boot (`RootStore.ts:71-133`)**:
  1. `RootStore.main` dispara em paralelo `locationStore.init()`, `tagStore.init()` e `searchStore.init()`.
  2. Em seguida chama `fileStore.fetchAllFiles()` ou `fileStore.fetchFilesByQuery()` + `refetchFileCounts()`. Só após essa carga inicial chama `RendererMessenger.initialized()` para revelar a janela oculta (`RootStore.ts:122`, `tauri.conf.json:25`).
  3. Depois dispara `locationStore.watchLocations()`, que chama `fetchFiles('id', Asc)` **novamente** (`LocationStore.ts:115`) e `purgeUnsupportedExtensions()` (`LocationStore.ts:328`), e por fim `backfillPalettes()`, que chama `fetchFiles('id', Asc)` **pela terceira vez** (`FileStore.ts:650`).

---

## 2. Schema SQL Completo e Índices

### 2.1 Mapeamento Completo dos Campos Encontrados no Código

Auditoria direta dos DTOs em `src/api/` e versões `4..10` de `dbConfig` em `src/backend/config.ts:17-138`:

1. **`FileDTO` (`src/api/file.ts:3-56`)**:
   - Campos base: `id`, `ino`, `locationId`, `relativePath`, `absolutePath`, `tags`, `dateAdded`, `dateModified`, `dateLastIndexed`, `name`, `extension`, `size`, `width`, `height`, `dateCreated`.
   - Campos extras adicionados no Allusion Next ("extra properties"):
     - `description?: string` (`file.ts:37`, `#49`);
     - `rating?: number` (`file.ts:41`, `#53`, v10 em `config.ts:120-136`);
     - `duration?: number` (`file.ts:45`, `#54`, v10 em `config.ts:120-136`);
     - `palette?: PaletteColorDTO[]` (`file.ts:47,51-56`, `#66`, v9 em `config.ts:100-118`), até `MAX_COLORS = 4` entradas `{ r, g, b, percentage }` (`src-tauri/src/commands/palette.rs:7-16`).
   - Nota de auditoria: não existe tabela ou mapa genérico `extraProperties` em nenhum arquivo de `src/` ou `common/`. Os metadados EXIF exibidos no Inspector (`PhotometricInterpretation`, `BitsPerSample`, `Software`, `Artist`, `CreatorWorkURL`, `ImageDescription`, `Parameters`, `Copyright` em `src/frontend/components/ImageInfo.tsx:34-51`) são lidos sob demanda e não são persistidos no banco. Preferências de UI (`UiStore.ts:30,879-993`, `FileStore.ts:21,439-463`, `LocationStore.ts:26,62-72`, `Outliner/index.tsx:15-16`, `FileTagEditor.tsx:80-85`, `renderer.tsx:57-86`) ficam em `localStorage` e permanecem lá.
   - Campos transientes de `ClientFile` não persistidos: `filename` (`entities/File.ts:109`), `thumbnailPath` (`FileStore.ts:596-600`) e `isBroken` (`FileStore.ts:522-527`).
2. **`TagDTO` (`src/api/tag.ts:3-13`)**: `id`, `name`, `dateAdded`, `color`, `subTags`, `isHidden`.
3. **`LocationDTO` e `SubLocationDTO` (`src/api/location.ts:3-15`)**: `id`, `path`, `dateAdded`, `subLocations`, `index`; cada sublocation possui `name`, `isExcluded`, `subLocations`.
4. **`FileSearchDTO` (`src/api/file-search.ts:4-10`) e `SearchCriteria` (`src/api/search-criteria.ts:24-62`)**: `id`, `name`, `criteria` (`{ key, valueType, operator, value }`), `matchAny`, `index`.

### 2.2 DDL SQLite Completo

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -32768; -- ~32 MB page cache por conexão
PRAGMA busy_timeout = 5000;

-- Metadados internos de controle (versão de migração Dexie e checksums)
CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Histórico explícito de migrations aplicadas (complementa PRAGMA user_version)
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

-- Locations raiz
CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  date_added INTEGER NOT NULL, -- Unix epoch ms
  sort_index INTEGER NOT NULL DEFAULT 0
);

-- Árvore recursiva de SubLocations vinculadas a uma Location
CREATE TABLE sublocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES sublocations(id) ON DELETE CASCADE, -- NULL = filho direto da Location
  name TEXT NOT NULL,
  is_excluded INTEGER NOT NULL DEFAULT 0 CHECK (is_excluded IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Tags hierárquicas: parent_id + sort_order substituem subTags: ID[] mantendo ordem
CREATE TABLE tags (
  id TEXT PRIMARY KEY, -- 'root' para ROOT_TAG_ID
  name TEXT NOT NULL,
  date_added INTEGER NOT NULL, -- Unix epoch ms
  color TEXT NOT NULL DEFAULT '',
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  parent_id TEXT REFERENCES tags(id) ON DELETE CASCADE, -- NULL apenas para 'root' (ou temporariamente órfã)
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Arquivos indexados
-- Nota sobre location_id: ver Seção 2.3 (sem FK rígida ou com reparo prévio)
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  ino TEXT NOT NULL,
  location_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  absolute_path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  extension TEXT NOT NULL, -- lowercase sem ponto
  size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  date_added INTEGER NOT NULL,        -- Unix epoch ms
  date_modified INTEGER NOT NULL,     -- Unix epoch ms
  date_created INTEGER NOT NULL,      -- Unix epoch ms
  date_last_indexed INTEGER NOT NULL, -- Unix epoch ms
  description TEXT,                   -- NULL = sem descrição (#49)
  rating INTEGER NOT NULL DEFAULT 0,  -- 0 = sem avaliação, 1..5 (#53)
  duration REAL                       -- segundos para vídeos (#54), NULL para imagens
);

-- Tabela de junção N:N entre arquivos e tags
CREATE TABLE file_tags (
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0, -- preserva ordem do array FileDTO.tags
  PRIMARY KEY (file_id, tag_id)
);

-- Paleta de cores dominantes normalizada (até 4 cores por arquivo, #66/#67)
CREATE TABLE file_palette (
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,   -- 0..3, preserva ordem por cobertura
  r INTEGER NOT NULL CHECK (r BETWEEN 0 AND 255),
  g INTEGER NOT NULL CHECK (g BETWEEN 0 AND 255),
  b INTEGER NOT NULL CHECK (b BETWEEN 0 AND 255),
  percentage REAL NOT NULL,
  color_id TEXT NOT NULL,      -- centroid mais próximo de FIXED_COLORS (common/color.ts:18-54)
  PRIMARY KEY (file_id, position)
);

-- Buscas salvas
CREATE TABLE saved_searches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  match_any INTEGER NOT NULL DEFAULT 0 CHECK (match_any IN (0, 1)),
  sort_index INTEGER NOT NULL DEFAULT 0
);

-- Critérios ordenados de cada busca salva
CREATE TABLE saved_search_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_id TEXT NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  key TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('number', 'date', 'string', 'array', 'color')),
  operator TEXT NOT NULL,
  value_json TEXT NOT NULL -- JSON do valor: string, number, epoch_ms/ISO, ID[] ou colorId
);
```

### 2.3 Detalhes de Modelagem e Reconciliação

1. **Hierarquia e ordem de `tags` (`TagDTO.subTags` → `parent_id` + `sort_order`)**:
   - Na leitura (`fetchTags`), o Rust busca `SELECT id, name, date_added, color, is_hidden, parent_id, sort_order FROM tags ORDER BY parent_id NULLS FIRST, sort_order ASC, date_added ASC` e remonta `subTags: ID[]` na ordem exata de `sort_order`.
   - Na escrita (`saveTag`), como `TagDTO` traz `subTags: ID[]` e **não** `parentId`, a mutation de `ClientTag.insertSubTag` (`Tag.ts:151-175`) dispara `saveTag(oldParent)` e `saveTag(newParent)` via `reaction(..., { delay: 500 })` (`Tag.ts:50-58`) em ordem não determinística. Para impedir que o save atrasado do antigo pai sobrescreva a nova paternidade, `db_save_tag` executa em transação:
     1. `INSERT INTO tags (...) ... ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, is_hidden=excluded.is_hidden` (preservando `parent_id` e `sort_order` do próprio nó);
     2. Para cada `(idx, child_id)` em `tag.sub_tags`: `UPDATE tags SET parent_id = ?1, sort_order = ?2 WHERE id = ?3`;
     3. Remove vínculo apenas de filhos que **ainda** apontem para este pai e saíram da lista: `UPDATE tags SET parent_id = NULL WHERE parent_id = ?1 AND id NOT IN (...tag.sub_tags...)`.
2. **Integridade de `files.location_id`**:
   - Em `tests/backend.test.ts:36`, `tests/rating.test.ts:18`, `tests/cleanup.test.ts:16`, `tests/description-search.test.ts:13` e `tests/color-filter.test.ts:67`, arquivos são inseridos via `createFilesFromPath` com `locationId: 'Default location'` ou `'loc'` sem registro prévio em `locations`. Além disso, bancos IndexedDB antigos podem conter órfãos.
   - Por isso, `files.location_id` não possui `FOREIGN KEY` bloqueante nesta etapa; `db_remove_location` remove os arquivos explicitamente dentro da mesma transação (`DELETE FROM files WHERE location_id = ?1; DELETE FROM locations WHERE id = ?1;`), o que aciona `ON DELETE CASCADE` em `file_tags` e `file_palette` — comportamento idêntico a `Backend.removeLocation` (`backend.ts:247-250`).
3. **Pré-computação de `file_palette.color_id`**:
   - Em vez de parsear JSON de `palette` para 150k linhas a cada filtro de cor, `db_save_files` e `db_create_files_from_path` calculam `color_id` em Rust usando a mesma distância euclidiana RGB aos 12 centróides de `FIXED_COLORS` (`common/color.ts:18-54`). A carga completa de `FileDTO` continua devolvendo `palette: PaletteColorDTO[]` ordenado por `position` sem perda de dados.
4. **Extensibilidade para cards futuros no roadmap**:
   - `FEAT-Grupos-Colecoes`: futuras tabelas `collections` e `collection_files(collection_id, file_id, position)` farão `REFERENCES files(id) ON DELETE CASCADE` sem alterar `files`.
   - `FEAT-Busca-Semantica-Local`: futura tabela `file_embeddings(file_id PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, model, dims, vector BLOB)` acopla por `files.id`.
   - `FEAT-Busca-Unificada`: futura tabela virtual `files_fts` indexando `name`, `relative_path` e `description`.

### 2.4 Índices Justificados pelas Queries Reais

| Índice | Colunas | Queries / Operações que o Justificam |
| :--- | :--- | :--- |
| PK `files(id)` | `id` | `fetchFilesByID`, joins com `file_tags`/`file_palette`, `ORDER BY id`, `removeFiles` |
| UNIQUE `files(absolute_path)` | `absolute_path` | `fetchFilesByKey('absolutePath', ...)` (`useFileDnD.ts:185`), dedup em `createFilesFromPath` (`backend.ts:285`), `ORDER BY absolute_path` (`Menus.tsx:61`), range scan de prefixo em clique de pasta (`LocationsPanel/index.tsx:104`) e `removeSublocationFiles` (`LocationStore.ts:604`) |
| `idx_files_location_id` | `files(location_id)` | `removeLocation` (`backend.ts:248`), `fetchFilesByKey('locationId', ...)` (`LocationStore.ts:429`), `findLocationFiles` (`LocationStore.ts:598`) |
| `idx_files_ino` | `files(ino)` | `fetchFilesByKey('ino', ...)` no watcher `LocationStore.addFile` (`LocationStore.ts:562`) |
| `idx_files_extension` | `files(extension)` | `deleteFilesByExtension` (`FileStore.ts:226`), `purgeUnsupportedExtensions` (`LocationStore.ts:328`), filtro por extensão (`Inputs.tsx:67`), `ORDER BY extension` (`Menus.tsx:62`) |
| `idx_files_date_added` | `files(date_added)` | Ordenação padrão da galeria (`FileStore.ts:51`, `Menus.tsx:64`) e busca por `dateAdded` (`Inputs.tsx:79`) |
| `idx_files_date_modified` | `files(date_modified)` | `ORDER BY date_modified` (`Menus.tsx:65`) |
| `idx_files_date_created` | `files(date_created)` | `ORDER BY date_created` (`Menus.tsx:66`) |
| `idx_files_name_nocase` | `files(name COLLATE NOCASE)` | `ORDER BY name` (`Menus.tsx:60`) e buscas `equalsIgnoreCase`/`startsWithIgnoreCase` por `name` |
| `idx_files_size` | `files(size)` | `ORDER BY size` (`Menus.tsx:63`) e filtro numérico por `size` (`Inputs.tsx:70`) |
| `idx_files_rating` | `files(rating)` | Filtro por estrelas (`Inputs.tsx:52`, `rating.test.ts:105,121`) |
| `idx_file_tags_tag_id` | `file_tags(tag_id, file_id)` | Busca por tag (`WHERE tag_id IN (...)`), `countFiles()` (contagem de não-tagueados), `removeTags` e `mergeTags` |
| `idx_file_palette_color_id` | `file_palette(color_id, file_id)` | Filtro de cor `palette contains/notContains` em O(log N + K) (`PaletteCommand.tsx:92`, `color-filter.test.ts:84`) |
| `idx_tags_parent_order` | `tags(parent_id, sort_order)` | `fetchTags()` ordenado e CTE recursiva (`WITH RECURSIVE` descendentes via `parent_id`) |
| `idx_sublocations_loc_parent` | `sublocations(location_id, parent_id, sort_order)` | Reconstrução da árvore de `LocationDTO.subLocations` no boot |
| `idx_saved_search_criteria_search` | `saved_search_criteria(search_id, position)` | Carga ordenada de critérios em `fetchSearches()` |

*Decisão sobre `width` e `height`*: filtros por `width`/`height` são ocasionais (`Inputs.tsx:73-77`) e não há ordenação por eles (`Menus.tsx:53-68`). Omitir índices dedicados para `width`/`height` na v1 evita manutenção extra de B-trees durante inserções em lote de 150k linhas; podem ser adicionados em migration futura se o benchmark de filtros dimensionais justificar.

---

## 3. Mapeamento `DataStorage` e `DataBackup` para Comandos Tauri

### 3.1 Serialização na Fronteira TS ↔ Rust

- **Datas (`Date` ↔ `i64`)**: no TypeScript, `FileDTO`, `TagDTO` e `LocationDTO` usam objetos `Date` (ex.: `LocationStore.ts:39,79,119,290`, `ImageInfo.tsx:71-72`). Sobre `invoke()`, `Date` serializaria como string ISO-8601. O adapter `SqliteBackend` converte `Date → number` via `.getTime()` na saída e `number → new Date(ms)` na entrada, usando tipos wire `FileWireDTO`, `TagWireDTO` e `LocationWireDTO`.
- **Tipo `IndexableType` (`src/api/data-storage.ts:1,22`)**: `fetchFilesByKey` recebe `IndexableType` do Dexie (`string | number | Date | ...`). O adapter `SqliteBackend` normaliza `Date` para `i64` e aceita `string | number | boolean`.
- **Nomenclatura**: comandos Rust em `src-tauri/src/commands/db.rs` com prefixo `db_*`, argumentos `snake_case` em Rust mapeados automaticamente para `camelCase` pelo Tauri 2 (`docs/tauri-masonry.md:11-13`).

### 3.2 Tabela de Mapeamento de Comandos

| Método `DataStorage` / `DataBackup` | Comando Tauri | Argumentos Rust | Retorno Rust | Paginação / Streaming |
| :--- | :--- | :--- | :--- | :--- |
| `Backend.init` | `db_init` | `db_path: Option<String>` | `DbInitInfo { migrated: bool, schema_version: u32 }` | N/A — abre conexão, aplica migrations e garante `root` tag (`backend.ts:51-63`) |
| `fetchTags()` | `db_fetch_tags` | `()` | `Vec<TagWireDTO>` | Direto — tabela pequena (<2k linhas) |
| `fetchFiles(order, fileOrder)` | `db_fetch_files_stream` e `db_fetch_files_page` | `order: OrderByField`, `direction: OrderDirectionWire`, `on_chunk: Channel<Vec<FileWireDTO>>` (ou `limit: Option<u32>`, `offset: Option<u32>`) | `QuerySummary { total_count: u64 }` (stream) ou `PagedFiles { items: Vec<FileWireDTO>, total_count: u64 }` | **Sim — `Channel` em chunks de 2.000**; suporta `limit/offset` para paginação futura |
| `fetchFilesByID(ids)` | `db_fetch_files_by_id` | `ids: Vec<String>` | `Vec<FileWireDTO>` | Chunking interno no SQL em blocos de `900` binds (`SQLITE_MAX_VARIABLE_NUMBER`) |
| `fetchFilesByKey(key, value)` | `db_fetch_files_by_key` | `key: FileKeyField`, `value: WireValue` | `Vec<FileWireDTO>` | `Channel` opcional se `key = locationId` ultrapassar 2.000 linhas |
| `fetchLocations()` | `db_fetch_locations` | `()` | `Vec<LocationWireDTO>` | Direto — tabela pequena |
| `fetchSearches()` | `db_fetch_searches` | `()` | `Vec<FileSearchWireDTO>` | Direto — tabela pequena |
| `searchFiles(criteria, order, fileOrder, matchAny)` | `db_search_files_stream` e `db_search_files_page` | `criteria: Vec<SearchConditionWire>`, `order: OrderByField`, `direction: OrderDirectionWire`, `match_any: bool`, `on_chunk: Channel<Vec<FileWireDTO>>` | `QuerySummary { total_count: u64 }` | **Sim — `Channel` em chunks de 2.000**; suporta `limit/offset` |
| `createTag(tag)` | `db_create_tag` | `tag: TagWireDTO` | `()` | N/A |
| `createFilesFromPath(path, files)` | `db_create_files_from_path` | `path: String`, `files: Vec<FileWireDTO>` | `()` | **Chunking em lotes de 2.000** no `SqliteBackend`; dedup por `absolute_path` e inserção em 1 transação por lote |
| `createLocation(location)` | `db_create_location` | `location: LocationWireDTO` | `()` | N/A |
| `createSearch(search)` | `db_create_search` | `search: FileSearchWireDTO` | `()` | N/A |
| `saveTag(tag)` | `db_save_tag` | `tag: TagWireDTO` | `()` | N/A — transação reconciliando `sub_tags` (`parent_id` + `sort_order`) |
| `saveFiles(files)` | `db_save_files` | `files: Vec<FileWireDTO>` | `()` | **Chunking em lotes de 2.000** no `SqliteBackend`; upsert `files` + sync de `file_tags` e `file_palette` em transação |
| `saveLocation(location)` | `db_save_location` | `location: LocationWireDTO` | `()` | N/A — transação atualizando `locations` e substituindo `sublocations` |
| `saveSearch(search)` | `db_save_search` | `search: FileSearchWireDTO` | `()` | N/A |
| `removeTags(ids)` | `db_remove_tags` | `tag_ids: Vec<String>` | `()` | Chunking de binds se >900 IDs; `ON DELETE CASCADE` limpa `file_tags` |
| `mergeTags(removed, kept)` | `db_merge_tags` | `tag_to_be_removed: String`, `tag_to_merge_with: String` | `()` | Transação única SQL (ver 3.3) |
| `removeFiles(ids)` | `db_remove_files` | `file_ids: Vec<String>` | `()` | Chunking em lotes de 900 IDs dentro de 1 transação |
| `purgeUnsupportedExtensions()` | `db_purge_unsupported_extensions` | `supported_extensions: Vec<String>` | `u64` (linhas removidas) | Executado 100% em SQL (`DELETE ... RETURNING` / `changes()`), sem trafegar 150k registros |
| `removeLocation(id)` | `db_remove_location` | `location_id: String` | `()` | Transação atômica (`DELETE FROM files WHERE location_id = ?1; DELETE FROM locations WHERE id = ?1;`) |
| `removeSearch(id)` | `db_remove_search` | `search_id: String` | `()` | `ON DELETE CASCADE` limpa `saved_search_criteria` |
| `countFiles()` | `db_count_files` | `()` | `(u64, u64)` | Query SQL agregada direta (`COUNT(*)` e `NOT EXISTS` em `file_tags`) |
| `clear()` | `db_clear` | `()` | `()` | Fecha conexão, apaga `allusion.db` + `-wal`/`-shm`, reinicializa schema vazio |
| `DataBackup.backupToFile(path)` | `db_backup_to_file` | `path: String` | `()` | Streaming nativo em disco via `VACUUM INTO` (zero memória JS) |
| `DataBackup.restoreFromFile(path)` | `db_restore_from_file` | `path: String` | `()` | Validação + troca atômica da base em Rust |
| `DataBackup.peekFile(path)` | `db_peek_backup` | `path: String` | `(u64, u64)` | Abertura read-only em Rust (`num_tags`, `num_files`) |

### 3.3 Estratégia de Streaming, Paginação e Escrita em Lote

1. **Por que `Channel` no `SqliteBackend` sem quebrar `DataStorage`**:
   - Serializar 150k `FileWireDTO`s em um único payload JSON de resposta `invoke()` gera ~75–90 MB de JSON contíguo em Rust e pico simultâneo de parsing no WebView2.
   - Com `tauri::ipc::Channel<Vec<FileWireDTO>>`, o Rust executa a consulta SQL (`files` + carga em lote de `file_tags` e `file_palette` ordenada por `file_id, position`) e emite blocos de **2.000 arquivos**. O `SqliteBackend` acumula no array final para cumprir `Promise<FileDTO[]>` de `DataStorage`, reduzindo o pico de buffer de ~90 MB para ~1.5 MB por chunk.
2. **Pronto para paginação incremental na UI**:
   - Os comandos `db_fetch_files_page` e `db_search_files_page` já nascem aceitando `limit` e `offset`. Hoje `FileStore.updateFromBackend` (`FileStore.ts:486-489`) filtra `isHidden` tags e `MasonryNativeAdapter.compute` (`MasonryNativeAdapter.tsx:41-54`) exige o array completo de `{width, height}`; caso a Etapa 5 mostre necessidade de virtualizar também o `FileStore` para 150k+, a camada Rust não precisará ser refeita.
3. **Semântica exata de `db_merge_tags`**:
   ```sql
   BEGIN IMMEDIATE;
   INSERT OR IGNORE INTO file_tags (file_id, tag_id, position)
   SELECT file_id, ?2, position
   FROM file_tags
   WHERE tag_id = ?1;
   DELETE FROM file_tags WHERE tag_id = ?1;
   DELETE FROM tags WHERE id = ?1;
   COMMIT;
   ```
   Preserva a ordem aproximada, evita duplicatas pela PK `(file_id, tag_id)` (equivalente a `backend.ts:207-212`) e garante atomicidade.
4. **Semântica exata de `db_create_files_from_path(path, files)`**:
   - Em `backend.ts:285-291`, `createFilesFromPath` filtra arquivos cujo `absolutePath` já existe com prefixo `path`. Em SQLite (`absolute_path UNIQUE`), cada arquivo é inserido com `INSERT INTO files (...) VALUES (...) ON CONFLICT(absolute_path) DO NOTHING`, seguido de inserção de `file_tags` e `file_palette` apenas para os IDs efetivamente inseridos.

---

## 4. Tradução dos Operadores de `search-criteria` para SQL

Todas as condições recebidas por `db_search_files_*` são combinadas com `AND` quando `match_any = false` e com `OR` quando `match_any = true`, sempre entre parênteses individuais `(cond_1) OP (cond_2)`. Colunas permitidas são validadas por `enum` estrito em Rust (`name`, `absolute_path`, `description`, `extension`, `location_id`, `ino`, `size`, `width`, `height`, `rating`, `duration`, `date_added`, `date_modified`, `date_created`, `date_last_indexed`).

### 4.1 Busca por Tags e CTE Recursiva

Hoje `ClientTagSearchCriteria.serialize` (`src/frontend/entities/SearchCriteria.ts:151-177`) expande `containsRecursively` e `containsNotRecursively` em JS usando `tag.getSubTree()` antes de chamar `DataStorage.searchFiles`. Para suportar tanto o contrato atual quanto queries recursivas diretas no Rust (ex.: `FEAT-Busca-Unificada` ou avaliação direta de `SearchCriteria`):

1. **CTE recursiva para descendentes com trava de ciclo (`MAX_TAG_DEPTH = 32`, `common/config.ts:8`)**:
   ```sql
   WITH RECURSIVE target_tags(id, depth) AS (
     SELECT id, 0 FROM tags WHERE id IN (?1, ...)
     UNION ALL
     SELECT t.id, tt.depth + 1
     FROM tags t
     JOIN target_tags tt ON t.parent_id = tt.id
     WHERE tt.depth < 32
   )
   ```
2. **Tabela de operadores de Tag**:

| Operador (`TagOperatorType` / `ArrayOperatorType`) | Valor | Tradução SQL na Tabela `files f` | Observações |
| :--- | :--- | :--- | :--- |
| `contains` | `[]` (vazio) | `NOT EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id)` | Arquivos sem tags (`FileStore.ts:265`, `backend.ts:415`) |
| `notContains` | `[]` (vazio) | `EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id)` | Arquivos com pelo menos 1 tag (`backend.ts:417`) |
| `contains` | `[id1, ...]` | `EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id AND ft.tag_id IN (?...))` | Match em qualquer tag da lista (`backend.ts:421`) |
| `notContains` | `[id1, ...]` | `NOT EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id AND ft.tag_id IN (?...))` | Garante que nenhuma tag proibida exista no arquivo (`backend.ts:425-426`) |
| `containsRecursively` | `[id1, ...]` | `EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id AND ft.tag_id IN (SELECT id FROM target_tags))` | Usa CTE recursiva acima; se `[]`, equivale a `contains []` |
| `containsNotRecursively` | `[id1, ...]` | `NOT EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id AND ft.tag_id IN (SELECT id FROM target_tags))` | Usa CTE recursiva acima; se `[]`, equivale a `notContains []` |

### 4.2 Operadores de String

**Atenção ao comportamento com `NULL` em `description`**: em SQL, `NULL != 'x'` avalia para `UNKNOWN` (falso), enquanto `backend.ts:483-493` normaliza `(t[key] ?? '')`. Logo, campos nullable como `description` devem usar `COALESCE(f.description, '')` em operadores negativos.

**Atenção a `COLLATE NOCASE` e Unicode**: o `COLLATE NOCASE` e `LIKE` nativos do SQLite dobram apenas ASCII (`A–Z`). Registraremos funções escalares Unicode via `rusqlite::Connection::create_scalar_function` (`u_lower(s)`, `u_contains_ci(haystack, needle)`, `u_starts_with_ci(haystack, prefix)`) usando `str::to_lowercase()` em Rust, mantendo caminhos de faixa B-tree quando o prefixo for ASCII ou `BINARY`.

| Operador (`data-storage-search.ts:63-72`) | Tradução SQL | Uso de Índice e Nuances |
| :--- | :--- | :--- |
| `equals` | `COALESCE(f.<col>, '') = ?1` | Usa índice `BINARY` direto (com `extension`, `location_id`, `ino`, `absolute_path`, `name`). |
| `equalsIgnoreCase` | `f.<col> = ?1 COLLATE NOCASE` (ou `u_lower(COALESCE(f.<col>, '')) = u_lower(?1)`) | Usa `idx_files_name_nocase` quando `<col> = name`; fallback com `u_lower` garante Unicode. |
| `notEqual` | `COALESCE(f.<col>, '') != ?1` | `COALESCE` garante que `description IS NULL` retorne `TRUE` para `notEqual 'foo'`. |
| `startsWith` | `COALESCE(f.<col>, '') >= ?1 AND COALESCE(f.<col>, '') < ?2` (limite superior calculado em Rust no último codepoint) | **Usa B-tree em `absolute_path` e evita bug de `GLOB`/`LIKE` com `[` ou `%` em nomes de pasta no Windows!** |
| `startsWithIgnoreCase` | `u_starts_with_ci(COALESCE(f.<col>, ''), ?1) = 1` (ou `LIKE` com escape para ASCII) | Seguro contra `%`, `_`, `[` e funciona para Unicode. |
| `notStartsWith` | `u_starts_with_ci(COALESCE(f.<col>, ''), ?1) = 0` | Case-insensitive conforme `backend.ts:492-493`. |
| `contains` | `u_contains_ci(COALESCE(f.<col>, ''), ?1) = 1` | Equivale a `.toLowerCase().includes(valLow)` (`backend.ts:487`), sem falsos wildcards de `LIKE`. |
| `notContains` | `u_contains_ci(COALESCE(f.<col>, ''), ?1) = 0` | Arquivos sem `description` (`NULL`) dão match em `notContains` (`description-search.test.ts:52-64`). |

### 4.3 Operadores Numéricos

Aplicados a `size`, `width`, `height`, `rating` e `duration`. Seguindo `backend.ts:528-538` (`(t[key] ?? 0)`), colunas nullable (`duration`) usam `COALESCE(f.duration, 0.0)`.

| Operador (`data-storage-search.ts:53-60`) | Tradução SQL |
| :--- | :--- |
| `equals` | `COALESCE(f.<col>, 0) = ?1` |
| `notEqual` | `COALESCE(f.<col>, 0) != ?1` |
| `smallerThan` | `COALESCE(f.<col>, 0) < ?1` |
| `smallerThanOrEquals` | `COALESCE(f.<col>, 0) <= ?1` |
| `greaterThan` | `COALESCE(f.<col>, 0) > ?1` |
| `greaterThanOrEquals` | `COALESCE(f.<col>, 0) >= ?1` |

### 4.4 Operadores de Data

Em `backend.ts:545-573`, comparações de data operam por **dia inteiro local** (`00:00:00.000` até `23:59:59.999`). A função em Rust converte o timestamp recebido para `[day_start_ms, day_end_ms]` no fuso local (corrigindo inclusive o bug do operador `equals` em `filterDateLambda` no `backend.ts:584` que usava `||` em vez de `&&`).

| Operador | Tradução SQL em `f.<col>` (ms Unix) |
| :--- | :--- |
| `equals` | `f.<col> >= ?day_start AND f.<col> <= ?day_end` |
| `notEqual` | `f.<col> < ?day_start OR f.<col> > ?day_end` |
| `smallerThan` | `f.<col> < ?day_start` |
| `smallerThanOrEquals` | `f.<col> <= ?day_end` |
| `greaterThan` | `f.<col> > ?day_end` |
| `greaterThanOrEquals` | `f.<col> >= ?day_start` |

### 4.5 Operadores de Cor

Aplicados a `key = 'palette'` com `value` igual ao ID de cor fixa (`'red'`, `'blue'`, etc. em `common/color.ts:18-31`). Arquivos sem paleta não possuem linhas em `file_palette`.

| Operador (`data-storage-search.ts:78-79`) | Tradução SQL |
| :--- | :--- |
| `contains` | `EXISTS (SELECT 1 FROM file_palette fp WHERE fp.file_id = f.id AND fp.color_id = ?1)` |
| `notContains` | `NOT EXISTS (SELECT 1 FROM file_palette fp WHERE fp.file_id = f.id AND fp.color_id = ?1)` |

Com `idx_file_palette_color_id`, ambos os operadores evitam varredura linear na tabela `files` e reproduzem exatamente os testes de `tests/color-filter.test.ts:84-138` (incluindo string vazia `''` retornando 0 matches em `contains` e todos em `notContains`).

### 4.6 Ordenação SQL via `ORDER BY`

Mapeamento de `OrderBy<FileDTO>` (`src/backend/backend.ts:72-86`, `src/frontend/containers/AppToolbar/Menus.tsx:53-68`):

- `name` → `ORDER BY f.name COLLATE NOCASE ASC|DESC, f.id ASC`
- `absolutePath` → `ORDER BY f.absolute_path ASC|DESC`
- `extension` → `ORDER BY f.extension ASC|DESC, f.name COLLATE NOCASE ASC`
- `size` → `ORDER BY f.size ASC|DESC, f.id ASC`
- `dateAdded` → `ORDER BY f.date_added ASC|DESC, f.id ASC`
- `dateModified` → `ORDER BY f.date_modified ASC|DESC, f.id ASC`
- `dateCreated` → `ORDER BY f.date_created ASC|DESC, f.id ASC`
- `dateLastIndexed`, `width`, `height`, `rating`, `duration`, `ino`, `locationId`, `relativePath`, `id`, `description` → coluna correspondente `ASC|DESC`
- `random` → `ORDER BY RANDOM()` (ou embaralhamento Fisher-Yates em Rust se `ORDER BY RANDOM()` competir com `Channel` chunked)

---

## 5. Migração Dexie para SQLite no Primeiro Boot

### 5.1 Restrição Arquitetural

O IndexedDB (`DB_NAME = 'Allusion'` em `src/backend/config.ts:7`) fica armazenado em formato interno proprietário do WebView2 (Chromium LevelDB/Blob) dentro da pasta de dados do WebView. O Rust **não** deve tentar ler arquivos LevelDB do WebView2 diretamente. A leitura acontece no processo renderer via Web APIs (`Dexie` / `indexedDB`) e a gravação acontece em lotes via `invoke()` no Rust.

### 5.2 Fluxo Passo a Passo no Boot

1. **Verificação inicial em Rust (`db_init`)**:
   - Localiza `<app_data_dir>/allusion.db` (via `app_handle.path().app_data_dir()`).
   - Se `allusion.db` existir e `app_meta['dexie_migration_state'] = 'completed'`, o app abre o SQLite normalmente sem tocar no IndexedDB.
   - Se `allusion.db` ainda não existir (ou `dexie_migration_state != 'completed'`):
     - O frontend verifica se existe um IndexedDB `'Allusion'` populado usando `await indexedDB.databases()` (suportado nativamente no WebView2/Chromium — evita criar um IndexedDB vazio para usuários novos). Caso não exista ou tenha 0 arquivos/locations/searches e no máximo 1 tag (`root`), Rust inicializa `allusion.db` vazio e marca `dexie_migration_state = 'skipped'`.
2. **Staging atômico para proteção contra falha**:
   - Enquanto migra um IndexedDB existente, o Rust escreve em um arquivo temporário `allusion.db.migrating` (em modo `WAL` ou `OFF` + `synchronous = OFF` durante a carga inicial em staging, alternando para `WAL` + `synchronous = NORMAL` ao finalizar!).
   - Se o banco tiver mais de 1.000 arquivos, a UI chama `RendererMessenger.initialized()` exibindo uma tela simples de progresso ("Migrando biblioteca para SQLite: X / Y arquivos") antes do timeout de 15s da janela oculta em `src-tauri/src/lib.rs:47`.
3. **Leitura paginada do IndexedDB sem estourar memória**:
   - **Proibido chamar `files.toArray()`** (causa o travamento/OOM acima de 80 MB / 120k arquivos).
   - Ordem da migração:
     1. **Lote de metadados (`db_migrate_metadata`)**: lê `locations`, `tags` e `searches` (tabelas pequenas) via `db.table(...).toArray()` e envia em 1 chamada IPC. Rust grava `locations`, `sublocations`, `tags` (resolvendo `parent_id` + `sort_order` a partir de `subTags`), `saved_searches` e `saved_search_criteria` em 1 transação.
     2. **Lotes de arquivos (`db_migrate_files_batch`)**:
        - Em JS, lê `files` com **keyset pagination** sobre a chave primária (UUID `id`), **sem manter transação IDB aberta durante `await invoke()`** (evita `TransactionInactiveError`):
          ```ts
          let lastId: string | undefined = checkpointId;
          while (true) {
            const batch = lastId === undefined
              ? await filesTable.orderBy(':id').limit(1000).toArray()
              : await filesTable.where(':id').above(lastId).limit(1000).toArray();
            if (batch.length === 0) break;
            await invoke('db_migrate_files_batch', { files: serializeBatch(batch) });
            lastId = batch[batch.length - 1].id;
          }
          ```
        - Nota sobre `:id` em `Dexie`: no `config.ts:25,80,107,126`, a primary key é `'++id'` com strings UUID v4 (`id.ts:5`). Caso algum registro antigo possua `id` numérico (legado pré-UUID), `String(id)` ou iteração via cursor nativo `IDBObjectStore.openCursor(range)` com `IDBKeyRange.lowerBound(lastRawKey, true)` preserva exatamente a ordem de tipos mistos do IndexedDB. **Recomenda-se usar cursor nativo `openCursor` por lotes de 1.000 chaves** encerrando a transação IDB a cada lote e guardando `lastRawKey`.
4. **Idempotência**:
   - Dentro de `db_migrate_files_batch`, cada lote roda em transação única usando:
     - `INSERT INTO files (...) VALUES (...) ON CONFLICT(id) DO UPDATE SET ...` (ou `ON CONFLICT(absolute_path) DO NOTHING` caso haja inconsistência prévia);
     - Pré-filtragem de `file_tags`: ignora `tag_id` que não exista em `tags` (limpa ponteiros fantasmas de crashes antigos no Dexie antes da FK);
     - `INSERT OR IGNORE INTO file_tags ...` e `INSERT OR REPLACE INTO file_palette ...`;
     - Atualiza `app_meta['dexie_last_key']` na mesma transação.
5. **Finalização, Verificação e Backup Intacto**:
   - Ao final dos lotes, `db_migrate_finalize` compara contagens (`COUNT(*)` de `files`, `tags`, `locations`, `saved_searches`), executa `PRAGMA quick_check`, troca `journal_mode = WAL`, grava `dexie_migration_state = 'completed'` e `dexie_migrated_at`, fecha `allusion.db.migrating` (removendo `-wal`/`-shm` temporários) e promove atomicamente via `fs::rename` para `allusion.db`.
   - **O banco IndexedDB `'Allusion'` permanece 100% intacto como backup passivo**, sem `Dexie.delete()`.
6. **Rollback em caso de falha**:
   - Se qualquer lote falhar, o rename para `allusion.db` **não** ocorre. O arquivo `allusion.db.migrating` é removido (ou mantido se retomável conforme decisão), o IndexedDB original permanece intacto e a UI exibe diálogo claro com opção de tentar novamente (sem perder dados nem corromper estado).

---

## 6. Backup, Restore e Versionamento do Schema

### 6.1 Substituição de `dexie-export-import`

Hoje `BackupScheduler` (`src/backend/backup-scheduler.ts:106-140`) usa `exportDB` (gera um JSON monolítico em RAM e passa byte-a-byte via array JS para `fs-shim.js:72-87`!) e `importDB`. Em 150k arquivos isso estoura memória e bloqueia o WebView.

**Novo mecanismo nativo Rust (`SqliteBackupScheduler` implementando `DataBackup`)**:
- **Agendamento**: mantém a lógica de `AUTO_BACKUP_TIMEOUT = 10 min` (`config.ts:11`), `NUM_AUTO_BACKUPS = 6` (`config.ts:9`) e rotação `auto-backup-0..5.db`, `daily.db`, `weekly.db` (`backup-scheduler.ts:78-100`). A rotina roda em background no Rust (`spawn_blocking`) sem travar a UI.
- **`backupToFile(path)` → `db_backup_to_file(path)`**:
  - Executa `VACUUM INTO '<path>.tmp'` na conexão SQLite ativa e renomeia atomicamente `<path>.tmp` → `<path>`.
  - Vantagens: funciona online em modo `WAL` sem bloquear leituras, gera um único arquivo `.db` consistente e compactado (sem `-wal`/`-shm`), usa zero memória no WebView2 e leva ~200–600ms para ~50 MB.
- **`peekFile(path)` → `db_peek_backup(path)`**:
  - Detecta o formato pelo cabeçalho mágico:
    - Se começar com `"SQLite format 3\0"`: abre somente-leitura (`SQLITE_OPEN_READ_ONLY`), valida presença das tabelas `files` e `tags`, e retorna `[num_tags, num_files]` via `SELECT (SELECT COUNT(*) FROM tags), (SELECT COUNT(*) FROM files)`.
    - Se começar com `{` (JSON legado de `dexie-export-import` para retrocompatibilidade na UI `ImportExport.tsx:74`): lê em streaming/buffer no Rust (`serde_json`) extraindo `data.tables` (`tags.rowCount`, `files.rowCount`) exatamente como `backup-scheduler.ts:134-138`.
- **`restoreFromFile(path)` → `db_restore_from_file(path)`**:
  - **Validação prévia em staging**: copia o backup (ou converte o `.json` legado para um SQLite temporário `allusion.db.restore-staging`), roda `PRAGMA quick_check`, valida tabelas obrigatórias e aplica eventuais schema migrations pendentes até a versão atual do app.
  - **Swap atômico**: sob lock exclusivo do gerenciador de conexão (`DbState`), fecha todas as conexões abertas em `allusion.db`, faz `fs::rename(allusion.db → allusion.db.pre-restore)` (removendo `-wal`/`-shm` antigos), `fs::rename(restore-staging → allusion.db)`, reabre a conexão, remove `.pre-restore` após sucesso e retorna para o frontend disparar `RendererMessenger.reload()` (`ImportExport.tsx:100`). Se a reabertura falhar, restaura `allusion.db.pre-restore`.

### 6.2 Versionamento de Schema e Migrations

- Controle duplo: `PRAGMA user_version` (verificação O(1) no header do arquivo) + tabela `schema_migrations(version, name, applied_at)` para auditoria.
- Lista imutável de migrations em Rust (`src-tauri/src/db/migrations.rs`):
  - `v1_initial`: cria todo o schema especificado na Seção 2.2 (equivalente consolidado às versões v4–v10 do Dexie em `src/backend/config.ts:17-138`).
  - Futuras: `v2_collections` (`FEAT-Grupos-Colecoes`), `v3_fts5` (`FEAT-Busca-Unificada`), `v4_embeddings` (`FEAT-Busca-Semantica-Local`).
- Cada migration executa dentro de uma transação `BEGIN IMMEDIATE ... COMMIT`, atualiza `schema_migrations` e `PRAGMA user_version = <N>` atomicamente antes de liberar o `DbState` para qualquer comando Tauri. Em erro, o SQLite faz `ROLLBACK` automático e aborta a inicialização com mensagem explícita ao usuário.

---

## 7. Plano de Benchmark para 150k Arquivos

Seguindo o padrão já existente no repositório (`scripts/bench/boot-ram.ps1`, `scripts/bench/indexing.ps1`, `src-tauri/examples/bench_scan.rs` e `docs/baseline-metrics.md`), o benchmark terá duas camadas complementares:

### 7.1 Gerador de Biblioteca Sintética de 150k Arquivos

- **Artefato**: `src-tauri/examples/bench_sqlite.rs` + runner `scripts/bench/sqlite-150k.ps1`.
- **Dados determinísticos (PRNG seed fixa `42`)**:
  - **5 locations** e **500 sublocations** aninhadas (profundidade até 4).
  - **300 tags** em árvore hierárquica (profundidade 1 a 4, 5% marcadas com `is_hidden = 1`, cores variadas).
  - **150.000 arquivos**:
    - Extensões distribuídas (`jpg` 55%, `png` 25%, `webp` 10%, `mp4` 5%, `psd` 3%, `exr` 2%);
    - Nomes realistas (`character_study_00421.jpg`, `ref_landscape_12904.png`, etc.);
    - `width`/`height` entre 512 e 4096, `size` entre 100 KB e 25 MB, `rating` `0..5`, `duration` em `mp4`, `description` em 30% das linhas (45k textos com 15–40 palavras estilo prompt);
    - **~525.000 linhas em `file_tags`** (média de 3,5 tags por arquivo; 10% = 15.000 arquivos sem tag);
    - **~540.000 linhas em `file_palette`** (4 cores em 90% dos arquivos).
  - **Modo E2E para Tauri App**: opção `--with-app-dir <dir>` grava `allusion.db` no diretório de dados de um perfil isolado de teste (sem sobrescrever a biblioteca real do desenvolvedor) e cria opcionalmente stubs no disco para medir boot real da UI com `Allusion.exe`.
  - **Comparação com Dexie**: gerador auxiliar JS/DevTools para popular o mesmo dataset em 10k, 50k, 100k e 150k no IndexedDB (registrando exatamente em que ponto/tamanho em MB o Dexie trava ou falha, conforme issue `#604`).

### 7.2 Métricas, Cenários e Metas

Execução: 1 warmup + 5 iterações por cenário em build `--release`, reportando `p50`, `p95` e `max`.

| Métrica | O que Medir | Como Medir | Meta Alvo para 150k |
| :--- | :--- | :--- | :--- |
| **1. Boot (Cold Start)** | Processo spawn → `app_initialized` + carga de `TagStore`, `LocationStore`, `SearchStore` | Estender `scripts/bench/boot-ram.ps1` (`BootToWindowMs`) + `performance.mark` em `src/renderer.tsx:38` | `< 2.5 s` (Rust DB init `< 50 ms`) |
| **2. Primeira Renderização** | `renderer-start` → `fetchAllFiles` + `updateFromBackend` + `MasonryNativeAdapter.compute` + `ui-ready` | `performance.measure` no renderer (`renderer.tsx:99-104`) + breakdown IPC vs JS/MobX vs Layout | Medir separado: IPC+SQLite `< 400 ms`; tempo total até `ui-ready` registrado em `docs/baseline-metrics.md` |
| **3. Busca por Tag** | (a) Tag folha (~500 hits), (b) Tag raiz via CTE recursiva (~40k hits), (c) Untagged (~15k hits), (d) 3 tags com `AND` e `OR` | Timer interno em `bench_sqlite.rs` (SQL puro) + `performance.measure` no `FileStore.fetchFilesByQuery()` | SQL puro `< 30 ms` (p95); roundtrip com UI `< 250 ms` |
| **4. Busca por Nome e Texto** | (a) `name contains "landscape"`, (b) `name startsWith "ref_"`, (c) `absolutePath startsWith "<subpasta>"`, (d) `description contains "watercolor"`, (e) combinada `tag + name + rating >= 4 + palette = blue` | Timer interno em `bench_sqlite.rs` + `performance.measure` no `FileStore.fetchFilesByQuery()` | Prefixos indexados `< 15 ms`; substring `contains` `< 80 ms` em 150k linhas |
| **5. Memória RAM** | Working Set e Private Bytes do processo `allusion.exe` + árvore completa (`msedgewebview2.exe`) | `Get-TreeMemoryMB` (`scripts/bench/boot-ram.ps1:32-54`) em idle pós-carga, após 5 buscas e após backup | Processo Rust `< 80 MB`; documentar consumo WebView2 para 150k `ClientFile`s vs baseline |

---

## 8. Riscos e Perguntas em Aberto

### 8.1 Riscos Técnicos Identificados no Código

1. **Gargalo residual no Renderer com 150k `ClientFile`s (MobX + `pathExists` em IPC + `MasonryNativeAdapter`)**:
   - Mesmo com SQLite respondendo em milissegundos, `FileStore.filesFromBackend` (`FileStore.ts:565-605`) instancia 150k objetos `ClientFile` (cada um criando uma MobX `reaction` em `File.ts:121-132`), `FileStore.updateFromBackend` (`FileStore.ts:522-547`) dispara 150k chamadas `fse.pathExists` via IPC (`get_file_info`), `LocationStore.watchLocations` (`LocationStore.ts:115`) e `FileStore.backfillPalettes` (`FileStore.ts:650`) buscam todos os 150k registros novamente no boot, e `MasonryNativeAdapter.compute` (`MasonryNativeAdapter.tsx:41-54`) envia 150k pares `{width, height}` via JSON.
   - *Mitigação*: usar `Channel` em chunks na Etapa 3 e instrumentar exatamente quanto tempo vai para SQLite vs WebView na Etapa 5; se o WebView2 ainda engasgar em 150k, abrir follow-up para paginação/virtualização de `FileStore` e verificação `pathExists` em lote no Rust.
2. **Race/Split-save na hierarquia de `tags` (`ClientTag.saveHandler`)**:
   - `ClientTag` (`Tag.ts:50-58`) salva pais independentemente após delay de 500ms, e `TagStore.create` (`TagStore.ts:94-95`) salva o filho antes do pai atualizar `subTags`. Relacionado ao bug aberto `FIX-Hierarquia-Tags-ao-Mover` (`#44`).
   - *Mitigação*: lógica defensiva de reconciliação em `db_save_tag` (Seção 2.3) + flush antes de fechar a janela.
3. **Perda de edições nos últimos 600ms ao fechar o app**:
   - `ClientFile` tem delay de 500ms (`File.ts:131`) e `FileStore.save` debounce de 100ms (`FileStore.ts:65`). Fechar a janela via `window_close` (`window.rs:16`) pode perder a última edição se não houver flush no `beforeunload`.
   - *Mitigação*: expor `flush()` síncrono/assíncrono no `FileStore`/`TagStore` no fechamento.
4. **Timeout de 15s da janela oculta durante migração Dexie de 150k arquivos**:
   - `src-tauri/src/lib.rs:47` força `window.show()` após 15s se o frontend ainda não chamou `app_initialized`.
   - *Mitigação*: chamar `RendererMessenger.initialized()` cedo se uma migração Dexie longa for detectada e exibir barra de progresso.
5. **Divergência histórica de case-sensitivity no Dexie e `DateAddedInput` UTC**:
   - No `backend.ts:469-493`, `filterStringWhere` era case-sensitive na 1ª condição e `filterStringLambda` era case-insensitive nas demais. Além disso, `DateAddedInput` (`Inputs.tsx:338`) passa `e.target.valueAsDate` (meia-noite UTC), enquanto `ClientDateSearchCriteria` (`SearchCriteria.ts:273`) usa meia-noite local.
6. **Contenção de escrita em `Mutex<Connection>` e WAL**:
   - Chamadas simultâneas (`saveFiles`, `searchFiles`, `backupToFile`).
   - *Mitigação*: pool com 1 conexão escritora (`Mutex<Connection>`) + conexões leitoras em `WAL` ou execução de queries dentro de `tokio::task::spawn_blocking` com `busy_timeout = 5000` e `wal_checkpoint(TRUNCATE)` antes de `restoreFromFile` / `clear`.
7. **Suíte de testes Jest acoplada a `fake-indexeddb` (`jest.config.js:7`)**:
   - `tests/backend.test.ts`, `tests/description-search.test.ts`, `tests/color-filter.test.ts`, `tests/rating.test.ts`, `tests/cleanup.test.ts` e `tests/tag-store.test.ts` testam a classe `Backend` sobre `fake-indexeddb`.
   - *Mitigação*: cobertura pesada de SQL, CTEs, migrations e migração/restore em `cargo test` (Etapa 2), mais testes Jest para `SqliteBackend` mockando `invoke()`.

### 8.2 Perguntas em Aberto para Decisão Antes da Etapa 2

1. **Paginação no `FileStore`**: Nesta entrega mantemos `DataStorage` retornando `FileDTO[]` completos via `Channel` streaming no Rust (UI intacta), ou já devemos aprovar um segundo card/etapa para paginação no `FileStore` + `pathExists` em lote no Rust caso o WebView2 continue lento com 150k `ClientFile`s em memória?
2. **Período de coexistência com Dexie**: Durante as Etapas 3–5, mantemos uma feature flag de fallback para o `Backend` Dexie (para comparação A/B e rollback rápido em uso real) ou removemos `dexie`/`dexie-export-import` imediatamente ao concluir a Etapa 5?
3. **Semântica de `equals` e `startsWith` em strings**: Devemos padronizar `equals` e `startsWith` em SQL como **case-sensitive** (mantendo `equalsIgnoreCase`/`startsWithIgnoreCase` explícitos como no seletor de `Inputs.tsx:368`) ou forçar **case-insensitive** em todo operador string (como fazia `filterStringLambda` no Dexie)?
4. **Unicidade de `absolute_path` no Windows**: A coluna `files.absolute_path` deve usar `COLLATE NOCASE` no Windows (evitando duplicatas quando o drive letter muda entre `c:\` e `C:\`) ou manter `BINARY` exato como no Dexie (`&absolutePath`)?
5. **Backups `.json` legados no `restoreFromFile`**: É necessário suportar importação/peek de arquivos `.json` antigos do `dexie-export-import` diretamente no `restore_from_file` (Etapa 5), ou o restore passa a aceitar apenas `.db`/`.sqlite` mantendo o IndexedDB intacto como segurança?
6. **Frequência e compressão de backups automáticos em 150k arquivos**: Um banco SQLite de 150k arquivos ocupará ~40–60 MB; manter 6 rotativos + `daily` + `weekly` (~400 MB) a cada 10 minutos via `VACUUM INTO` é aceitável ou devemos comprimir os backups (`.db.zst`/`.gz`) ou ampliar `AUTO_BACKUP_TIMEOUT`?
7. **Filtro de tags ocultas (`isHidden`) no SQL**: Hoje `FileStore.updateFromBackend` (`FileStore.ts:486-489`) filtra `isHidden` no JS. Podemos mover a exclusão de tags ocultas para o `WHERE` SQL (para que futuro `LIMIT/OFFSET` funcione com contagens exatas)?
8. **Foreign Key estrita em `files.location_id`**: Devemos exigir `FOREIGN KEY (location_id) REFERENCES locations(id)` no SQLite (exigindo ajuste dos testes como `tests/backend.test.ts:36` e saneamento de possíveis órfãos na migração) ou manter a integridade por transação em `db_remove_location` como proposto na Seção 2.3?

---

## 9. Revisão e Decisões (Claude, 2026-11-11)

RFC **aprovada** com os ajustes abaixo. Afirmações conferidas por amostragem no código: IDs UUID string (`src/api/id.ts`), bug `||` no `equals` de data (`backend.ts:584`), `removeTags` já recebe a subárvore inteira (`TagStore.ts:110,128`), merge só de tags sem filhos (`TagStore.ts:144`).

### 9.1 Ajustes no schema

- **`tags.parent_id` sem `ON DELETE CASCADE`**: o frontend já envia a subárvore completa em `removeTags`, então cascata não é necessária e, com a corrida de saves da Seção 2.3, poderia apagar tags em silêncio. Usar `REFERENCES tags(id) ON DELETE SET NULL`. Em `db_fetch_tags`, toda tag com `parent_id IS NULL` e `id <> 'root'` é reanexada como filha de `root` (no fim da lista), para nunca sumir da UI.
- **`files.absolute_path` continua `BINARY` + `UNIQUE`**, mas o Rust normaliza a letra do drive para maiúscula (`c:\` → `C:\`) em toda escrita e na migração. `COLLATE NOCASE` só dobra ASCII e mudaria a semântica de busca.
- Correção do `equals` de data (`||` → `&&`) mantida, com teste dedicado em `cargo test`.

### 9.2 Respostas às perguntas da Seção 8.2

1. **Paginação no `FileStore`**: fora deste card. Mantém `FileDTO[]` completo via `Channel`. Paginação/virtualização e `pathExists` em lote viram card próprio, decidido com os números da Etapa 5.
2. **Coexistência com Dexie**: sim, flag `localStorage['allusion.storage'] = 'sqlite' | 'dexie'` durante as Etapas 3–5 (padrão `sqlite` só a partir da Etapa 4). `dexie` continua como dependência porque a migração lê o IndexedDB; `dexie-export-import` sai ao fim da Etapa 5.
3. **Case-sensitivity**: `equals`, `notEqual`, `startsWith` = case-sensitive (o nome promete isso); `*IgnoreCase`, `contains`, `notContains`, `notStartsWith` = case-insensitive Unicode, como no Dexie hoje.
4. **`absolute_path`**: ver 9.1 (BINARY + normalização do drive).
5. **Backups `.json` legados**: sim, `peek` e `restore` aceitam `.json` antigo (todo backup existente do usuário está nesse formato). Prioridade baixa dentro da Etapa 5.
6. **Backups automáticos**: mantém 10 min e só quando houver mudança; reduz rotativos de 6 para 3 (+ daily + weekly). Sem compressão por enquanto.
7. **`isHidden` no SQL**: não agora; continua no JS. Reavaliar junto com o card de paginação.
8. **FK em `files.location_id`**: sem FK estrita; integridade por transação em `db_remove_location`. A migração conta e registra em log os arquivos órfãos, sem apagá-los.

### 9.3 Concorrência

Começar simples: 1 `Mutex<Connection>` escritora + 1 conexão leitora (WAL), queries em `spawn_blocking`. Pool só se o benchmark mostrar contenção.
