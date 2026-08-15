param(
  [string]$ExePath = '',
  [int]$Samples = 3,
  [int]$SettleSeconds = 8
)

# Medição automatizada de boot (cold start) e RAM idle para o binário Tauri (issue #23).
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\bench\boot-ram.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\bench\boot-ram.ps1 -ExePath C:\path\to\Allusion.exe -Samples 5
#
# Boot: tempo até a janela principal do processo aparecer (proxy de cold start).
# RAM:  working set / memória privada / pico após um período de settle (idle).

$ErrorActionPreference = 'Stop'

if (-not $ExePath) {
  $candidates = @(
    (Join-Path $PSScriptRoot '..\..\src-tauri\target\release\Allusion.exe'),
    (Join-Path $PSScriptRoot '..\..\src-tauri\target\release\allusion.exe')
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $ExePath = (Resolve-Path $c).Path; break }
  }
}
if (-not $ExePath -or -not (Test-Path $ExePath)) {
  Write-Error 'Binário não encontrado. Rode primeiro `npm run tauri build` ou passe -ExePath <caminho>.'
}

# Coleta a memória (working set) do processo + toda a árvore de filhos
# (WebView2 roda em processos msedgewebview2.exe separados).
function Get-TreeMemoryMB([int]$RootPid) {
  $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  $all = @{}
  foreach ($p in $procs) { $all[$p.ProcessId] = $p.ParentProcessId }
  $ids = New-Object System.Collections.Generic.HashSet[int]
  [void]$ids.Add($RootPid)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($k in $all.Keys) {
      if (-not $ids.Contains($k) -and $ids.Contains($all[$k])) {
        [void]$ids.Add($k)
        $changed = $true
      }
    }
  }
  $totalMB = 0
  foreach ($id in $ids) {
    $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($proc) { $totalMB += $proc.WorkingSet64 / 1MB }
  }
  return [Math]::Round($totalMB, 1)
}

Write-Host "Medindo: $ExePath" -ForegroundColor Cyan
Write-Host "Amostras: $Samples | settle: ${SettleSeconds}s`n" -ForegroundColor Cyan

$rows = @()
for ($i = 1; $i -le $Samples; $i++) {
  $p = Start-Process -FilePath $ExePath -PassThru
  $sw = [System.Diagnostics.Stopwatch]::StartNew()

  $deadline = (Get-Date).AddSeconds(60)
  while (-not $p.HasExited -and $p.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 100
    $p.Refresh()
  }
  $sw.Stop()
  $bootMs = [Math]::Round($sw.Elapsed.TotalMilliseconds, 0)

  Start-Sleep -Seconds $SettleSeconds
  $p.Refresh()
  $idleMB = [Math]::Round($p.WorkingSet64 / 1MB, 1)
  $privMB = [Math]::Round($p.PrivateMemorySize64 / 1MB, 1)
  $peakMB = [Math]::Round($p.PeakWorkingSet64 / 1MB, 1)
  $treeMB = Get-TreeMemoryMB $p.Id

  $rows += [pscustomobject]@{
    Amostra        = $i
    BootToWindowMs = $bootMs
    IdleRAMMB      = $idleMB
    TreeRAMMB      = $treeMB
    PrivateMB      = $privMB
    PeakWSMB       = $peakMB
  }

  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

$rows | Format-Table -AutoSize

$avgBoot = [Math]::Round(($rows | Measure-Object -Property BootToWindowMs -Average).Average, 0)
$avgIdle = [Math]::Round(($rows | Measure-Object -Property IdleRAMMB -Average).Average, 1)
$avgTree = [Math]::Round(($rows | Measure-Object -Property TreeRAMMB -Average).Average, 1)
$avgPeak = [Math]::Round(($rows | Measure-Object -Property PeakWSMB -Average).Average, 1)

Write-Host 'Resumo:' -ForegroundColor Cyan
Write-Host ("  Boot até janela : {0} ms  (meta < 2000 ms)  {1}" -f $avgBoot, $(if ($avgBoot -lt 2000) { '[APROVADO]' } else { '[FORA DA META]' }))
Write-Host ("  RAM idle (app)   : {0} MB (working set)  (meta < 120 MB)  {1}" -f $avgIdle, $(if ($avgIdle -lt 120) { '[APROVADO]' } else { '[FORA DA META]' }))
Write-Host ("  RAM idle (árvore): {0} MB (app + WebView2 filhos)" -f $avgTree)
Write-Host ("  Pico working set : {0} MB" -f $avgPeak)
