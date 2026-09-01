[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PackagePath,
    [Parameter(Mandatory)][string]$ManifestPath,
    [string]$PublicKeyPath = (Join-Path $PSScriptRoot '..\host\UpdatePublicKey.pem')
)

$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$hash = (Get-FileHash -LiteralPath $PackagePath -Algorithm SHA256).Hash
if ($hash -ne $manifest.sha256) { throw 'UPDATE_SHA256_MISMATCH' }
$rsa = [Security.Cryptography.RSA]::Create()
try {
    $rsa.ImportFromPem([IO.File]::ReadAllText((Resolve-Path -LiteralPath $PublicKeyPath)))
    $valid = $rsa.VerifyHash(
        [Convert]::FromHexString($hash),
        [Convert]::FromBase64String($manifest.signature),
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pss)
    if (-not $valid) { throw 'UPDATE_SIGNATURE_INVALID' }
} finally { $rsa.Dispose() }
Write-Host 'UPDATE_SIGNATURE_OK'
