#Requires -Version 7
<#
.SYNOPSIS
  Package Orbit as an MSIX for the Microsoft Store (free, and Microsoft signs it: no "unknown publisher").

.DESCRIPTION
  The Store signs the package itself, so the .msix this writes is uploaded to Partner Center UNSIGNED. It is the
  same exe as the direct download, wrapped in apps/desktop/src-tauri/windows/msix/AppxManifest.xml with the tile and
  icon assets in windows/msix/Assets (rendered by marketing/brand/render-msix-assets.mjs) and a resources.pri, so
  Windows picks the right scale and size. At runtime the exe sees its package identity and turns off Orbit's own
  updater: the Store delivers the updates. Owner steps: docs/MICROSOFT_STORE.md.

  Store mode (default):
    - Reads the identity from windows/msix/store-identity.json (Partner Center > Product identity) and stops with a
      clear message while any of the three values is empty.
    - Builds a clean release exe: ORBIT_KEYRING_SERVICE and VITE_API_URL / VITE_WEB_URL are cleared, so the build
      uses the real sign-in storage and .env.production's addresses, and both are checked after the build.
    - Writes target/msix/Orbit_<version>_x64.msixupload, the file to upload (the .msix inside a zip, which is all an
      .msixupload is without symbols), and the .msix beside it (Partner Center takes either).

  -Test mode:
    - Packages the exe already in target/release, which must be a test build of the same version, e.g.
        ORBIT_KEYRING_SERVICE=orbit-store-test pnpm --filter @orbit/desktop tauri build --no-bundle --config <{"version":"X.Y.Z"}>
    - Uses an unsigned-package test identity. Windows still won't install an unsigned package that contains an exe
      without Developer Mode or a trusted test certificate, so -Test is for validating the package, not installing it.

  Both modes finish with scripts/check-msix.ps1 (the package checks we can run without installing it).

  Version mapping: Orbit X.Y.Z is package version (X+1).Y.Z.0, so 0.1.43 is 1.1.43.0. The Store's rules: the first
  part can't be 0, the fourth is the Store's and must be 0, each part is 0-65535. Adding 1 to the first part keeps
  every later release higher than the one before (1.0.0 becomes 2.0.0.0), which is what makes the Store update users.

.EXAMPLE
  ./scripts/package-msix.ps1 -Version 0.1.43           # the Store upload (Orbit 0.1.43 = package 1.1.43.0)
  ./scripts/package-msix.ps1 -Version 0.1.43 -Test     # validate a package of the current target/release test build
