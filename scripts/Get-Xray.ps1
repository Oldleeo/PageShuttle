[CmdletBinding()]
param(
    [string]$Version = 'v26.3.27',
    [string]$ExpectedSha256 = 'D004C39288CE9ADA487C6F398C7C545F7D749E44BDFDD59DBC9F865AFBA4E1AD'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$targetRoot = Join-Path $projectRoot 'third_party\xray'
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("pageshuttle-xray-" + [Guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $tempRoot 'xray.zip'
$extractPath = Join-Path $tempRoot 'extracted'
$url = "https://github.com/XTLS/Xray-core/releases/download/$Version/Xray-windows-64.zip"

try {
    New-Item -ItemType Directory -Force -Path $tempRoot, $extractPath, $targetRoot | Out-Null
    Invoke-WebRequest -Uri $url -OutFile $archivePath
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force
    $xray = Get-ChildItem -LiteralPath $extractPath -Filter 'xray.exe' -Recurse | Select-Object -First 1
    if (-not $xray) { throw 'Xray 发行包中缺少 xray.exe' }
    $hash = (Get-FileHash -LiteralPath $xray.FullName -Algorithm SHA256).Hash
    if ($hash -ne $ExpectedSha256) { throw "Xray SHA-256 不匹配：$hash" }
    Copy-Item -LiteralPath $xray.FullName -Destination (Join-Path $targetRoot 'xray.exe') -Force
    [IO.File]::WriteAllText((Join-Path $targetRoot 'XRAY-VERSION.txt'), "$Version`nSHA256 $($hash.ToLowerInvariant())`n", [Text.UTF8Encoding]::new($false))
    Write-Host "XRAY=$Version"
    Write-Host "SHA256=$hash"
} finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
