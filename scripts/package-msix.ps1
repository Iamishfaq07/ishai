<#
.SYNOPSIS
  Package Orbit as an MSIX for the Microsoft Store (free distribution with no "unknown publisher" warning).

.DESCRIPTION
  The Store signs the package itself, so the .msix this produces is uploaded to Partner Center UNSIGNED.
  The Store build is the same exe as the direct download. At runtime it detects its package identity and turns off
  Orbit's own updater, because the Store delivers updates.

  Store mode (default):
    - Reads the identity from apps/desktop/src-tauri/windows/msix/store-identity.json (Partner Center > Product
      identity).
    - Builds a clean release exe with the same keyring guard as release-desktop.ps1.
    - Writes target/msix/Orbit_<version>_x64.msix.

  -Test mode:
    - Packages the exe already in target/release (e.g. a test build with ORBIT_KEYRING_SERVICE=ai.orbit.desktop.test).
    - Uses Windows 11's unsigned-package publisher marker, so it can be sideloaded without a certificate or admin
      rights: Add-AppxPackage -Path <msix> -AllowUnsigned.

.EXAMPLE
  ./scripts/package-msix.ps1 -Version 0.1.23           # Store upload package
  ./scripts/package-msix.ps1 -Version 0.1.23 -Test     # local sideload test of the current target/release exe
#>
param(
  [Parameter(Mandatory)] [ValidatePattern('^\d+\.\d+\.\d+$')] [string]$Version,
  [switch]$Test
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path "$PSScriptRoot\.."
Set-Location $repo
$tauri = "apps\desktop\src-tauri"

$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName | Select-Object -Last 1
if (-not $makeappx) { throw "makeappx.exe not found: install the Windows 10/11 SDK (it comes with VS Build Tools)." }

$identity = Get-Content -Raw "$tauri\windows\msix\store-identity.json" | ConvertFrom-Json
if ($Test) {
  # OID 2.25.311729368913984317654407730594956997722=1 marks a package as intentionally unsigned (Windows 11).
  $identity = [pscustomobject]@{
    identityName = "OrbitDesktop.Test"
    publisher = "CN=Orbit Test, OID.2.25.311729368913984317654407730594956997722=1"
    publisherDisplayName = "Orbit (test package)"
    displayName = "Orbit (MSIX test)"
  }
} elseif (-not ($identity.identityName -and $identity.publisher -and $identity.publisherDisplayName)) {
  throw "Fill in $tauri\windows\msix\store-identity.json from Partner Center > Product identity first (see docs/WINDOWS_RELEASE.md)."
}

if (-not $Test) {
  # Same guard as release-desktop.ps1: a Store build must use the real sign-in storage.
  Remove-Item Env:ORBIT_KEYRING_SERVICE -ErrorAction SilentlyContinue
  if ((Test-Path Env:ORBIT_KEYRING_SERVICE) -or $null -ne [Environment]::GetEnvironmentVariable("ORBIT_KEYRING_SERVICE")) {
    throw "ORBIT_KEYRING_SERVICE is still set; open a new shell."
  }
  if ((git status --porcelain) -and -not $env:ORBIT_ALLOW_DIRTY) { throw "Working tree is dirty; commit or stash first." }
  $config = Join-Path $env:TEMP "orbit_msix_version.json"
  @{ version = $Version } | ConvertTo-Json | Set-Content -Encoding utf8NoBOM $config
  pnpm install --frozen-lockfile
  pnpm --filter @orbit/desktop tauri build --no-bundle --config $config
  if ($LASTEXITCODE) { throw "tauri build failed" }
  $dep = Get-ChildItem "$tauri\target\release\deps" -Filter "orbit_desktop_lib.d" | Select-Object -First 1
  $line = Select-String -Path $dep.FullName -Pattern "env-dep:ORBIT_KEYRING_SERVICE" | Select-Object -First 1
  if ($line -and $line.Line -match "ORBIT_KEYRING_SERVICE=") { throw "The build saw ORBIT_KEYRING_SERVICE. Refusing to package." }
  Write-Host "dep-info: ORBIT_KEYRING_SERVICE unset - real sign-in storage." -ForegroundColor Green
}

$exe = "$tauri\target\release\orbit-desktop.exe"
if (-not (Test-Path $exe)) { throw "No $exe; build first." }

# Layout: exe + manifest + tile assets (Tauri generates the Store-sized icons).
$layout = "$tauri\target\msix\layout"
if (Test-Path $layout) { Remove-Item -Recurse -Force $layout }
New-Item -ItemType Directory -Force "$layout\Assets" | Out-Null
Copy-Item $exe $layout
foreach ($a in "StoreLogo.png", "Square44x44Logo.png", "Square150x150Logo.png") {
  Copy-Item "$tauri\icons\$a" "$layout\Assets\$a"
}
$esc = { param($s) [Security.SecurityElement]::Escape([string]$s) }
$manifest = (Get-Content -Raw "$tauri\windows\msix\AppxManifest.xml").
  Replace("{{IDENTITY_NAME}}", (& $esc $identity.identityName)).
  Replace("{{PUBLISHER}}", (& $esc $identity.publisher)).
  Replace("{{PUBLISHER_DISPLAY_NAME}}", (& $esc $identity.publisherDisplayName)).
  Replace("{{DISPLAY_NAME}}", (& $esc ($identity.displayName ?? "Orbit"))).
  Replace("{{VERSION}}", "$Version.0")  # the Store requires the 4th part to be 0
Set-Content -Encoding utf8NoBOM "$layout\AppxManifest.xml" $manifest

$suffix = if ($Test) { "_test" } else { "" }
$out = "$tauri\target\msix\Orbit_${Version}_x64$suffix.msix"
& $makeappx.FullName pack /d $layout /p $out /o /h SHA256 | Out-Null
if ($LASTEXITCODE) { throw "makeappx pack failed" }
Write-Host "Packaged $out ($([math]::Round((Get-Item $out).Length / 1MB, 1)) MB)" -ForegroundColor Green
if ($Test) {
  Write-Host "Sideload: Add-AppxPackage -Path $out -AllowUnsigned   (remove: Get-AppxPackage OrbitDesktop.Test | Remove-AppxPackage)"
} else {
  Write-Host "Upload it UNSIGNED in Partner Center > Packages; the Store signs it."
}
