# Scanner Multithread Rust (Tauri)

O serviço `scan_directory` (`src-tauri/src/services/scanner.rs`) e o comando `scan_library` (`src-tauri/src/commands/scanner.rs`) realizam a varredura concorrente e multithread de diretórios utilizando `walkdir` e a thread pool paralela do `rayon`.

## Metadados Coletados
Para cada arquivo correspondente ao filtro de extensoes (case-insensitive):
- `absolute_path`: caminho completo no sistema de arquivos.
- `size`: tamanho do arquivo em bytes (`u64`).
- `date_modified`: timestamp da ultima modificacao em milissegundos Unix.
- `date_created`: timestamp de criacao do arquivo em milissegundos Unix.
- `ino`: identificador de arquivo (inode em Unix, `absolute_path` no Windows).

## Frontend Integration
O metodo `watch(directory)` em `src/frontend/entities/Location.ts` invoca `scan_library` via `invoke` quando `isTauri()` for verdadeiro. Em Web (sem Tauri), mantem o mecanismo de fallback via `fse.readdir`.
