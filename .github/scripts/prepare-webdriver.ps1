# Test tooling only. Read the installed WebView2 version, never install or update the runtime.
# https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution
# https://learn.microsoft.com/microsoft-edge/webview2/how-to/webdriver
param([string] $OutputDirectory)
$ErrorActionPreference = 'Stop'

function Select-WebViewVersion([string[]] $Versions) {
    $valid = @($Versions | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' -and $_ -ne '0.0.0.0' } | Select-Object -Unique)
    if ($valid.Count -ne 1) {
        throw 'One unambiguous installed WebView2 Runtime version is required. Do not substitute the Edge browser version.'
    }
    return $valid[0]
}

function Assert-WebDriverVersion([string] $RuntimeVersion, [string] $DriverOutput) {
    if ($RuntimeVersion -notmatch '^\d+\.\d+\.\d+\.\d+$' -or $DriverOutput -notmatch '^MSEdgeDriver (\d+\.\d+\.\d+\.\d+)\b') {
        throw 'The WebView2 or Microsoft Edge Driver version is invalid.'
    }
    $driverVersion = $Matches[1]
    if (($RuntimeVersion.Split('.')[0..2] -join '.') -ne ($driverVersion.Split('.')[0..2] -join '.')) {
        throw "WebView2 $RuntimeVersion and Microsoft Edge Driver $driverVersion do not match."
    }
    return $driverVersion
}

function Expand-WebDriver([string] $Archive, [string] $Destination) {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        $entries = @($zip.Entries | Where-Object { $_.FullName -ceq 'msedgedriver.exe' })
        if ($entries.Count -ne 1 -or $entries[0].Length -lt 1 -or $entries[0].Length -gt 100MB) {
            throw 'The driver archive must contain one bounded msedgedriver.exe entry.'
        }
        $source = $entries[0].Open()
        try {
            $target = [System.IO.File]::Open($Destination, [System.IO.FileMode]::CreateNew)
            try { $source.CopyTo($target) } finally { $target.Dispose() }
        } finally { $source.Dispose() }
    } finally { $zip.Dispose() }
}

if ($MyInvocation.InvocationName -eq '.') { return }
if (-not $IsWindows -or [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
    throw 'This provisioning step is qualified only for the Windows x64 CI runner.'
}
if (-not $OutputDirectory -or -not $env:GITHUB_OUTPUT) {
    throw 'OutputDirectory and GITHUB_OUTPUT are required.'
}
foreach ($name in @('WEBVIEW2_BROWSER_EXECUTABLE_FOLDER', 'WEBVIEW2_RELEASE_CHANNEL_PREFERENCE', 'WEBVIEW2_CHANNEL_SEARCH_KIND', 'WEBVIEW2_RELEASE_CHANNELS')) {
    if ([Environment]::GetEnvironmentVariable($name)) { throw "Remove the inherited $name override before runtime qualification." }
}
$registryRoots = @('HKLM:\SOFTWARE\WOW6432Node\', 'HKLM:\SOFTWARE\', 'HKCU:\SOFTWARE\WOW6432Node\', 'HKCU:\SOFTWARE\')
$versions = foreach ($prefix in $registryRoots) {
    $path = $prefix + 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    if (Test-Path -LiteralPath $path) {
        (Get-ItemProperty -LiteralPath $path -Name pv -ErrorAction SilentlyContinue).pv
    }
}
$runtimeVersion = Select-WebViewVersion $versions
$directory = [System.IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $directory) { throw 'The driver output directory must be new.' }
$null = New-Item -ItemType Directory -Path $directory
$archive = Join-Path $directory 'edgedriver.zip'
$driver = Join-Path $directory 'msedgedriver.exe'
$url = "https://msedgedriver.microsoft.com/$runtimeVersion/edgedriver_win64.zip"
Invoke-WebRequest -Uri $url -OutFile $archive -TimeoutSec 60 -MaximumRetryCount 2 -RetryIntervalSec 2
if ((Get-Item -LiteralPath $archive).Length -gt 100MB) { throw 'The driver archive exceeds 100 MiB.' }
Expand-WebDriver $archive $driver
$signature = Get-AuthenticodeSignature -LiteralPath $driver
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)CN=Microsoft Corporation(,|$)') {
    throw 'The downloaded driver does not have a valid Microsoft signature.'
}
$driverOutput = & $driver --version
if ($LASTEXITCODE -ne 0) { throw 'Microsoft Edge Driver could not report its version.' }
$driverVersion = Assert-WebDriverVersion $runtimeVersion "$driverOutput"
$evidence = @{
    runtime_version = $runtimeVersion
    driver_version = $driverVersion
    source = $url
    sha256 = (Get-FileHash -LiteralPath $driver -Algorithm SHA256).Hash.ToLowerInvariant()
    signature = 'Microsoft Corporation, Valid'
}
$evidence | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'versions.json') -Encoding utf8
Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value "native_driver=$driver"
Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value "webview_version=$runtimeVersion"
Write-Output "Prepared Microsoft Edge Driver $driverVersion for WebView2 $runtimeVersion."
