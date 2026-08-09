[CmdletBinding()]
param(
    [string]$BotToken = $env:MISCORD_BOT_TOKEN,
    [string]$GuildId = $env:MISCORD_GUILD_ID,
    [switch]$GlobalCommands
)

$ErrorActionPreference = "Stop"
$botRoot = $PSScriptRoot
$venvPython = Join-Path $botRoot ".venv\Scripts\python.exe"
$envPath = Join-Path $botRoot ".env"

if (-not (Test-Path -LiteralPath $venvPython)) {
    $python = Get-Command python -ErrorAction Stop
    Write-Host "Creating the virtual environment..."
    & $python.Source -m venv (Join-Path $botRoot ".venv")
}

Write-Host "Installing Music Bot dependencies..."
& $venvPython -m pip install --disable-pip-version-check -r (Join-Path $botRoot "requirements.txt")
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install dependencies"
}

if (-not (Test-Path -LiteralPath $envPath)) {
    if ([string]::IsNullOrWhiteSpace($BotToken)) {
        $secureToken = Read-Host "Paste the Bot Token" -AsSecureString
        $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
        try {
            $BotToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
        }
        finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
        }
    }

    if ($BotToken -notmatch '^mcb_(\d+)\.') {
        throw "Invalid Miscord Bot Token"
    }
    $applicationId = $Matches[1]

    if ([string]::IsNullOrWhiteSpace($GuildId) -and (-not $GlobalCommands)) {
        $GuildId = Read-Host "Test server ID (Enter for global commands)"
    }

    $lines = @(
        "MISCORD_BOT_TOKEN=$BotToken"
        "MISCORD_APPLICATION_ID=$applicationId"
        "MISCORD_GUILD_ID=$GuildId"
        "MISCORD_API_BASE=https://miscord.ru/api/v1"
        "MISCORD_GATEWAY=wss://miscord.ru/gateway?v=1&encoding=json"
    )
    [IO.File]::WriteAllLines($envPath, $lines, [Text.UTF8Encoding]::new($false))
    Write-Host "Local configuration saved to the Git-ignored .env file."
}

Push-Location $botRoot
try {
    Write-Host "Registering slash commands..."
    & $venvPython register_commands.py
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to register slash commands"
    }
}
finally {
    Pop-Location
}

Write-Host "Ready. Run start.cmd"
