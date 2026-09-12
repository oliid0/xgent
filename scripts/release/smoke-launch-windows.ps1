param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,

  [ValidateRange(1, 60)]
  [int]$StartupWaitSeconds = 8
)

$ErrorActionPreference = "Stop"
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$process = $null

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class XgentWindowSmoke {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr window, int x, int y, int width, int height, bool repaint);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
'@

function Wait-XgentWindow($AppProcess) {
  $deadline = (Get-Date).AddSeconds(60)
  $previousHandle = [IntPtr]::Zero
  do {
    $AppProcess.Refresh()
    if ($AppProcess.HasExited) { throw "Xgent exited before its window became ready" }
    $handle = $AppProcess.MainWindowHandle
    $client = New-Object XgentWindowSmoke+Rect
    if ($handle -ne [IntPtr]::Zero -and [XgentWindowSmoke]::IsWindowVisible($handle) -and
        [XgentWindowSmoke]::GetClientRect($handle, [ref]$client) -and
        $client.Right -ge 400 -and $client.Bottom -ge 300) {
      # Ignore transient startup/helper windows before the actual WebView is ready.
      if ($handle -eq $previousHandle) { return $handle }
      $previousHandle = $handle
    } else {
      $previousHandle = [IntPtr]::Zero
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "Xgent did not reveal its ready window"
}

function Wait-XgentClientSize($Window, $Width, $Height) {
  # Tauri applies a hidden-window resize through the native event loop. Require
  # the persisted client size itself, but allow that queued operation to settle.
  $deadline = (Get-Date).AddSeconds(15)
  $actual = New-Object XgentWindowSmoke+Rect
  do {
    if (-not [XgentWindowSmoke]::GetClientRect($Window, [ref]$actual)) {
      throw "Restored window handle became invalid"
    }
    if ([Math]::Abs($actual.Right - $Width) -le 4 -and
        [Math]::Abs($actual.Bottom - $Height) -le 4) {
      return $actual
    }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)
  throw "Native window size was not restored: expected ${Width}x${Height}, got $($actual.Right)x$($actual.Bottom)"
}

try {
  $process = Start-Process -FilePath $resolvedExecutable -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds $StartupWaitSeconds

  if ($process.HasExited) {
    throw "Portable Xgent exited during the launch smoke test with code $($process.ExitCode)"
  }

  $window = Wait-XgentWindow $process
  $outer = New-Object XgentWindowSmoke+Rect
  [void][XgentWindowSmoke]::GetWindowRect($window, [ref]$outer)
  if (-not [XgentWindowSmoke]::MoveWindow($window, $outer.Left, $outer.Top, 960, 680, $true)) {
    throw "Unable to resize the native window"
  }
  Start-Sleep -Seconds 1
  $expected = New-Object XgentWindowSmoke+Rect
  if (-not [XgentWindowSmoke]::GetClientRect($window, [ref]$expected)) { throw "Resized window handle became invalid" }
  if (-not [XgentWindowSmoke]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
    throw "Unable to deliver the native close request"
  }
  # The app saves state before hiding to tray. Wait for that lifecycle boundary
  # instead of killing a loaded CI process after an arbitrary two seconds.
  $closeDeadline = (Get-Date).AddSeconds(30)
  do {
    $process.Refresh()
    if ($process.HasExited -or -not [XgentWindowSmoke]::IsWindowVisible($window)) { break }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $closeDeadline)
  if (-not $process.HasExited -and [XgentWindowSmoke]::IsWindowVisible($window)) {
    throw "Xgent did not finish handling its native close request"
  }
  $statePath = Join-Path $env:APPDATA 'com.ohi.xgent/main-window-size.json'
  if (Test-Path -LiteralPath $statePath) {
    Write-Output "Saved native window state: $(Get-Content -LiteralPath $statePath -Raw)"
  } else {
    throw "Native window state was not saved at $statePath"
  }
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  $process.WaitForExit()
  $persisted = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  if ([Math]::Abs($persisted.width - $expected.Right) -gt 4 -or
      [Math]::Abs($persisted.height - $expected.Bottom) -gt 4) {
    throw "Hidden-window events corrupted persisted size: expected $($expected.Right)x$($expected.Bottom), got $($persisted.width)x$($persisted.height)"
  }
  $process = Start-Process -FilePath $resolvedExecutable -PassThru -WindowStyle Hidden
  $window = Wait-XgentWindow $process
  $restored = Wait-XgentClientSize $window $expected.Right $expected.Bottom
  Write-Output "PASS: frontend-ready window and native resize/close/relaunch persistence"
}
finally {
  if ($null -ne $process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
}
