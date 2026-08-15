# Diretrizes para Agentes de Código (AI Coding Agents) — Allusion Next

Este documento define o contexto, a arquitetura, o fluxo de governança no GitHub e os procedimentos operacionais para qualquer agente de IA (Antigravity, Claude Code, Cursor, etc.) trabalhando neste repositório.

---

## 1. Visão Geral do Projeto

- **Nome**: Allusion Next (Fork de `allusion-app/Allusion`)
- **Repositório Fork**: `oguilhermemoraes/Allusion_fk`
- **Repositório Upstream**: `allusion-app/Allusion`
- **Objetivo**: Migração do **Electron 21 (EOL)** para o **Tauri 2 (Rust)**, melhorando significativamente o tempo de boot, o consumo de RAM (-50% a -70%) e o desempenho da biblioteca visual.

---

## 2. Stack Técnica

- **Frontend**: React 18 + MobX 6 + Dexie 3 (IndexedDB) + TypeScript 4.9.
- **Runtime**: **Tauri 2 (Rust)** — 100% do backend em comandos nativos, sem Electron. A camada de browser-only (WASM, node-exiftool, clipper web) foi removida.
- **Backend (Rust nativo)**: Comandos `invoke()` em `src-tauri/` + `tauri-plugin-fs`, `tauri-plugin-shell`, `tauri-plugin-dialog`, `tauri-plugin-window-state`.
- **Módulos Rust Nativos**: Algoritmo de layout `masonry`, decodificador `EXR`, thumbnails, scanner de pastas e leitura EXIF (`kamadak-exif`).
- **Shims de runtime**: `fs`/`path`/`os`/`stream`/`util`/`process` são emulados no renderer (o WebView do Tauri não tem Node.js); deps como `chokidar` e `node-stream-zip` os exigem.

---

## 3. Governança do Projeto no GitHub

O projeto utiliza **exclusivamente os recursos nativos do GitHub** para gerenciamento de backlog, tarefas e roadmap.

- **GitHub Project (Kanban)**: [Allusion Next (Project #2)](https://github.com/users/oguilhermemoraes/projects/2)
- **Colunas do Kanban**:
  1. `Backlog & Ideias Futuras` — Ideias e backlog geral de longo prazo.
  2. `Pronto pra Dev` — Tarefas priorizadas prontas para execução na fase atual.
  3. `Em Progresso` — Tarefas sendo desenvolvidas pelo Agente de Código.
  4. `Testando & Review` — Tarefas concluídas aguardando suíte de testes / revisão.
  5. `Concluído` — Tarefas finalizadas e incorporadas na branch principal.

- **Milestones**:
  - `Fase 0 — Discovery`: Mapeamento, baseline, RFC de arquitetura e CI.
  - `Fase 1 — Shell Tauri 2 (React Preservado)`: Substituição do Shell Electron pelo Tauri sem quebrar a UI.
  - `Fase 2 — Migração IPC e FileSystem`: Substituição de subsistemas Node.js/Electron por Rust. **Concluída** — runtime unificado Tauri-only (Fase 2.6, #63).
  - `Fase 3 — Otimização Nativa Rust (Masonry + EXR)`: Comandos Tauri nativos de alta performance.
  - `Fase 4 — Novas Features`: Busca semântica, tags, filtros avançados.

- **Labels Nativas**:
  - `type: feature` | `type: bug` | `type: tech-debt` | `type: research`
  - `area: tauri` | `area: rust` | `area: architecture` | `area: performance` | `area: ci-cd` | `area: frontend`
  - `status: ready` | `status: blocked`
  - `priority: p0` | `priority: p1`
  - `agent: gemini`

---

## 4. Como Acessar a API do GitHub (Autenticação do Agente)

Para criar ou atualizar Issues, Milestones e o Kanban via script ou chamadas HTTP:

1. A variável de ambiente `$env:GITHUB_TOKEN` ou um token PAT deve ser utilizada com cabeçalhos HTTP:
   ```json
   {
     "Authorization": "token <GITHUB_TOKEN>",
     "User-Agent": "Antigravity-Agent",
     "Accept": "application/vnd.github.v3+json"
   }
   ```
2. Scripts auxiliares para sincronização do Kanban e status estão salvos na pasta `.agents/scripts/`.

---

## 6. Regras de Ouro de Desenvolvimento para Agentes

1. **Migração Incremental**: NUNCA reescreva a aplicação inteira de uma só vez. Siga rigorosamente a ordem das Fases.
2. **Preservar a Interface React**: O frontend (`src/`) deve ser mantido 100% funcional enquanto o shell subjacente é adaptado.
3. **Sincronização com o Kanban**: Ao iniciar uma Issue, atualize seu status no GitHub Project para `Em Progresso`. Ao finalizar, envie um PR ou commit referenciando a Issue (`Closes #ID`), mova para `Testando & Review` (revisão do opencode) e, após aprovação, para `Concluído`.
4. **Sem Máfia de Simulação (Anti-Ghost Data)**: Nunca disfarce erros nem insira dados falsos no banco/arquivos. Verifique o código nativo.
5. **Documentação Integrada**: Sempre que uma alteração arquitetural for realizada, atualize os documentos correspondentes na pasta `docs/`.
6. **Zero IA Pesada ou APIs Pagas**: PROIBIDO adicionar recursos que dependam de chamadas a APIs pagas de IA ou execução de modelos de ML/LLM pesados localmente. O foco do Allusion Next é leveza extrema, baixo uso de CPU/RAM e utilitários nativos em Rust.
