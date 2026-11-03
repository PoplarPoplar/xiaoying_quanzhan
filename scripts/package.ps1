param([string]$OutputName = 'xiaoying-source.zip')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$distRoot = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Force -Path $distRoot | Out-Null
if ([IO.Path]::GetFileName($OutputName) -ne $OutputName -or -not $OutputName.EndsWith('.zip')) { throw 'OutputName must be a zip filename.' }
$zipPath = Join-Path $distRoot $OutputName
if (Test-Path -LiteralPath $zipPath) { throw "Already exists: $zipPath. Choose another OutputName." }
Add-Type -AssemblyName System.IO.Compression
$files = @()
foreach ($name in @('README.md','compose.yaml','.env.example','.gitignore','.dockerignore')) { $files += Get-Item -LiteralPath (Join-Path $projectRoot $name) }
foreach ($directory in @('frontend','backend','docs','scripts','.github')) {
  $files += Get-ChildItem -LiteralPath (Join-Path $projectRoot $directory) -File -Recurse -Force | Where-Object {
    $relative = [IO.Path]::GetRelativePath($projectRoot, $_.FullName).Replace('\','/')
    $relative -notmatch '(^|/)(node_modules|\.next|target|coverage|\.git|\.local|\.runtime|\.tools|data|dist|ui-reference)(/|$)' -and
    $_.Name -notmatch '^(\.env($|\.)|.*\.log$|.*\.tsbuildinfo$)' -and $_.Extension -notin @('.zip','.pem','.key','.jar','.class','.exe','.dll','.ibd','.sdi') -and $_.Name -ne 'failure.png'
  }
}
$stream = [IO.File]::Open($zipPath,[IO.FileMode]::CreateNew)
try {
  $archive = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$false)
  try {
    foreach ($file in $files) {
      $entryName = [IO.Path]::GetRelativePath($projectRoot,$file.FullName).Replace('\','/')
      $entry = $archive.CreateEntry($entryName,[IO.Compression.CompressionLevel]::Optimal)
      $inputStream = $file.OpenRead(); $outputStream = $entry.Open()
      try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
    }
  } finally { $archive.Dispose() }
} finally { $stream.Dispose() }
$readStream = [IO.File]::OpenRead($zipPath)
try {
  $check = [IO.Compression.ZipArchive]::new($readStream,[IO.Compression.ZipArchiveMode]::Read)
  try {
    $names = @($check.Entries | ForEach-Object FullName)
    foreach ($required in @('frontend/package-lock.json','backend/pom.xml','.github/workflows/ci.yml','compose.yaml','.env.example')) {
      if ($names -notcontains $required) { throw "Archive missing $required" }
    }
    if (-not ($names | Where-Object { $_ -match '^backend/src/main/resources/db/migration/.*\.sql$' })) { throw 'Archive missing migration SQL.' }
    if ($names | Where-Object { $_ -match '(^|/)(node_modules|\.next|target|ui-reference|\.git|\.runtime|\.tools|data)(/|$)|(^|/)\.env$|\.log$|\.jar$|(^|/)failure\.png$' }) { throw 'Archive contains excluded material.' }
    Write-Output "Verified $($names.Count) source files: $zipPath"
  } finally { $check.Dispose() }
} finally { $readStream.Dispose() }
Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath

