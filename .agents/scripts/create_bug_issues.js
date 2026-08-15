const https = require('https');

let TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  const envPath = require('path').join(__dirname, '../github_token.env');
  const content = require('fs').readFileSync(envPath, 'utf8');
  const match = content.match(/GITHUB_TOKEN=(.+)/);
  if (match) TOKEN = match[1].trim();
}
if (!TOKEN) { console.error('GITHUB_TOKEN não definido'); process.exit(1); }

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

function api(path, method, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.github.com', port: 443, path, method, headers: {
      'User-Agent': 'Antigravity-Agent', 'Authorization': `token ${TOKEN}`,
      'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json',
    } }, res => { let d=''; res.on('data', c=>d+=c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } }); });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
function graphql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.github.com', port: 443, path: '/graphql', method: 'POST', headers: {
      'User-Agent': 'Antigravity-Agent', 'Authorization': `token ${TOKEN}`, 'Content-Type': 'application/json',
    } }, res => { let b=''; res.on('data', c=>b+=c); res.on('end', () => { try { const j=JSON.parse(b); if (j.errors) reject(new Error(JSON.stringify(j.errors))); else resolve(j.data); } catch(e){ reject(e); } }); });
    req.on('error', reject);
    req.write(JSON.stringify({ query, variables }));
    req.end();
  });
}

