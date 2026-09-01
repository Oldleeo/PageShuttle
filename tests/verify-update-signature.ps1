[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PackagePath,
    [Parameter(Mandatory)][string]$ManifestPath,
    [ValidateSet('win-x64', 'osx-x64', 'osx-arm64')]
    [string]$RuntimeIdentifier = 'win-x64',
    [string]$PublicKeyPath = (Join-Path $PSScriptRoot '..\host\UpdatePublicKey.pem')
)

$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$package = if ($manifest.packages -and $manifest.packages.$RuntimeIdentifier) {
    $manifest.packages.$RuntimeIdentifier
} elseif ($RuntimeIdentifier -eq 'win-x64') {
    $manifest
} else {
    throw "UPDATE_PLATFORM_MISSING_$RuntimeIdentifier"
}
$hash = (Get-FileHash -LiteralPath $PackagePath -Algorithm SHA256).Hash
if ($hash -ne $package.sha256) { throw 'UPDATE_SHA256_MISMATCH' }
$rsa = [Security.Cryptography.RSA]::Create()
try {
    $rsa.ImportFromPem([IO.File]::ReadAllText((Resolve-Path -LiteralPath $PublicKeyPath)))
    $valid = $rsa.VerifyHash(
        [Convert]::FromHexString($hash),
        [Convert]::FromBase64String($package.signature),
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pss)
    if (-not $valid) { throw 'UPDATE_SIGNATURE_INVALID' }
} finally { $rsa.Dispose() }
Write-Host 'UPDATE_SIGNATURE_OK'
Write-Host "RUNTIME=$RuntimeIdentifier"
