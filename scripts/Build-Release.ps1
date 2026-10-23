[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repositoryRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$pluginRoot = Join-Path $repositoryRoot 'plugins/task-progress'
$releaseRoot = Join-Path $repositoryRoot 'dist'
if (Test-Path -LiteralPath $releaseRoot) { throw 'dist already exists; keep the previous release and build in a fresh checkout' }
Push-Location -LiteralPath $repositoryRoot
try {
  & node --test tests/distribution.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Distribution checks failed' }
  & (Join-Path $pluginRoot 'scripts/Build-Package.ps1')
} finally { Pop-Location }
$ready = Get-Content -LiteralPath (Join-Path $pluginRoot 'READY.safe.json') -Raw | ConvertFrom-Json
[System.IO.Directory]::CreateDirectory($releaseRoot) | Out-Null
$archiveName = [System.IO.Path]::GetFileName($ready.archive.path)
$releaseArchive = Join-Path $releaseRoot $archiveName
[System.IO.File]::Copy($ready.archive.path, $releaseArchive, $false)
$archiveInfo = Get-Item -LiteralPath $releaseArchive
$archiveSha256 = (Get-FileHash -LiteralPath $releaseArchive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($archiveInfo.Length -ne $ready.archive.bytes -or $archiveSha256 -ne $ready.archive.sha256) { throw 'Release copy hash mismatch' }
$receipt = [ordered]@{
  schemaVersion = 1
  plugin = 'task-progress'
  version = $ready.version
  repository = 'https://github.com/MaximillianVoss/codex-task-progress-plugin'
  ref = ('v' + $ready.version)
  generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
  artifact = [ordered]@{ file = $archiveName; bytes = $archiveInfo.Length; sha256 = $archiveSha256 }
  checks = [ordered]@{ pluginTests = $ready.checks.tests; pluginPassed = $ready.checks.passed; distributionTestsPassed = $true; extractedFilesIdentical = $ready.checks.archiveSourceFilesIdentical; extractedExamplesPassed = $ready.checks.extractedCliExamplesPassed }
  installedByBuild = $false
  nativeCodexRenderingCheckedByBuild = $false
}
[System.IO.File]::WriteAllText((Join-Path $releaseRoot 'release.safe.json'), ($receipt | ConvertTo-Json -Depth 12) + "`n", [System.Text.UTF8Encoding]::new($false))
$receipt | ConvertTo-Json -Depth 12
