[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$nativeHostName = 'com.oldlee.chrome_only_proxy'
$installRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Oldlee\ChromeOnlyProxy'
$expectedRoot = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Oldlee\ChromeOnlyProxy'))
$resolvedTarget = [IO.Path]::GetFullPath($installRoot)
if ($resolvedTarget -ne $expectedRoot) { throw '卸载目标校验失败，已停止。' }

$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$nativeHostName"
if (Test-Path -LiteralPath $registryPath) {
    Remove-Item -LiteralPath $registryPath -Force
}
if (Test-Path -LiteralPath $resolvedTarget) {
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
}

Write-Host '页梭本地助手已卸载。' -ForegroundColor Green
Write-Host '没有修改 Windows 系统代理。'
Write-Host '请在 chrome://extensions 中手动移除扩展。'
