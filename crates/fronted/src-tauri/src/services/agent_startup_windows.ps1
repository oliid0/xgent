$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$config = $env:XGENT_AGENT_REGISTRATION | ConvertFrom-Json
if ($config.mode -notin @('status', 'enable', 'disable') -or
    $config.name -notmatch '^Xgent\.Agent\.[a-f0-9]{32}$' -or
    $config.marker -ne ('XgentAgent/v1/' + $config.name) -or
    [string]::IsNullOrWhiteSpace($config.executable)) {
    throw 'Invalid native agent registration descriptor'
}
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function Get-AgentSid([string] $identity) {
    if ($identity -match '^S-1-[0-9-]+$') {
        return ([System.Security.Principal.SecurityIdentifier]::new($identity)).Value
    }
    return ([System.Security.Principal.NTAccount]::new($identity)).Translate(
        [System.Security.Principal.SecurityIdentifier]).Value
}
function Get-AgentTask {
    try {
        $tasks = @(Get-ScheduledTask -TaskName $config.name -TaskPath '\' -ErrorAction Stop)
    } catch {
        if ($_.CategoryInfo.Category -eq [System.Management.Automation.ErrorCategory]::ObjectNotFound -or
            $_.FullyQualifiedErrorId -like 'CmdletizationQuery_NotFound*') { return $null }
        throw
    }
    if ($tasks.Count -eq 0) { return $null }
    if ($tasks.Count -ne 1) { throw 'Ambiguous native agent registration' }
    $task = $tasks[0]
    if ($task.Description -ne $config.marker -or $task.TaskPath -ne '\' -or
        (Get-AgentSid $task.Principal.UserId) -ne $currentSid) {
        throw 'Another owner controls this scheduled task; no registration was changed'
    }
    return $task
}
function Test-AgentPolicy($task) {
    if ($null -eq $task) { return $false }
    $actions = @($task.Actions)
    $triggers = @($task.Triggers)
    return $actions.Count -eq 1 -and $triggers.Count -eq 1 -and
        $actions[0].Execute -ceq $config.executable -and
        $actions[0].Arguments -ceq '--xgent-agent' -and
        $triggers[0].CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' -and
        (Get-AgentSid $triggers[0].UserId) -eq $currentSid -and
        [int]$task.Principal.LogonType -eq 3 -and [int]$task.Principal.RunLevel -eq 0 -and
        [int]$task.Settings.MultipleInstances -eq 2 -and
        $task.Settings.RestartCount -eq 255 -and $task.Settings.RestartInterval -eq 'PT1M' -and
        $task.Settings.ExecutionTimeLimit -eq 'PT0S' -and $task.Settings.Enabled -eq $true -and
        $task.Settings.DisallowStartIfOnBatteries -eq $false -and
        $task.Settings.StopIfGoingOnBatteries -eq $false -and $task.Settings.WakeToRun -eq $false
}
$existing = Get-AgentTask
if ($config.mode -eq 'enable') {
    $action = New-ScheduledTaskAction -Execute $config.executable -Argument '--xgent-agent'
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentSid
    $principal = New-ScheduledTaskPrincipal -UserId $currentSid -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -RestartCount 255 -RestartInterval ([TimeSpan]::FromMinutes(1)) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -StartWhenAvailable
    Register-ScheduledTask -TaskName $config.name -TaskPath '\' -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Description $config.marker -Force -ErrorAction Stop | Out-Null
} elseif ($config.mode -eq 'disable' -and $null -ne $existing) {
    # Removing future registration leaves an already running Xgent process alone.
    Unregister-ScheduledTask -TaskName $config.name -TaskPath '\' -Confirm:$false -ErrorAction Stop
}
$observed = Get-AgentTask
$policyMatches = Test-AgentPolicy $observed
if (($config.mode -eq 'enable' -and -not $policyMatches) -or
    ($config.mode -eq 'disable' -and $null -ne $observed)) {
    throw 'OS agent registration did not match the requested state; observe it before retrying'
}
@{ registered = $policyMatches; restartOnFailure = $policyMatches } | ConvertTo-Json -Compress
