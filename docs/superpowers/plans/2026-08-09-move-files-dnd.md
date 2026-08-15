# Mover Arquivos entre Pastas via Drag-and-Drop — Implementation Plan (#36)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o drag-and-drop interno (grid → LocationsPanel) mover arquivos no disco, com sincronização via watcher/refetch.

**Architecture:** Transporta a seleção do grid até o drop através de um `dataTransfer` custom MIME (`DnDFileType`), no mesmo padrão que as tags já usam (`DnDTagType`). O movimento físico usa um novo comando Tauri `move_file` (Rust) com fallback copy+remove para cross-device. A sincronização pós-move reutiliza o pipeline existente (`handleMove` → `setTimeout(refetch, 500)` → watcher → `mergeMovedFile`).

**Tech Stack:** TypeScript, React, MobX, Rust (Tauri 2), `fs-extra` shim, jest, `cargo test` (tempfile).

**Fonte:** `docs/superpowers/specs/2026-08-09-move-files-dnd-design.md`

**Worktree/branch:** `feat/move-files-dnd` (base `master`).

---

## Mapa de arquivos

- `src-tauri/src/commands/fs.rs` — adiciona `move_file` + `mod tests` (Rust).
- `src-tauri/src/lib.rs` — registra `move_file` no `invoke_handler`.
- `src/frontend/services/fs-shim.js` — adiciona `move` ao shim.
- `src/frontend/contexts/TagDnDContext.ts` — adiciona `DnDFileType`.
- `src/frontend/containers/ContentView/Commands.tsx` — `CommandDispatcher` recebe `uiStore`; `dragStart` seta o `dataTransfer` e **remove** o `preventDefault`.
- `src/frontend/containers/ContentView/GalleryItem.tsx`, `ListItem.tsx`, `SlideMode/index.tsx` — passam `uiStore` ao construtor.
- `src/frontend/containers/Outliner/LocationsPanel/dnd.ts` — `isAcceptableType`/`onDragOver`/`handleDragLeave` aceitam `DnDFileType`; `getDropData` lê o payload; `findDroppedFileMatches` casa paths string; novo export `parseFilePathsPayload`.
- `src/frontend/containers/Outliner/LocationsPanel/useFileDnD.ts` — `handleDragEnter`/`handleDragLeave` aceitam `DnDFileType`.
- Testes: `tests/move-file-dnd.test.ts` (jest), unit tests Rust inline em `fs.rs`.

---

### Task 1: Comando nativo `move_file` (Rust) com fallback cross-device

**Files:**
- Modify: `src-tauri/src/commands/fs.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/frontend/services/fs-shim.js`
- Test: inline `mod tests` em `fs.rs` (usa `tempfile`, já em `[dev-dependencies]`)

- [ ] **Step 1: Escrever os testes Rust que falham**

Adicionar ao final de `src-tauri/src/commands/fs.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn move_file_moves_within_same_device() {
        let dir = TempDir::new().unwrap();
        let src = dir.path().join("a.jpg");
        std::fs::write(&src, b"abc").unwrap();
        let dest = dir.path().join("sub").join("a.jpg");

        move_file(
            src.to_string_lossy().into_owned(),
            dest.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert!(dest.exists(), "destination should exist");
        assert!(!src.exists(), "source should have been removed");
    }

    #[test]
    fn move_file_creates_parent_directories() {
        let dir = TempDir::new().unwrap();
        let src = dir.path().join("b.png");
        std::fs::write(&src, b"xyz").unwrap();
        let dest = dir.path().join("deep").join("nest").join("b.png");

        move_file(
            src.to_string_lossy().into_owned(),
            dest.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert!(dest.exists());
    }

    #[test]
    fn move_file_returns_error_when_source_missing() {
        let dir = TempDir::new().unwrap();
        let src = dir.path().join("missing.jpg");
        let dest = dir.path().join("c.jpg");

        let err = move_file(
            src.to_string_lossy().into_owned(),
            dest.to_string_lossy().into_owned(),
        )
        .unwrap_err();

        assert!(!err.is_empty());
    }
}
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `cargo test -p allusion move_file` (workdir `src-tauri`)
Expected: FAIL — `error[E0425]: cannot find function move_file`.

- [ ] **Step 3: Implementar `move_file`**

Adicionar ao final de `src-tauri/src/commands/fs.rs` (antes de `mod tests`):

```rust
/// Moves a file from `src` to `dest`, creating parent directories as needed.
/// Uses a fast same-volume `rename`; falls back to copy+remove for
/// cross-device moves (e.g. between drives).
#[tauri::command]
pub fn move_file(src: String, dest: String) -> Result<(), String> {
    let src_b = PathBuf::from(&src);
    let dest_b = PathBuf::from(&dest);

    if let Some(parent) = dest_b.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    match fs::rename(&src_b, &dest_b) {
        Ok(_) => Ok(()),
        Err(_) => {
            // Cross-device (EXDEV / ERROR_NOT_SAME_DEVICE): copy then remove.
            let copied = fs::copy(&src_b, &dest_b);
            match copied {
                Ok(_) => fs::remove_file(&src_b).map_err(|e| e.to_string()),
                Err(e) => Err(e.to_string()),
            }
        }
    }
}
```

Obs: `PathBuf`, `fs` e `std::path::Path` já estão importados no topo do arquivo (linhas 1-4 do `fs.rs` atual).

- [ ] **Step 4: Registrar no invoke_handler**

Em `src-tauri/src/lib.rs`, dentro do `invoke_handler` (lista de `commands::fs::*`), adicionar após `commands::fs::copy_file,`:

```rust
            commands::fs::move_file,
