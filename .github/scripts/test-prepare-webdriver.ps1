# Pure provisioning regressions: no registry, network, downloaded code or native app execution.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'prepare-webdriver.ps1')
function Assert-Throws([scriptblock] $Action) {
    $failed = $false
    try { & $Action } catch { $failed = $true }
    if (-not $failed) { throw 'Expected this invalid input to fail.' }
}
if ((Select-WebViewVersion @('155.0.1.2', '155.0.1.2', '0.0.0.0')) -ne '155.0.1.2') { throw 'Version deduplication failed.' }
Assert-Throws { Select-WebViewVersion @() }
Assert-Throws { Select-WebViewVersion @('155.0.1.2', '156.0.1.2') }
Assert-Throws { Select-WebViewVersion @('../driver') }
if ((Assert-WebDriverVersion '155.0.1.2' 'MSEdgeDriver 155.0.1.3 (fixture)') -ne '155.0.1.3') { throw 'Compatible patch versions were refused.' }
Assert-Throws { Assert-WebDriverVersion '155.0.1.2' 'MSEdgeDriver 155.0.2.1' }
Assert-Throws { Assert-WebDriverVersion '155.0.1.2' 'other tool 155.0.1.2' }
Assert-Throws { Assert-WebDriverVersion '../driver' 'MSEdgeDriver 155.0.1.2' }
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$owned = Join-Path $temporaryRoot ('auracode-webdriver-test-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $owned
try {
    $archive = Join-Path $owned 'fixture.zip'
    $zip = [System.IO.Compression.ZipFile]::Open($archive, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in @('msedgedriver.exe', '../outside.txt')) {
            $entry = $zip.CreateEntry($name)
            $stream = $entry.Open()
            try { $stream.WriteByte(42) } finally { $stream.Dispose() }
        }
    } finally { $zip.Dispose() }
    $output = Join-Path $owned 'driver.fixture'
    Expand-WebDriver $archive $output
    if ([System.IO.File]::ReadAllBytes($output)[0] -ne 42) { throw 'The exact driver entry was not extracted.' }
    if ((Get-ChildItem -LiteralPath $owned).Count -ne 2) { throw 'Unrequested archive entries were extracted.' }
    Assert-Throws { Expand-WebDriver $archive $output }
    $empty = Join-Path $owned 'empty.zip'
    [System.IO.Compression.ZipFile]::Open($empty, [System.IO.Compression.ZipArchiveMode]::Create).Dispose()
    Assert-Throws { Expand-WebDriver $empty (Join-Path $owned 'missing.fixture') }
} finally {
    $resolved = [System.IO.Path]::GetFullPath($owned)
    if ([System.IO.Path]::GetDirectoryName($resolved).TrimEnd('\') -ne $temporaryRoot.TrimEnd('\') -or [System.IO.Path]::GetFileName($resolved) -notlike 'auracode-webdriver-test-*') {
        throw 'Refusing cleanup outside the owned temporary test directory.'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Output 'WebDriver version, archive selection and no-overwrite tests passed.'
