# Critérios de Aceite da Fase 1: Shell Tauri 2 com UI React Preservada

Este documento especifica a suíte de validação e os critérios formais de aceite para a conclusão da **Fase 1**, garantindo que a substituição do runtime Electron 21 pelo Tauri 2 ocorra sem regressões na experiência do usuário.

---

## 1. Critérios de Aceite Quantitativos

- [ ] **Tempo de Cold Start**: Inicialização completa da janela principal em menos de **3.0 segundos** no Windows.
- [ ] **Footprint de RAM em Idle**: Consumo de memória RAM inferior a **200 MB** com a galeria inicial carregada.
- [ ] **Tamanho do Executável**: Binário empacotado (`.exe` / `.msi`) menor que **25 MB**.
- [ ] **Estabilidade**: Zero travamentos ou crashes não tratados durante 30 minutos de navegação contínua.

---

## 2. Matriz de Verificação de Funcionalidades Críticas (15 Pontos de Teste)

| ID | Funcionalidade | Comportamento Esperado na Fase 1 | Status |
| :--- | :--- | :--- | :--- |
| **FN01** | Inicialização da Janela | Janela principal abre com o tema light/dark correto e sem flashes brancos na carga. | [ ] |
| **FN02** | Carregamento da Galeria | Grid de miniaturas carrega imagens locais via protocolo customizado sem erros de CORS. | [ ] |
| **FN03** | Adição de Locais (Pastas) | Diálogo nativo de seleção de pasta abre e permite adicionar novo diretório à biblioteca. | [ ] |
| **FN04** | Navegação por Tags | Filtro por tags laterais reflete instantaneamente as imagens visíveis no grid. | [ ] |
| **FN05** | Visualização de Imagem | Clique duplo abre o modo de exibição individual (fullview) da imagem com zoom e pan. | [ ] |
| **FN06** | Edição de Metadados / Tags | Adicionar/remover tag em uma imagem atualiza o IndexedDB e a UI via MobX. | [ ] |
| **FN07** | Leitura de EXIF (Sidecar) | Painel de detalhes exibe informações de abertura, ISO, câmera e resolução da imagem. | [ ] |
| **FN08** | Layout Masonry | Grid posiciona imagens em colunas mantendo a proporção de aspecto (WASM/Rust). | [ ] |
| **FN09** | Drag and Drop | É possível arrastar arquivos de imagem para dentro do aplicativo para importar. | [ ] |
| **FN10** | Busca e Filtros | Campo de busca por nome de arquivo e tags responde em tempo real. | [ ] |
| **FN11** | File Watcher | Adicionar/deletar um arquivo na pasta monitorada reflete na galeria sem recarregar o app. | [ ] |
| **FN12** | Redimensionamento da Janela | O layout do grid se adapta dinamicamente sem quebras visuais ao redimensionar a janela. | [ ] |
| **FN13** | Suporte a Formatos (PSD/TIFF)| Visualização de arquivos PSD e TIFF usando decodificadores JS/WASM integrados. | [ ] |
| **FN14** | Menu de Configurações | Abertura do modal de configurações e alteração de preferências salvas no localStorage. | [ ] |
| **FN15** | Fechamento Limpo | Encerrar o app libera todos os processos filho e threads de background sem deixar processos órfãos. | [ ] |

---

## 3. Protocolo de Aprovação do PR da Fase 1

1. Todos os 15 testes funcionais acima devem estar marcados como aprovados.
2. Nenhuma exceção não capturada ou erro de runtime deve constar no console do DevTools.
3. O build de release pelo `tauri build` deve concluir sem warnings de compilação impeditivos no Rust.
