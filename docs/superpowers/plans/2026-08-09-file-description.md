# Campo de Descrição Manual por Imagem — Implementation Plan (#49)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir registrar e editar uma descrição textual por imagem, persistida no banco (Dexie), exibida/editada no Inspector e buscável via critério de busca.

**Architecture:** Adiciona `description?: string` opcional ao `FileDTO`; expõe um `@observable description` no `ClientFile` com auto-save via reaction já existente; renderiza um textarea editável na seção do Inspector; integra o campo `description` ao modelo de busca reutilizando `ClientStringSearchCriteria` (string + operador `contains`). Sem auto-extração e sem tocar no arquivo no disco.

**Tech Stack:** TypeScript, MobX, Dexie (IndexedDB), React, jest.

---

### Task 1: DTO e entidade com descrição

**Files:**
- Modify: `src/api/file.ts:3-34`
- Modify: `src/frontend/entities/File.ts:60-63, 115-118, 159-178`

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/description.test.ts`:

```ts
import { ClientFile } from '../src/frontend/entities/File';
import { FileDTO } from '../src/api/file';
// helper para construir FileDTO mínimo
function makeFileDTO(overrides: Partial<FileDTO> = {}): FileDTO {
  return {
    id: '1',
    ino: 'ino1',
    locationId: 'loc',
    relativePath: 'a.jpg',
    absolutePath: 'C:/loc/a.jpg',
    tags: [],
    dateAdded: new Date(),
    dateModified: new Date(),
    dateLastIndexed: new Date(),
    name: 'a.jpg',
    extension: 'jpg',
    size: 1,
    width: 1,
    height: 1,
    dateCreated: new Date(),
    ...overrides,
  };
}

// O construtor de ClientFile chama store.getLocation() e store.getTags() — um store incompleto lança TypeError
function makeStore(): any {
  return {
    getLocation: () => ({ path: 'C:/loc' }),
    getTags: () => [],
    save: () => {},
  };
}

describe('ClientFile description', () => {
  it('serializes description round-trip', () => {
    const dto = makeFileDTO({ description: 'my prompt' });
    const file = new ClientFile(makeStore(), dto);
    expect(file.description).toBe('my prompt');
    expect(file.serialize().description).toBe('my prompt');
  });
});
```

- [ ] **Step 2: Rodar para confirmar falha**

Run: `npx jest tests/description.test.ts`
Expected: FAIL — `file.description` é `undefined` (propriedade ainda não existe).

- [ ] **Step 3: Adicionar `description?: string` ao `FileDTO`**

In `src/api/file.ts`:

```ts
  /** Dominant colors extracted during indexing (see #66), oldest first by coverage. */
  palette?: PaletteColorDTO[];
  /**
   * Optional free-form description (e.g. the AI prompt used to generate this image).
   * Stored only in the database, never written to the file itself (#49).
   */
  description?: string;
```

- [ ] **Step 4: Expor campo observável no `ClientFile` e serializar**

In `src/frontend/entities/File.ts`:

```ts
  /**
   * Free-text description registered by the user (e.g. the AI prompt used).
   * Stored only in the DB via the auto-save reaction; missing = "no description" (#49).
   */
  @observable description?: string;

  // ... no constructor, após this.palette:
  this.description = fileProps.description;

  @action.bound setDescription(description: string): void {
    this.description = description;
  }
```

And in `serialize()`:

```ts
      palette: this.palette.slice(),
      description: this.description,
```

- [ ] **Step 5: Rodar o teste e confirmar pass**

Run: `npx jest tests/description.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/file.ts src/frontend/entities/File.ts tests/description.test.ts
git commit -m "feat(description): adiciona description ao FileDTO e ClientFile com round-trip (#49)"
```

- [ ] **Step 7: Garantir que `mergeMovedFile` preserva a descrição**

`mergeMovedFile` (File.ts:203-213) usa `...oldFile`, já preservando `description`. Adicionar teste documentando isso (append a `tests/description.test.ts`):

```ts
import { mergeMovedFile } from '../src/frontend/entities/File';

