$ErrorActionPreference = 'Stop'
$nativePerl = $null
foreach ($candidate in @(Get-Command perl.exe -All -CommandType Application -ErrorAction SilentlyContinue)) {
    $platform = & $candidate.Source -e 'print $^O'
    if ($LASTEXITCODE -eq 0 -and "$platform" -eq 'MSWin32') {
        $nativePerl = $candidate.Source
        break
    }
}
if (-not $nativePerl) {
    throw 'The Windows runner needs native Perl for vendored OpenSSL; Git/MSYS Perl is unsupported.'
}
if (-not $env:GITHUB_ENV) {
    throw 'GITHUB_ENV is required to configure the remaining build steps.'
}
Add-Content -LiteralPath $env:GITHUB_ENV -Value ("OPENSSL_SRC_PERL=" + $nativePerl)
