# 🚀 PowerShell script for quick Miscord local development setup

param(
    [switch]$SkipInfrastructure = $false,
    [switch]$SkipBackend = $false,
    [switch]$SkipFrontend = $false
)

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

# Check dependencies
function Test-Dependencies {
    Write-Status "Checking dependencies..."
    
    $dependencies = @(
        @{ Name = "Python"; Command = "python"; Version = "3.11+" },
        @{ Name = "Node.js"; Command = "node"; Version = "18+" },
        @{ Name = "Docker"; Command = "docker"; Version = "latest" },
        @{ Name = "Docker Compose"; Command = "docker-compose"; Version = "latest" }
    )
    
    foreach ($dep in $dependencies) {
        try {
            $null = Get-Command $dep.Command -ErrorAction Stop
            Write-Success "$($dep.Name) found"
        }
        catch {
            Write-Error "$($dep.Name) not found. Please install $($dep.Name) $($dep.Version)"
            exit 1
        }
    }
}

# Create environment files
function New-EnvironmentFiles {
    Write-Status "Creating environment files..."
    
    # Backend .env
    $backendEnvPath = "backend\.env"
    if (-not (Test-Path $backendEnvPath)) {
        $backendEnvContent = @"
DATABASE_URL=postgresql://miscord_user:miscord_password@localhost:5432/miscord
REDIS_URL=redis://localhost:6379
SECRET_KEY=your-secret-key-for-development-change-in-production
CORS_ORIGINS=["http://localhost:3000"]
ACCESS_TOKEN_EXPIRE_MINUTES=10080
"@
        $backendEnvContent | Out-File -FilePath $backendEnvPath -Encoding UTF8
        Write-Success "Created $backendEnvPath"
    } else {
        Write-Warning "$backendEnvPath already exists"
    }
    
    # Frontend .env.local
    $frontendEnvPath = "frontend\.env.local"
    if (-not (Test-Path $frontendEnvPath)) {
        $frontendEnvContent = @"
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
"@
        $frontendEnvContent | Out-File -FilePath $frontendEnvPath -Encoding UTF8
        Write-Success "Created $frontendEnvPath"
    } else {
        Write-Warning "$frontendEnvPath already exists"
    }
}

# Start all services with Docker Compose
function Start-AllServices {
    if ($SkipInfrastructure -and $SkipBackend -and $SkipFrontend) {
        Write-Warning "All services skipped"
        return
    }
    
    Write-Status "Starting all services with Docker Compose..."
    
    try {
        # Start all services (postgres, redis, backend, frontend)
        docker-compose up -d
        
        Write-Status "Waiting for services to start..."
        Start-Sleep -Seconds 15
        
        # Check PostgreSQL connection
        $pgCheck = docker-compose exec postgres pg_isready -U miscord_user -d miscord 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "PostgreSQL is running and ready"
        } else {
            Write-Error "PostgreSQL failed to start"
            exit 1
        }
        
        # Check Redis connection
        $redisCheck = docker-compose exec redis redis-cli ping 2>$null
        if ($redisCheck -match "PONG") {
            Write-Success "Redis is running and ready"
        } else {
            Write-Error "Redis failed to start"
            exit 1
        }
        
        # Check Backend health
        try {
            $backendCheck = Invoke-RestMethod -Uri "http://localhost:8000/health" -TimeoutSec 10
            if ($backendCheck.status -eq "healthy") {
                Write-Success "Backend is running and ready"
            } else {
                Write-Warning "Backend might not be ready yet"
            }
        }
        catch {
            Write-Warning "Backend might not be ready yet, check http://localhost:8000"
        }
        
        # Check Frontend availability
        try {
            $frontendCheck = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 10 -UseBasicParsing
            if ($frontendCheck.StatusCode -eq 200) {
                Write-Success "Frontend is running and ready"
            } else {
                Write-Warning "Frontend might not be ready yet"
            }
        }
        catch {
            Write-Warning "Frontend might not be ready yet, check http://localhost:3000"
        }
        
    }
    catch {
        Write-Error "Error starting services: $($_.Exception.Message)"
        exit 1
    }
}

# Build Docker images (optional)
function Build-DockerImages {
    Write-Status "Building Docker images..."
    
    try {
        # Build backend and frontend images
        docker-compose build backend frontend
        
        Write-Success "Docker images built successfully"
    }
    catch {
        Write-Error "Error building Docker images: $($_.Exception.Message)"
        exit 1
    }
}

# Show startup information
function Show-Info {
    Write-Host ""
    Write-Host "🎉 Miscord successfully started in local development mode!" -ForegroundColor $Colors.Green
    Write-Host ""
    Write-Host "📱 Available services:" -ForegroundColor $Colors.White
    Write-Host "   • Frontend: http://localhost:3000" -ForegroundColor $Colors.White
    Write-Host "   • Backend API: http://localhost:8000" -ForegroundColor $Colors.White
    Write-Host "   • API Documentation: http://localhost:8000/docs" -ForegroundColor $Colors.White
    Write-Host "   • Health Check: http://localhost:8000/health" -ForegroundColor $Colors.White
    Write-Host ""
    Write-Host "📝 To stop the application, run: .\stop-local-dev.ps1" -ForegroundColor $Colors.White
    Write-Host ""
}

# Main function
function Main {
    Write-Host "🚀 Miscord Docker Development Setup" -ForegroundColor $Colors.Blue
    Write-Host "===================================" -ForegroundColor $Colors.Blue
    
    Test-Dependencies
    New-EnvironmentFiles
    Build-DockerImages
    Start-AllServices
    Show-Info
}

# Handle interruption
$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    Write-Host ""
    Write-Warning "Received exit signal..."
    & ".\stop-local-dev.ps1"
}

# Start
try {
    Main
}
catch {
    Write-Error "Error during startup: $($_.Exception.Message)"
    exit 1
}