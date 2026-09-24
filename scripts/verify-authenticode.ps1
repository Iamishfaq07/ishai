<#
.SYNOPSIS
  Verify Authenticode signatures on release files: signed, hash intact, chained to a trusted root, timestamped.

.PARAMETER AllowTestCertificate
  For pipeline tests with a self-signed certificate: accept an untrusted root (status UnknownError) but still
  require a signature whose hash matches and a timestamp. Never use it for a real release.
#>
param(
  [Parameter(Mandatory)] [string[]]$Files,
  [switch]$AllowTestCertificate
)
$failed = 0
foreach ($f in $Files) {
  if (-not (Test-Path $f)) { Write-Host "MISSING  $f" -ForegroundColor Red; $failed++; continue }
  $sig = Get-AuthenticodeSignature -FilePath $f
  $name = Split-Path $f -Leaf
  $subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { "-" }
  $stamped = $null -ne $sig.TimeStamperCertificate
  $ok = switch ($sig.Status) {
    "Valid" { $true }
    # Untrusted root only: the signature itself is intact. Acceptable for self-signed pipeline tests.
    "UnknownError" { $AllowTestCertificate -and $sig.SignerCertificate -and $sig.StatusMessage -match "root|trust" }
    default { $false }
  }
  if ($ok -and -not $stamped) { $ok = $false; $why = "no timestamp" } else { $why = $sig.StatusMessage }
  $color = if ($ok) { "Green" } else { "Red" }
  Write-Host ("{0,-6} {1,-34} {2,-13} ts={3,-5} {4}" -f ($(if ($ok) { "OK" } else { "FAIL" })), $name, $sig.Status, $stamped, $subject) -ForegroundColor $color
  if (-not $ok) { Write-Host "       $why" -ForegroundColor Red; $failed++ }
}
if ($failed) { exit 1 }
exit 0
