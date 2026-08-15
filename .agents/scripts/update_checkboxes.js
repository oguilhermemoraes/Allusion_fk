const https = require('https');

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("Erro: GITHUB_TOKEN não definido");
  process.exit(1);
}

const REPO_OWNER = 'oguilhermemoraes';
const REPO_NAME = 'Allusion_fk';
const ISSUES = [16, 17];

function request(path, method, body = null) {
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

async function main() {
  for (const num of ISSUES) {
    try {
      const issue = await request(`/repos/${REPO_OWNER}/${REPO_NAME}/issues/${num}`, 'GET');
      if (issue && issue.body) {
        const updatedBody = issue.body.replace(/\[ \]/g, '[x]');
        await request(`/repos/${REPO_OWNER}/${REPO_NAME}/issues/${num}`, 'PATCH', {
          body: updatedBody,
          state: 'closed'
        });
        console.log(`Sucesso: Issue #${num} teve todos os checkboxes marcados [x] e foi fechada.`);
      }
    } catch (e) {
      console.error(`Erro na Issue #${num}:`, e);
    }
  }
}

main();
