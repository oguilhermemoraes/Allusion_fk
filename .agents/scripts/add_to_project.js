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

const ISSUE = parseInt(process.argv[2], 10) || 78;
const STATUS_ARG = process.argv[3] || 'review';
const PROJECT_ID = 'PVT_kwHOBuUPb84BfDJA';
const FIELD_ID = 'PVTSSF_lAHOBuUPb84BfDJAzhZY59I';

const STATUS_MAP = {
  backlog: 'f75ad846',
  ready: '47fc9ee4',
  in_progress: 'e7b0a701',
  review: '8f265977',
  done: '25867901',
};
const TARGET_STATUS = STATUS_MAP[STATUS_ARG] || STATUS_MAP.review;

function rest(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.github.com',
      path,
      headers: { 'User-Agent': 'Antigravity-Agent', Authorization: `token ${TOKEN}`, Accept: 'application/vnd.github.v3+json' },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function graphql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com', port: 443, path: '/graphql', method: 'POST',
      headers: { 'User-Agent': 'Antigravity-Agent', Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
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

(async () => {
  const issue = await rest(`/repos/oguilhermemoraes/Allusion_fk/issues/${ISSUE}`);
  const noteId = issue.node_id;
  const added = await graphql(
    `mutation($projectId: ID!, $contentId: ID!) {
       addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
     }`,
    { projectId: PROJECT_ID, contentId: noteId },
  );
  const itemId = added.addProjectV2ItemById.item.id;
  await graphql(
    `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $singleSelectOptionId: String!) {
       updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $singleSelectOptionId } }) { projectV2Item { id } }
     }`,
    { projectId: PROJECT_ID, itemId, fieldId: FIELD_ID, singleSelectOptionId: TARGET_STATUS },
  );
  console.log(`Issue #${ISSUE} adicionada ao Project e movida para "${STATUS_ARG}".`);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});