# Arquitetura do Backend Tauri 2 (`src-tauri/`)

Este documento especifica a arquitetura interna do backend em Rust para a Fase 1 e Fase 2 da migração do Allusion, descrevendo a estrutura de diretórios, convenção de comandos, gerenciamento de estado e integração com a UI em React.

---

## 1. Estrutura de Diretórios Proposta (`src-tauri/`)

```text
src-tauri/
├── Cargo.toml                  # Cargo manifest com dependências do Tauri 2
├── tauri.conf.json             # Configurações do app, permissões, janelas e plugins
├── build.rs                    # Script de build nativo do Rust
├── icons/                      # Ícones da aplicação (icns, ico, png)
└── src/
    ├── main.rs                 # Entry point da aplicação Rust
    ├── lib.rs                  # Setup do Tauri Builder e registro de plugins/comandos
    ├── commands/               # Módulos de Comandos Tauri (Invocados pelo Frontend)
    │   ├── mod.rs
    │   ├── fs.rs               # Comandos de leitura/escrita e scan de diretórios
    │   ├── exif.rs             # Interop com ExifTool / parsing nativo de metadados
    │   ├── layout.rs           # Cálculo do algoritmo Masonry nativo em Rust
    │   └── exr.rs              # Decodificação de arquivos OpenEXR
    ├── services/               # Lógica de Negócio e Serviços Assíncronos
    │   ├── mod.rs
    │   ├── watcher.rs          # Monitor de arquivos em Rust (notify crate)
    │   └── scanner.rs          # Escaneamento multithreaded de imagens
    └── state.rs                # AppState gerenciado pelo Tauri (State<T>)
```

---

## 2. Padrão de Comunicação (IPC via Tauri Commands)

### 2.1 Padrão de Invocação (Frontend React → Rust)
Todas as operações de I/O e computação intensiva são exportadas via funções Rust marcadas com `#[tauri::command]`:

```rust
// Exemplo em src-tauri/src/commands/fs.rs
#[tauri::command]
pub async fn read_image_metadata(path: String) -> Result<ImageMetadata, String> {
    // Execução assíncrona sem bloquear a UI thread do React
    tokio::task::spawn_blocking(move || {
        services::exif::parse_file(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
```

No frontend React, a chamada é realizada sem abstrações complexas:
```typescript
import { invoke } from '@tauri-apps/api/core';

const metadata = await invoke<ImageMetadata>('read_image_metadata', { path: '/caminho/imagem.jpg' });
```

### 2.2 Notificações e Eventos (Rust → Frontend React)
Para eventos contínuos (como detecção de novos arquivos pelo watcher), o backend publica eventos no canal do Tauri:

```rust
// Em src-tauri/src/services/watcher.rs
app_handle.emit("file-changed", FileChangeEvent { path, kind })?;
```

No frontend MobX store:
```typescript
import { listen } from '@tauri-apps/api/event';

listen<FileChangeEvent>('file-changed', (event) => {
  fileStore.handleFileChange(event.payload);
});
```

---

## 3. Estratégia de Persistência e Banco de Dados

### 3.1 Transição Gradual (Dexie → SQLite)
1. **Fase 1 e Fase 2**: O frontend React continua utilizando **Dexie (IndexedDB)** nativamente dentro do WebView. Nenhuma alteração é necessária no schema do banco ou nas stores MobX (`FileStore`, `TagStore`, `LocationStore`).
2. **Fase 3 e Fase 4**: Avaliação do `tauri-plugin-sql` (SQLite nativo em Rust) para migração das coleções gigantes (>50.000 imagens), permitindo queries SQL indexadas com performance nativa diretamente em C/Rust.

---

## 4. Plugins Obrigatórios do Tauri 2

No `Cargo.toml` do `src-tauri`, os seguintes plugins oficiais do Tauri 2 serão integrados:
- `tauri-plugin-fs`: Manipulação segura de arquivos e diretórios locais.
- `tauri-plugin-shell`: Execução de sidecars externos (ExifTool).
- `tauri-plugin-dialog`: Abertura de diálogos nativos do SO para seleção de pastas.
- `tauri-plugin-updater`: Atualizações automáticas de versão.
- `tauri-plugin-window-state`: Restauração de posição e tamanho da janela principal.
