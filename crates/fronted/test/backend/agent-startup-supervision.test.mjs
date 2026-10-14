import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const helper=readFileSync(new URL("../../src-tauri/src/services/agent_startup_windows.ps1",import.meta.url),"utf8");
const program=path.join(process.env.SystemRoot??"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");
const prelude=String.raw`
$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$task=$null;$registrations=0;$removals=0;$running=$true;$fault=''
$descriptor=@{name='Xgent.Agent.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';marker='XgentAgent/v1/Xgent.Agent.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';executable='C:\Program Files\用户 & Co\xgent.exe';mode='enable'}
function Get-ScheduledTask { [CmdletBinding()]param($TaskName,$TaskPath) if($null-ne$script:task){$script:task} }
function New-ScheduledTaskAction { param($Execute,$Argument) [pscustomobject]@{Execute=$Execute;Arguments=$Argument} }
function New-ScheduledTaskTrigger { param([switch]$AtLogOn,$User) [pscustomobject]@{UserId=$User;CimClass=[pscustomobject]@{CimClassName='MSFT_TaskLogonTrigger'}} }
function New-ScheduledTaskPrincipal { param($UserId,$LogonType,$RunLevel) if($LogonType-ne'Interactive'-or$RunLevel-ne'Limited'){throw 'Unexpected principal'};[pscustomobject]@{UserId=$UserId;LogonType=3;RunLevel=0} }
function New-ScheduledTaskSettingsSet {param($RestartCount,$RestartInterval,$ExecutionTimeLimit,$MultipleInstances,[switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries,[switch]$StartWhenAvailable)
 if($RestartInterval-ne[TimeSpan]::FromMinutes(1)-or$ExecutionTimeLimit-ne[TimeSpan]::Zero-or$MultipleInstances-ne'IgnoreNew'){throw 'Unexpected restart policy'}
 [pscustomobject]@{RestartCount=$RestartCount;RestartInterval='PT1M';ExecutionTimeLimit='PT0S';MultipleInstances=2;Enabled=$true;DisallowStartIfOnBatteries=(!$AllowStartIfOnBatteries);StopIfGoingOnBatteries=(!$DontStopIfGoingOnBatteries);WakeToRun=$false}}
function Register-ScheduledTask { [CmdletBinding()]param($TaskName,$TaskPath,$Action,$Trigger,$Principal,$Settings,$Description,[switch]$Force)
 $script:registrations++;$script:task=[pscustomobject]@{TaskName=$TaskName;TaskPath=$TaskPath;Actions=@($Action);Triggers=@($Trigger);Principal=$Principal;Settings=$Settings;Description=$Description}
 if($script:fault-eq'after'){throw 'Acceptance reply lost'};if($script:fault-eq'policy'){$script:task.Settings.ExecutionTimeLimit='PT72H'} }
function Unregister-ScheduledTask { [CmdletBinding()]param($TaskName,$TaskPath,[switch]$Confirm) $script:removals++;$script:task=$null }
foreach($name in @('Get-ScheduledTask','New-ScheduledTaskAction','New-ScheduledTaskTrigger','New-ScheduledTaskPrincipal','New-ScheduledTaskSettingsSet','Register-ScheduledTask','Unregister-ScheduledTask')) {
 if((Get-Command $name).CommandType-ne'Function'){throw 'Refuse to run real OS registration in a fixture'} }
function Invoke-AgentFixture([string]$mode){$descriptor.mode=$mode;$env:XGENT_AGENT_REGISTRATION=$descriptor|ConvertTo-Json -Compress;& $native}
`;
function run(scenario){
 const script=prelude+"\n$native=[scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+Buffer.from(helper).toString("base64")+"')))\n"+scenario;
 const result=spawnSync(program,["-NoLogo","-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(script,"utf16le").toString("base64")],{encoding:"utf8",windowsHide:true,timeout:20000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout.trim());
}
const windows={skip:process.platform!=="win32"};
test("the actual Windows registration helper confirms restart policy, preserves unusual paths, and removes only future registration",windows,()=>{
 const value=run(String.raw`$enabled=Invoke-AgentFixture enable|ConvertFrom-Json;$observed=Invoke-AgentFixture status|ConvertFrom-Json;$path=$task.Actions[0].Execute;$disabled=Invoke-AgentFixture disable|ConvertFrom-Json
 @{enabled=$enabled;observed=$observed;disabled=$disabled;path=$path;registrations=$registrations;removals=$removals;running=$running}|ConvertTo-Json -Depth 6 -Compress`);
 assert.deepEqual(value.enabled,{registered:true,restartOnFailure:true});assert.deepEqual(value.observed,value.enabled);
 assert.deepEqual(value.disabled,{registered:false,restartOnFailure:false});assert.equal(value.path,"C:\\Program Files\\用户 & Co\\xgent.exe");
 assert.equal(value.registrations,1);assert.equal(value.removals,1);assert.equal(value.running,true);
});
test("a lost Windows registration response is observed without a duplicate create",windows,()=>{
 const value=run(String.raw`$fault='after';$observedError='';try{Invoke-AgentFixture enable|Out-Null}catch{$observedError=$_.Exception.Message};$fault='';$observed=Invoke-AgentFixture status|ConvertFrom-Json
 @{error=$observedError;observed=$observed;registrations=$registrations}|ConvertTo-Json -Depth 6 -Compress`);
 assert.match(value.error,/Acceptance reply lost/);assert.equal(value.observed.registered,true);assert.equal(value.registrations,1);
});
test("foreign task ownership and mismatched OS policy never become successful registration",windows,()=>{
 const value=run(String.raw`Invoke-AgentFixture enable|Out-Null;$task.Description='Foreign owner';$blocked='';try{Invoke-AgentFixture disable|Out-Null}catch{$blocked=$_.Exception.Message};$removalsBefore=$removals;$task=$null;$fault='policy';$policy='';try{Invoke-AgentFixture enable|Out-Null}catch{$policy=$_.Exception.Message}
 @{blocked=$blocked;policy=$policy;removalsBefore=$removalsBefore;registrations=$registrations}|ConvertTo-Json -Compress`);
 assert.match(value.blocked,/Another owner/);assert.equal(value.removalsBefore,0);assert.match(value.policy,/did not match/);assert.equal(value.registrations,2);
});

test("a copied owner marker cannot change another principal's task, and policy degradation is observed without writes",windows,()=>{
 const value=run(String.raw`Invoke-AgentFixture enable|Out-Null;$task.Principal.UserId='S-1-5-18';$ownerFailure='';try{Invoke-AgentFixture enable|Out-Null}catch{$ownerFailure=$_.Exception.Message};$task=$null;Invoke-AgentFixture enable|Out-Null;$task.Settings.Enabled=$false;$observed=Invoke-AgentFixture status|ConvertFrom-Json
 @{ownerFailure=$ownerFailure;registrations=$registrations;observed=$observed}|ConvertTo-Json -Depth 6 -Compress`);
 assert.match(value.ownerFailure,/Another owner/);assert.equal(value.registrations,2);
 assert.deepEqual(value.observed,{registered:false,restartOnFailure:false});
});

test("installed Windows CIM constructors expose the exact supervised user policy without registering a task",windows,()=>{
 const script=String.raw`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
 $pcSettings=New-ScheduledTaskSettingsSet -RestartCount 255 -RestartInterval ([TimeSpan]::FromMinutes(1)) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
 $pcPrincipal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value) -LogonType Interactive -RunLevel Limited
 $pcTrigger=New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
 @{settings=($pcSettings|Select-Object RestartCount,RestartInterval,ExecutionTimeLimit,MultipleInstances,Enabled,DisallowStartIfOnBatteries,StopIfGoingOnBatteries,WakeToRun);principal=($pcPrincipal|Select-Object LogonType,RunLevel);triggerClass=$pcTrigger.CimClass.CimClassName}|ConvertTo-Json -Depth 6 -Compress`;
 const result=spawnSync(program,["-NoLogo","-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(script,"utf16le").toString("base64")],{encoding:"utf8",windowsHide:true,timeout:20000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stderr);const observed=JSON.parse(result.stdout.trim());
 assert.deepEqual(observed.settings,{RestartCount:255,RestartInterval:"PT1M",ExecutionTimeLimit:"PT0S",MultipleInstances:2,Enabled:true,DisallowStartIfOnBatteries:false,StopIfGoingOnBatteries:false,WakeToRun:false});
 assert.deepEqual(observed.principal,{LogonType:3,RunLevel:0});assert.equal(observed.triggerClass,"MSFT_TaskLogonTrigger");
});