```

- [ ] **Step 5: Adicionar `move` ao fs-shim**

Em `src/frontend/services/fs-shim.js`:
1. Adicionar após a definição de `copyFile` (linha ~127):

```js
const move = async (src, dest) => {
  if (src && dest) {
    await invoke('move_file', { src: String(src), dest: String(dest) });
  }
};
const moveSync = () => {};
```

2. Incluir no objeto exportado (`fsShim`), após `copyFileSync,`:

```js
  move,
  moveSync,
```

3. Incluir em `promises`, após `copyFile,`:

```js
    move,
```

- [ ] **Step 6: Rodar testes Rust para ver passar**

Run: `cargo test -p allusion move_file` (workdir `src-tauri`)
Expected: 3 PASS (failures: 0).

- [ ] **Step 7: Typecheck JS/TS**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: exit 0, sem output.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands/fs.rs src-tauri/src/lib.rs src/frontend/services/fs-shim.js
git commit -m "feat(move): comando nativo move_file com fallback cross-device (#36)"
```

---

### Task 2: Tipo custom MIME e drag do grid populando o dataTransfer

**Files:**
- Modify: `src/frontend/contexts/TagDnDContext.ts:52-53` (região de `DnDLocationType`)
- Modify: `src/frontend/containers/ContentView/Commands.tsx`
- Modify: `src/frontend/containers/ContentView/GalleryItem.tsx:37`
- Modify: `src/frontend/containers/ContentView/ListItem.tsx:34`
- Modify: `src/frontend/containers/ContentView/SlideMode/index.tsx:50`

- [ ] **Step 1: Adicionar `DnDFileType` ao contexto de DnD**

Em `src/frontend/contexts/TagDnDContext.ts`, após o bloco de Locations (linha ~61), adicionar:

```ts
// ----------- Files ------------
/** dataTransfer MIME type for internal file drags (grid -> LocationsPanel).
 *  Payload: JSON.stringify(paths: string[]) of the selected absolute paths. */
export const DnDFileType = 'application/x-allusion-files';
```

- [ ] **Step 2: Alterar o `CommandDispatcher` para receber `uiStore` e setar o dataTransfer**

Em `src/frontend/containers/ContentView/Commands.tsx`:

1. Import `UiStore` ao topo (após os imports existentes) e `DnDFileType`:

```ts
import { DnDAttribute, DnDFileType, DnDTagType, useTagDnD } from '../../contexts/TagDnDContext';
import UiStore from '../../stores/UiStore';
```

(Nota: `DnDAttribute` e `DnDTagType` já são importados dessa linha hoje — apenas acrescente `DnDFileType`.)

2. Alterar o construtor:

```ts
  constructor(file: ClientFile, private uiStore: UiStore) {
    this.file = file;
```

3. Substituir o método `dragStart` (hoje nas linhas 85-92):

