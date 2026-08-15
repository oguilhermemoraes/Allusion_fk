#!/usr/bin/env node

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
if (!TOKEN) { console.error('GITHUB_TOKEN não definido'); process.exit(1); }

const PROJECT_ID = 'PVT_kwHOBuUPb84BfDJA';
const FIELD_ID = 'PVTSSF_lAHOBuUPb84BfDJAzhZY59I';
const DONE_STATUS_ID = '25867901'; // Concluído

function graphql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com', port: 443, path: '/graphql', method: 'POST',
      headers: { 'User-Agent': 'Antigravity-Agent', 'Authorization': `bearer ${TOKEN}`, 'Content-Type': 'application/json' }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { const j = JSON.parse(body); if (j.errors) reject(new Error(JSON.stringify(j.errors))); else resolve(j.data); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify({ query, variables }));
    req.end();
  });
}

async function fetchAllItems() {
  const items = [];
  let cursor = null;
  let hasNext = true;
  while (hasNext) {
    const data = await graphql(`query($id: ID!, $after: String) {
      node(id: $id) { ... on ProjectV2 {
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id content { ... on Issue { number } } }
        }
      } }
    }`, { id: PROJECT_ID, after: cursor });
    const page = data.node.items;
    for (const node of page.nodes) {
      if (node.content) items.push({ id: node.id, number: node.content.number });
    }
    hasNext = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }
  return items;
}

async function findItemId(issueNum, allItems) {
  const item = allItems.find(i => i.number === parseInt(issueNum, 10));
  return item ? item.id : null;
}

async function main() {
  const issues = process.argv.slice(2).map(Number);
  const allItems = await fetchAllItems();
  for (const num of issues) {
    try {
      const itemId = await findItemId(num, allItems);
      if (!itemId) { console.log(`Issue #${num} não encontrada no Kanban.`); continue; }
      await graphql(`mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $singleSelectOptionId: String!) {
        updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $singleSelectOptionId } }) { projectV2Item { id } }
      }`, { projectId: PROJECT_ID, itemId: itemId, fieldId: FIELD_ID, singleSelectOptionId: DONE_STATUS_ID });
      console.log(`Issue #${num} movida para "Concluído".`);
    } catch (e) {
      console.error(`Erro na Issue #${num}:`, e.message || e);
    }
  }
}
main();
