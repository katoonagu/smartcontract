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
  [ValidateRange(1, 9223372036854775807)]
  [long]$RuntimeRssBytes,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 9223372036854775807)]
  [long]$RuntimeHeapUsedBytes
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

[void](Get-Process -Id $NodePid -ErrorAction Stop)
$rssBytes = Require-NonNegativeInt64 $RuntimeRssBytes "rssBytes"
$heapUsedBytes = Require-NonNegativeInt64 $RuntimeHeapUsedBytes "heapUsedBytes"
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

[Console]::Out.Write(
  (ConvertTo-Json -InputObject $sample -Depth 8 -Compress)
)
