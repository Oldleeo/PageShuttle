[CmdletBinding()]
param(
    [string]$Version = '0.5.0',
    [string]$SigningKeyPath = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Oldlee\PageShuttleSigning\update-signing-private.pem'),
    [string[]]$ReleaseNotes = @(
        '新增 GitHub Releases 签名更新与一键安装',
        '更新失败自动回滚并保留最近两个备份',
        '新增网页时区、语言与字体指纹环境保护'
    )
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$artifacts = Join-Path $projectRoot 'artifacts'
$publish = Join-Path $artifacts 'host'
$updaterPublish = Join-Path $artifacts 'updater'
$releaseRoot = Join-Path $projectRoot 'release'
$packageName = "页梭-v$Version"
$package = Join-Path $releaseRoot $packageName
$zip = Join-Path $releaseRoot "$packageName.zip"
$releaseAsset = Join-Path $releaseRoot "PageShuttle-v$Version-win-x64.zip"
$updateManifestPath = Join-Path $releaseRoot 'update-manifest.json'
$releaseNotesPath = Join-Path $releaseRoot 'release-notes.md'
$xrayRoot = Join-Path $projectRoot 'third_party\xray'

if (-not (Test-Path -LiteralPath (Join-Path $xrayRoot 'xray.exe'))) {
    throw '缺少 third_party\xray\xray.exe，无法生成可运行安装包。'
}

dotnet publish (Join-Path $projectRoot 'host\ChromeProxyHost.csproj') -c Release -r win-x64 --self-contained true --no-restore -o $publish
if ($LASTEXITCODE -ne 0) { throw 'ChromeProxyHost 发布失败。' }
dotnet publish (Join-Path $projectRoot 'updater\PageShuttleUpdater.csproj') -c Release -r win-x64 --self-contained true --no-restore -o $updaterPublish
if ($LASTEXITCODE -ne 0) { throw 'PageShuttleUpdater 发布失败。' }

if (Test-Path -LiteralPath $package) { Remove-Item -LiteralPath $package -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $package 'extension'), (Join-Path $package 'helper\xray') | Out-Null
Copy-Item -Path (Join-Path $projectRoot 'extension\*') -Destination (Join-Path $package 'extension') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $publish 'ChromeProxyHost.exe') -Destination (Join-Path $package 'helper\ChromeProxyHost.exe') -Force
Copy-Item -LiteralPath (Join-Path $updaterPublish 'PageShuttleUpdater.exe') -Destination (Join-Path $package 'helper\PageShuttleUpdater.exe') -Force
Copy-Item -Path (Join-Path $xrayRoot '*') -Destination (Join-Path $package 'helper\xray') -Recurse -Force
$installScriptSource = Join-Path $projectRoot 'installer\Install.ps1'
$uninstallScriptSource = Join-Path $projectRoot 'installer\Uninstall.ps1'
$installScriptTarget = Join-Path $package 'Install.ps1'
$uninstallScriptTarget = Join-Path $package 'Uninstall.ps1'
$utf8WithBom = [Text.UTF8Encoding]::new($true)
[IO.File]::WriteAllText($installScriptTarget, [IO.File]::ReadAllText($installScriptSource), $utf8WithBom)
[IO.File]::WriteAllText($uninstallScriptTarget, [IO.File]::ReadAllText($uninstallScriptSource), $utf8WithBom)
Copy-Item -LiteralPath (Join-Path $projectRoot 'installer\安装 页梭.cmd') -Destination (Join-Path $package '安装 页梭.cmd') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'installer\卸载 页梭.cmd') -Destination (Join-Path $package '卸载 页梭.cmd') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination (Join-Path $package '项目说明.md') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\INSTALL.md') -Destination (Join-Path $package '安装教程.md') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\USER_GUIDE.md') -Destination (Join-Path $package '使用教程.md') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'COPYRIGHT.txt') -Destination (Join-Path $package '版权声明.txt') -Force
if (Test-Path -LiteralPath (Join-Path $projectRoot 'LICENSE')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination (Join-Path $package 'LICENSE') -Force
}
if (Test-Path -LiteralPath (Join-Path $projectRoot 'PRIVACY.md')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot 'PRIVACY.md') -Destination (Join-Path $package '隐私说明.md') -Force
}

if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -LiteralPath $package -DestinationPath $zip -CompressionLevel Optimal
Copy-Item -LiteralPath $zip -Destination $releaseAsset -Force

$hash = (Get-FileHash -LiteralPath $releaseAsset -Algorithm SHA256).Hash
if (-not (Test-Path -LiteralPath $SigningKeyPath)) {
    throw "缺少发布签名私钥：$SigningKeyPath"
}
$rsa = [Security.Cryptography.RSA]::Create()
try {
    $rsa.ImportFromPem([IO.File]::ReadAllText($SigningKeyPath))
    $hashBytes = [Convert]::FromHexString($hash)
    $signatureBytes = $rsa.SignHash(
        $hashBytes,
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pss)
    $signature = [Convert]::ToBase64String($signatureBytes)
} finally {
    $rsa.Dispose()
}
$updateManifest = [ordered]@{
    version = $Version
    publishedAt = [DateTimeOffset]::UtcNow.ToString('o')
    packageUrl = "https://github.com/Oldleeo/PageShuttle/releases/download/v$Version/PageShuttle-v$Version-win-x64.zip"
    sha256 = $hash
    signature = $signature
    releasePage = "https://github.com/Oldleeo/PageShuttle/releases/tag/v$Version"
    notes = $ReleaseNotes
}
[IO.File]::WriteAllText(
    $updateManifestPath,
    ($updateManifest | ConvertTo-Json -Depth 5),
    [Text.UTF8Encoding]::new($false))
$releaseNoteLines = @($ReleaseNotes | ForEach-Object { "- $_" })
$releaseNotesMarkdown = (@(
    "# 页梭 v$Version",
    '',
    '## 本次更新',
    ''
) + $releaseNoteLines + @(
    '',
    '## 下载与安装',
    '',
    "下载 ``PageShuttle-v$Version-win-x64.zip``，完整解压后双击 ``安装 页梭.cmd``。",
    '',
    'v0.5.0 及之后的版本也可以在页梭设置中检查并安装签名更新。',
    '',
    '作者：[老李Oldlee](https://x.com/oldleeoo)'
)) -join "`n"
[IO.File]::WriteAllText($releaseNotesPath, $releaseNotesMarkdown, [Text.UTF8Encoding]::new($false))
Write-Host "PACKAGE=$package"
Write-Host "ZIP=$zip"
Write-Host "RELEASE_ASSET=$releaseAsset"
Write-Host "UPDATE_MANIFEST=$updateManifestPath"
Write-Host "RELEASE_NOTES=$releaseNotesPath"
Write-Host "SHA256=$hash"
