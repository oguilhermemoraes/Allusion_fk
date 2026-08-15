#!/usr/bin/env node

/**
 * Script para atualizar o status e as descrições das Issues do Lote Fase 2 (#18, #12, #15).
 * Marca os checklists como concluídos [x] e move os itens do Kanban para "Testando & Review".
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

const REPO_OWNER = 'oguilhermemoraes';
const REPO_NAME = 'Allusion_fk';
const PROJECT_ID = 'PVT_kwHOBuUPb84BfDJA';
const FIELD_ID = 'PVTSSF_lAHOBuUPb84BfDJAzhZY59I';
const REVIEW_STATUS_ID = '8f265977'; // Testando & Review

function restRequest(path, method, body = null) {
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
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
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
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify({ query, variables }));
    req.end();
  });
}

async function updateIssueChecklist(number) {
  console.log(`Buscando dados da Issue #${number}...`);
  const issue = await restRequest(`/repos/${REPO_OWNER}/${REPO_NAME}/issues/${number}`, 'GET');
  if (issue && issue.body) {
    const updatedBody = issue.body.replace(/\[ \]/g, '[x]');
    await restRequest(`/repos/${REPO_OWNER}/${REPO_NAME}/issues/${number}`, 'PATCH', {
      body: updatedBody
    });
    console.log(`Checklist da Issue #${number} atualizada para [x].`);
  }
}

async function moveProjectItem(issueNum) {
  const data = await graphql(`
    query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          items(first: 50) {
            nodes {
              id
              content {
                ... on Issue {
                  number
                }
              }
            }
          }
        }
      }
    }
  `, { id: PROJECT_ID });

  const item = data.node.items.nodes.find(i => i.content && i.content.number === parseInt(issueNum, 10));
  if (!item) {
    console.log(`Aviso: Issue #${issueNum} não encontrada no quadro Kanban.`);
    return;
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
    singleSelectOptionId: REVIEW_STATUS_ID
  });

  console.log(`Issue #${issueNum} movida para a coluna "Testando & Review" no Kanban.`);
}

async function main() {
  const issues = [18, 12, 15];
  for (const num of issues) {
    try {
      await updateIssueChecklist(num);
      await moveProjectItem(num);
    } catch (e) {
      console.error(`Erro ao processar a Issue #${num}:`, e.message || e);
    }
  }
  console.log('\nSincronização com o GitHub concluída!');
}

main();
