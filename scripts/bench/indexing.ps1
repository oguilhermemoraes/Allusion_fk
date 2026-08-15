param(
  [int[]]$Sizes = @(1000, 5000, 10000)
)

# Benchmark de indexação do scanner Rust (issue #23).
# Compila o exemplo bench_scan, gera datasets sintéticos de 1k/5k/10k e mede o tempo de varredura.

$ErrorActionPreference = 'Stop'
$tauriDir = Join-Path $PSScriptRoot '..\..\src-tauri'
$exe = Join-Path $tauriDir 'target\release\examples\bench_scan.exe'

Write-Host '=== Build do exemplo bench_scan (release) ===' -ForegroundColor Cyan
Push-Location $tauriDir
cargo build --release --example bench_scan
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  Write-Error 'Falha ao compilar o exemplo bench_scan'
}
Pop-Location

Write-Host "`n=== Benchmark de indexação (scanner Rust multithread) ===" -ForegroundColor Cyan
# NativeCommandError do stderr dos exemplos não pode virar erro fatal
$ErrorActionPreference = 'Continue'
$rows = @()
foreach ($n in $Sizes) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $out = & $exe --generate $n 2>$null | Out-String
  $sw.Stop()
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Falha no dataset de $n imagens: $out"
    continue
  }
  $json = $out | ConvertFrom-Json
  $rows += [pscustomobject]@{
    Imagens       = $n
    Arquivos      = $json.count
    ScanMs        = $json.elapsed_ms
    TotalComSetup = [Math]::Round($sw.Elapsed.TotalMilliseconds, 0)
  }
}
$rows | Format-Table -AutoSize

if ($rows.Count -gt 0) {
  Write-Host 'Resumo (ScanMs):' -ForegroundColor Cyan
  foreach ($r in $rows) {
    $threshold = if ($r.Imagens -le 1000) { 5000 } else { 45000 }
    $status = if ($r.ScanMs -lt $threshold) { 'APROVADO' } else { 'FORA DA META' }
    Write-Host ("  {0,6} imagens -> {1,6} ms  (meta < {2}s)  [{3}]" -f $r.Imagens, $r.ScanMs, [int]($threshold / 1000), $status)
  }
}

# limpa datasets sintéticos
$tempDir = Join-Path $env:TEMP 'allusion-bench-*'
Get-ChildItem -Path (Split-Path $tempDir) -Filter (Split-Path $tempDir -Leaf) -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^allusion-bench-\d+$' } |
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
