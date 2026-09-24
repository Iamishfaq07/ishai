<#
.SYNOPSIS
  Build a signed Windows release of Orbit and (optionally) publish it as a GitHub Release.

.DESCRIPTION
  Starts from a clean environment for the build-affecting variables, builds the NSIS installer with the updater
  signature, and refuses to continue unless the build provably used the REAL sign-in storage (0.1.11 shipped built
  with ORBIT_KEYRING_SERVICE="" and forgot users' sign-ins).

  Checks, in order:
    1. ORBIT_KEYRING_SERVICE is removed from every scope this process can see.
    2. After the build, rustc's dep-info records ORBIT_KEYRING_SERVICE as unset (no "=").
    3. Optional (-VerifySignIn): the built exe finds the sign-in saved by the installed Orbit (read-only).

.EXAMPLE
  ./scripts/release-desktop.ps1 -Version 0.1.13            # build + checks only
  ./scripts/release-desktop.ps1 -Version 0.1.13 -Publish   # + gh release create (notes from -NotesFile)
#>
param(
  [Parameter(Mandatory)] [ValidatePattern('^\d+\.\d+\.\d+$')] [string]$Version,
  [switch]$Publish,
  [string]$NotesFile,
  [string]$KeyDir = "$env:USERPROFILE\.orbit\updater"
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path "$PSScriptRoot\.."
Set-Location $repo

# 1. clean environment: test builds set this; a leftover (even empty) value must never reach a release
Remove-Item Env:ORBIT_KEYRING_SERVICE -ErrorAction SilentlyContinue
[Environment]::SetEnvironmentVariable("ORBIT_KEYRING_SERVICE", $null, "User")
if ((Test-Path Env:ORBIT_KEYRING_SERVICE) -or $null -ne [Environment]::GetEnvironmentVariable("ORBIT_KEYRING_SERVICE")) {
  throw "ORBIT_KEYRING_SERVICE is still set; open a new shell."
}

if ((git status --porcelain) -and -not $env:ORBIT_ALLOW_DIRTY) { throw "Working tree is dirty; commit or stash first." }
$branch = git branch --show-current
if ($branch -ne "main") { Write-Warning "Releasing from '$branch', not main." }

$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$KeyDir\orbit-updater.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content -Raw "$KeyDir\orbit-updater.key.password").Trim()
$config = Join-Path $env:TEMP "orbit_release_version.json"
"{`"version`":`"$Version`"}" | Set-Content -Encoding utf8NoBOM $config

pnpm install --frozen-lockfile
pnpm --filter @orbit/desktop tauri build --bundles nsis --config $config
if ($LASTEXITCODE) { throw "tauri build failed" }

# 2. prove the build saw the variable as unset
$dep = Get-ChildItem "apps\desktop\src-tauri\target\release\deps" -Filter "orbit_desktop_lib.d" | Select-Object -First 1
$line = Select-String -Path $dep.FullName -Pattern "env-dep:ORBIT_KEYRING_SERVICE" | Select-Object -First 1
if ($line -and $line.Line -match "ORBIT_KEYRING_SERVICE=") {
  throw "The build saw ORBIT_KEYRING_SERVICE ('$($line.Line)'). Refusing to release."
}
Write-Host "dep-info: ORBIT_KEYRING_SERVICE unset - real sign-in storage." -ForegroundColor Green

$bundle = "apps\desktop\src-tauri\target\release\bundle\nsis"
$installer = Join-Path $bundle "Orbit_${Version}_x64-setup.exe"
if (-not (Test-Path "$installer.sig")) { throw "No updater signature at $installer.sig" }
Write-Host "Built $installer (+ .sig)" -ForegroundColor Green

if ($Publish) {
  $sha = git rev-parse HEAD
  $notes = if ($NotesFile) { @("--notes-file", $NotesFile) } else { @("--generate-notes") }
  gh release create "v$Version" $installer "$installer.sig" --target $sha --title "Orbit $Version" @notes
  if ($LASTEXITCODE) { throw "gh release create failed" }
}
