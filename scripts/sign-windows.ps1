<#
.SYNOPSIS
  Authenticode-sign one file (Tauri's bundle.windows.signCommand runs this for every binary it produces).

.DESCRIPTION
  Signs with signtool, SHA-256, and an RFC 3161 timestamp (so the signature stays valid after the certificate
  expires). Credentials come from the environment and are never written to the repo:

    Azure Trusted Signing (orgs, or individuals in the US/Canada; no key file to leak):
      ORBIT_SIGN_DLIB       path to Azure.CodeSigning.Dlib.dll
      ORBIT_SIGN_METADATA   path to metadata.json ({"Endpoint", "CodeSigningAccountName", "CertificateProfileName"})
      + AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_TENANT_ID (read by the dlib)

    Certificate in the Windows store (Certum SimplySign virtual card, SSL.com/eToken hardware or cloud key):
      ORBIT_SIGN_CERT_SHA1     the certificate's thumbprint (the private key never leaves the card/HSM)

    PFX / OV-EV certificate file:
      ORBIT_SIGN_PFX           path to the .pfx
      ORBIT_SIGN_PFX_PASSWORD  its password

  Optional: ORBIT_SIGN_TIMESTAMP_URL (defaults: Microsoft's for Azure, Certum's for store certs, DigiCert's for PFX).
  Exits non-zero (failing the build) if nothing is configured or signtool fails.
#>
param([Parameter(Mandatory)] [string]$File)
$ErrorActionPreference = "Stop"

function Find-SignTool {
  $onPath = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  $found = Get-ChildItem $kits -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\" } | Sort-Object FullName | Select-Object -Last 1
  if (-not $found) { throw "signtool.exe not found (install the Windows SDK)." }
  return $found.FullName
}

$signtool = Find-SignTool
if ($env:ORBIT_SIGN_DLIB -and $env:ORBIT_SIGN_METADATA) {
  $ts = if ($env:ORBIT_SIGN_TIMESTAMP_URL) { $env:ORBIT_SIGN_TIMESTAMP_URL } else { "http://timestamp.acs.microsoft.com" }
  & $signtool sign /v /fd SHA256 /tr $ts /td SHA256 /dlib $env:ORBIT_SIGN_DLIB /dmdf $env:ORBIT_SIGN_METADATA $File
} elseif ($env:ORBIT_SIGN_CERT_SHA1) {
  $ts = if ($env:ORBIT_SIGN_TIMESTAMP_URL) { $env:ORBIT_SIGN_TIMESTAMP_URL } else { "http://time.certum.pl" }
  & $signtool sign /fd SHA256 /tr $ts /td SHA256 /sha1 $env:ORBIT_SIGN_CERT_SHA1 $File
} elseif ($env:ORBIT_SIGN_PFX) {
  $ts = if ($env:ORBIT_SIGN_TIMESTAMP_URL) { $env:ORBIT_SIGN_TIMESTAMP_URL } else { "http://timestamp.digicert.com" }
  & $signtool sign /fd SHA256 /tr $ts /td SHA256 /f $env:ORBIT_SIGN_PFX /p $env:ORBIT_SIGN_PFX_PASSWORD $File
} else {
  throw "No code-signing credentials: set ORBIT_SIGN_CERT_SHA1, ORBIT_SIGN_DLIB + ORBIT_SIGN_METADATA, or ORBIT_SIGN_PFX."
}
if ($LASTEXITCODE) { throw "signtool failed ($LASTEXITCODE) for $File" }
