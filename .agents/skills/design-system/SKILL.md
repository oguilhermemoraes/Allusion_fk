# Allusion Design System Reference

Este documento é a referência oficial para o design do Allusion. NÃO INVENTE COMPONENTES.

> Documento de referÃªncia para agentes de IA implementando features no Allusion.
> O objetivo Ã© garantir consistÃªncia total com o design existente.
> **NUNCA invente componentes, cores ou padrÃµes nÃ£o listados aqui.**

---

## 1. Stack de UI

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript + React |
| Estilos | SCSS (mÃ³dulos globais + por componente) |
| Biblioteca de componentes | **Blueprint.js v4** (`@blueprintjs/core`) |
| Ãcones | **Blueprint Icons** (`@blueprintjs/icons`) + SVGs customizados |
| Temas | CSS custom properties via arquivos em `/themes/` |
| Renderer | Electron (Chromium) â€” sem polyfills de browser antigo |

> âš ï¸ Blueprint.js Ã© a fonte da verdade para componentes base.
> Sempre prefira um componente Blueprint existente antes de criar um custom.

---

## 2. Temas

O Allusion suporta temas via arquivos CSS na pasta `Allusion/themes/`.
Existem dois temas oficiais: **Dark (padrÃ£o)** e **Light**.

A classe raiz do tema dark Ã© `bp4-dark` aplicada no `<body>` ou no container principal.

### PrincÃ­pio dos temas
- A UI deve **recuar** e deixar o conteÃºdo visual do usuÃ¡rio em destaque
- Nunca use cores vibrantes na UI â€” o conteÃºdo (imagens) Ã© o elemento mais colorido da tela
- PreferÃªncia absoluta por **neutros escuros** no tema padrÃ£o

---

## 3. Paleta de Cores (Tema Dark â€” PadrÃ£o)

### Backgrounds
```
--bg-primary:      #1C1C1E   /* Fundo principal da janela */
--bg-secondary:    #252528   /* PainÃ©is laterais (Tags, Inspector) */
--bg-tertiary:     #2C2C2F   /* Cards, inputs, hover states */
--bg-elevated:     #323236   /* Dropdowns, tooltips, modais */
```

### Bordas e Divisores
```
--border-subtle:   #3A3A3E   /* Divisores entre painÃ©is */
--border-default:  #48484D   /* Bordas de inputs e cards */
--border-focus:    #6B8AFF   /* Foco em inputs (acessibilidade) */
```

### Texto
```
--text-primary:    #F2F2F7   /* Texto principal */
--text-secondary:  #A0A0A8   /* Labels, metadados, texto secundÃ¡rio */
--text-disabled:   #57575E   /* Estado desabilitado */
--text-muted:      #6E6E76   /* Placeholders */
```

### Accent / Interativo
```
--accent-primary:  #6B8AFF   /* SeleÃ§Ã£o, links, foco â€” azul Blueprint */
--accent-hover:    #5A78F0   /* Hover em elementos interativos */
--accent-active:   #4A68E0   /* Estado ativo/pressionado */
```

### Estado / Feedback
```
--color-success:   #3DCC91   /* Blueprint: intent=success */
--color-warning:   #FFB366   /* Blueprint: intent=warning */
--color-danger:    #FF7373   /* Blueprint: intent=danger */
--color-info:      #48AFF0   /* Blueprint: intent=primary */
```

### SeleÃ§Ã£o na Galeria
```
--selection-bg:    rgba(107, 138, 255, 0.25)   /* Overlay de seleÃ§Ã£o */
--selection-border: #6B8AFF                    /* Borda do item selecionado */
```

> âš ï¸ Para o tema Light, as variÃ¡veis se invertem mas os nomes permanecem os mesmos.
> Nunca hardcode valores hex â€” sempre use as CSS variables acima.

---

## 4. Tipografia

