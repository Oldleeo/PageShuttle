[CmdletBinding()]
param(
    [string]$Version = '0.6.1',
    [string]$SigningKeyPath = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Oldlee/PageShuttleSigning/update-signing-private.pem'),
    [string[]]$ReleaseNotes = @(
        '删除字体探测保护及其高频网页布局接口劫持，改善滚动与交互流畅度',
        '网页时间跟随代理国家改为默认关闭的独立开关',
        '界面明确提示开启网页时间跟随后可能增加复杂页面计算开销'
    )
)

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Build-PlatformPackage.ps1') -Version $Version -RuntimeIdentifier 'win-x64'
if ($LASTEXITCODE -ne 0) { throw 'Windows 发行包构建失败。' }
& (Join-Path $PSScriptRoot 'Sign-Release.ps1') -Version $Version -SigningKeyPath $SigningKeyPath -RuntimeIdentifiers @('win-x64') -ReleaseNotes $ReleaseNotes
