param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,

  [ValidateRange(1, 60)]
  [int]$StartupWaitSeconds = 8
)

$ErrorActionPreference = "Stop"
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$process = $null

try {
  $process = Start-Process -FilePath $resolvedExecutable -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds $StartupWaitSeconds

  if ($process.HasExited) {
    throw "Portable Xgent exited during the launch smoke test with code $($process.ExitCode)"
  }
}
finally {
  if ($null -ne $process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
}