const https = require('https');

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("Erro: GITHUB_TOKEN não definido");
  process.exit(1);
}

const REPO_OWNER = 'oguilhermemoraes';
const REPO_NAME = 'Allusion_fk';
const PROJECT_ID = 'PVT_kwHOBuUPb84BfDJA';
const FIELD_ID = 'PVTSSF_lAHOBuUPb84BfDJAzhZY59I';

const STATUS_MAP = {
  'Backlog & Ideias Futuras': 'eba95faa',
  'Pronto pra Dev': '9104f855',
  'Em Progresso': 'ef15cceb',
  'Testando & Review': '8f265977',
  'Concluído': '25867901'
};

function githubApi(path, method, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'User-Agent': 'Antigravity-Agent',
        'Authorization': `bearer ${TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, res => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          resolve(responseData);
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function graphql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'api.github.com',
      port: 443,
      path: '/graphql',
      method: 'POST',
      headers: {
        'User-Agent': 'Antigravity-Agent',
        'Authorization': `bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.errors) reject(new Error(JSON.stringify(json.errors)));
          else resolve(json.data);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const NEW_ISSUES = [
  {
    title: "[Fase 1] Inicialização do Shell Tauri 2 com UI React Preservada",
    body: "## Objetivo\nCriar a infraestrutura do backend Rust em `src-tauri/` integrando o Tauri 2 como shell da aplicação desktop, mantendo a interface React 18 / TypeScript 100% funcional.\n\n## Checklist de Tarefas\n- [x] Criar `src-tauri/Cargo.toml` com dependências do Tauri 2\n- [x] Criar `src-tauri/tauri.conf.json` e ícones do aplicativo\n- [x] Criar `src-tauri/src/main.rs`, `src-tauri/src/lib.rs` e `src-tauri/build.rs`\n- [x] Atualizar `package.json` com scripts `tauri:dev` e `tauri:build`\n- [x] Validar compilação do Rust (`cargo check`) e build do frontend (`yarn production`)\n- [x] Garantir aprovação de 100% dos testes Jest (`yarn test`)",
    statusName: 'Concluído',
    state: 'closed',
    labels: ['type: feature', 'area: tauri', 'priority: p0', 'agent: gemini']
  },
  {
    title: "[Fase 2] Substituir File Watcher (chokidar -> Rust notify crate)",
    body: "## Objetivo\nSubstituir o `chokidar` no WebWorker pelo monitoramento nativo de diretórios em Rust utilizando o crate `notify` / `tauri-plugin-fs`.\n\n## Checklist de Tarefas\n- [ ] Implementar serviço de watcher assíncrono em `src-tauri/src/services/watcher.rs`\n- [ ] Publicar eventos `file-changed` via `app_handle.emit()`\n- [ ] Conectar escutador de eventos no frontend MobX (`FileStore.ts` / `LocationStore.ts`)\n- [ ] Remover dependência do `chokidar` e worker do Webpack",
    statusName: 'Pronto pra Dev',
    state: 'open',
    labels: ['type: feature', 'area: filesystem', 'area: rust', 'priority: p0', 'agent: gemini']
  },
  {
    title: "[Fase 2] Substituir I/O de Arquivos (fs-extra -> tauri-plugin-fs)",
    body: "## Objetivo\nSubstituir chamadas síncronas/assíncronas do `fs-extra` do Node.js por comandos nativos do Tauri 2 e operações assíncronas do Rust.\n\n## Checklist de Tarefas\n- [ ] Criar módulo `src-tauri/src/commands/fs.rs` com comandos de leitura/escrita e scan de diretórios\n- [ ] Implementar protocol handler customizado `asset://` para carregamento de imagens locais\n- [ ] Adaptar o `ImageLoader.ts` e `FileStore.ts` para usar `invoke()`",
    statusName: 'Pronto pra Dev',
    state: 'open',
    labels: ['type: feature', 'area: filesystem', 'area: tauri', 'priority: p0', 'agent: gemini']
  },
  {
    title: "[Fase 2] Migrar Integração com ExifTool Sidecar (tauri-plugin-shell)",
    body: "## Objetivo\nMigrar a leitura e escrita de metadados EXIF do `node-exiftool` para execução nativa de sidecar via `tauri-plugin-shell` ou parser nativo em Rust.\n\n## Checklist de Tarefas\n- [ ] Configurar `exiftool` como `externalBin` no `tauri.conf.json`\n- [ ] Criar módulo `src-tauri/src/commands/exif.rs` para invocação do sidecar\n- [ ] Atualizar `ExifIO.ts` para chamar os comandos do Tauri",
    statusName: 'Pronto pra Dev',
    state: 'open',
    labels: ['type: feature', 'area: rust', 'area: tauri', 'priority: p1', 'agent: gemini']
  },
  {
    title: "[Fase 2] Substituir Comunicação IPC (Comlink/Electron -> invoke/listen Tauri)",
    body: "## Objetivo\nEliminar a dependência do `comlink` e `ipcRenderer`/`ipcMain` do Electron, padronizando toda a comunicação no `invoke()` do Tauri.\n\n## Checklist de Tarefas\n- [ ] Mapear todas as chamadas IPC do `RootStore.ts` e `backend.ts`\n- [ ] Substituir invocação dos WebWorkers por comandos assíncronos do Rust\n- [ ] Validar tempo de resposta e ausência de bloqueio na UI thread",
    statusName: 'Pronto pra Dev',
    state: 'open',
    labels: ['type: feature', 'area: architecture', 'area: tauri', 'priority: p0', 'agent: gemini']
  },
  {
    title: "[Fase 3] Migração do Algoritmo Masonry (WASM -> Comando Rust Nativo)",
    body: "## Objetivo\nPortar o algoritmo de layout masonry de WASM para um comando Rust nativo no Tauri para eliminar overhead de conversão JS/WASM.\n\n## Checklist de Tarefas\n- [ ] Criar módulo `src-tauri/src/commands/masonry.rs` utilizando a lógica de `wasm/packages/masonry`\n- [ ] Exportar comando `compute_masonry_layout` no Tauri\n- [ ] Atualizar componentes do grid na UI React",
    statusName: 'Backlog & Ideias Futuras',
    state: 'open',
    labels: ['type: feature', 'area: performance', 'area: rust', 'priority: p1', 'agent: gemini']
  },
  {
    title: "[Fase 3] Migração do Decodificador EXR (WASM -> Comando Rust Nativo)",
    body: "## Objetivo\nPortar o decodificador OpenEXR de WASM para comando nativo Rust no Tauri.\n\n## Checklist de Tarefas\n- [ ] Criar módulo `src-tauri/src/commands/exr.rs` para decodificação de imagens .exr em buffer RGBA\n- [ ] Integrar no `ImageLoader.ts` do frontend",
    statusName: 'Backlog & Ideias Futuras',
    state: 'open',
    labels: ['type: feature', 'area: performance', 'area: rust', 'priority: p1', 'agent: gemini']
  }
];