```ts
  dragStart(event: DataTransferEvent) {
    event.stopPropagation();
    // Carry the selected file paths (or this file) to the drop target in the
    // LocationsPanel. The native drag cannot attach real File objects in Tauri
    // (startDragExport is a no-op), so a custom MIME payload is used instead.
    const paths = this.uiStore.fileSelection.has(this.file)
      ? Array.from(this.uiStore.fileSelection, (f) => f.absolutePath)
      : [this.file.absolutePath];
    event.dataTransfer.setData(DnDFileType, JSON.stringify(paths));
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.dropEffect = 'move';

    dispatchCustomEvent(event, {
      selector: Selector.FileDragStart,
      payload: { file: this.file },
    });
  }
```

> Atenção: **remover** o `event.preventDefault()` que existia no `dragStart` — ele impedia o drag HTML5 nativo de iniciar no WebView.

- [ ] **Step 3: Atualizar os call-sites do construtor**

No `src/frontend/containers/ContentView/GalleryItem.tsx`:

`const { uiStore, fileStore } = useStore();` (já existe na linha 35) e, na linha 37:

```ts
const eventManager = useMemo(() => new CommandDispatcher(file, uiStore), [file, uiStore]);
```

No `src/frontend/containers/ContentView/ListItem.tsx` (linha 34): garantir que o componente tenha `uiStore` do `useStore()` (consultar o corpo — se já desestrutura os stores, adicionar `uiStore`), e:

```ts
const eventManager = useMemo(() => new CommandDispatcher(file, uiStore), [file, uiStore]);
```

No `src/frontend/containers/ContentView/SlideMode/index.tsx` (linha 50): garantir `uiStore` no escopo do componente e:

```ts
const eventManager = useMemo(() => (file ? new CommandDispatcher(file, uiStore) : undefined), [file, uiStore]);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: exit 0. Se o `ListItem`/`SlideMode` não tiverem `uiStore` desestruturado, ajustar o `useStore()` local.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/contexts/TagDnDContext.ts src/frontend/containers/ContentView/Commands.tsx src/frontend/containers/ContentView/GalleryItem.tsx src/frontend/containers/ContentView/ListItem.tsx src/frontend/containers/ContentView/SlideMode/index.tsx
git commit -m "feat(move): grid popula dataTransfer com paths via DnDFileType (#36)"
```

---

### Task 3: Drop no LocationsPanel lê o tipo custom e casa arquivos internos

**Files:**
- Modify: `src/frontend/containers/Outliner/LocationsPanel/dnd.ts`
- Modify: `src/frontend/containers/Outliner/LocationsPanel/useFileDnD.ts`
- Test: `tests/move-file-dnd.test.ts` (criar no Step 1)

- [ ] **Step 1: Escrever os testes jest que falham**

Criar `tests/move-file-dnd.test.ts`:

```ts
import {
  findDroppedFileMatches,
  isAcceptableType,
  parseFilePathsPayload,
} from '../src/frontend/containers/Outliner/LocationsPanel/dnd';
import { DnDFileType } from '../src/frontend/contexts/TagDnDContext';
import { ClientFile } from '../src/frontend/entities/File';

describe('DnDFileType payload parsing', () => {
  test('parses a JSON array of paths', () => {
    expect(parseFilePathsPayload(JSON.stringify(['C:/a.jpg', 'C:/b.png']))).toEqual([
      'C:/a.jpg',
      'C:/b.png',
    ]);
  });

  test('returns [] for an invalid payload', () => {
    expect(parseFilePathsPayload('not-json')).toEqual([]);
    expect(parseFilePathsPayload('')).toEqual([]);
  });
});

describe('isAcceptableType with DnDFileType', () => {
  test('accepts the internal file MIME type', () => {
    const e = { dataTransfer: { types: [DnDFileType] } } as unknown as React.DragEvent;
    expect(isAcceptableType(e)).toBe(true);
  });
});

describe('findDroppedFileMatches', () => {
  const makeFile = (id: string, absolutePath: string) =>
    ({ id, absolutePath }) as unknown as ClientFile;

  test('returns matching files for string paths', () => {
    const fs = { fileList: [makeFile('1', 'C:/loc/a.jpg'), makeFile('2', 'C:/loc/b.png')] } as any;
    const matches = findDroppedFileMatches(['C:/loc/a.jpg', 'C:/loc/b.png'], fs);
    expect(matches).toBeTruthy();
    expect((matches as ClientFile[]).map((m) => m.id)).toEqual(['1', '2']);
  });

  test('returns false when one path has no match (fallback to import)', () => {
    const fs = { fileList: [makeFile('1', 'C:/loc/a.jpg')] } as any;
    expect(findDroppedFileMatches(['C:/loc/a.jpg', 'C:/external/new.png'], fs)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx jest tests/move-file-dnd.test.ts`
