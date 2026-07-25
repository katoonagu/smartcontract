param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$RunId,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ScenarioId,

  [Parameter(Mandatory = $true)]
  [ValidateSet("before", "during", "after")]
  [string]$Phase,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int]$NodePid,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$RuntimeSnapshotPath,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$OutputPath,

  [string]$SummaryPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Read-MemInfoBytes {
  param(
    [AllowNull()]
    [string]$MemInfo,
    [string]$Name
  )
  if ([string]::IsNullOrWhiteSpace($MemInfo)) {
    return $null
  }
  $match = [regex]::Match(
    $MemInfo,
    "(?m)^" + [regex]::Escape($Name) + ":\s+(\d+)\s+kB\s*$"
  )
  if (-not $match.Success) {
    return $null
  }
  return [int64]::Parse($match.Groups[1].Value) * 1024
}

function Require-NonNegativeInt64 {
  param(
    [object]$Value,
    [string]$Name
  )
  $parsed = 0L
  if (
    -not [int64]::TryParse(
      [string]$Value,
      [System.Globalization.NumberStyles]::Integer,
      [System.Globalization.CultureInfo]::InvariantCulture,
      [ref]$parsed
    ) -or
    $parsed -lt 0
  ) {
    throw "unified_memory_runtime_snapshot_invalid:$Name"
  }
  return $parsed
}

function Write-Utf8NoBom {
  param(
    [string]$Path,
    [string]$Content
  )
  $parent = [System.IO.Path]::GetDirectoryName(
    [System.IO.Path]::GetFullPath($Path)
  )
  if (-not [System.IO.Directory]::Exists($parent)) {
    throw "unified_memory_output_directory_missing"
  }
  [System.IO.File]::WriteAllText(
    [System.IO.Path]::GetFullPath($Path),
    $Content,
    [System.Text.UTF8Encoding]::new($false)
  )
}

$runtimePath = [System.IO.Path]::GetFullPath($RuntimeSnapshotPath)
if (-not [System.IO.File]::Exists($runtimePath)) {
  throw "unified_memory_runtime_snapshot_missing"
}
[void](Get-Process -Id $NodePid -ErrorAction Stop)
$runtime = Get-Content -Raw -Encoding UTF8 $runtimePath |
  ConvertFrom-Json
$rssBytes = Require-NonNegativeInt64 $runtime.rssBytes "rssBytes"
$heapUsedBytes = Require-NonNegativeInt64 `
  $runtime.heapUsedBytes `
  "heapUsedBytes"
if ($rssBytes -lt 1 -or $heapUsedBytes -lt 1 -or $heapUsedBytes -gt $rssBytes) {
  throw "unified_memory_runtime_snapshot_invalid"
}

$vmmem = Get-Process -Name vmmemWSL -ErrorAction SilentlyContinue |
  Select-Object -First 1
$vmmemBytes = if ($null -eq $vmmem) {
  $null
} else {
  [int64]$vmmem.WorkingSet64
}
$memInfo = $null
try {
  $wslCommand = Get-Command wsl.exe -ErrorAction Stop
  $memInfoOutput = & $wslCommand.Source -- cat /proc/meminfo 2>$null
  if ($LASTEXITCODE -eq 0) {
    $memInfo = [string]::Join(
      [Environment]::NewLine,
      @($memInfoOutput)
    )
  }
} catch {
  $memInfo = $null
}
$memAvailableBytes = Read-MemInfoBytes $memInfo "MemAvailable"
$swapTotalBytes = Read-MemInfoBytes $memInfo "SwapTotal"
$swapFreeBytes = Read-MemInfoBytes $memInfo "SwapFree"
$localCaptured =
  $null -ne $vmmemBytes -and
  $null -ne $memAvailableBytes -and
  $null -ne $swapTotalBytes -and
  $null -ne $swapFreeBytes

$sample = [ordered]@{
  capturedAt = [DateTime]::UtcNow.ToString(
    "yyyy-MM-ddTHH:mm:ss.fffZ",
    [System.Globalization.CultureInfo]::InvariantCulture
  )
  localWslDiagnostic = [ordered]@{
    linuxMemAvailableBytes = if ($localCaptured) {
      $memAvailableBytes
    } else {
      $null
    }
    linuxSwapFreeBytes = if ($localCaptured) {
      $swapFreeBytes
    } else {
      $null
    }
    linuxSwapTotalBytes = if ($localCaptured) {
      $swapTotalBytes
    } else {
      $null
    }
    status = if ($localCaptured) { "captured" } else { "skipped" }
    vmmemWslWorkingSetBytes = if ($localCaptured) {
      $vmmemBytes
    } else {
      $null
    }
  }
  nodePid = $NodePid
  phase = $Phase
  runId = $RunId
  runtime = [ordered]@{
    heapUsedBytes = $heapUsedBytes
    rssBytes = $rssBytes
  }
  scenarioId = $ScenarioId
  version = "unified-memory-sample-v1"
}

