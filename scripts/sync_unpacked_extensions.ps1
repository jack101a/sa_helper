param(
    [string]$ServerUrl = 'http://127.0.0.1:8080'
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$source = Join-Path $root 'extension'
$templatePopupHtml = Join-Path $root 'scripts\user_extension_templates\popup.html'
$templatePopupJs = Join-Path $root 'scripts\user_extension_templates\popup.js'
$outBase = Join-Path $root 'test\unpacked_extensions'
$masterOut = Join-Path $outBase 'master_localhost'
$userOut = Join-Path $outBase 'user_localhost'

if (!(Test-Path $source)) {
    throw "Extension source directory not found: $source"
}

function Reset-Directory([string]$path) {
    if (Test-Path $path) {
        Remove-Item -LiteralPath $path -Recurse -Force
    }
    New-Item -ItemType Directory -Path $path | Out-Null
}

function Replace-UrlInTextFiles([string]$baseDir, [string]$fromUrl, [string]$toUrl) {
    $files = Get-ChildItem -Path $baseDir -Recurse -File | Where-Object {
        @('.js', '.json', '.html', '.css') -contains $_.Extension.ToLowerInvariant()
    }
    foreach ($file in $files) {
        $text = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
        $updated = $text.Replace($fromUrl, $toUrl)
        if ($updated -ne $text) {
            Set-Content -LiteralPath $file.FullName -Value $updated -Encoding UTF8
        }
    }
}

Reset-Directory $outBase

# Master unpacked build
Copy-Item -Path $source -Destination $masterOut -Recurse -Force
Replace-UrlInTextFiles -baseDir $masterOut -fromUrl 'https://tata-ocs.duckdns.org' -toUrl $ServerUrl

# User unpacked build
Copy-Item -Path $source -Destination $userOut -Recurse -Force
$optionsDir = Join-Path $userOut 'options'
if (Test-Path $optionsDir) {
    Remove-Item -LiteralPath $optionsDir -Recurse -Force
}
Copy-Item -LiteralPath $templatePopupHtml -Destination (Join-Path $userOut 'popup\popup.html') -Force
Copy-Item -LiteralPath $templatePopupJs -Destination (Join-Path $userOut 'popup\popup.js') -Force

foreach ($manifestName in @('manifest.json', 'manifest_firefox.json')) {
    $manifestPath = Join-Path $userOut $manifestName
    if (!(Test-Path $manifestPath)) { continue }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.PSObject.Properties.Name -contains 'options_page') {
        $manifest.PSObject.Properties.Remove('options_page')
    }
    $manifest.name = 'ta-ta User (Local Dev)'
    if ($manifest.content_scripts) {
        foreach ($cs in $manifest.content_scripts) {
            if ($cs.js) {
                $cs.js = @($cs.js | Where-Object { $_ -ne 'modules/mock_trainer.js' })
            }
        }
    }
    $manifest | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
}

$mockTrainer = Join-Path $userOut 'modules\mock_trainer.js'
if (Test-Path $mockTrainer) {
    Remove-Item -LiteralPath $mockTrainer -Force
}
Replace-UrlInTextFiles -baseDir $userOut -fromUrl 'https://tata-ocs.duckdns.org' -toUrl $ServerUrl

Write-Output "Master unpacked extension: $masterOut"
Write-Output "User unpacked extension:   $userOut"
Write-Output "Server URL: $ServerUrl"
