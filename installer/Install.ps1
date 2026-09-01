[CmdletBinding()]
param(
    [string]$InstallRoot,
    [switch]$SkipRegistry,
    [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$productName = '页梭'
$extensionId = 'fmbeehpohhpjacimkghepkiempnbpplg'
$nativeHostName = 'com.oldlee.chrome_only_proxy'
$packageRoot = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'extension\manifest.json')) {
    $PSScriptRoot
} else {
    Split-Path -Parent $PSScriptRoot
}
$sourceExtension = Join-Path $packageRoot 'extension'
$sourceHelper = Join-Path $packageRoot 'helper'
if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
    $installRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Oldlee\ChromeOnlyProxy'
} else {
    $installRoot = [IO.Path]::GetFullPath($InstallRoot)
}
$installedExtension = Join-Path $installRoot 'extension'
$installedHelper = Join-Path $installRoot 'helper'

function Get-CanonicalProcessPath {
    param([System.Diagnostics.Process]$Process)

    try {
        if ([string]::IsNullOrWhiteSpace($Process.Path)) { return $null }
        return [IO.Path]::GetFullPath($Process.Path)
    } catch {
        return $null
    }
}

function Get-OwnedProcesses {
    param([string[]]$ExecutablePaths)

    $canonicalPaths = @($ExecutablePaths | ForEach-Object { [IO.Path]::GetFullPath($_) })
    return @(Get-Process -Name 'ChromeProxyHost', 'xray' -ErrorAction SilentlyContinue | Where-Object {
        $processPath = Get-CanonicalProcessPath -Process $_
        $null -ne $processPath -and $canonicalPaths -contains $processPath
    })
}

function Stop-InstalledPageShuttle {
    $helperExecutable = Join-Path $installedHelper 'ChromeProxyHost.exe'
    $xrayExecutable = Join-Path $installedHelper 'xray\xray.exe'
    $ownedProcesses = @(Get-OwnedProcesses -ExecutablePaths @($helperExecutable, $xrayExecutable))
    if ($ownedProcesses.Count -eq 0) { return }

    Write-Host '检测到页梭正在运行，正在安全停止旧版进程以完成升级…' -ForegroundColor Yellow
    Write-Host '只会停止页梭安装目录中的进程，不会关闭 v2rayN 或其他代理软件。'

    $helperPath = [IO.Path]::GetFullPath($helperExecutable)
    $helperProcesses = @($ownedProcesses | Where-Object {
        (Get-CanonicalProcessPath -Process $_) -eq $helperPath
    })
    foreach ($process in $helperProcesses) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(1)
    do {
        $remaining = @(Get-OwnedProcesses -ExecutablePaths @($helperExecutable, $xrayExecutable))
        if ($remaining.Count -eq 0) { break }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)

    # ChromeProxyHost 会通过 Job Object 关闭子进程。如果 Xray 仍在退出，
    # 只按完整路径终止页梭自带的副本，避免误伤其他 xray.exe。
    $remaining = @(Get-OwnedProcesses -ExecutablePaths @($helperExecutable, $xrayExecutable))
    foreach ($process in $remaining) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(3)
    do {
        $remaining = @(Get-OwnedProcesses -ExecutablePaths @($helperExecutable, $xrayExecutable))
        if ($remaining.Count -eq 0) { break }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)

    if ($remaining.Count -gt 0) {
        throw '旧版页梭进程未能退出。请在扩展中点击「断开」，然后重新运行安装程序。'
    }
}

function Copy-DirectoryContentsWithRetry {
    param(
        [string]$Source,
        [string]$Destination
    )

    for ($attempt = 1; $attempt -le 8; $attempt++) {
        try {
            Copy-Item -Path (Join-Path $Source '*') -Destination $Destination -Recurse -Force -ErrorAction Stop
            return
        } catch {
            if ($attempt -eq 8) { throw }
            Start-Sleep -Milliseconds 300
        }
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $sourceExtension 'manifest.json'))) {
    throw '安装包不完整：缺少 extension\manifest.json'
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceHelper 'ChromeProxyHost.exe'))) {
    throw '安装包不完整：缺少 helper\ChromeProxyHost.exe'
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceHelper 'xray\xray.exe'))) {
    throw '安装包不完整：缺少 helper\xray\xray.exe'
}

Stop-InstalledPageShuttle
New-Item -ItemType Directory -Force -Path $installedExtension, $installedHelper | Out-Null
Copy-DirectoryContentsWithRetry -Source $sourceExtension -Destination $installedExtension
Copy-DirectoryContentsWithRetry -Source $sourceHelper -Destination $installedHelper

$hostManifestPath = Join-Path $installRoot "$nativeHostName.json"
$hostManifest = [ordered]@{
    name = $nativeHostName
    description = "$productName 本地回环助手"
    path = (Join-Path $installedHelper 'ChromeProxyHost.exe')
    type = 'stdio'
    allowed_origins = @("chrome-extension://$extensionId/")
}
$manifestJson = $hostManifest | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($hostManifestPath, $manifestJson, [Text.UTF8Encoding]::new($false))

if (-not $SkipRegistry) {
    $registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$nativeHostName"
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -Path $registryPath -Value $hostManifestPath
}

Write-Host ''
Write-Host "$productName 本地助手已安装。" -ForegroundColor Green
Write-Host '本次安装没有修改 Windows 系统代理、WinHTTP、TUN 或防火墙。'
Write-Host ''
Write-Host '请在 Chrome 中完成最后一步：'
Write-Host '1. 打开 chrome://extensions'
Write-Host '2. 开启右上角「开发者模式」'
Write-Host '3. 点击「加载已解压的扩展程序」'
Write-Host "4. 选择：$installedExtension" -ForegroundColor Cyan
Write-Host ''
Write-Host "固定扩展 ID：$extensionId"
Write-Host '作者：老李Oldlee  https://x.com/oldleeoo'

if (-not $NoLaunch) {
    try {
        Start-Process 'chrome.exe' 'chrome://extensions' -WindowStyle Normal
        Start-Process 'explorer.exe' -ArgumentList @($installedExtension) -WindowStyle Normal
    } catch {
        Write-Host '无法自动打开 Chrome，请手动完成上述步骤。' -ForegroundColor Yellow
    }
}
