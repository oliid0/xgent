param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,

  [ValidateRange(1, 60)]
  [int]$StartupWaitSeconds = 8
)

$ErrorActionPreference = 'Stop'
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$diagnosticPath = Join-Path ([IO.Path]::GetTempPath()) ('xgent-launch-' + [Guid]::NewGuid() + '.log')
$process = $null

try {
  $process = Start-Process -FilePath $resolvedExecutable -PassThru -WindowStyle Hidden -RedirectStandardError $diagnosticPath
  Start-Sleep -Seconds $StartupWaitSeconds
  $process.Refresh()
  if ($process.HasExited) {
    throw "Portable Xgent exited during the launch smoke test with code $($process.ExitCode)"
  }
  Write-Output 'PASS: portable app stayed alive after launch'
}
finally {
  if ($null -ne $process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
  if (Test-Path -LiteralPath $diagnosticPath) {
    Get-Content -LiteralPath $diagnosticPath
    Remove-Item -LiteralPath $diagnosticPath -Force
  }
}