const ISSUES = [
  {
    title: '[Bug] Thumbnails não são geradas no Tauri (404 no asset://) — invoke com args errados + fallback worker inoperante',
    body: `## Sintoma (validação do usuário — build release 02/08)
- Grid mostra apenas placeholders azuis; console mostra **404 (Not Found)** em \`asset.localhost/.../Allusion/thumbnails/<nome>.webp?v=1\` (não 403, ou seja: scope OK, arquivo não existe).
- Nenhum arquivo é criado em \`%TEMP%\\Allusion\\thumbnails\` (diretório contém só 738 thumbs antigas de 22/07, de outro dataset).
- Backup automático funcionou na mesma sessão (\`auto-backup-0.json\` criado) → I/O de escrita via \`write_file\` OK.

## Causa raiz (confirmada em código Tauri 2.11.5)
1. **Native nunca executava**: o comando Rust \`generate_thumbnail(params: GenerateThumbnailParams)\` recebe **um struct**, e o Tauri vincula argumentos **por nome de parâmetro** (\`tauri/src/ipc/command.rs\`: \`v.get(self.key)\`, key=\`"params"\`). O JS chamava \`invoke('generate_thumbnail', { path, outPath, targetSize })\` **sem o wrapper** \`params\` → \`missing required key params\` → reject → fallback JS. Todos os outros comandos usam parâmetros planos (ex. \`get_image_dimensions(path)\` → \`{ path }\`), por isso só o thumbnail quebrava.
2. **Fallback worker é inoperante no Tauri**: o worker (\`thumbnailGenerator.worker.ts\`) roda em thread sem \`window\`; as init scripts do Tauri são \`for_main_frame_only\` → \`window.__TAURI_INTERNALS__\` não existe no worker → \`isTauri()\` (\`fs-shim.js\`) é \`false\` → o fs-shim vira no-op: \`pathExists\` retorna \`true\` e \`outputFile\` não escreve. Resultado: worker "responde sucesso" sem criar arquivo, e \`ImageLoader.ensureThumbnail\` seta \`thumbnailPath?v=1\` → 404 eterno. Erros ficam invisíveis (logs de fallback são \`console.debug\`, ocultos no DevTools).

## Fix aplicado (opencode, branch atual — build 03:24)
- \`src/frontend/services/nativeThumbnail.ts\`: \`invoke('generate_thumbnail', { params: { path, outPath, targetSize } })\`.
- Teste do comando nativo contra arquivos reais da biblioteca (\`1920x.webp\`, \`1691554.jpg\`, \`1_-6zqEON5hQmYwl7aRDCC1w.png\`) → \`generate_thumbnail_impl\` gera WebP 100% OK (decode + write).
- Jest 63/63, ESLint 0 erros, build Tauri OK.

## Pendente
- [ ] **Re-teste do usuário** no novo build (grid deve mostrar thumbs; \`%TEMP%\\Allusion\\thumbnails\` deve ganhar arquivos novos).
- [ ] Fallback do worker no Tauri continua quebrado (vira a issue \`[Tech-debt] Worker de thumbnails sem IPC Tauri\`).

## Como reproduzir
1. Rodar \`src-tauri\\target\\release\\allusion.exe\`.
2. Importar uma biblioteca com imagens (ex. \`<caminho-da-sua-biblioteca>\`).
3. Abrir o DevTools (menu de contexto → Inspect) e observar os 404 em \`asset.localhost/.../thumbnails/\`.
`,
    statusName: 'Testando & Review',
    labels: ['type: bug', 'area: tauri', 'area: frontend', 'priority: p0']
  },
  {
    title: '[Bug] Crash "Layout has not been computed yet" quebra o grid masonry no Tauri',
    body: `## Sintoma (validação do usuário — build release 02/08)
- Após \`IndexedDB: Searching files...\`, o app quebra com \`Error: Layout has not been computed yet.\` capturado por \`componentDidCatch\` (ErrorBoundary) — stack: \`nl.worker.getTransform\` → \`uE\` (findViewportEdge) → render.

## Causa raiz
- \`MasonryNativeAdapter.getTransform(index)\` lança exceção quando \`index >= this.transforms.length\` (linha 66).
- O \`VirtualizedRenderer\` renderiza **sincronamente** sempre que \`fileStore.fileList\` muda (search/filtro), mas o layout é recomputado **async** via \`invoke('compute_masonry_*')\`. Na janela do recompute, \`transforms\` ainda tem o tamanho antigo → \`getTransform(i)\` para \`i\` além do array → throw → ErrorBoundary derruba a galeria inteira.
- O adapter WASM antigo não tinha esse problema: memória WASM não inicializada lê como zeros → retorna \`[0,0,0,0]\` em vez de lançar.

## Fix aplicado (opencode, build 03:24)
- \`MasonryNativeAdapter.getTransform\` agora retorna \`[0,0,0,0]\` (placeholder) para índices fora do layout, em paridade com o WASM, em vez de lançar.
- Teste atualizado: \`tests/masonry-native-adapter.test.ts\` valida o placeholder.
- Jest 63/63, ESLint 0 erros, build Tauri OK.

## Pendente
- [ ] **Re-teste do usuário**: navegar/pesquisar em biblioteca grande (1202+ arquivos) sem crash.
- [ ] Opcional: proteger o \`VirtualizedRenderer\` para não renderizar células além do layout atual (evita o frame com transform zero).
`,
    statusName: 'Testando & Review',
    labels: ['type: bug', 'area: frontend', 'area: rust', 'priority: p0']
  },
  {
    title: '[Tech-debt] Worker de thumbnails sem IPC Tauri — fallback JS silencioso quando o nativo falha',
    body: `## Contexto
O fallback JS (\`thumbnailGenerator.worker.ts\` → \`fse\` via \`fs-shim.js\`) é **inoperante no runtime Tauri** e falha de forma silenciosa (a galeria mostra 404 sem nenhum erro no console).

## Causa raiz
- \`invoke()\` do \`@tauri-apps/api/core\` lê \`window.__TAURI_INTERNALS__\` (core.js:202), e as init scripts do Tauri são \`for_main_frame_only\` → **não existem em Web Workers**.
- No worker, \`typeof window === 'undefined'\` → \`isTauri()\` (\`fs-shim.js\`) é \`false\` → fs-shim vira no-op:
  - \`pathExists\` → retorna \`true\` (pula geração, "sucesso" sem arquivo);
  - \`readFile\` → buffer vazio; \`outputFile\` → não escreve.
- O listener pai (\`useWorkerListener\` → \`onmessage\`) resolve como \`success\` e **ignora** o \`thumbnailPath\` retornado pelo worker.

## Impacto
- Enquanto o caminho nativo (\`generate_thumbnail\`) cobre JPG/PNG/WEBP/GIF/BMP/TIFF/ICO, qualquer formato que o crate \`image\` não decodifique cai no worker e vira 404 silencioso.

## Propostas de solução (escolher uma)
1. **Worker devolve bytes e a main thread escreve**: o worker só decodifica (OffscreenCanvas → ArrayBuffer) e posta os bytes + path; o listener pai (que tem \`window.__TAURI_INTERNALS__\`) grava via \`fse.outputFile\`. Mínimo impacto no Electron (mantém escrita no worker).
2. **Executar decode inline na main thread** com um pool de concorrência (limite ~4) quando o nativo falhar; o worker é usado apenas no Electron.
3. Manter native-only e simplesmente **logar com visibilidade** quando o fallback não for possível (evitar 404 silencioso).

## Nota
- Não usar \`window.location.href\` como base de \`new URL(...)\` de workers (quebra o bundling do webpack); usar \`import.meta.url\` num módulo-factory mockável nos testes (regra da revisão #20).
`,
    statusName: 'Pronto pra Dev',
    labels: ['type: tech-debt', 'area: tauri', 'area: frontend', 'priority: p1', 'agent: gemini']
  }
];

async function main() {
  for (const item of ISSUES) {
    try {
      console.log(`Criando issue: ${item.title}...`);
      const created = await api(`/repos/${REPO_OWNER}/${REPO_NAME}/issues`, 'POST', {
        title: item.title, body: item.body, labels: item.labels
      });
      const addResult = await graphql(`mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
      }`, { projectId: PROJECT_ID, contentId: created.node_id });
      const itemId = addResult.addProjectV2ItemById.item.id;
      await graphql(`mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $singleSelectOptionId: String!) {
        updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $singleSelectOptionId } }) { projectV2Item { id } }
      }`, { projectId: PROJECT_ID, itemId: itemId, fieldId: FIELD_ID, singleSelectOptionId: STATUS_MAP[item.statusName] });
      console.log(`OK: Issue #${created.number} -> "${item.statusName}"`);
    } catch (e) {
      console.error(`Erro em "${item.title}":`, e.message || e);
    }
  }
}
main();