it('mergeMovedFile preserves description', () => {
  const oldFile = makeFileDTO({ description: 'prompt A' });
  const newFile = makeFileDTO({ name: 'b.jpg', relativePath: 'b.jpg', absolutePath: 'C:/loc/b.jpg' });
  const merged = mergeMovedFile(oldFile, newFile);
  expect(merged.description).toBe('prompt A');
});
```

Run: `npx jest tests/description.test.ts` — PASS.

---

### Task 2: Auto-save e tratamento de undefined

**Files:**
- Modify: `src/frontend/stores/FileStore.ts:367-380`
- Test: `tests/description.test.ts`

- [ ] **Step 1: Escrever teste de auto-save**

Append to `tests/description.test.ts`:

```ts
describe('ClientFile description auto-save', () => {
  it('persists when description changes via the save path', async () => {
    const saved: FileDTO[] = [];
    const store = {
      ...makeStore(),
      save: (dto: FileDTO) => saved.push(dto),
      getLocation: () => ({ path: 'C:/loc' }),
      getTags: () => [],
    };
    const file = new ClientFile(store as any, makeFileDTO());
    file.setDescription('nano banana');
    // Reaction triggers save with delay 500
    await new Promise((r) => setTimeout(r, 700));
    expect(saved.some((s) => s.description === 'nano banana')).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx jest tests/description.test.ts -t "auto-save"`
Expected: FAIL — `setDescription`/`description` não faz a reaction disparar (campo não trapado no observável hoje).

- [ ] **Step 3: Verificar que a reaction já cobre**

`ClientFile` usa `makeObservable` + `reaction(() => this.serialize(), ...)`. Como `description` é `@observable` e incluída no `serialize()`, a reaction já dispara. Adicionar `makeObservable` para novas propriedades:

- Confirmar que `makeObservable(this)` (File.ts:108) já observa `description` (decorator).
- O campo `description` fica no escopo dos inputs observáveis; nada mais a fazer no FileStore `save(`.

- [ ] **Step 4: Rodar teste passa**

Run: `npx jest tests/description.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/entities/File.ts tests/description.test.ts
git commit -m "feat(description): auto-save do description via reaction existente (#49)"
```

---

### Task 3: Backend — busca por `description`

**Files:**
- Modify: `src/backend/backend.ts:455-476` (filterStringLambda)
- Modify: `src/backend/backend.ts` (import TYPE de `FileDTO` já existe)
- Test: `tests/description-search.test.ts`

- [ ] **Step 1: Escrever teste de busca falhando**

Create `tests/description-search.test.ts` (use o padrão do `backend.test.ts`: `dbInit` + `Backend.init` + `createFilesFromPath`):

```ts
import { OrderDirection } from '../src/api/data-storage-search';
import { FileDTO } from '../src/api/file';
import Backend from '../src/backend/backend';
import { dbInit } from '../src/backend/config';

describe('Search by description', () => {
  let TEST_DATABASE_ID_COUNTER = 0;

  function makeFileDTO(overrides: Partial<FileDTO> = {}): FileDTO {
    return {
      id: '1',
      ino: 'ino1',
      locationId: 'loc',
      relativePath: 'a.jpg',
      absolutePath: 'c:/loc/a.jpg',
      tags: [],
      dateAdded: new Date(),
      dateModified: new Date(),
      dateLastIndexed: new Date(),
      name: 'a.jpg',
      extension: 'jpg',
      size: 1,
      width: 1,
      height: 1,
      dateCreated: new Date(),
      ...overrides,
    };
  }

  function test(name: string, fn: (backend: Backend) => Promise<void>): void {
    it(name, async () => {
      const db = dbInit(`Test_Desc_${TEST_DATABASE_ID_COUNTER++}`);
      const backend = await Backend.init(db, () => {});
      await fn(backend);
    });
  }

  test('finds a file whose description contains the term', async (backend) => {
    await backend.createFilesFromPath('c:/loc', [
      makeFileDTO({ id: '1', description: 'my nano banana prompt' }),
      makeFileDTO({ id: '2' }),
    ]);
    const result = await backend.searchFiles(
      { key: 'description', valueType: 'string', operator: 'contains', value: 'banana' },
      'name',
      OrderDirection.Asc,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  test('is robust when a file has no description (undefined)', async (backend) => {
    await backend.createFilesFromPath('c:/loc', [
      makeFileDTO({ id: '1', description: 'apple' }),
      makeFileDTO({ id: '2' }),
    ]);
    const result = await backend.searchFiles(
      { key: 'description', valueType: 'string', operator: 'contains', value: 'apple' },
      'name',
      OrderDirection.Asc,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  test('or: name or description', async (backend) => {
    await backend.createFilesFromPath('c:/loc', [
      makeFileDTO({ id: '1', description: 'banana' }),
      makeFileDTO({ id: '2', name: 'banana.jpg' }),
      makeFileDTO({ id: '3' }),
    ]);
    const result = await backend.searchFiles(
      [
        { key: 'description', valueType: 'string', operator: 'contains', value: 'banana' },
        { key: 'name', valueType: 'string', operator: 'contains', value: 'banana' },
      ],
      'name',
      OrderDirection.Asc,
      true, // matchAny = OR
    );
    expect(result).toHaveLength(2);
  });
});
```

(Use o nome de método real do backend para criar arquivos — verifique em `backend.ts`; se for `createFilesFromPath`/`saveFiles`, chame `await backend.saveFiles([...])` antes de buscar. Os asserts:
  - contém → arquivo com a palavra retorna 1 (não contém → 0)
  - `description` ausente/undefined não quebra o filtro
  - OR com name OU description casando nas duas partes retorna a soma correta)

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx jest tests/description-search.test.ts`
Expected: FAIL — `filterStringLambda` faz `(t[key] as string).toLowerCase()` → `TypeError` quando `description` é `undefined`.

- [ ] **Step 3: Tornar o lambda robusto a valores ausentes**

`filterStringLambda` (backend.ts:455):

```ts
function filterStringLambda<T>(crit: StringConditionDTO<T>): (t: any) => boolean {
  const { key, value } = crit;
  const valLow = value.toLowerCase();

  switch (crit.operator) {
    case 'equals':
      return (t: any) => (t[key] ?? '').toLowerCase() === valLow;
    case 'notEqual':
      return (t: any) => (t[key] ?? '').toLowerCase() !== valLow;
    case 'contains':
      return (t: any) => (t[key] ?? '').toLowerCase().includes(valLow);
    case 'notContains':
      return (t: any) => !(t[key] ?? '').toLowerCase().includes(valLow);
    case 'startsWith':
      return (t: any) => (t[key] ?? '').toLowerCase().startsWith(valLow);
    case 'notStartsWith':
      return (t: any) => !(t[key] ?? '').toLowerCase().startsWith(valLow);
    default:
      console.log('String operator not allowed:', crit.operator);
      return () => false;
  }
}
```

- [ ] **Step 4: Usar apenas lambda para o key `description`**

`description` não é indexada no Dexie (schema em `config.ts` não a define). O fluxo `searchFiles` (backend.ts:296-340):
- linha 328: `collection.where(firstCrit.key)` cria um `WhereClause`. Para `contains`, `filterStringWhere` retorna `filterStringLambda` (não consulta o índice) — funcionaria.
- PORÉM operadores `equals`/`startsWith`/etc. caem em `where[funcName](value)` (backend.ts:430-433) e lançam `SchemaError: Key description is not indexed`.

Corrigir `filterWhere` (backend.ts:351-365) roteando `description` sempre ao lambda:

```ts
function filterWhere<T>(
  where: WhereClause<T, string>,
  crit: ConditionDTO<T>,
): Collection<T, string> | ((val: T) => boolean) {
  switch (crit.valueType) {
    case 'array':
      return filterArrayWhere(where, crit);
    case 'string':
      // description is not indexed in Dexie: only the lambda can evaluate it safely
      return crit.key === 'description' ? filterStringLambda(crit) : filterStringWhere(where, crit);
    case 'number':
      return filterNumberWhere(where, crit);
    case 'date':
      return filterDateWhere(where, crit);
    default:
      throw new Error(`Unsupported valueType: ${crit.valueType}`);
  }
}
```

Nota (OR): em `searchFiles`, para o caso `conjunction === 'or'` (backend.ts:295-320), quando qualquer crit não for "where" ele cai para lambdas (`collection.filter(...)`), então `description` no OR continua seguro (o `table.or('description')` só é chamado se TODOS forem wheres; como description nunca é where, jamais chega ao `or()`). Confirmar com o teste `or: name or description`.

- [ ] **Step 5: Rodar testes**

Run: `npx jest tests/description-search.test.ts tests/description.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/backend/backend.ts tests/description-search.test.ts
git commit -m "feat(description): busca por description via string contains, robusto a undefined (#49)"
```

---

### Task 4: Advanced Search — key e input de descrição

**Files:**
- Modify: `src/frontend/containers/AdvancedSearch/data.ts:24-54, 56-78, 82-111, 112-129`
- Modify: `src/frontend/containers/AdvancedSearch/Inputs.tsx:49-78, 108-121`

- [ ] **Step 1: Adicionar `description` aos tipos de criteria**

In `data.ts`:

```ts
export type Criteria =
  | Field<'name' | 'absolutePath' | 'description', StringOperatorType, string>
  | ...
```

E na `Key` (Pick) adicionar `'description'`:

```ts
export type Key = keyof Pick<
  FileDTO,
  | 'name'
  | 'absolutePath'
  | 'description'
  | ...
>;
```

E em `defaultQuery` tratar como key string:

```ts
  if (key === 'name' || key === 'absolutePath' || key === 'description') {
    return { key, operator: 'contains', value: '' };
  }
```

E em `fromCriteria` e `intoCriteria` aceitar description igual as demais (a lógica de `ClientStringSearchCriteria` já cobre via `criteria instanceof` e incluir `description` nas condições):

```ts
  if (
    criteria instanceof ClientStringSearchCriteria &&
    (criteria.key === 'name' || criteria.key === 'absolutePath' || criteria.key === 'description')
  ) {
    query.value = criteria.value;
  }
```

E em `intoCriteria` (data.ts:94) incluir `description` também — sem isso o critério novo descripto não regenera `ClientStringSearchCriteria`:

```ts
  if (query.key === 'name' || query.key === 'absolutePath' || query.key === 'description' || query.key === 'extension') {
    return new ClientStringSearchCriteria(query.key, query.value, query.operator);
  }
```

- [ ] **Step 2: Adicionar opção no KeySelector**

`Inputs.tsx` no `<select>` depois de "File Path":

```tsx
      <option key="description" value="description">
        Description
      </option>
```

E em `ValueInput` tratar como PathInput-like text input:

```tsx
  if (keyValue === 'name' || keyValue === 'absolutePath' || keyValue === 'description') {
    return <PathInput labelledby={labelledby} value={value as string} dispatch={dispatch} />;
  }
```

E em `getOperatorOptions` (Inputs.tsx:295) tratar `description` como as demais strings, caso contrário retorna `[]` e não há operadores:

```ts
  } else if (key === 'name' || key === 'absolutePath' || key === 'description') {
    return StringOperators.map((op) => toOperatorOption(op, StringOperatorLabels));
  }
```

- [ ] **Step 3: Rodar testes e typecheck**

Run: `npx jest tests/description-search.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS e sem erros de tipo.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/containers/AdvancedSearch/data.ts src/frontend/containers/AdvancedSearch/Inputs.tsx
git commit -m "feat(description): criterio de descricao no Advanced Search (#49)"
```

---

### Task 5: UI no Inspector — textarea editável

**Files:**
- Create: `src/frontend/components/FileDescription.tsx`
- Modify: `src/frontend/containers/Inspector/index.tsx:30-51`
- Modify: `resources/style/content.scss` ou `resources/style/controls/input.scss` (estilo textarea)
- Test: `tests/description.test.ts` (render via react-test-renderer se existir, senão skip)

- [ ] **Step 1: Criar componente editor e usar no Inspector**

Create `src/frontend/components/FileDescription.tsx`:

```tsx
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { ClientFile } from '../entities/File';

const FileDescription = observer(({ file }: { file: ClientFile }) => {
  const [text, setText] = useState(file.description);
  const handleBlur = () => {
    if (text !== file.description) {
      file.setDescription(text);
    }
  };
  return (
    <textarea
      className="input file-description"
      value={text}
      placeholder="No description yet"
      onChange={(e) => setText(e.target.value)}
      onBlur={handleBlur}
      rows={4}
    />
  );
});

export default FileDescription;
```

- [ ] **Step 2: Inserir no Inspector (próximo de Tags)**

In `Inspector/index.tsx`: nova seção entre a de `Path` e `Tags`:

```tsx
      <section>
        <header>
          <h2>Description</h2>
        </header>
        <FileDescription key={first.id} file={first} />
      </section>
```

E import no topo.

> **Atenção** — o Inspector reutiliza o mesmo componente entre seleções, então `useState(file.description)` ficaria stale ao trocar de imagem. A solução usada é `key={first.id}`: o React remonta o `FileDescription` quando o arquivo selecionado muda.

- [ ] **Step 3: Estilo do textarea (opcional)**

In `resources/style/...` juntar ao padrão de `.input`. Se a UI padrão já cobrir, deixar herdado. Procurar `textarea` no stylesheet: usar classes existentes (`.input`) com `min-height` e `resize: vertical`.

- [ ] **Step 4: Rodar build e testes**

```bash
npx jest tests/description.test.ts
npx webpack --config webpack.prod.js
```

- [ ] **Step 5: Commit**

```bash
git add src/frontend/components/FileDescription.tsx src/frontend/containers/Inspector/index.tsx resources/style/
git commit -m "feat(description): campo editavel de descricao no Inspector (#49)"
```

---

### Task 6: Validação final e PR

- [ ] **Step 1: Rodar todos os gates**

```bash
npx jest
npx eslint "src/**/*{ts,tsx}"
npx webpack --config webpack.prod.js
```

- [ ] **Step 2: Push e PR**

```bash
git push origin feat/description
# criar PR via API (padrão .agents/github_helper)
```

- [ ] **Step 3: Mover #49 no Kanban para Testando & Review**

`node .agents/scripts/github_helper.js move 49 "Testando & Review"`