#!/usr/bin/env node

/**
 * Posta um comentário numa issue do repo fork.
 * Uso:
 *   node .agents/scripts/add_issue_comment.js <issueNumber> <arquivo-markdown-ou-texto>
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

const issueNum = process.argv[2];
const bodyPath = process.argv[3];

if (!TOKEN || !issueNum || !bodyPath) {
  console.error('Uso: node add_issue_comment.js <issueNumber> <bodyFile>');
  process.exit(1);
}

const body = fs.readFileSync(bodyPath, 'utf8');

const payload = JSON.stringify({ body });

const req = https.request(
  {
    hostname: 'api.github.com',
    port: 443,
    path: `/repos/oguilhermemoraes/Allusion_fk/issues/${issueNum}/comments`,
    method: 'POST',
    headers: {
      'User-Agent': 'Antigravity-Agent',
      Authorization: `token ${TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  },
  (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const json = JSON.parse(data);
        console.log(`Comentário postado: ${json.html_url}`);
      } else {
        console.error(`Falha (${res.statusCode}): ${data}`);
        process.exit(1);
      }
    });
  },
);
req.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
req.write(payload);
req.end();