### Fonte
- **FamÃ­lia**: System font stack â€” `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- **NÃ£o use Google Fonts ou fontes externas**
- O Blueprint.js define a fonte base; nÃ£o a sobrescreva globalmente

### Escala
| Role | Tamanho | Peso | Uso |
|---|---|---|---|
| `--text-xs` | 11px | 400 | Badges, duraÃ§Ã£o de vÃ­deo, metadados compactos |
| `--text-sm` | 12px | 400 | Labels de painel, nomes de tag, tooltips |
| `--text-base` | 14px | 400 | Corpo de texto padrÃ£o (Blueprint default) |
| `--text-md` | 16px | 500 | TÃ­tulos de seÃ§Ã£o em painÃ©is |
| `--text-lg` | 18px | 600 | TÃ­tulos de modal/dialog |

### Regras
- **Nunca use `font-size` abaixo de 11px**
- Text overflow em elementos de largura fixa: sempre `text-overflow: ellipsis` + `overflow: hidden` + `white-space: nowrap`
- NÃ£o use `font-weight` maior que 600

---

## 5. EspaÃ§amento

Baseado na grade de **4px**:

```
--space-1:   4px
--space-2:   8px
--space-3:  12px
--space-4:  16px
--space-5:  20px
--space-6:  24px
--space-8:  32px
--space-10: 40px
```

### Padding de Componentes
| Componente | Padding |
|---|---|
| Painel lateral (interno) | `12px` horizontal, `8px` vertical |
| Item de lista (tag, arquivo) | `4px 8px` |
| Toolbar | `0 8px`, altura `36px` |
| Card de thumbnail | `0` (sem padding â€” imagem full bleed) |
| Modal/Dialog | `20px` |
| Input | `8px 10px` (Blueprint padrÃ£o) |

---

## 6. Layout e Estrutura

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  TOOLBAR (36px height, full width)              â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚          â”‚                      â”‚               â”‚
â”‚  SIDEBAR â”‚   GALLERY (main)     â”‚  INSPECTOR    â”‚
â”‚  LEFT    â”‚                      â”‚  PANEL        â”‚
â”‚  ~240px  â”‚   flex-grow: 1       â”‚  ~280px       â”‚
â”‚          â”‚                      â”‚               â”‚
â”‚  (Tags,  â”‚   Grid de thumbs     â”‚  (Metadata,   â”‚
â”‚  Folders)â”‚   Masonry/uniform    â”‚  Tags do item)â”‚
â”‚          â”‚                      â”‚               â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Regras de Layout
- Os trÃªs painÃ©is sÃ£o **redimensionÃ¡veis** via drag â€” respeitar esse comportamento em qualquer novo painel
- PainÃ©is laterais tÃªm **largura mÃ­nima de 160px** e **mÃ¡xima de 400px**
- Nenhum elemento deve ter `position: fixed` dentro dos painÃ©is (quebra o resize)
- Use `flex` para layouts internos; evite `grid` exceto na galeria

---

## 7. Galeria

### Modos de VisualizaÃ§Ã£o
| Modo | Layout | DescriÃ§Ã£o |
|---|---|---|
| Grid | Uniform grid | Thumbnails de tamanho igual, ajustÃ¡vel por slider |
| Masonry | Altura variÃ¡vel | Resposta Ã  proporÃ§Ã£o real da imagem |
| List | Linha horizontal | Thumbnail pequeno + metadados em linha |

### Thumbnail Card
- **Sem border-radius** nos cards por padrÃ£o (imagens full bleed)
- **Borda de seleÃ§Ã£o**: `2px solid var(--selection-border)` + `outline` para acessibilidade
- **Hover**: overlay escuro `rgba(0,0,0,0.15)` + cursors de aÃ§Ã£o (Ã­cone de tag, etc.)
- **Nenhum texto** dentro do card exceto badges especÃ­ficos (duraÃ§Ã£o de vÃ­deo, formato)
- Background do card enquanto thumb carrega: `var(--bg-tertiary)`

---

## 8. Componentes Blueprint.js em Uso

> Sempre use os componentes Blueprint nativos. NÃ£o crie substitutos custom para os itens abaixo.

| Componente | Blueprint | Uso no Allusion |
|---|---|---|
| BotÃ£o | `<Button>` | Toolbar, aÃ§Ãµes em painÃ©is |
| Input de texto | `<InputGroup>` | Busca, rename de tags |
| Dropdown | `<Select>` / `<Popover>` | Filtros, ordenaÃ§Ã£o |
| Menu contextual | `<ContextMenu>` + `<Menu>` | Clique direito em imagem/tag |
| Dialog/Modal | `<Dialog>` | Settings, confirmaÃ§Ãµes |
| Tooltip | `<Tooltip>` | Dicas em Ã­cones da toolbar |
| Tree | `<Tree>` | Painel de Tags e Locations |
| Tag | `<Tag>` | Tags nas imagens, filtros ativos |
| Spinner | `<Spinner>` | Loading states |
| Slider | `<Slider>` | Tamanho dos thumbnails |
| Checkbox | `<Checkbox>` | SeleÃ§Ã£o em filtros |
| Alert | `<Alert>` | ConfirmaÃ§Ã£o de exclusÃ£o |

### Variantes de Intent
Sempre use as props `intent` do Blueprint para feedback:
```tsx
<Button intent="primary" />   // aÃ§Ã£o principal
<Button intent="danger" />    // aÃ§Ãµes destrutivas (deletar)
<Button intent="success" />   // confirmaÃ§Ãµes
<Tag intent="primary" />      // tag ativa/selecionada
```

---

## 9. Ãcones

- **Fonte Ãºnica**: `@blueprintjs/icons` para Ã­cones de UI
- **SVG customizados**: apenas para Ã­cones sem equivalente no Blueprint
- Tamanho padrÃ£o: `16px` (Blueprint default)
- Tamanho em toolbar: `16px`
- Tamanho em painÃ©is compactos: `14px`
- **Nunca use emojis como Ã­cones de UI**
- Cor dos Ã­cones: herda `var(--text-secondary)` por padrÃ£o; `var(--text-primary)` em hover/ativo

---

## 10. Estados de InteraÃ§Ã£o

```
Default  â†’ background: transparent
Hover    â†’ background: var(--bg-tertiary), transiÃ§Ã£o 100ms ease
Active   â†’ background: var(--bg-elevated)
Selected â†’ background: var(--accent-primary) a 20%, borda accent
Disabled â†’ opacity: 0.4, cursor: not-allowed
Focus    â†’ outline: 2px solid var(--border-focus), outline-offset: 2px
```

### TransiÃ§Ãµes
- DuraÃ§Ã£o padrÃ£o: `100ms` (UI responsiva â€” nÃ£o use animaÃ§Ãµes longas)
- Propriedades animÃ¡veis: `background-color`, `opacity`, `transform`
- **Nunca anime `width`, `height` ou `layout properties`** em listas grandes (performance)

---

## 11. PainÃ©is Laterais

### Painel Esquerdo (Tags / Locations)
- Background: `var(--bg-secondary)`
- Hierarquia em Ã¡rvore via `<Tree>` do Blueprint
- Item de Ã¡rvore: altura `28px`, padding `4px 8px`
- Ãcone de pasta/tag Ã  esquerda, nome do item, contador Ã  direita
- Drag-and-drop para reordenar â€” manter comportamento existente

### Painel Direito (Inspector)
- Background: `var(--bg-secondary)`
- SeÃ§Ãµes colapsÃ¡veis com `<Collapse>` do Blueprint
- TÃ­tulo de seÃ§Ã£o: `var(--text-secondary)`, `font-size: 11px`, `text-transform: uppercase`, `letter-spacing: 0.08em`
- Separador entre seÃ§Ãµes: `1px solid var(--border-subtle)`

---

## 12. Toolbar

- Altura fixa: `36px`
- Background: `var(--bg-secondary)` com `border-bottom: 1px solid var(--border-subtle)`
- BotÃµes de toolbar: `<Button minimal icon="..." />` (prop `minimal` obrigatÃ³ria)
- Grupos de botÃµes separados por `<Divider />` do Blueprint
- Busca: `<InputGroup leftIcon="search" />` com largura expansÃ­vel no focus

---

## 13. Scrollbars

Estilizadas via CSS `::-webkit-scrollbar`:
```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: var(--border-default);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover { background: var(--text-disabled); }
```

---

## 14. Regras Proibidas (NUNCA faÃ§a)

- âŒ NÃ£o use `!important` nos estilos (exceto overrides de Blueprint que exigem)
- âŒ NÃ£o crie componentes de botÃ£o, input ou modal do zero â€” use Blueprint
- âŒ NÃ£o use cores fora da paleta definida acima
- âŒ NÃ£o adicione `border-radius` em thumbnails/cards da galeria
- âŒ NÃ£o use fontes externas
- âŒ NÃ£o anime propriedades de layout em listas com muitos itens
- âŒ NÃ£o use `z-index` acima de `1000` sem documentar motivo
- âŒ NÃ£o adicione shadows (`box-shadow`) em elementos que jÃ¡ tÃªm borda â€” escolha um ou outro
- âŒ NÃ£o crie novos painÃ©is flutuantes â€” todo conteÃºdo pertence a um dos 3 painÃ©is existentes ou a um `<Dialog>`
- âŒ NÃ£o use `px` para font-size fora da escala tipogrÃ¡fica definida

---

## 15. Checklist para Novas Features

Antes de submeter qualquer implementaÃ§Ã£o, verificar:

- [ ] Usa componentes Blueprint.js onde possÃ­vel?
- [ ] Funciona tanto no tema Dark quanto no Light?
- [ ] Usa CSS variables (nÃ£o hex hardcoded)?
- [ ] Respeita o espaÃ§amento na grade de 4px?
- [ ] Elementos interativos tÃªm todos os estados (hover, active, focus, disabled)?
- [ ] Nenhum elemento quebra o layout ao redimensionar os painÃ©is?
- [ ] Ãcones sÃ£o do `@blueprintjs/icons`?
- [ ] Nenhuma animaÃ§Ã£o com duraÃ§Ã£o > 200ms?
- [ ] Textos longos tÃªm ellipsis em containers de largura fixa?
- [ ] Scrollbars seguem o estilo global?
