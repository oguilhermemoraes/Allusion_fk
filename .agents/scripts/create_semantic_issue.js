#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

let TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  const envPath = path.join(__dirname, '../github_token.env');
  if (fs.existsSync(envPath)) {
    const match = fs.readFileSync(envPath, 'utf8').match(/GITHUB_TOKEN=(.+)/);
    if (match) TOKEN = match[1].trim();
  }
}

if (!TOKEN) {
  console.error("Erro: GITHUB_TOKEN não definido");
  process.exit(1);
}

const REPO_OWNER = 'oguilhermemoraes';
const REPO_NAME = 'Allusion_fk';
const PROJECT_ID = 'PVT_kwHOBuUPb84BfDJA';
const FIELD_ID = 'PVTSSF_lAHOBuUPb84BfDJAzhZY59I';
const STATUS_BACKLOG = 'eba95faa'; // Backlog & Ideias Futuras

const ISSUE_DATA = {
  title: "[Feature Request] Busca Semântica Local de Mídias via CLIP (ONNX / INT8 + Rust)",
  body: `## 💡 Descrição do Recurso
Implementar um sistema de **busca semântica local baseada em IA (100% offline)** para a biblioteca de mídias do Allusion. 

Em vez de depender apenas de tags manuais ou nomes de arquivo, o usuário poderá buscar referências visuais por significado e linguagem natural (ex: *"UI escura minimalista"*, *"textura de concreto"*, *"paleta de cores outonal"*).

## 🎯 Objetivos e Benefícios
- **Busca por Significado:** Encontrar imagens por conceito usando texto em linguagem natural.
- **Privacidade Total:** Processamento 100% local no dispositivo do usuário (sem APIs na nuvem, sem envio de dados).
- **Baixo Consumo de Recursos:** Utilização de modelos **CLIP quantizados em INT8 (~150 MB)** rodando via **ONNX Runtime no Rust**, garantindo compatibilidade inclusive com hardware intermediário/notebooks (ex: i5 / GPUs dedicadas de entrada como MX330 / Apple Silicon).
- **Sem Travamentos na UI:** Indexação em segundo plano (*background threads*) via Rust sem impactar o desempenho da interface gráfica.

---

## 🛠️ Especificações Técnicas Propostas

### 1. Backend (Rust / Tauri v2)
- **Modelo de Visão/Linguagem:** CLIP (\`ViT-B/32\` quantizado em INT8, formato \`.onnx\`).
- **Inference Engine:** Crate [\`ort\`](https://crates.io/crates/ort) (ONNX Runtime em Rust com suporte a DirectML / CUDA / CPU / CoreML).
- **Armazenamento de Vetores:** Banco de dados local (SQLite com extensão de vetor ou biblioteca de busca como \`usearch\` / \`hnswlib-rs\`).
- **Concorrência:** Gerenciamento da fila de indexação usando \`rayon\` / \`tokio\` em prioridade de CPU reduzida.

### 2. Comunicação IPC (Tauri v2)
- **Streaming de Progresso:** Usar \`tauri::ipc::Channel\` para enviar o progresso do escaneamento/indexação das imagens para o front-end em tempo real.
- **Comando de Busca:** Função \`invoke('search_semantic', { query, limit })\` retornando a lista de caminhos de arquivos e seus scores de similaridade de cosseno.

---

## 📋 Lista de Tarefas (Roadmap de Implementação)

- [ ] **Fase 1: Configuração do Backend em Rust**
  - [ ] Adicionar dependência \`ort\` no \`Cargo.toml\`.
  - [ ] Estruturar o download/inclusão do modelo CLIP INT8 no projeto.
  - [ ] Criar função de extração de embeddings (Texto $\\rightarrow$ Vetor e Imagem $\\rightarrow$ Vetor).

- [ ] **Fase 2: Indexação e Armazenamento**
  - [ ] Implementar fila de processamento de imagens da biblioteca em background.
  - [ ] Salvar vetores extraídos e relacioná-los com o ID/caminho da mídia no SQLite.

- [ ] **Fase 3: Integração com o Front-end**
  - [ ] Adicionar toggle de busca semântica no componente de barra de pesquisa.
  - [ ] Conectar os resultados da query de similaridade com a grade de exibição de mídias do Allusion.
  - [ ] Adicionar indicador visual de progresso da indexação inicial na UI.

---

## 📌 Informações Adicionais
- **Tamanho do Modelo:** ~150 MB.
- **Consumo de Memória Estimado:** ~300 MB de RAM durante a inferência.
`,
  labels: ['type: feature', 'area: rust', 'area: architecture', 'area: performance', 'status: ready', 'agent: gemini']
};

function githubApi(path, method, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request({
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
    }, res => {
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
    req.write(JSON.stringify({ query, variables }));
    req.end();
  });
}

async function main() {
  console.log(`Criando Issue: ${ISSUE_DATA.title}...`);
  const createdIssue = await githubApi(`/repos/${REPO_OWNER}/${REPO_NAME}/issues`, 'POST', {
    title: ISSUE_DATA.title,
    body: ISSUE_DATA.body,
    labels: ISSUE_DATA.labels
  });

  if (!createdIssue.number) {
    console.error("Falha ao criar a issue no GitHub:", createdIssue);
    process.exit(1);
  }

  console.log(`Issue #${createdIssue.number} criada com sucesso! URL: ${createdIssue.html_url}`);

  console.log(`Adicionando Issue #${createdIssue.number} ao GitHub Project...`);
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
    singleSelectOptionId: STATUS_BACKLOG
  });

  console.log(`Sucesso: Issue #${createdIssue.number} criada e adicionada à coluna "Backlog & Ideias Futuras"!`);
}

main().catch(console.error);
