const https = require('https');
let TOKEN = null;
const content = require('fs').readFileSync(require('path').join(__dirname, '../github_token.env'), 'utf8');
const m = content.match(/GITHUB_TOKEN=(.+)/);
if (m) TOKEN = m[1].trim();

const PROJECT_ID = 'PVT_kwHOBuUPb84BfDJA';
const FIELD_ID = 'PVTSSF_lAHOBuUPb84BfDJAzhZY59I';
const BACKLOG_STATUS_ID = 'eba95faa'; // Backlog & Ideias Futuras

function api(path, method, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.github.com', port: 443, path, method, headers: {
      'User-Agent': 'Antigravity-Agent', 'Authorization': `token ${TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json'
    } }, res => { let d=''; res.on('data', c=>d+=c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } }); });
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}
function graphql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.github.com', port: 443, path: '/graphql', method: 'POST', headers: {
      'User-Agent': 'Antigravity-Agent', 'Authorization': `token ${TOKEN}`, 'Content-Type': 'application/json'
    } }, res => { let b=''; res.on('data', c=>b+=c); res.on('end', () => { try { const j=JSON.parse(b); if (j.errors) reject(new Error(JSON.stringify(j.errors))); else resolve(j.data); } catch(e){ reject(e); } }); });
    req.on('error', reject); req.write(JSON.stringify({ query, variables })); req.end();
  });
}

async function main() {
  const created = await api('/repos/oguilhermemoraes/Allusion_fk/issues', 'POST', {
    title: '[Perf] Reduzir "loads" visíveis das thumbnails no grid (flicker durante carregamento)',
    body: `## Contexto
Validação do usuário (02/08/2026) após o fix dos bugs #25/#26: thumbnails agora **carregam corretamente**, porém o grid ainda mostra **muitos "loads" visíveis** (placeholders/flicker) enquanto as thumbs são geradas/buscadas.

## Proposta (open — sem design definido ainda)
Reduzir a percepção de carregamento do grid:
- Geração em lote/lazy dos thumbs mais próximos do viewport (prioridade por visibilidade).
- Cache em memória das thumbnails já carregadas na sessão (evitar re-decode).
- Skeleton/progressive render menos "piscante" (evitar placeholder azul → imagem).
- Possível prefetch das thumbs da 1ª página logo após indexação.
- Pré-geração em background (idle) após o scan da biblioteca.

## Escopo futuro
Backlog — sem data definida. Ideias acima podem ser refinadas em sub-issues ou virarem um RFC.
`,
    labels: ['type: feature', 'area: performance', 'area: frontend', 'priority: p2']
  });
  console.log(`Issue #${created.number} criada.`);
  const addResult = await graphql(`mutation($projectId: ID!, $contentId: ID!) { addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } } }`, { projectId: PROJECT_ID, contentId: created.node_id });
  const itemId = addResult.addProjectV2ItemById.item.id;
  await graphql(`mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $singleSelectOptionId: String!) { updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $singleSelectOptionId } }) { projectV2Item { id } } }`, { projectId: PROJECT_ID, itemId: itemId, fieldId: FIELD_ID, singleSelectOptionId: BACKLOG_STATUS_ID });
  console.log('Movida para "Backlog & Ideias Futuras".');
}
main();
