$ErrorActionPreference = "Stop"
$botRoot = $PSScriptRoot
$venvPython = Join-Path $botRoot ".venv\Scripts\python.exe"
$envPath = Join-Path $botRoot ".env"

if (-not (Test-Path -LiteralPath $venvPython) -or -not (Test-Path -LiteralPath $envPath)) {
    & (Join-Path $botRoot "setup.ps1")
}

$runningBot = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
    Where-Object {
        $_.ExecutablePath -eq $venvPython -and $_.CommandLine -match '(^|\s)(-u\s+)?bot\.py(\s|$)'
    }
if ($runningBot) {
    throw "Music Bot is already running (PID: $($runningBot.ProcessId -join ', ')). Run stop.cmd first."
}

Push-Location $botRoot
try {
    Write-Host "Starting Miscord Music Bot. Press Ctrl+C to stop."
    & $venvPython -u bot.py
}
finally {
    Pop-Location
}