#>
param(
  [Parameter(Mandatory)] [ValidatePattern('^\d+\.\d+\.\d+$')] [string]$Version,
  [switch]$Test
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path "$PSScriptRoot\.."
Set-Location $repo
$tauri = "apps\desktop\src-tauri"
$msixDir = "$tauri\windows\msix"

$x, $y, $z = $Version.Split(".") | ForEach-Object { [int]$_ }
if ($x + 1 -gt 65535 -or $y -gt 65535 -or $z -gt 65535) { throw "Each part of an MSIX version must be 65535 or less." }
$packageVersion = "$($x + 1).$y.$z.0"

# makeappx and makepri from the newest Windows SDK (it comes with the VS Build Tools).
$sdkBin = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.*\x64" -Directory -ErrorAction SilentlyContinue |
  Where-Object { (Test-Path "$($_.FullName)\makeappx.exe") -and (Test-Path "$($_.FullName)\makepri.exe") } |
  Sort-Object { [version]$_.Parent.Name } | Select-Object -Last 1
if (-not $sdkBin) { throw "makeappx.exe/makepri.exe not found: install the Windows 10/11 SDK." }
$makeappx = "$($sdkBin.FullName)\makeappx.exe"
$makepri = "$($sdkBin.FullName)\makepri.exe"

$identity = Get-Content -Raw "$msixDir\store-identity.json" | ConvertFrom-Json
if ($Test) {
  # OID 2.25.311729368913984317654407730594956997722=1 marks a package as intentionally unsigned (Windows 11).
  $identity = [pscustomobject]@{
    identityName = "OrbitDesktop.Test"
    publisher = "CN=Orbit Test, OID.2.25.311729368913984317654407730594956997722=1"
    publisherDisplayName = "Orbit (test package)"
    displayName = "Orbit (MSIX test)"
    shortName = "Orbit test"
  }
} else {
  $missing = @("identityName", "publisher", "publisherDisplayName", "displayName") |
    Where-Object { -not ([string]$identity.$_).Trim() }
  if ($missing) {
    throw ("$msixDir\store-identity.json is missing: $($missing -join ', '). Copy them from Partner Center > " +
      "Orbit AI Career Assistant > Product management > Product identity (Package/Identity/Name, " +
      "Package/Identity/Publisher, Package/Properties/PublisherDisplayName), then run this again. See docs/MICROSOFT_STORE.md.")
  }
  if ($identity.publisher -notmatch '^CN=') {
    throw "store-identity.json: publisher is the whole 'CN=...' string from Product identity (Package/Identity/Publisher)."
  }
  if ($identity.identityName -notmatch '^[A-Za-z0-9.-]{3,50}$') {
    throw "store-identity.json: identityName '$($identity.identityName)' isn't a package name (Package/Identity/Name)."
  }
}
$shortName = if ($identity.shortName) { $identity.shortName } else { "Orbit" }
if ($shortName.Length -gt 40) { throw "store-identity.json: shortName must be 40 characters or fewer." }

$exe = "$tauri\target\release\orbit-desktop.exe"
$depInfo = "$tauri\target\release\deps\orbit_desktop_lib.d"
if (-not $Test) {
  # Same guard as release-desktop.ps1: a Store build must use the real sign-in storage...
  Remove-Item Env:ORBIT_KEYRING_SERVICE -ErrorAction SilentlyContinue
  if ((Test-Path Env:ORBIT_KEYRING_SERVICE) -or $null -ne [Environment]::GetEnvironmentVariable("ORBIT_KEYRING_SERVICE")) {
    throw "ORBIT_KEYRING_SERVICE is still set; open a new shell."
  }
  # ...and the production addresses from apps/desktop/.env.production (a process-level VITE_* would override them).
  Remove-Item Env:VITE_API_URL, Env:VITE_WEB_URL -ErrorAction SilentlyContinue
  if ((git status --porcelain) -and -not $env:ORBIT_ALLOW_DIRTY) { throw "Working tree is dirty; commit or stash first." }
  $config = Join-Path $env:TEMP "orbit_msix_version.json"
  [IO.File]::WriteAllText($config, (@{ version = $Version } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  pnpm install --frozen-lockfile
  pnpm --filter @orbit/desktop tauri build --no-bundle --config $config
  if ($LASTEXITCODE) { throw "tauri build failed" }
  $line = Select-String -Path $depInfo -Pattern "env-dep:ORBIT_KEYRING_SERVICE" | Select-Object -First 1
  if ($line -and $line.Line -match "ORBIT_KEYRING_SERVICE=") { throw "The build saw ORBIT_KEYRING_SERVICE. Refusing to package." }
  Write-Host "dep-info: ORBIT_KEYRING_SERVICE unset - real sign-in storage." -ForegroundColor Green
  $apiUrl = (Select-String -Path "apps\desktop\.env.production" -Pattern '^VITE_API_URL=(.+)$').Matches[0].Groups[1].Value.Trim()
  $bundle = Get-ChildItem "apps\desktop\dist\assets" -Filter *.js | Select-String -SimpleMatch $apiUrl -List
  if (-not $bundle) { throw "The built app doesn't contain $apiUrl (.env.production). Refusing to package." }
  Write-Host "API address in the build: $apiUrl" -ForegroundColor Green
} else {
  if (-not (Test-Path $exe)) { throw "No $exe; build a test exe first (see the help above)." }
  $line = Select-String -Path $depInfo -Pattern "env-dep:ORBIT_KEYRING_SERVICE=" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $line) { Write-Warning "target/release is NOT a test build (no ORBIT_KEYRING_SERVICE): it would share your real sign-in." }
}

if (-not (Test-Path $exe)) { throw "No $exe; build first." }
$exeVersion = (Get-Item $exe).VersionInfo.FileVersion
if ($exeVersion -ne $Version) {
  throw "target/release/orbit-desktop.exe is version $exeVersion, not $Version. Build it with --config '{""version"":""$Version""}'."
}

# Layout: exe + manifest + tile/icon assets + resources.pri.
$layout = "$tauri\target\msix\layout"
if (Test-Path $layout) { Remove-Item -Recurse -Force $layout }
New-Item -ItemType Directory -Force "$layout\Assets" | Out-Null
Copy-Item $exe $layout
$assets = Get-ChildItem "$msixDir\Assets" -Filter *.png
if ($assets.Count -lt 30) { throw "$msixDir\Assets is incomplete: run node marketing/brand/render-msix-assets.mjs" }
Copy-Item $assets.FullName "$layout\Assets"
$esc = { param($s) [Security.SecurityElement]::Escape([string]$s) }
$manifest = (Get-Content -Raw "$msixDir\AppxManifest.xml").
  Replace("{{IDENTITY_NAME}}", (& $esc $identity.identityName)).
  Replace("{{PUBLISHER}}", (& $esc $identity.publisher)).
  Replace("{{PUBLISHER_DISPLAY_NAME}}", (& $esc $identity.publisherDisplayName)).
  Replace("{{DISPLAY_NAME}}", (& $esc $identity.displayName)).
  Replace("{{SHORT_NAME}}", (& $esc $shortName)).
  Replace("{{VERSION}}", $packageVersion)
[IO.File]::WriteAllText((Join-Path $repo "$layout\AppxManifest.xml"), $manifest, [Text.UTF8Encoding]::new($false))

# resources.pri: indexes Assets' scale-*/targetsize-*/altform-* variants under the unqualified names the manifest uses
# (windows/msix/priconfig.xml keeps them all in this one file; no resource packs, which only bundles use).
& $makepri new /pr $layout /cf "$msixDir\priconfig.xml" /mn "$layout\AppxManifest.xml" /of "$layout\resources.pri" /o | Out-Null
if ($LASTEXITCODE) { throw "makepri new failed" }
if (Get-ChildItem $layout -Filter "resources.*.pri") { throw "makepri split resources into resource packs; check priconfig.xml." }

$suffix = if ($Test) { "_test" } else { "" }
$out = "$tauri\target\msix\Orbit_${Version}_x64$suffix.msix"
# pack validates the manifest against the schema and the files it names.
& $makeappx pack /d $layout /p $out /o /h SHA256 | Out-Null
if ($LASTEXITCODE) { throw "makeappx pack failed" }
Write-Host "Packaged $out ($([math]::Round((Get-Item $out).Length / 1MB, 1)) MB, version $packageVersion)" -ForegroundColor Green

& "$PSScriptRoot\check-msix.ps1" -Path $out -Store:(-not $Test)
if ($LASTEXITCODE) { throw "check-msix.ps1 found problems (above)." }
if ($Test) {
  Write-Host "Test package only: installing it needs Developer Mode or a trusted test certificate (docs/MICROSOFT_STORE.md)."
} else {
  # An .msixupload is a zip of the package (plus an .appxsym of public symbols, which a stripped release exe doesn't
  # have): https://learn.microsoft.com/en-us/windows/msix/package/packaging-uwp-apps
  $upload = [IO.Path]::ChangeExtension($out, ".msixupload")
  $zip = "$upload.zip"
  Remove-Item $upload, $zip -ErrorAction SilentlyContinue
  Compress-Archive -Path $out -DestinationPath $zip -CompressionLevel NoCompression
  Move-Item $zip $upload
  Write-Host "Upload $upload in Partner Center > your submission > Packages (or the .msix beside it). It's unsigned:" `
    "the Store signs it." -ForegroundColor Green
}
