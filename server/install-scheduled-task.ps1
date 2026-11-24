param(
  [string]$Time = "06:30",
  [string]$TaskName = "DailyEmailTriageMorningSync"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$RunnerCmd = Join-Path $PSScriptRoot "run-morning-sync.cmd"

Write-Host "Registering Windows Scheduled Task '$TaskName' to run daily at $Time..."

$Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$RunnerCmd`"" -WorkingDirectory $RepoRoot
$Trigger = New-ScheduledTaskTrigger -Daily -At $Time
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "Daily 06:30 morning email triage sync for David McAughtry (Draft-Only: gmail.readonly + gmail.compose)." `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskName $TaskName | Select-Object NextRunTime, LastRunTime, LastTaskResult
