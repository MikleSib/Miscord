# 🛑 PowerShell script to stop Miscord in local development mode

# Setup encoding for proper display
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Colors for output
$Colors = @{
    Red = "Red"
    Green = "Green"
    Yellow = "Yellow"
    Blue = "Blue"
    White = "White"
}

function Write-Status {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor $Colors.Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor $Colors.Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor $Colors.Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor $Colors.Red
}

Write-Host "🛑 Stopping Miscord in local development mode..." -ForegroundColor $Colors.Yellow
Write-Host "==================================================" -ForegroundColor $Colors.Yellow

# Stop all Docker containers
Write-Status "Stopping all Docker containers..."

try {
    $dockerStatus = docker-compose ps 2>$null
    if ($dockerStatus -match "Up") {
        docker-compose down
        Write-Success "All Docker containers stopped"
    } else {
        Write-Warning "Docker containers already stopped"
    }
}
catch {
    Write-Warning "Error stopping Docker containers: $($_.Exception.Message)"
}

# Find and stop processes by ports (fallback method)
Write-Status "Checking processes on ports 3000 and 8000..."

try {
    # Stop processes on port 8000 (Backend)
    $backendProcesses = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess
    if ($backendProcesses) {
        foreach ($processId in $backendProcesses) {
            try {
                $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
                if ($process) {
                    Write-Warning "Stopping process on port 8000: $($process.ProcessName) (PID: $processId)"
                    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
                }
            }
            catch {
                Write-Warning "Could not stop process $processId: $($_.Exception.Message)"
            }
        }
        Write-Success "Processes on port 8000 stopped"
    }
    
    # Stop processes on port 3000 (Frontend)
    $frontendProcesses = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess
    if ($frontendProcesses) {
        foreach ($processId in $frontendProcesses) {
            try {
                $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
                if ($process) {
                    Write-Warning "Stopping process on port 3000: $($process.ProcessName) (PID: $processId)"
                    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
                }
            }
            catch {
                Write-Warning "Could not stop process $processId: $($_.Exception.Message)"
            }
        }
        Write-Success "Processes on port 3000 stopped"
    }
}
catch {
    Write-Warning "Error checking processes: $($_.Exception.Message)"
}

# Remove log files
$logFiles = @("backend.log", "frontend.log")
foreach ($logFile in $logFiles) {
    if (Test-Path $logFile) {
        Remove-Item $logFile -ErrorAction SilentlyContinue
        Write-Status "Removed $logFile"
    }
}

Write-Host ""
Write-Success "🎉 All Miscord services stopped!"
Write-Host ""
Write-Host "📝 To restart, run: .\start-local-dev.ps1" -ForegroundColor $Colors.White
Write-Host "🐳 To start with Docker: docker-compose up -d" -ForegroundColor $Colors.White
Write-Host ""