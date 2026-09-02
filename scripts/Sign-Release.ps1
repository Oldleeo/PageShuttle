[CmdletBinding()]
param(
    [string]$Version = '0.6.1',
    [Parameter(Mandatory)][string]$SigningKeyPath,
    [string[]]$RuntimeIdentifiers = @('win-x64', 'osx-x64', 'osx-arm64'),
    [string[]]$ReleaseNotes = @(
        '删除字体探测保护及其高频网页布局接口劫持，改善滚动与交互流畅度',
        '网页时间跟随代理国家改为默认关闭的独立开关',
        '界面明确提示开启网页时间跟随后可能增加复杂页面计算开销'
    )
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot 'release'
$updateManifestPath = Join-Path $releaseRoot 'update-manifest.json'
$releaseNotesPath = Join-Path $releaseRoot 'release-notes.md'

if (-not (Test-Path -LiteralPath $SigningKeyPath)) { throw "缺少发布签名私钥：$SigningKeyPath" }
$rsa = [Security.Cryptography.RSA]::Create()
try {
    $rsa.ImportFromPem([IO.File]::ReadAllText($SigningKeyPath))
    $packages = [ordered]@{}
    foreach ($runtime in $RuntimeIdentifiers) {
        $assetName = "PageShuttle-v$Version-$runtime.zip"
        $assetPath = Join-Path $releaseRoot $assetName
        if (-not (Test-Path -LiteralPath $assetPath)) { throw "缺少发行包：$assetName" }
        $hash = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash
        $signatureBytes = $rsa.SignHash(
            [Convert]::FromHexString($hash),
            [Security.Cryptography.HashAlgorithmName]::SHA256,
            [Security.Cryptography.RSASignaturePadding]::Pss)
        $packages[$runtime] = [ordered]@{
            packageUrl = "https://github.com/Oldleeo/PageShuttle/releases/download/v$Version/$assetName"
            sha256 = $hash
            signature = [Convert]::ToBase64String($signatureBytes)
        }
    }
} finally { $rsa.Dispose() }

$windows = $packages['win-x64']
$updateManifest = [ordered]@{
    version = $Version
    publishedAt = [DateTimeOffset]::UtcNow.ToString('o')
    packageUrl = if ($windows) { $windows.packageUrl } else { '' }
    sha256 = if ($windows) { $windows.sha256 } else { '' }
    signature = if ($windows) { $windows.signature } else { '' }
    releasePage = "https://github.com/Oldleeo/PageShuttle/releases/tag/v$Version"
    notes = $ReleaseNotes
    packages = $packages
}
[IO.File]::WriteAllText($updateManifestPath, ($updateManifest | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))

$releaseNoteLines = @($ReleaseNotes | ForEach-Object { "- $_" })
$downloadLines = @()
if ($RuntimeIdentifiers -contains 'win-x64') { $downloadLines += "- Windows 10/11：``PageShuttle-v$Version-win-x64.zip``" }
if ($RuntimeIdentifiers -contains 'osx-arm64') { $downloadLines += "- Apple Silicon Mac：``PageShuttle-v$Version-osx-arm64.zip``" }
if ($RuntimeIdentifiers -contains 'osx-x64') { $downloadLines += "- Intel Mac：``PageShuttle-v$Version-osx-x64.zip``" }
$releaseNotesMarkdown = (@(
    "# 页梭 v$Version",
    '',
    '## 本次更新',
    ''
) + $releaseNoteLines + @(
    '',
    '## 下载',
    ''
) + $downloadLines + @(
    '',
    'Windows 完整解压后双击「安装 页梭.cmd」。macOS 完整解压后右键打开「安装 页梭.command」；如果 Gatekeeper 提示来源不明，请在系统设置的隐私与安全中确认打开。',
    '',
    '页梭只修改安装它的 Chrome 用户配置，不修改 Windows 或 macOS 系统代理。',
    '',
    '作者：[老李Oldlee](https://x.com/oldleeoo)'
)) -join "`n"
[IO.File]::WriteAllText($releaseNotesPath, $releaseNotesMarkdown, [Text.UTF8Encoding]::new($false))
Write-Host "UPDATE_MANIFEST=$updateManifestPath"
Write-Host "RELEASE_NOTES=$releaseNotesPath"