$samples = @()
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
if ([System.IO.File]::Exists($resolvedOutput)) {
  $samples = @(
    Get-Content -Raw -Encoding UTF8 $resolvedOutput |
      ConvertFrom-Json
  )
}
if ($samples | Where-Object {
  $_.runId -ne $RunId -or $_.scenarioId -ne $ScenarioId
}) {
  throw "unified_memory_sample_identity_mismatch"
}
if ($samples | Where-Object { $_.phase -eq $Phase }) {
  throw "unified_memory_sample_phase_duplicate"
}
$samples += [pscustomobject]$sample
$orderedSamples = @(
  foreach ($name in @("before", "during", "after")) {
    $samples | Where-Object { $_.phase -eq $name }
  }
)
Write-Utf8NoBom `
  $resolvedOutput `
  (ConvertTo-Json -InputObject $orderedSamples -Depth 8 -Compress)

if (
  $Phase -eq "after" -and
  -not [string]::IsNullOrWhiteSpace($SummaryPath)
) {
  $before = $orderedSamples | Where-Object { $_.phase -eq "before" } |
    Select-Object -First 1
  $during = $orderedSamples | Where-Object { $_.phase -eq "during" } |
    Select-Object -First 1
  $after = $orderedSamples | Where-Object { $_.phase -eq "after" } |
    Select-Object -First 1
  if ($null -eq $before -or $null -eq $during -or $null -eq $after) {
    throw "unified_memory_summary_phases_incomplete"
  }
  $wslComplete = @($before, $during, $after) |
    Where-Object { $_.localWslDiagnostic.status -ne "captured" } |
    Measure-Object |
    Select-Object -ExpandProperty Count
  $wslComplete = $wslComplete -eq 0
  $swapGrowth = if ($wslComplete) {
    $beforeSwapUsed =
      [int64]$before.localWslDiagnostic.linuxSwapTotalBytes -
      [int64]$before.localWslDiagnostic.linuxSwapFreeBytes
    $afterSwapUsed =
      [int64]$after.localWslDiagnostic.linuxSwapTotalBytes -
      [int64]$after.localWslDiagnostic.linuxSwapFreeBytes
    $afterSwapUsed - $beforeSwapUsed
  } else {
    $null
  }
  $summary = [ordered]@{
    completedAt = $sample.capturedAt
    diagnosticStatus = if ($wslComplete) { "captured" } else { "skipped" }
    runId = $RunId
    runtimeTrend = [ordered]@{
      afterRssBytes = [int64]$after.runtime.rssBytes
      beforeRssBytes = [int64]$before.runtime.rssBytes
      peakRssBytes = [int64](
        @($before, $during, $after) |
          ForEach-Object { [int64]$_.runtime.rssBytes } |
          Measure-Object -Maximum |
          Select-Object -ExpandProperty Maximum
      )
      postRunRssDeltaBytes =
        [int64]$after.runtime.rssBytes -
        [int64]$before.runtime.rssBytes
    }
    scenarioId = $ScenarioId
    scope = "local_wsl_diagnostic"
    verdict = "diagnostic_only"
    version = "unified-local-wsl-memory-summary-v1"
    wslTrend = [ordered]@{
      linuxAvailableDeltaBytes = if ($wslComplete) {
        [int64]$after.localWslDiagnostic.linuxMemAvailableBytes -
        [int64]$before.localWslDiagnostic.linuxMemAvailableBytes
      } else {
        $null
      }
      postRunVmmemDeltaBytes = if ($wslComplete) {
        [int64]$after.localWslDiagnostic.vmmemWslWorkingSetBytes -
        [int64]$before.localWslDiagnostic.vmmemWslWorkingSetBytes
      } else {
        $null
      }
      swapUsedGrowthBytes = $swapGrowth
    }
  }
  Write-Utf8NoBom `
    ([System.IO.Path]::GetFullPath($SummaryPath)) `
    ($summary | ConvertTo-Json -Depth 8 -Compress)
}
