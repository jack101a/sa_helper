# package_extension.ps1
$ExtensionDir = "extension"
$PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$OutputDir = "$PSScriptRoot\..\backend\app\static\extensions"

# Create build dir if missing
if (!(Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force
}

Write-Host "Packaging extension from $ExtensionDir to $OutputDir..."

# 1. Zip (Chrome/Firefox)
$ZipPath = "$OutputDir\mcq_solver_extension.zip"
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path "$ExtensionDir\*" -DestinationPath $ZipPath -Force

# 2. CRX (Chrome) - Note: This is just a copy for now, real CRX needs signing
$CrxPath = "$OutputDir\mcq_solver_extension.crx"
Copy-Item $ZipPath $CrxPath -Force

# 3. XPI (Firefox)
$XpiPath = "$OutputDir\mcq_solver_extension.xpi"
Copy-Item $ZipPath $XpiPath -Force

if (Test-Path $ZipPath) {
    Write-Host "Success! Extension packaged at $OutputDir"
    Get-ChildItem $OutputDir | Select-Object Name, Length, LastWriteTime
} else {
}