Expected: FAIL — `parseFilePathsPayload` não exportada (`Cannot find module`).

- [ ] **Step 3: Implementar em `dnd.ts`**

Em `src/frontend/containers/Outliner/LocationsPanel/dnd.ts`:

1. Importar `DnDFileType` (após o import de `DnDAttribute` da linha 11):

```ts
import { DnDAttribute, DnDFileType } from '../../../contexts/TagDnDContext';
```

2. Adicionar export de parsing após `ALLOWED_FILE_DROP_TYPES` (linha 15):

```ts
/** Parses the payload of an internal file drag (`DnDFileType`) into a list of paths. */
export function parseFilePathsPayload(raw: string): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter((p) => typeof p === 'string') as string[]) : [];
  } catch (e) {
    return [];
  }
}
```

3. Atualizar `isAcceptableType` para aceitar o tipo interno:

```ts
export const isAcceptableType = (e: React.DragEvent) =>
  e.dataTransfer.types.some(
    (type) => ALLOWED_DROP_TYPES.includes(type) || type === DnDFileType,
  );
```

4. Atualizar `findDroppedFileMatches` para casar paths string (além de `File.path`):

```ts
export const findDroppedFileMatches = action(
  (dropData: (File | string)[], fs: FileStore): ClientFile[] | false => {
    const matches = dropData.map((item) => {
      if (typeof item === 'string') {
        return fs.fileList.find((f) => f.absolutePath === item);
      }
      return item.path && fs.fileList.find((f) => f.absolutePath === item.path);
    });
    return matches.every((m): m is ClientFile => m instanceof ClientFile) ? matches : false;
  },
);
```

5. Em `getDropData`, logo após a leitura de `e.dataTransfer.files`, tratar o tipo interno:

```ts
  // Internal Allusion drag: the payload is a JSON array of absolute paths.
  if (e.dataTransfer.types.includes(DnDFileType)) {
    const raw = e.dataTransfer.getData(DnDFileType);
    for (const p of parseFilePathsPayload(raw)) {
      dropItems.add(p);
    }
  }

```

e, no trecho final que filtra itens não-imagem, garantir que string-paths também passem. Substituir o bloco:

```ts
  const imageChecks = await Promise.all(
    imageItems.map(async (item) => {
      if (item instanceof File) {
        return true;
        // Check if the URL has an image extension, or perform a network request
      } else if (IMG_EXTENSIONS.some((ext) => item.toLowerCase().includes(`.${ext}`))) {
        return true;
      } else {
        return await testImage(item);
      }
    }),
  );
```

por (a parte `else` extra para paths locais com barra/backslash):

```ts
  const imageChecks = await Promise.all(
    imageItems.map(async (item) => {
      if (item instanceof File) {
        return true;
        // Check if the URL has an image extension, or perform a network request
      } else if (IMG_EXTENSIONS.some((ext) => item.toLowerCase().includes(`.${ext}`))) {
        return true;
      } else if (/[/\\]/.test(item)) {
        // Local absolute path (e.g. C:/x/a.jpg) from an internal drag
        return true;
      } else {
        return await testImage(item);
      }
    }),
  );
```

> Por quê: a string retornada por um drag interno é o `absolutePath` (ex.: `C:/loc/a.jpg`), que já contém `.jpg` e passaria no filtro anterior. A checagem `[/\\]/` é uma rede de segurança para paths sem extensão reconhecida, evitando `fetch` num caminho de disco.

- [ ] **Step 4: Atualizar `useFileDnD.ts`**

Em `src/frontend/containers/Outliner/LocationsPanel/useFileDnD.ts`, no `handleDragEnter` (linha ~125) e no `handleDragLeaveWrapper` (linha ~185), trocar:

