#!/usr/bin/env node

/**
 * Script utilitário para Agentes de Código consultarem e atualizarem o GitHub Project V2.
 * Uso:
 *   node .agents/scripts/github_helper.js list
 *   node .agents/scripts/github_helper.js move <issueNumber> <statusName>
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

let TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  const envPath = path.join(__dirname, '../github_token.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/GITHUB_TOKEN=(.+)/);
    if (match) TOKEN = match[1].trim();
  }
}

if (!TOKEN) {
  console.error("Erro: A variável de ambiente GITHUB_TOKEN precisa estar definida ou em .agents/github_token.env");
  process.exit(1);
}

const PROJECT_ID = 'PVT_kwHOBuUPb84BfDJA';
const FIELD_ID = 'PVTSSF_lAHOBuUPb84BfDJAzhZY59I';
const PAGE_SIZE = 100;

const STATUS_MAP = {
  'backlog': 'eba95faa',
  'pronto': '9104f855',
  'progresso': 'ef15cceb',
  'review': '8f265977',
  'concluido': '25867901',
  'Backlog & Ideias Futuras': 'eba95faa',
  'Pronto pra Dev': '9104f855',
  'Em Progresso': 'ef15cceb',
  'Testando & Review': '8f265977',
  'Concluído': '25867901'
};

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

async function fetchAllItems() {
  const items = [];
  let cursor = null;
  let hasNext = true;
  while (hasNext) {
    const data = await graphql(`
      query($id: ID!, $after: String) {
        node(id: $id) {
          ... on ProjectV2 {
            items(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                fieldValueByName(name: "Status") {
                  ... on ProjectV2ItemFieldSingleSelectValue { name }
                }
                content { ... on Issue { number title } }
              }
            }
          }
        }
      }
    `, { id: PROJECT_ID, after: cursor });
    const page = data.node.items;
    for (const node of page.nodes) {
      if (node.content) {
        items.push({
          id: node.id,
          status: node.fieldValueByName ? node.fieldValueByName.name : 'Sem status',
          number: node.content.number,
          title: node.content.title,
        });
      }
    }
    hasNext = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }
  items.sort((a, b) => a.number - b.number);
  return items;
}

async function listItems() {
  const items = await fetchAllItems();

  console.log(`=== Status das Issues no Projeto "Allusion Next" ===\n`);
  for (const item of items) {
    console.log(`[Issue #${item.number}] ${item.title} --> (${item.status})`);
  }
}

async function moveItem(issueNum, statusName) {
  const optionId = STATUS_MAP[statusName.toLowerCase()] || STATUS_MAP[statusName];
  if (!optionId) {
    console.error(`Status desconhecido: "${statusName}". Opções válidas: backlog, pronto, progresso, review, concluido`);
    process.exit(1);
  }

  const items = await fetchAllItems();
  const item = items.find((i) => i.number === parseInt(issueNum, 10));
  if (!item) {
    console.error(`Issue #${issueNum} não encontrada no projeto.`);
    process.exit(1);
  }

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
    itemId: item.id,
    fieldId: FIELD_ID,
    singleSelectOptionId: optionId
  });

  console.log(`Sucesso: Issue #${issueNum} movida para "${statusName}".`);
}

const args = process.argv.slice(2);
if (args[0] === 'list') {
  listItems().catch(console.error);
} else if (args[0] === 'move' && args[1] && args[2]) {
  moveItem(args[1], args[2]).catch(console.error);
} else {
  console.log('Uso:\n  node .agents/scripts/github_helper.js list\n  node .agents/scripts/github_helper.js move <issueNumber> <statusName>');
}
