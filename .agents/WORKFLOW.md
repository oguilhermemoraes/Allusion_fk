# Agent Workflow & Operations Manual

Este guia instrui futuros agentes de código sobre a rotina diária de desenvolvimento neste projeto.

---

## 1. Ciclo de Trabalho de uma Issue

1. **Seleção de Tarefa**:
   - Acesse o Kanban em [Allusion Next (Project #2)](https://github.com/users/oguilhermemoraes/projects/2).
   - Escolha a primeira tarefa disponível na coluna `Pronto pra Dev`.

2. **Iniciar Desenvolvimento**:
   - Crie uma branch nomeada `feat/<nome-curto>` ou `docs/<nome-curto>`.
   - Atualize a coluna da Issue para `Em Progresso`.

3. **Implementação & Verificação**:
   - Escreva o código idiomático seguindo as convenções da linguagem (TS/React ou Rust).
   - Execute os testes unitários (`yarn test` ou `cargo test`).
   - Garanta que a verificação passou antes de declarar conclusão.

4. **Entrega & Fechamento**:
   - Faça commit com mensagem clara (ex: `feat(tauri): adiciona comando rust de leitura de exif (Closes #2)`).
   - Faça push para `origin` (`https://github.com/oguilhermemoraes/Allusion_fk.git`).
   - Mova a card no Kanban para `Concluído`.

---

## 2. Scripts Auxiliares em `.agents/scripts/`

- `node .agents/scripts/github_helper.js list` — Lista as issues e status atuais do Kanban.
- `node .agents/scripts/github_helper.js move <issueNumber> <statusName>` — Move uma issue para a coluna desejada no Kanban.

Opções de colunas para status:
- `Backlog & Ideias Futuras`
- `Pronto pra Dev`
- `Em Progresso`
- `Testando & Review`
- `Concluído`
