param(
    [int]$MaximumLines = 600
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$targets = @(
    'backend/app/api/miscord_gateway.py',
    'backend/app/services/media_ticket.py',
    'backend/app/services/voice_presence.py',
    'backend/app/services/bot_voice_sessions.py',
    'backend/app/websocket/bot_gateway.py',
    'backend/app/websocket/bot_voice_control.py',
    'backend/app/websocket/chat.py',
    'backend/app/websocket/group_voice.py',
    'backend/app/websocket/unified.py',
    'backend/app/websocket/unified_dm.py',
    'scripts/probe_voice_contracts.py',
    'frontend/src/services/optimizedVoiceService.ts',
    'frontend/src/services/unifiedWebSocketService.ts',
    'frontend/src/services/voiceService.ts',
    'frontend/src/store/slices/optimizedVoiceSlice.ts'
)

$targets += Get-ChildItem -LiteralPath (Join-Path $workspace 'frontend/src/services/voice') -File -Recurse |
    ForEach-Object { $_.FullName.Substring($workspace.Length + 1) }
$targets += Get-ChildItem -LiteralPath (Join-Path $workspace 'voice-media/src') -File -Recurse -Include *.ts |
    ForEach-Object { $_.FullName.Substring($workspace.Length + 1) }
$targets += Get-ChildItem -LiteralPath (Join-Path $workspace 'voice-media/scripts') -File -Include *.mjs |
    ForEach-Object { $_.FullName.Substring($workspace.Length + 1) }
$targets += Get-ChildItem -LiteralPath (Join-Path $workspace 'examples/music-bot') -File -Include *.py |
    ForEach-Object { $_.FullName.Substring($workspace.Length + 1) }

$oversized = foreach ($relativePath in $targets | Sort-Object -Unique) {
    $path = Join-Path $workspace $relativePath
    $lineCount = (Get-Content -LiteralPath $path).Count
    if ($lineCount -gt $MaximumLines) {
        [pscustomobject]@{ Lines = $lineCount; Path = $relativePath }
    }
}

if ($oversized) {
    $oversized | Format-Table -AutoSize
    throw "Voice code files must not exceed $MaximumLines lines."
}

Write-Output "Voice file-size check passed (maximum: $MaximumLines lines)."
