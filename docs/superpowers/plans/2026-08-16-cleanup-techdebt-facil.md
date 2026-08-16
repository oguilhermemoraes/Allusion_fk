# Limpeza de Tech-Debts Fáceis (#30, #34, #35) — Implementation Plan

> **Para agentes workers:** Implementar EXATAMENTE as tasks abaixo, na ordem. Cada passo tem instrução precisa e resultado esperado. **REGRAS INVIOLÁVEIS no final deste documento.** Não pule steps, não improvise.

**Goal:** Resolver três tech-debts pequenos: habilitar `skipLibCheck` (#30), e levantar evidências para fechar #34 (electron-updater já removido) e corrigir #35 (react-window em uso).

**Architecture:** Nenhuma mudança de arquitetura. Uma alteração de uma linha no `tsconfig.json` + relatórios de verificação estática. O agente **NÃO executa nenhum comando de build/teste/lint** — apenas edita arquivos e lê arquivos.

**Tech Stack:** TypeScript (`tsconfig.json`), Node/Yarn.

---

## Contexto que o agente precisa saber

- Este é um app Tauri 2 + React 18 (TypeScript 4.9).
- `tsconfig.json` (raiz do projeto) declara `"lib": ["dom", "esnext", "webworker"]` — `dom` e `webworker` juntos geram conflito de declarações no `tsc --noEmit`. O fix aprovado no ticket #30 é `"skipLibCheck": true` (não remover `webworker`, não mudar mais nada).
- O repositório foi migrado de Electron para Tauri: o processo principal Electron foi 100% removido. Por isso `electron-updater` (ticket #34) provavelmente sumiu. Verificar e documentar.
- `react-window` (ticket #35) precisa de verificação de uso real (há indício de import em `ListGallery.tsx`).

---

### Task 1: Habilitar skipLibCheck (#30)

**Files:**
- Modify: `tsconfig.json` (raiz do projeto)

- [ ] **Step 1: Ler o arquivo `tsconfig.json`** na raiz do projeto e confirmar que `compilerOptions` termina com:

```json
    "strict": true, 
    "isolatedModules": true
  },
```

- [ ] **Step 2: Editar `tsconfig.json`** — alterar exatamente estas duas linhas:

De:
```json
    "strict": true, 
    "isolatedModules": true
  },
```

Para:
```json
    "strict": true, 
    "isolatedModules": true,
    "skipLibCheck": true
  },
```

Regras da edição: apenas adicionar a vírgula ao final de `"isolatedModules": true` e a nova linha `"skipLibCheck": true`. NÃO reordenar, NÃO formatar o arquivo com prettier, NÃO tocar em nenhuma outra propriedade.

- [ ] **Step 3: Conferir o arquivo final com Read** — deve conter exatamente `"skipLibCheck": true` como último item de `compilerOptions`, seguido de `},` e depois `"include"`.

- [ ] **Step 4: Commit** (mensagem obrigatória, mais nada no commit):

```bash
git add tsconfig.json
git commit -m "chore(tsconfig): habilita skipLibCheck para sanar conflito dom/webworker (#30)"
```

- [ ] **Step 5: Confirmar** com `git log --oneline -1` que o HEAD é o commit acima, e `git status --short` mostrando **apenas** `tsconfig.json` modificado/nenhum outro arquivo sujo.

**Resultado esperado do Step 5:** `git status --short` vazio (working tree limpa) e HEAD = o commit da Task 1.

---

### Task 2: Verificação do ticket #34 (electron-updater) — SEM edição de código

Objetivo: produzir um relatório de evidências. NÃO editar nenhum arquivo do projeto. NÃO criar arquivos dentro do repositório — o relatório vai para `C:\Users\GUILHE~1\AppData\Local\Temp\opencode\report_34.md`.

- [ ] **Step 1: Verificar dependências.** Ler `package.json` (raiz) e verificar SEPARADAMENTE as chaves `dependencies` e `devDependencies`. Registrar no relatório se a string `electron-updater` aparece em alguma das duas (esperado: NÃO aparece).

- [ ] **Step 2: Verificar imports/código.** Procurar (grep) por `electron-updater` em todo o repositório (qualquer pasta). Para cada ocorrência encontrada, registrar arquivo + linha + o conteúdo da linha. Esperado: ocorrências apenas em **comentários** em `src/ipc/renderer.ts` nas linhas ~367 e ~375 (texto parecido com "electron-updater is removed (see #34)"). Se houver QUALQUER import ou uso fora de comentário, **PARAR** e reportar como "ADO: há uso real" (não remover nada).

- [ ] **Step 3: Gravar o relatório** em `C:\Users\GUILHE~1\AppData\Local\Temp\opencode\report_34.md` com o formato:

```markdown
# Evidências #34 — electron-updater

## package.json
- dependencies: (aparece? SIM/NAO)
- devDependencies: (aparece? SIM/NAO)

## Ocorrências de "electron-updater" no código
(listar arquivo:linha -> conteúdo da linha, ou "nenhuma")

## Conclusão
REMOVER_OU_JA_REMOVIDO (escolher um) — justificativa em 1-2 frases.
```

- [ ] **Step 4: NÃO commitar** nada desta task (nada deve mudar no working tree).

**Resultado esperado:** arquivo `report_34.md` criado no TEMP; `git status --short` idêntico ao fim da Task 1 (limpo).

---

### Task 3: Verificação do ticket #35 (react-window) — SEM edição de código

- [ ] **Step 1: Procurar imports de `react-window`** no código (grep por `react-window` na pasta `src/`). Registrar cada ocorrência (arquivo:linha -> conteúdo). Esperado: **pelo menos** `src/frontend/containers/ContentView/ListGallery.tsx:13` com `import { FixedSizeList, ListOnScrollProps } from 'react-window';`.

- [ ] **Step 2: Verificar se ListGallery é usada.** Grep por `ListGallery` em todo `src/`. Esperado: uso em `src/frontend/containers/ContentView/LayoutSwitcher.tsx` (import na linha ~11 e renderização na linha ~145).

- [ ] **Step 3: Confirmar presença da dep e do tipo.** Em `package.json`: `react-window` em `dependencies` e `@types/react-window` em `devDependencies`. Registrar no relatório.

- [ ] **Step 4: Gravar o relatório** em `C:\Users\GUILHE~1\AppData\Local\Temp\opencode\report_35.md`:

```markdown
# Evidências #35 — react-window

## package.json
- dependencies: react-window (SIM/NAO)
- devDependencies: @types/react-window (SIM/NAO)

## Imports de react-window
(listar arquivo:linha -> conteúdo)

## Uso de ListGallery
(listar arquivo:linha -> conteúdo)

## Conclusão
EM_USO_REAL (escolher: EM_USO_REAL ou NAO_USADO) — justificativa em 1-2 frases. Se EM_USO_REAL, recomendar: "a issue #35 esta desatualizada: react-window e usado na ListGallery (modo lista); nao deve ser removido sem reescrever a virtualizacao da ListGallery."
```

- [ ] **Step 5: NÃO commitar** nada desta task.

**Resultado esperado:** arquivo `report_35.md` criado no TEMP; `git status --short` limpo; HEAD inalterado (commit da Task 1).

---

## REGRAS INVIOLÁVEIS

1. **NUNCA rode** `yarn`, `npm`, `npx`, `tsc`, `eslint`, `jest`, `webpack` ou qualquer comando de build/teste/lint/build. Sua função é EDITAR (só a Task 1) e VERIFICAR (Tasks 2-3). Nenhuma execução dessas ferramentas.
2. **NUNCA** edite qualquer arquivo fora dos listados: `tsconfig.json` (Task 1) e os relatórios no TEMP (Tasks 2-3).
3. **NUNCA** use a API do GitHub (sem token, sem curl para api.github.com, sem `gh`).
4. **NUNCA** faça `git push`, `git rebase`, `git pull`, `git fetch`, `git checkout` de branches. Apenas o `git add`+`commit`+`log`+`status` da Task 1.
5. **NUNCA** remova, renomeie ou reescreva imports de nenhum arquivo.
6. **NUNCA** formate/refatore qualquer trecho "de passagem".
7. Se QUALQUER passo der resultado diferente do "Resultado esperado" (ex.: grep #34 achar import real, tsc config diferente do descrito), **PARE imediatamente** e reporte no seu retorno final o desvio EXATO — não tente "consertar" criativamente.
8. No retorno final (sua única mensagem), informe:
   - o SHA do commit da Task 1 e a confirmação do `git status` limpo;
   - o caminho dos dois relatórios e a conclusão de cada um (frase curta);
   - lista de qualquer desvio encontrado (ou "nenhum desvio").