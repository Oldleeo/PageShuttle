[CmdletBinding()]
param(
    [string]$Version = '0.6.1',
    [ValidateSet('win-x64', 'osx-x64', 'osx-arm64')]
    [string]$RuntimeIdentifier = 'win-x64'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$artifacts = Join-Path $projectRoot 'artifacts'
$publish = Join-Path $artifacts "host-$RuntimeIdentifier"
$updaterPublish = Join-Path $artifacts "updater-$RuntimeIdentifier"
$releaseRoot = Join-Path $projectRoot 'release'
$packageName = "页梭-v$Version"
$package = Join-Path $releaseRoot $packageName
$releaseAssetName = "PageShuttle-v$Version-$RuntimeIdentifier.zip"
$releaseAsset = Join-Path $releaseRoot $releaseAssetName
$xrayRoot = Join-Path $projectRoot 'third_party/xray'
$isWindowsPackage = $RuntimeIdentifier -eq 'win-x64'
$helperName = if ($isWindowsPackage) { 'ChromeProxyHost.exe' } else { 'ChromeProxyHost' }
$updaterName = if ($isWindowsPackage) { 'PageShuttleUpdater.exe' } else { 'PageShuttleUpdater' }
$xrayName = if ($isWindowsPackage) { 'xray.exe' } else { 'xray' }

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null

$extensionManifest = Get-Content -LiteralPath (Join-Path $projectRoot 'extension/manifest.json') -Raw | ConvertFrom-Json
if ($extensionManifest.version -ne $Version) {
    throw "扩展版本 $($extensionManifest.version) 与发行版本 $Version 不一致"
}
if (-not (Test-Path -LiteralPath (Join-Path $xrayRoot $xrayName))) {
    throw "缺少 third_party/xray/$xrayName，无法生成 $RuntimeIdentifier 安装包。"
}

dotnet publish (Join-Path $projectRoot 'host/ChromeProxyHost.csproj') -c Release -r $RuntimeIdentifier --self-contained true --no-restore -o $publish
if ($LASTEXITCODE -ne 0) { throw 'ChromeProxyHost 发布失败。' }
dotnet publish (Join-Path $projectRoot 'updater/PageShuttleUpdater.csproj') -c Release -r $RuntimeIdentifier --self-contained true --no-restore -o $updaterPublish
if ($LASTEXITCODE -ne 0) { throw 'PageShuttleUpdater 发布失败。' }

if (Test-Path -LiteralPath $package) { Remove-Item -LiteralPath $package -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $package 'extension'), (Join-Path $package 'helper/xray') | Out-Null
Copy-Item -Path (Join-Path $projectRoot 'extension/*') -Destination (Join-Path $package 'extension') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $publish $helperName) -Destination (Join-Path $package "helper/$helperName") -Force
Copy-Item -LiteralPath (Join-Path $updaterPublish $updaterName) -Destination (Join-Path $package "helper/$updaterName") -Force
Copy-Item -LiteralPath (Join-Path $xrayRoot $xrayName) -Destination (Join-Path $package "helper/xray/$xrayName") -Force
Copy-Item -LiteralPath (Join-Path $xrayRoot 'XRAY-VERSION.txt') -Destination (Join-Path $package 'helper/xray/XRAY-VERSION.txt') -Force
Copy-Item -LiteralPath (Join-Path $xrayRoot 'LICENSE-Xray.txt') -Destination (Join-Path $package 'helper/xray/LICENSE-Xray.txt') -Force

if ($isWindowsPackage) {
    $utf8WithBom = [Text.UTF8Encoding]::new($true)
    [IO.File]::WriteAllText((Join-Path $package 'Install.ps1'), [IO.File]::ReadAllText((Join-Path $projectRoot 'installer/Install.ps1')), $utf8WithBom)
    [IO.File]::WriteAllText((Join-Path $package 'Uninstall.ps1'), [IO.File]::ReadAllText((Join-Path $projectRoot 'installer/Uninstall.ps1')), $utf8WithBom)
    Copy-Item -LiteralPath (Join-Path $projectRoot 'installer/安装 页梭.cmd') -Destination (Join-Path $package '安装 页梭.cmd') -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'installer/卸载 页梭.cmd') -Destination (Join-Path $package '卸载 页梭.cmd') -Force
} else {
    Copy-Item -LiteralPath (Join-Path $projectRoot 'installer/安装 页梭.command') -Destination (Join-Path $package '安装 页梭.command') -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'installer/卸载 页梭.command') -Destination (Join-Path $package '卸载 页梭.command') -Force
    & /bin/chmod 755 (Join-Path $package '安装 页梭.command') (Join-Path $package '卸载 页梭.command') (Join-Path $package "helper/$helperName") (Join-Path $package "helper/$updaterName") (Join-Path $package "helper/xray/$xrayName")
}

Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination (Join-Path $package '项目说明.md') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/INSTALL.md') -Destination (Join-Path $package '安装教程.md') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/USER_GUIDE.md') -Destination (Join-Path $package '使用教程.md') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'COPYRIGHT.txt') -Destination (Join-Path $package '版权声明.txt') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination (Join-Path $package 'LICENSE') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'PRIVACY.md') -Destination (Join-Path $package '隐私说明.md') -Force

if (Test-Path -LiteralPath $releaseAsset) { Remove-Item -LiteralPath $releaseAsset -Force }
if ($isWindowsPackage) {
    $temporaryZip = Join-Path $releaseRoot "$packageName.zip"
    if (Test-Path -LiteralPath $temporaryZip) { Remove-Item -LiteralPath $temporaryZip -Force }
    Compress-Archive -LiteralPath $package -DestinationPath $temporaryZip -CompressionLevel Optimal
    Move-Item -LiteralPath $temporaryZip -Destination $releaseAsset
} else {
    Push-Location $releaseRoot
    try { & /usr/bin/zip -qry $releaseAssetName $packageName } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'macOS ZIP 打包失败。' }
}

$hash = (Get-FileHash -LiteralPath $releaseAsset -Algorithm SHA256).Hash
Write-Host "PACKAGE=$package"
Write-Host "RELEASE_ASSET=$releaseAsset"
Write-Host "RUNTIME=$RuntimeIdentifier"
Write-Host "SHA256=$hash"
