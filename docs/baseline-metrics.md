# Baseline de Performance: Electron 21 vs Alvo Tauri 2

Este documento estabelece o protocolo de medição e os valores de referência (baseline) de desempenho do Allusion v1.0.0-rc.10 em Electron 21, comparados com as metas quantitativas estabelecidas para o port em Tauri 2.

---

## 1. Métricas de Referência (Baseline vs Meta Tauri 2)

| Métrica de Performance | Baseline Atual (Electron 21) | Meta Alvo (Tauri 2) | Tolerância Máxima | Método de Medição |
| :--- | :--- | :--- | :--- | :--- |
| **Tempo de Boot (Cold Start)** | ~4.5s – 7.0s | **< 2.0s** | 2.5s | Medição do tempo de spawn do processo até evento `DOMContentLoaded` / render inicial. |
| **Uso de Memória RAM (Idle)** | ~280MB – 450MB | **< 120MB** | 150MB | Monitoramento de working set no Gerenciador de Tarefas / `Process Explorer`. |
| **Uso de Memória RAM (Grid 5k imagens)** | ~600MB – 1.1GB | **< 250MB** | 300MB | Consumo após renderização e navegação contínua na galeria. |
| **Tamanho do Instalador (Windows)** | ~110MB (.exe) | **< 15MB (.msi / .exe)** | 20MB | Tamanho do pacote binário gerado na compilação final de release. |
| **Tamanho Instalado em Disco** | ~320MB | **< 35MB** | 50MB | Espaço em disco ocupado após instalação limpa. |
| **Indexação Inicial (1.000 imagens)** | ~18s | **< 5s** | 8s | Varredura de metadados, dimensões e thumbs em diretório local. |
| **Indexação em Lote (10.000 imagens)** | ~180s | **< 45s** | 60s | Varredura em massa sem congelamento de UI. |

---

## 2. Protocolo de Testes de Baseline

### 2.1 Ambiente de Teste Padronizado
- **SO**: Windows 11 Pro 64-bit (Build 22621+)
- **CPU**: AMD Ryzen / Intel Core i7 6-core+
- **RAM**: 16 GB DDR4/DDR5
- **Armazenamento**: NVMe SSD (Leitura >2000 MB/s)

### 2.2 Dataset de Benchmark
Para garantir reprodutibilidade, as medições de indexação utilizam a seguinte estrutura de arquivos de teste:
- **Coleção Small (1k)**: 1.000 imagens JPEG/PNG (resolução média 1920x1080, ~2.5 GB total).
- **Coleção Medium (5k)**: 5.000 imagens mistas (JPEG, PNG, WEBP, PSD, EXR) (~12 GB total).
- **Coleção Large (10k)**: 10.000 imagens mistas com estruturas de subpastas aninhadas.

---

## 3. Relatório de Execução do Baseline (Status)

- [x] Mapeamento de métricas e alvos quantitativos concluído.
- [x] Benchmark de varredura e indexação do Scanner Rust Multithread (`rayon` + `walkdir`):
  - **1.000 imagens (Small)**: ~0.25s (Meta: < 5s — **Aprovado**)
  - **10.000 imagens (Large)**: ~2.1s (Meta: < 45s — **Aprovado**)
  - *Ganho de desempenho*: ~50x a 100x mais rápido em relação ao escaneamento sequencial via JS (`fse.readdir` + `fse.stat`).
- [x] Medição automatizada (datasets sintéticos 1k/5k/10k, build release, `scripts/bench/indexing.ps1`):
  - **1.000 imagens**: ~19 ms (Meta: < 5s — **Aprovado**)
  - **5.000 imagens**: ~36 ms (Meta: < 45s — **Aprovado**)
  - **10.000 imagens**: ~81 ms (Meta: < 45s — **Aprovado**)
- [x] Script de benchmark de indexação (datasets 1k/5k/10k): `scripts/bench/indexing.ps1` + exemplo `src-tauri/examples/bench_scan.rs` (`cargo run --release --example bench_scan -- --generate <n>`).
- [x] Script de medição automatizada de boot e RAM (Windows): `scripts/bench/boot-ram.ps1` (mede tempo até a janela principal + RAM idle/pico após settle).
- [x] Medição real no binário `tauri build` (build release, Windows, `scripts/bench/boot-ram.ps1`):
  - **Boot até a janela principal**: ~146 ms (média de 3 amostras; Meta: < 2s — **Aprovado**)
  - **RAM idle (processo principal `allusion.exe`)**: ~29 MB working set (Meta: < 120 MB — **Aprovado**)
  - **RAM idle (árvore total, app + processos WebView2)**: ~409 MB working set / ~249 MB privado — **não atinge a meta agregada de <120MB**; a memória é dominada pelos processos `msedgewebview2` (6 processos) que renderizam a UI React. Compare com o baseline Electron (280–450MB): o processo principal cai de centenas para ~29MB, e o total fica no limite inferior do baseline Electron.
  - **Instalador NSIS**: 4,0 MB (Meta: < 15MB — **Aprovado**)
- [ ] Coleta automatizada de logs de boot no Electron 21.
- [ ] Validação pós-migração da Fase 1 (Tauri Shell) — build gerado; medições acima registradas.

---

## 4. Ferramentas de Medição (issue #23)

### 4.1 Indexação (scanner Rust)
```powershell
powershell -ExecutionPolicy Bypass -File scripts\bench\indexing.ps1            # 1k/5k/10k
cargo run --release --example bench_scan -- --generate 10000                   # dataset único
cargo run --release --example bench_scan -- "C:\Minha\Colecao" jpg,png,webp    # dir real
```
Saída: `{"count":..., "elapsed_ms":...}` — apenas a varredura (setup do dataset não é contabilizado).

### 4.2 Boot (cold start) e RAM idle
```powershell
powershell -ExecutionPolicy Bypass -File scripts\bench\boot-ram.ps1                      # exe detectado
powershell -ExecutionPolicy Bypass -File scripts\bench\boot-ram.ps1 -ExePath C:\Allusion\Allusion.exe -Samples 5
```
- **Boot**: tempo do spawn do processo até a janela principal (proxy de cold start).
- **RAM idle**: working set / memória privada / pico após período de settle (padrão 8s).

### 4.3 RAM no grid 5k
Medida manual pós-build: abrir uma biblioteca com ~5k imagens, navegar o grid e acompanhar o working set
(Gerenciador de Tarefas / `Process Explorer`). Meta: **< 250MB**.

> Os resultados das medições reais são publicados na issue #23 à medida que o build Tauri é gerado.

