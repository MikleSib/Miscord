$ErrorActionPreference = "Stop"
$botRoot = $PSScriptRoot
$venvPython = Join-Path $botRoot ".venv\Scripts\python.exe"
$runningBot = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
    Where-Object {
        $_.ExecutablePath -eq $venvPython -and $_.CommandLine -match '(^|\s)(-u\s+)?bot\.py(\s|$)'
    }

if (-not $runningBot) {
    Write-Host "Miscord Music Bot is not running."
    exit 0
}

foreach ($process in $runningBot) {
    Stop-Process -Id $process.ProcessId
    Write-Host "Stopped Miscord Music Bot (PID: $($process.ProcessId))."
}
