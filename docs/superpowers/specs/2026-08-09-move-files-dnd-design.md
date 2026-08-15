# Mover Arquivos entre Pastas via Drag-and-Drop — Design (#36)

**Data:** 2026-08-09
**Status:** Aprovado (design review) — pronto para plano de implementação

## Objetivo

Permitir mover arquivos (imagens já indexadas no Allusion) do **grid** para um **diretório no painel lateral** (LocationsPanel) via drag-and-drop, movendo fisicamente o arquivo no disco e sincronizando banco/thumbnails — **interno ao app apenas** (sem drag-out para o Sistema), reutilizando o pipeline de watcher/refetch já existente.

## Estado Atual (gaps identificados)

O drop-side já existe: `useFileDnD.ts` implementa `handleMove` (com diálogo Replace/Skip/Cancel), fallback `storeDroppedImage` para arquivos externos, e o feedback visual `data-dnd-target` (CSS em `outliner.scss:115`). `mergeMovedFile` (`File.ts:216`) e `removeThumbnail` (`FileStore.ts:408`) já estão prontos para reuso. **Dois gaps impedem o recurso de funcionar no Tauri:**

1. **Drag interno do grid não funciona:** `CommandDispatcher.dragStart` (`Commands.tsx:85`) chama `event.preventDefault()` e dispara `Selector.FileDragStart`, cujo handler chama `RendererMessenger.startDragExport(...)` — que é um **no-op no Tauri** (`renderer.ts:178`). Resultado: o drag HTML5 nativo é cancelado, o `dataTransfer` nunca é preenchido, e o drop do painel não reconhece os arquivos como "já no Allusion".
2. **`fse.move` não existe no shim:** `handleMove` chama `fse.move(src, dst, { overwrite: true })` (`useFileDnD.ts:98`), mas `fs-shim.js` não implementa `move` → lançaria `TypeError` no runtime Tauri. Falta um comando nativo `move_file` com fallback cross-drive.

## Design

### 1. Transporte da seleção: `dataTransfer` custom MIME (padrão das tags)

Reutiliza exatamente o mecanismo que as tags já usam (`DnDTagType` em `TreeItemDnD.ts:23`):

- **Novo tipo** em `src/frontend/contexts/TagDnDContext.ts`: `DnDFileType = 'application/x-allusion-files'`.
- **`CommandDispatcher`** passa a receber o `uiStore` no construtor (todos os call-sites possuem `uiStore` no escopo: `GalleryItem.tsx:35`, `ListItem.tsx`, `SlideMode/index.tsx`). Em `dragStart(event: DataTransferEvent)`:
  - `paths = uiStore.fileSelection.has(file) ? Array.from(uiStore.fileSelection, f => f.absolutePath) : [file.absolutePath]`
  - `event.dataTransfer.setData(DnDFileType, JSON.stringify(paths))`
  - `event.dataTransfer.effectAllowed = 'move'`
  - **remover `event.preventDefault()`** (atual `Commands.tsx:87`) — é ele que impede o drag HTML5 nativo de iniciar no WebView.
  - Manter o dispatch de `Selector.FileDragStart` (preserva o timestamp `(window as any).internalDragStart` usado pelo `DropContext` para suprimir overlay no arrasto interno).

### 2. Destino: leitura do tipo custom no drop

- `src/frontend/containers/Outliner/LocationsPanel/dnd.ts`:
  - `getDropData` ganha um caminho: se `e.dataTransfer.types` inclui `DnDFileType`, ler `getData(DnDFileType)` → `JSON.parse` → retornar a lista de paths (strings).
  - `isAcceptableType` / `onDragOver` / `handleDragLeave` passam a aceitar `DnDFileType` além de `Files`/`text/html`/`text/plain` (feedback visual reutilizado).
- `useFileDnD.ts` `handleDrop`: fluxo inalterado — `findDroppedFileMatches` casa os paths contra `fileStore.fileList` por `absolutePath`; se todos casam → `handleMove`; senão → `storeDroppedImage`.

### 3. Movimento físico: comando nativo `move_file`

- `src-tauri/src/commands/fs.rs`: novo comando
  ```rust
  #[tauri::command]
  pub fn move_file(src: String, dest: String) -> Result<(), String> {
      let src_b = PathBuf::from(&src);
      let dest_b = PathBuf::from(&dest);
      if let Some(parent) = dest_b.parent() {
          fs::create_dir_all(parent).map_err(|e| e.to_string())?;
      }
      match fs::rename(&src_b, &dest_b) {
          Ok(_) => Ok(()),
          Err(e) => {
              // Cross-device move: fallback copy + remove
              fs::copy(&src_b, &dest_b).map_err(|_| e.to_string())?;
              fs::remove_file(&src_b).map_err(|_| e.to_string())
          }
      }
  }
  ```
- Registrar em `src-tauri/src/lib.rs` (`invoke_handler`).
- `src/frontend/services/fs-shim.js`: implementar `move(src, dest)` via `invoke('move_file', { src, dest })` e incluir no objeto exportado (e em `promises`).

### 4. Sincronização pós-move (watcher + refetch)

- Sem mudança: após `move_file`, o `handleMove` já faz `setTimeout(() => fileStore.refetch(), 500)` (`useFileDnD.ts:156`).
- O watcher de pastas detecta create/remove e dispara o re-scan; `mergeMovedFile` preserva tags/description/palette. O fluxo Replace/Skip/Cancel e o delay de 1s para replace permanecem.

### 5. Escopo excluído

- **Sem undo** — apenas a confirmação Replace/Skip/Cancel existente.
- **Sem drag-out para o Explorer** — `startDragExport` continua no-op (cortado na #62).

## Testes

- **Unit (Rust):** `move_file` — mesmo volume usa `rename`; cross-device usa copy+remove (mocado/emulando) e cria diretório pai.
- **Unit (jest):** `getDropData` lê `DnDFileType` e retorna os paths; `isAcceptableType` aceita `DnDFileType`; `findDroppedFileMatches` casa por `absolutePath` (incluindo seleção múltipla: todos casam → move; um não casa → `storeDroppedImage`).
- **Regressão:** fluxo Replace/Skip/Cancel de `handleMove` com `fse.move` mockado.
- Sem mudança de schema Dexie (nenhum version bump).

## Arquivos afetados

- `src/frontend/contexts/TagDnDContext.ts` (novo `DnDFileType`)
- `src/frontend/containers/ContentView/Commands.tsx` (`dragStart` + construtor do dispatcher)
- `src/frontend/containers/ContentView/GalleryItem.tsx`, `ListItem.tsx`, `SlideMode/index.tsx` (passar `uiStore`)
- `src/frontend/containers/Outliner/LocationsPanel/dnd.ts` (`getDropData`, `isAcceptableType`, `onDragOver`, `handleDragLeave`)
- `src/frontend/containers/Outliner/LocationsPanel/useFileDnD.ts` (revisão mínima)
- `src/frontend/services/fs-shim.js` (`move`)
- `src-tauri/src/commands/fs.rs` (`move_file`)
- `src-tauri/src/lib.rs` (registrar comando)
- Testes: `tests/move-file-dnd.test.ts` (novo), testes Rust em `src-tauri`