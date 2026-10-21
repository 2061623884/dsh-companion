$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'CI check tools require Windows' }
$ciMetadata = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ci-tools.json') -Raw | ConvertFrom-Json
$ciDirectory = Join-Path (Split-Path $PSScriptRoot) '.test-work/ci-tools'
New-Item -ItemType Directory -Force -Path $ciDirectory | Out-Null
foreach ($ciName in @('gitleaks', 'actionlint')) {
    $ciTool = $ciMetadata.$ciName
    $ciArchive = Join-Path $ciDirectory ($ciName + '-' + $ciTool.version + '.zip')
    if (-not (Test-Path -LiteralPath $ciArchive)) { Invoke-WebRequest -Uri $ciTool.url -OutFile $ciArchive }
    if ((Get-FileHash -LiteralPath $ciArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ciTool.sha256) {
        throw ('CI tool checksum mismatch: ' + $ciName)
    }
    Expand-Archive -LiteralPath $ciArchive -DestinationPath (Join-Path $ciDirectory $ciName) -Force
    Write-Output ('Prepared ' + $ciName + ' ' + $ciTool.version)
}
