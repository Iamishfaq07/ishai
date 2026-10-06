<#
.SYNOPSIS
  Put a built Orbit installer on the free public download site (Cloudflare Worker "orbit-downloads").

.DESCRIPTION
  GitHub release downloads need a GitHub sign-in while the repo is private, so the web app's "Download for Windows"
  button links here instead: https://orbit-downloads.ishfaq.workers.dev/Orbit-Setup.exe (always the latest).

  Stages apps/downloads/dist and deploys it with wrangler (apps/downloads/wrangler.jsonc):
    /Orbit-Setup.exe               the latest installer, saved as Orbit_X.Y.Z_x64-setup.exe
    /v/X.Y.Z/Orbit_X.Y.Z_x64-setup.exe
    /latest.json                   version, size, SHA-256, updater signature (CORS open)
    /                              a small download page
  A deploy replaces the whole site, so it holds the latest release only. Afterwards the live file is downloaded
  again and its SHA-256 compared with the local installer.

  Cloudflare sign-in, once per machine: `pnpm dlx wrangler@4 login` (or set CLOUDFLARE_API_TOKEN to a token with
  "Workers Scripts: Edit").

.EXAMPLE
  ./scripts/publish-download.ps1 -Version 0.1.34
#>
param(
  [Parameter(Mandatory)] [ValidatePattern('^\d+\.\d+\.\d+$')] [string]$Version,
  [string]$Installer,  # default: the NSIS installer scripts/release-desktop.ps1 builds
  [string]$Site = "https://orbit-downloads.ishfaq.workers.dev",
  [switch]$StageOnly  # build apps/downloads/dist and stop (inspect it, or `pnpm dlx wrangler@4 dev` it locally)
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path "$PSScriptRoot\.."
Set-Location $repo

$name = "Orbit_${Version}_x64-setup.exe"
if (-not $Installer) { $Installer = "apps\desktop\src-tauri\target\release\bundle\nsis\$name" }
if (-not (Test-Path $Installer)) { throw "No installer at $Installer; build it first (scripts/release-desktop.ps1)." }
if ((Split-Path $Installer -Leaf) -ne $name) { throw "$Installer isn't the $Version installer ($name)." }
if (-not (Test-Path "$Installer.sig")) { throw "No updater signature at $Installer.sig." }
$size = (Get-Item $Installer).Length
if ($size -gt 25MB) { throw "The installer is $size bytes; Workers static assets take 25 MiB per file." }
$sha = (Get-FileHash $Installer -Algorithm SHA256).Hash.ToLowerInvariant()
$published = (Get-Date).ToUniversalTime()

# Stage the site.
$dist = Join-Path $repo "apps\downloads\dist"
if (Test-Path $dist) { [IO.Directory]::Delete($dist, $true) }
New-Item -ItemType Directory -Force (Join-Path $dist "v\$Version") | Out-Null
Copy-Item $Installer (Join-Path $dist "Orbit-Setup.exe")
Copy-Item $Installer (Join-Path $dist "v\$Version\$name")

$utf8 = [Text.UTF8Encoding]::new($false)
$latest = [ordered]@{
  version    = $Version
  file       = $name
  url        = "$Site/v/$Version/$name"
  latest_url = "$Site/Orbit-Setup.exe"
  size       = $size
  sha256     = $sha
  signature  = (Get-Content -Raw "$Installer.sig").Trim()
  published  = $published.ToString("yyyy-MM-ddTHH:mm:ssZ")
}
[IO.File]::WriteAllText((Join-Path $dist "latest.json"), ($latest | ConvertTo-Json), $utf8)

$headers = @"
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer

/Orbit-Setup.exe
  Content-Disposition: attachment; filename="$name"

/v/*
  Content-Disposition: attachment
  Cache-Control: public, max-age=31536000, immutable

/latest.json
  Access-Control-Allow-Origin: *
"@
[IO.File]::WriteAllText((Join-Path $dist "_headers"), $headers, $utf8)

$inv = [Globalization.CultureInfo]::InvariantCulture
$fields = @{
  "{{VERSION}}" = $Version
  "{{FILE}}"    = $name
  "{{SIZE}}"    = [string]::Format($inv, "{0:N1} MB", $size / 1MB)
  "{{DATE}}"    = $published.ToString("d MMM yyyy", $inv)
  "{{SHA256}}"  = $sha
}
$page = Get-Content -Raw "apps\downloads\index.html"
foreach ($field in $fields.Keys) { $page = $page.Replace($field, $fields[$field]) }
[IO.File]::WriteAllText((Join-Path $dist "index.html"), $page, $utf8)
if ($StageOnly) { Write-Host "Staged $dist (not deployed)"; return }

# Deploy.
pnpm dlx wrangler@4 deploy --config apps/downloads/wrangler.jsonc
if ($LASTEXITCODE) { throw "wrangler deploy failed (signed in? pnpm dlx wrangler@4 login)" }

# Check what the site now serves: the new version, byte for byte.
$live = $null
for ($i = 0; $i -lt 20 -and $live -ne $Version; $i++) {
  if ($i) { Start-Sleep -Seconds 3 }
  try { $live = (Invoke-RestMethod "$Site/latest.json" -Headers @{ "Cache-Control" = "no-cache" }).version } catch { }
}
if ($live -ne $Version) { throw "$Site/latest.json says '$live', not $Version." }
$check = Join-Path $env:TEMP "orbit-download-check-$Version.exe"
$response = Invoke-WebRequest "$Site/Orbit-Setup.exe" -OutFile $check -PassThru
$got = (Get-FileHash $check -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::Delete($check)
if ($got -ne $sha) { throw "$Site/Orbit-Setup.exe has SHA-256 $got, expected $sha." }
if ("$($response.Headers['Content-Disposition'])" -notmatch "attachment") { throw "Orbit-Setup.exe isn't served as a download." }
Write-Host "Live: $Site/Orbit-Setup.exe = $name ($size bytes, SHA-256 matches)" -ForegroundColor Green
