[CmdletBinding()]
param(
    [ValidateSet('win-x64', 'osx-x64', 'osx-arm64')]
    [string]$RuntimeIdentifier = 'win-x64',
    [string]$Version = 'v26.3.27'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$targetRoot = Join-Path $projectRoot 'third_party/xray'
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("pageshuttle-xray-" + [Guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $tempRoot 'xray.zip'
$extractPath = Join-Path $tempRoot 'extracted'

$asset = switch ($RuntimeIdentifier) {
    'win-x64' { 'Xray-windows-64.zip' }
    'osx-x64' { 'Xray-macos-64.zip' }
    'osx-arm64' { 'Xray-macos-arm64-v8a.zip' }
}
$executableName = if ($RuntimeIdentifier -eq 'win-x64') { 'xray.exe' } else { 'xray' }
$expectedArchiveSha256 = switch ($RuntimeIdentifier) {
    'osx-x64' { 'F5B0471D3459EFF1B82E48AF0AEAC186ABCC3298210070AFBBBD8437A4E8B203' }
    'osx-arm64' { '2E93A67E8AA1936ECEFB307E120830FCBD4C643AB9B1C46A2D0838D5F8409EAF' }
    default { $null }
}
$expectedBinarySha256 = if ($RuntimeIdentifier -eq 'win-x64') {
    'D004C39288CE9ADA487C6F398C7C545F7D749E44BDFDD59DBC9F865AFBA4E1AD'
} else { $null }
$url = "https://github.com/XTLS/Xray-core/releases/download/$Version/$asset"

try {
    New-Item -ItemType Directory -Force -Path $tempRoot, $extractPath, $targetRoot | Out-Null
    Invoke-WebRequest -Uri $url -OutFile $archivePath
    $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    if ($expectedArchiveSha256 -and $archiveHash -ne $expectedArchiveSha256) {
        throw "Xray 压缩包 SHA-256 不匹配：$archiveHash"
    }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force
    $xray = Get-ChildItem -LiteralPath $extractPath -Filter $executableName -Recurse | Select-Object -First 1
    if (-not $xray) { throw "Xray 发行包中缺少 $executableName" }
    $binaryHash = (Get-FileHash -LiteralPath $xray.FullName -Algorithm SHA256).Hash
    if ($expectedBinarySha256 -and $binaryHash -ne $expectedBinarySha256) {
        throw "Xray 二进制 SHA-256 不匹配：$binaryHash"
    }

    $target = Join-Path $targetRoot $executableName
    Copy-Item -LiteralPath $xray.FullName -Destination $target -Force
    if ($RuntimeIdentifier -like 'osx-*') { & /bin/chmod 755 $target }
    [IO.File]::WriteAllText(
        (Join-Path $targetRoot 'XRAY-VERSION.txt'),
        "$Version`nASSET $asset`nARCHIVE-SHA256 $($archiveHash.ToLowerInvariant())`nBINARY-SHA256 $($binaryHash.ToLowerInvariant())`n",
        [Text.UTF8Encoding]::new($false))
    Write-Host "XRAY=$Version"
    Write-Host "RUNTIME=$RuntimeIdentifier"
    Write-Host "ASSET=$asset"
    Write-Host "ARCHIVE_SHA256=$archiveHash"
    Write-Host "BINARY_SHA256=$binaryHash"
} finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
