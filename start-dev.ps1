<#
.SYNOPSIS
Start development environment PowerShell script
.DESCRIPTION
This script prepares the development environment with the following functions:
1. Delete .env files in apps/web/ and apps/workers/ directories if they exist
2. Copy the .env file from the project root to apps/web/ and apps/workers/ directories
.NOTES
Author: Karakeep Team
Date: $(Get-Date)
#>

# Set working directory to the script location
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $scriptPath

# Define file paths
$rootEnv = ".\.env"
$webEnv = ".\apps\web\.env"
$workersEnv = ".\apps\workers\.env"
$dbEnv = ".\packages\db\.env"

Write-Host "=== Development Environment Setup ==="
Write-Host ""

# Step 1: Delete web .env if exists
Write-Host "Step 1: Removing existing .env in web directory..."
if (Test-Path $webEnv) {
    Remove-Item $webEnv -Force
    Write-Host "   ✓ Removed $webEnv"
} else {
    Write-Host "   - No existing .env found in web directory"
}

# Step 2: Delete workers .env if exists
Write-Host "Step 2: Removing existing .env in workers directory..."
if (Test-Path $workersEnv) {
    Remove-Item $workersEnv -Force
    Write-Host "   ✓ Removed $workersEnv"
} else {
    Write-Host "   - No existing .env found in workers directory"
}

# Step 3: Check root .env exists
Write-Host "Step 3: Checking root .env file..."
if (Test-Path $rootEnv) {
    Write-Host "   ✓ Root .env found"
    
    # Step 4: Copy to web directory
    Write-Host "Step 4: Copying .env to web directory..."
    Copy-Item -Path $rootEnv -Destination $webEnv -Force
    if (Test-Path $webEnv) {
        Write-Host "   ✓ Successfully copied to $webEnv"
    } else {
        Write-Host "   ✗ Failed to copy to $webEnv"
    }
    
    # Step 5: Copy to workers directory
    Write-Host "Step 5: Copying .env to workers directory..."
    Copy-Item -Path $rootEnv -Destination $workersEnv -Force
    if (Test-Path $workersEnv) {
        Write-Host "   ✓ Successfully copied to $workersEnv"
    } else {
        Write-Host "   ✗ Failed to copy to $workersEnv"
    }

    # Step 6: Copy to db directory
    Write-Host "Step 6: Copying .env to db directory..."
    Copy-Item -Path $rootEnv -Destination $dbEnv -Force
    if (Test-Path $dbEnv) {
        Write-Host "   ✓ Successfully copied to $dbEnv"
    } else {
        Write-Host "   ✗ Failed to copy to $dbEnv"
    }
} else {
    Write-Host "   ✗ Root .env file not found!"
    if (Test-Path ".\.env.sample") {
        Write-Host "   - You can create it from .env.sample: cp .env.sample .env"
    }
}

Write-Host ""
Write-Host "=== Setup Complete ==="