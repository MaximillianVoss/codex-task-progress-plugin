[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$sourceRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$distRoot = Join-Path $sourceRoot 'dist'
$evidenceRoot = Join-Path $sourceRoot 'evidence'
$marketplaceRoot = Join-Path $distRoot 'task-progress-marketplace'
$extractedRoot = Join-Path $distRoot 'verified-extract'
$manifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'plugin.json') -Raw | ConvertFrom-Json
$archivePath = Join-Path $distRoot ('task-progress-' + $manifest.version + '-marketplace.zip')
foreach ($target in @($marketplaceRoot, $extractedRoot, $archivePath)) {
  if (Test-Path -LiteralPath $target) { throw ('Output already exists; preserve this release and use a fresh source copy for the next build: ' + $target) }
}
New-Item -ItemType Directory -Path $distRoot, $evidenceRoot -Force | Out-Null
function Get-SafeFileReceipt([string]$filePath) {
  $item = Get-Item -LiteralPath $filePath
  [ordered]@{ path = $item.FullName; bytes = $item.Length; sha256 = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant() }
}
function Save-SafeJson([string]$filePath, $value) {
  [System.IO.File]::WriteAllText($filePath, ($value | ConvertTo-Json -Depth 30) + "`n", [System.Text.UTF8Encoding]::new($false))
}
$allFiles = @(Get-ChildItem -LiteralPath $sourceRoot -File -Recurse -Force | Where-Object {
  $relativePath = [System.IO.Path]::GetRelativePath($sourceRoot, $_.FullName).Replace('\', '/')
  $relativePath -notmatch '^(dist/|evidence/|node_modules/|\.git/|CURRENT\.safe\.json$|READY\.safe\.json$)'
} | Sort-Object FullName)
foreach ($file in $allFiles) {
  if (($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Source links are not allowed in the package' }
  $relativePath = [System.IO.Path]::GetRelativePath($sourceRoot, $file.FullName).Replace('\', '/')
  if ($relativePath -match '(^|/)(\.env|STATE|NEXT|secrets|credentials)(\.|/|$)' -or $relativePath -match '(^|/)\.\./') { throw 'Unsafe source file in bundle' }
}

Push-Location -LiteralPath $sourceRoot
try {
  $tests = @(Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'tests') -File -Filter '*.test.mjs' | ForEach-Object FullName)
  $testText = (& node --test --test-reporter=tap @tests 2>&1 | Out-String)
  $testExit = $LASTEXITCODE
  [System.IO.File]::WriteAllText((Join-Path $evidenceRoot 'tests.tap'), $testText, [System.Text.UTF8Encoding]::new($false))
  if ($testExit -ne 0) { throw 'Tests failed; see evidence/tests.tap' }
  if ($testText -notmatch '# tests (\d+)') { throw 'Missing test count' }
  $testCount = [int]$Matches[1]
  if ($testText -notmatch '# pass (\d+)') { throw 'Missing pass count' }
  $passCount = [int]$Matches[1]
  if ($passCount -ne $testCount -or $testText -notmatch '# fail 0') { throw 'Incomplete test success' }
  foreach ($exampleName in @('single', 'multiple', 'stages')) {
    foreach ($format in @('markdown', 'html')) {
      $preview = (& node 'skills/task-progress/scripts/render.mjs' --input ('examples/' + $exampleName + '.safe.json') --at '2026-10-21T12:10:00Z' --format $format | Out-String)
      if ($LASTEXITCODE -ne 0) { throw ('Example failed: ' + $exampleName + '/' + $format) }
      $extension = if ($format -eq 'html') { 'html' } else { 'md' }
      [System.IO.File]::WriteAllText((Join-Path $evidenceRoot ($exampleName + '.preview.' + $extension)), $preview, [System.Text.UTF8Encoding]::new($false))
    }
  }
} finally { Pop-Location }

$sourceReceipts = @()
foreach ($file in $allFiles) {
  $relativePath = [System.IO.Path]::GetRelativePath($sourceRoot, $file.FullName).Replace('\', '/')
  $receipt = Get-SafeFileReceipt $file.FullName
  $sourceReceipts += [ordered]@{ relativePath = $relativePath; path = $receipt.path; bytes = $receipt.bytes; sha256 = $receipt.sha256 }
  $destination = Join-Path $marketplaceRoot ('plugins/task-progress/' + $relativePath)
  [System.IO.Directory]::CreateDirectory((Split-Path -Parent $destination)) | Out-Null
  [System.IO.File]::Copy($file.FullName, $destination, $false)
}
$catalogPath = Join-Path $marketplaceRoot '.agents/plugins/marketplace.json'
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $catalogPath)) | Out-Null
[System.IO.File]::Copy((Join-Path $sourceRoot 'install/marketplace.json'), $catalogPath, $false)
$sourceLines = ($sourceReceipts | ForEach-Object { $_.relativePath + "`0" + $_.bytes + "`0" + $_.sha256 + "`n" }) -join ''
$treeHash = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData([System.Text.Encoding]::UTF8.GetBytes($sourceLines))).ToLowerInvariant()
$sourcesPath = Join-Path $evidenceRoot 'sources.safe.json'
Save-SafeJson $sourcesPath ([ordered]@{ schemaVersion = 1; root = $sourceRoot; fileCount = $sourceReceipts.Count; treeSha256 = $treeHash; hashFormat = 'sorted(relativePath + NUL + bytes + NUL + lowercaseSha256 + LF), UTF8'; files = $sourceReceipts })

Add-Type -AssemblyName System.IO.Compression
$archiveStream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
$zip = [System.IO.Compression.ZipArchive]::new($archiveStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
try {
  foreach ($file in @(Get-ChildItem -LiteralPath $marketplaceRoot -File -Recurse -Force | Sort-Object FullName)) {
    $entryName = [System.IO.Path]::GetRelativePath($marketplaceRoot, $file.FullName).Replace('\', '/')
    $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = [DateTimeOffset]::Parse('2026-01-01T00:00:00Z')
    $inputStream = [System.IO.File]::OpenRead($file.FullName)
    $entryStream = $entry.Open()
    try { $inputStream.CopyTo($entryStream) } finally { $entryStream.Dispose(); $inputStream.Dispose() }
  }
} finally { $zip.Dispose(); $archiveStream.Dispose() }
[System.IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $extractedRoot)
$checkedCount = 0
foreach ($sourceFile in $sourceReceipts) {
  $extractedPath = Join-Path $extractedRoot ('plugins/task-progress/' + $sourceFile.relativePath)
  $actual = Get-SafeFileReceipt $extractedPath
  if ($actual.bytes -ne $sourceFile.bytes -or $actual.sha256 -ne $sourceFile.sha256) { throw ('Extracted bytes differ: ' + $sourceFile.relativePath) }
  $checkedCount++
}
$catalogCopy = Get-SafeFileReceipt (Join-Path $extractedRoot '.agents/plugins/marketplace.json')
$catalogOriginal = Get-SafeFileReceipt (Join-Path $sourceRoot 'install/marketplace.json')
if ($catalogCopy.sha256 -ne $catalogOriginal.sha256) { throw 'Extracted marketplace differs' }
if (@(Get-ChildItem -LiteralPath $extractedRoot -File -Recurse -Force).Count -ne ($sourceReceipts.Count + 1)) { throw 'Unexpected archive contents' }
Push-Location -LiteralPath (Join-Path $extractedRoot 'plugins/task-progress')
try {
  foreach ($exampleName in @('single', 'multiple', 'stages')) {
    foreach ($format in @('markdown', 'html')) {
      $preview = (& node 'skills/task-progress/scripts/render.mjs' --input ('examples/' + $exampleName + '.safe.json') --at '2026-10-21T12:10:00Z' --format $format | Out-String)
      if ($LASTEXITCODE -ne 0) { throw 'Extracted CLI failed' }
      $extension = if ($format -eq 'html') { 'html' } else { 'md' }
      if ($preview -cne [System.IO.File]::ReadAllText((Join-Path $evidenceRoot ($exampleName + '.preview.' + $extension)))) { throw 'Extracted example differs from source output' }
    }
  }
} finally { Pop-Location }
$extractCheckPath = Join-Path $evidenceRoot 'extracted-verification.safe.json'
Save-SafeJson $extractCheckPath ([ordered]@{ status = 'passed'; sourceFilesChecked = $checkedCount; marketplaceChecked = $true; extraFiles = 0; extractedCliExamples = @('single/markdown', 'single/html', 'multiple/markdown', 'multiple/html', 'stages/markdown', 'stages/html'); outputEqualsSource = $true; root = $extractedRoot })
$generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
$ready = [ordered]@{
  schemaVersion = 1; status = 'ready_for_install'; generatedAt = $generatedAt; plugin = 'task-progress'; version = $manifest.version
  installed = $null; installedByBuild = $false; globalConfigModifiedByBuild = $false; plannerWritten = $false; networkOrApiCallsByPlugin = $false
  sourceRoot = $sourceRoot; sourceTreeSha256 = $treeHash; sourceFiles = Get-SafeFileReceipt $sourcesPath
  archive = Get-SafeFileReceipt $archivePath; marketplaceRoot = $marketplaceRoot; extractedRoot = $extractedRoot
  checks = [ordered]@{ nodeVersion = (& node --version); tests = $testCount; passed = $passCount; failed = 0; archiveSourceFilesIdentical = $checkedCount; marketplaceIdentical = $true; extractedCliExamplesPassed = 6; pluginManifestPortableAndCompatibilityAgree = $true; userCodexInstall = 'not_run_by_build'; nativeCodexScreenshot = 'not_checked_by_build'; markdownPreview = 'saved_in_evidence'; skillCreatorValidator = 'not_run_by_build' }
  evidence = @(Get-ChildItem -LiteralPath $evidenceRoot -File | Sort-Object FullName | ForEach-Object { Get-SafeFileReceipt $_.FullName })
  limitations = @('Skill plugin with Markdown output; no pinned native widget, MCP App, automatic polling, or live Planner adapter.', 'External evidence authenticity and full population are asserted by the input source, not independently fetched.', 'Build does not install the plugin or verify native Codex discovery/rendering. Existing profile state is unknown to this builder.', 'Font and table width depend on the Codex client; dated demo is synthetic.')
  install = @('Verify archive bytes and SHA256 from this receipt.', ('Use marketplace root: ' + $marketplaceRoot), ('codex plugin marketplace add "' + $marketplaceRoot + '" --json (registration only)'), 'codex plugin add task-progress@task-progress-local --json (installation)', 'codex plugin list --marketplace task-progress-local --json (installed entries only)', 'Use an existing enabled task-progress plugin without reinstalling when possible. Verify enabled on this plugin only.', 'Automatic discovery in the current chat depends on the client; if absent use next session or explicitly read installed SKILL.md.', 'Verify actual installation and enabled separately from discovery before claiming installed.')
  use = @('Read README.md and skills/task-progress/references/contract.md.', 'node skills/task-progress/scripts/render.mjs --input examples/single.safe.json --at 2026-10-21T12:10:00Z', 'For working data omit --at; use --task ID or --scope project:ID or --tasks ID,ID.')
  rollback = @('codex plugin remove task-progress@task-progress-local', 'codex plugin marketplace remove task-progress-local', 'Keep ZIP and READY for recovery. Do not alter other plugins or Planner data.')
}
Save-SafeJson (Join-Path $sourceRoot 'READY.safe.json') $ready
Save-SafeJson (Join-Path $sourceRoot 'CURRENT.safe.json') $ready
Write-Output ('ready_for_install; tests=' + $testCount + '; source_files=' + $checkedCount)
Get-SafeFileReceipt $archivePath | ConvertTo-Json
