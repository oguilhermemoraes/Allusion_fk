# Mapa de Migração de Dependências: Electron 21 → Tauri 2

Este documento mapeia cada biblioteca e subsistema Node.js / Electron utilizado no Allusion v1.0.0-rc.10 para o seu equivalente nativo em Tauri 2 e Rust, visando ganho de performance e redução de footprint de memória.

---

## 1. Tabela de Mapeamento de Dependências

| Subsistema / Recurso | Stack Atual (Electron 21) | Stack Alvo (Tauri 2 / Rust) | Impacto / Estratégia |
| :--- | :--- | :--- | :--- |
| **App Shell / Runtime** | Electron 21 + Chromium bundled (~150MB) | Tauri 2 (OS native WebView) (~10-15MB) | Redução imediata de RAM em 50–70% e tempo de boot reduzido para <2s. |
| **File System Access** | `fs-extra` (Node.js) | `tauri-plugin-fs` + Rust `std::fs` | Substituição do I/O assíncrono JS por chamadas nativas em Rust (`tokio::fs`). |
| **File Watcher** | `chokidar` (no WebWorker `folderWatcher.worker.ts`) | `tauri-plugin-fs` watch / Rust `notify` crate | O monitoramento de diretórios roda nativamente em Rust sem overhead de event loop JS. |
| **EXIF Metadata (ExifTool)** | `node-exiftool` + `exiftool.exe` sidecar | `tauri-plugin-shell` (sidecar) ou Rust `kamadak-exif` crate | Leitura/escrita de metadados via sidecar do ExifTool ou parsing direto de imagens comuns em Rust. |
| **Comunicação IPC** | `comlink` + `ipcRenderer` / `ipcMain` | `invoke()` + Tauri Rust Commands | IPC serializada via JSON/MessagePack de alta velocidade entre React e Rust. |
| **Auto-Updater** | `electron-updater` | `tauri-plugin-updater` | Mecanismo de atualização nativo do Tauri com verificação de assinatura digital. |
| **Banco de Dados (IndexedDB)** | `dexie` 3 + `dexie-export-import` | Preservado em React (Fase 1-2) → `tauri-plugin-sql` (SQLite, Fase 3-4) | Manutenção do Dexie no frontend na transição inicial; migração opcional para SQLite nativo em Rust. |
| **Algoritmo Masonry (Layout)** | WASM em Rust (`wasm/wasm-build/masonry`) | Comando nativo Rust (`src-tauri/src/masonry.rs`) | Eliminação do overhead de interop WASM/JS; computação de coordenadas calculada diretamente em Rust. |
| **Decodificador EXR** | WASM em Rust (`wasm/wasm-build/exr-decoder`) | Comando nativo Rust (`src-tauri/src/exr.rs`) | Decodificação nativa de imagens OpenEXR para buffer PNG/RGBA diretamente no backend Rust. |

---

## 2. Estratégia por Módulo

### 2.1 File System e Watcher
- **Electron**: O `FileStore.ts` e `folderWatcher.worker.ts` utilizavam WebWorkers com `Comlink` e `chokidar` para escanear e monitorar pastas.
- **Tauri 2**: O escaneamento e monitoramento passam a ser executados em background por tarefas assíncronas do `tokio` em Rust. Eventos de alteração de arquivo enviam notificações via `app_handle.emit()` diretamente para o MobX store no frontend.

### 2.2 ExifTool (Sidecar)
- **Electron**: O `ExifIO.ts` executava a chamada do binário `exiftool.exe`/`exiftool.pl` empacotado no `extraResources` via `node-exiftool`.
- **Tauri 2**: Registra-se o `exiftool` como `externalBin` no `tauri.conf.json`. O backend Rust executa o sidecar nativamente via `tauri_plugin_shell::process::Command` ou utiliza o crate `kamadak-exif` para extração instantânea sem spawn de processo secundário para formatos padrão (JPEG/PNG).

### 2.3 IPC & State Synchronization
- **Electron**: IPC bidirecional utilizando `ipcRenderer` / `ipcMain`.
- **Tauri 2**: Chamadas síncronas/assíncronas do frontend React via `import { invoke } from '@tauri-apps/api/core'`. Notificações do backend via `import { listen } from '@tauri-apps/api/event'`.

---

## 3. Matriz de Riscos de Migração

| Risco Mapeado | Severidade | Mitigação |
| :--- | :--- | :--- |
| Incompatibilidade de caminhos no Windows (`C:\` vs URIs) | Média | Normalização rigorosa de caminhos via utilitários Rust `std::path::PathBuf`. |
| Perda de performance no envio de buffers de imagem via IPC | Alta | Utilização de custom protocol handlers (`asset://`) do Tauri para carregamento direto de imagens locais sem codificação Base64. |
| Bloqueio da UI durante leituras massivas de arquivos | Baixa | Execução de todas as tarefas I/O em thread pool assíncrona (`tokio::task::spawn_blocking`). |