async function main() {
  for (const item of NEW_ISSUES) {
    try {
      console.log(`Criando issue: ${item.title}...`);
      const createdIssue = await githubApi(`/repos/${REPO_OWNER}/${REPO_NAME}/issues`, 'POST', {
        title: item.title,
        body: item.body,
        labels: item.labels
      });

      if (item.state === 'closed') {
        await githubApi(`/repos/${REPO_OWNER}/${REPO_NAME}/issues/${createdIssue.number}`, 'PATCH', {
          state: 'closed'
        });
      }

      console.log(`Adicionando Issue #${createdIssue.number} ao GitHub Project...`);
      // Adicionar item ao projeto V2
      const addResult = await graphql(`
        mutation($projectId: ID!, $contentId: ID!) {
          addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
            item { id }
          }
        }
      `, {
        projectId: PROJECT_ID,
        contentId: createdIssue.node_id
      });

      const itemId = addResult.addProjectV2ItemById.item.id;
      const optionId = STATUS_MAP[item.statusName];

      await graphql(`
        mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $singleSelectOptionId: String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId,
            itemId: $itemId,
            fieldId: $fieldId,
            value: { singleSelectOptionId: $singleSelectOptionId }
          }) {
            projectV2Item { id }
          }
        }
      `, {
        projectId: PROJECT_ID,
        itemId: itemId,
        fieldId: FIELD_ID,
        singleSelectOptionId: optionId
      });

      console.log(`Sucesso: Issue #${createdIssue.number} criada e definida como "${item.statusName}".`);
    } catch (e) {
      console.error(`Erro ao criar issue "${item.title}":`, e);
    }
  }
}

main();