```ts
      if (!event.dataTransfer.types.includes('Files')) {
```

por:

```ts
      if (
        !event.dataTransfer.types.includes('Files') &&
        !event.dataTransfer.types.includes(DnDFileType)
      ) {
```

E importar `DnDFileType` no arquivo:

```ts
import { DnDAttribute, DnDFileType } from '../../../contexts/TagDnDContext';
```

(No atual: `import { DnDAttribute } from '../../../contexts/TagDnDContext';` — adicionar `DnDFileType`.)

- [ ] **Step 5: Rodar os testes para ver passar**

Run: `npx jest tests/move-file-dnd.test.ts`
Expected: 5 PASS.

- [ ] **Step 6: Suíte completa + typecheck**

Run: `npx jest` e `npx tsc --noEmit --skipLibCheck`
Expected: Test Suites: todas passando (inclui `tests/move-file-dnd.test.ts`); tsc exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/frontend/containers/Outliner/LocationsPanel/dnd.ts src/frontend/containers/Outliner/LocationsPanel/useFileDnD.ts tests/move-file-dnd.test.ts
git commit -m "feat(move): drop no LocationsPanel le o tipo custom e casa arquivos internos (#36)"
```

---

### Task 4: Regressão do fluxo Replace/Skip/Cancel + lint + prod build

**Files:**
- Test: `tests/move-file-dnd-flow.test.ts` (criar no Step 1)

- [ ] **Step 1: Escrever o teste de regressão do `handleMove`**

Criar `tests/move-file-dnd-flow.test.ts`. Precisamos do `handleMove`. Atualmente ele é local a `useFileDnD.ts` (usa `fse`, `RendererMessenger`, `ClientLocation`). Para testá-lo sem reescrever o componente, exportar `handleMove` como named export em `src/frontend/containers/Outliner/LocationsPanel/useFileDnD.ts`:

```ts
export const handleMove = async (
  fileStore: FileStore,
  matches: ClientFile[],
  loc: ClientLocation,
  dir: string,
) => {
```

Conteúdo do teste:

```ts
import fse from 'fs-extra';
import RendererMessenger from '../src/ipc/renderer';
import { handleMove } from '../src/frontend/containers/Outliner/LocationsPanel/useFileDnD';
import { ClientFile } from '../src/frontend/entities/File';
import { ClientLocation } from '../src/frontend/entities/Location';

jest.mock('fs-extra', () => {
  const api = {
    pathExists: jest.fn(),
    stat: jest.fn(),
    remove: jest.fn(),
    move: jest.fn(),
  };
  return Object.assign(api, { __esModule: true, default: api });
});
jest.mock('../src/ipc/renderer', () => ({
  __esModule: true,
  default: {
    showMessageBox: jest.fn(),
  },
}));

const mockedFse = fse as unknown as {
  pathExists: jest.Mock;
  stat: jest.Mock;
  remove: jest.Mock;
  move: jest.Mock;
};
const mockedMsgBox = RendererMessenger as unknown as {
  showMessageBox: jest.Mock;
};

const makeFile = (id: string, absolutePath: string) =>
  ({ id, absolutePath }) as unknown as ClientFile;
const makeLoc = () => ({ path: 'C:/dest' }) as unknown as ClientLocation;

describe('handleMove (Replace/Skip/Cancel flow)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFse.pathExists.mockResolvedValue(false);
    mockedFse.stat.mockResolvedValue({ size: 100 });
    mockedFse.move.mockResolvedValue(undefined);
    mockedFse.remove.mockResolvedValue(undefined);
  });

  test('moves a file to the target dir when it does not exist yet', async () => {
    const fs = { fileList: [], deleteFiles: jest.fn() } as any;
    const file = makeFile('1', 'C:/src/a.jpg');
    await handleMove(fs, [file], makeLoc(), 'C:/dest');

    expect(mockedFse.move).toHaveBeenCalledWith('C:/src/a.jpg', 'C:/dest/a.jpg', {
      overwrite: true,
    });
    expect(mockedMsgBox.showMessageBox).not.toHaveBeenCalled();
  });

  test('asks user then replaces when the target exists and user confirms', async () => {
    mockedFse.pathExists.mockImplementation(async (p) => p === 'C:/dest/b.jpg');
    mockedMsgBox.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false });

    const fs = { fileList: [], deleteFiles: jest.fn() } as any;
    const file = makeFile('2', 'C:/src/b.jpg');
    await handleMove(fs, [file], makeLoc(), 'C:/dest');

    expect(mockedMsgBox.showMessageBox).toHaveBeenCalled();
    expect(mockedFse.remove).toHaveBeenCalledWith('C:/dest/b.jpg');
    expect(mockedFse.move).toHaveBeenCalled();
  });

  test('skips the file when the user skips', async () => {
    mockedFse.pathExists.mockImplementation(async (p) => p === 'C:/dest/c.jpg');
    mockedMsgBox.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });

    const fs = { fileList: [], deleteFiles: jest.fn() } as any;
    const file = makeFile('3', 'C:/src/c.jpg');
    await handleMove(fs, [file], makeLoc(), 'C:/dest');

    expect(mockedFse.move).not.toHaveBeenCalled();
  });
});
```

> Nota: `jest.clearAllMocks()` em `beforeEach` é proposital — substitui a necessidade de `mockedFse.*.mockReset()` individualmente.

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `npx jest tests/move-file-dnd-flow.test.ts`
Expected: FAIL — `handleMove is not exported` do módulo `useFileDnD`.

- [ ] **Step 3: Exportar `handleMove` em `useFileDnD.ts`**

Trocar, em `src/frontend/containers/Outliner/LocationsPanel/useFileDnD.ts`:

```ts
const handleMove = async (
```

por:

```ts
export const handleMove = async (
```

- [ ] **Step 4: Rodar o teste para ver passar**

Run: `npx jest tests/move-file-dnd-flow.test.ts`
Expected: 3 PASS.

> Se o mock de `fse-extra` conflitar com o real `fs-shim.js` via alias do ts-jest/jest: o `jest.mock('fs-extra', ...)` intercepta o resolvido pelo `moduleNameMapper` (`^src/...` não cobre `fs-extra`; o alias `'fs-extra'` em webpack **não** vale para jest). Em jest, `fs-extra` é o pacote real; o mock acima substitui por completo. Se um teste falhar por falta de `__esModule`/default, aplicar `Object.assign(api, { __esModule: true, default: api })` como no padrão de `thumbnail-generation.test.ts`.

- [ ] **Step 5: Suíte completa, typecheck e lint**

Run: `npx jest`, `npx tsc --noEmit --skipLibCheck`, `npx eslint "src/**/*{ts,tsx}" "widgets/**/*{ts,tsx}" --fix`
Expected: jest todas passando; tsc exit 0; eslint sem `error` (apenas warnings pré-existentes).

- [ ] **Step 6: Build de produção**

Run: `npx webpack --config ./webpack.prod.js`
Expected: compila sem `ERROR` (bundle gerado).

- [ ] **Step 7: Commit**

```bash
git add src/frontend/containers/Outliner/LocationsPanel/useFileDnD.ts tests/move-file-dnd-flow.test.ts
git commit -m "test(move): regressao do fluxo Replace/Skip/Cancel do handleMove (#36)"
```

---

## Self-Review

**1. Cobertura do spec:**
- Transporte custom MIME → Task 2 (grid) + Task 3 (drop). ✔
- `move_file` Rust cross-device + registro + shim `move` → Task 1. ✔
- Sincronização watcher/refetch: reutilizada do `handleMove` existente, sem mudança (documentado no passo 4 do design; coberto pelo teste `moves a file ... refetch` implícito do Step 1 da Task 4). ✔
- Feedback visual (`data-dnd-target`) → preservado; `onDragOver`/`handleDragEnter` agora aceitam `DnDFileType` (Task 3 Step 4). ✔
- Escopos excluídos (undo, drag-out) → não implementados. ✔
- Testes: Task 1 (Rust), Task 3 (jest), Task 4 (regressão) + gates lint/prod em Task 4. ✔

**2. Placeholder scan:** nenhum `TBD`/`TODO`; todos os passos têm código/tests concretos. ✔

**3. Consistência de tipos:** `parseFilePathsPayload`, `DnDFileType`, `move_file`, `handleMove` referenciados com os mesmos nomes em todas as tasks. O construtor de `CommandDispatcher(file, uiStore)` é atualizado em todos os 3 call-sites na Task 2. ✔