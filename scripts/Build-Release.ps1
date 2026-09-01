[CmdletBinding()]
param(
    [string]$Version = '0.6.0',
    [string]$SigningKeyPath = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Oldlee/PageShuttleSigning/update-signing-private.pem'),
    [string[]]$ReleaseNotes = @(
        '新增 macOS 版本，同时支持 Apple Silicon 与 Intel Mac',
        'macOS 版只修改当前 Chrome 用户配置，不修改系统代理',
        '更新清单按操作系统与架构选择签名安装包'
    )
)

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Build-PlatformPackage.ps1') -Version $Version -RuntimeIdentifier 'win-x64'
if ($LASTEXITCODE -ne 0) { throw 'Windows 发行包构建失败。' }
& (Join-Path $PSScriptRoot 'Sign-Release.ps1') -Version $Version -SigningKeyPath $SigningKeyPath -RuntimeIdentifiers @('win-x64') -ReleaseNotes $ReleaseNotes
