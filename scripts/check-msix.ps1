#Requires -Version 7
<#
.SYNOPSIS
  Checks an Orbit MSIX the way the Store's package validation and the Windows App Certification Kit's static tests
  do, without installing it.

.DESCRIPTION
  The App Certification Kit (appcert.exe) needs administrator rights and installs and launches the package, which
  an unsigned package containing an exe can't do without Developer Mode or a trusted test certificate. These are the
  checks that need neither; Partner Center runs the full kit during certification.

    - makeappx unpacks it: the package, its block map and its signature-free layout are well formed.
    - Manifest: no template placeholders; version A.B.C.0 (A not 0, parts <= 65535); MinVersion <= MaxVersionTested;
      only the capabilities Orbit justifies (runFullTrust, internetClient, microphone); in -Store mode a real
      Partner Center identity, not the test one.
    - Every image the manifest names resolves to files, and every scale-*/targetsize-* file has exactly the pixel
      size its qualifier promises (the kit's "App manifest resources" test); none is a Visual Studio/kit
      placeholder image ("Branding" test); none is over 200 KB.
    - resources.pri is present (the qualified images only resolve through it).
    - Every exe/dll is x64 like the package ("Platform appropriate files"), and nothing loads a debug runtime or the
      VC++ redistributable (Orbit links it statically; a dependency would need the VCLibs framework package).
    - Paths stay short enough for C:\Program Files\WindowsApps\<package full name>\ ("Supported directory structure").

.EXAMPLE
  ./scripts/check-msix.ps1 -Path apps/desktop/src-tauri/target/msix/Orbit_0.1.43_x64.msix -Store
#>
param(
  [Parameter(Mandatory)] [string]$Path,
  [switch]$Store
)
$ErrorActionPreference = "Stop"
$results = [System.Collections.Generic.List[object]]::new()
function Check([string]$name, [bool]$ok, [string]$detail = "") {
  $results.Add([pscustomobject]@{ Result = $(if ($ok) { "PASS" } else { "FAIL" }); Check = $name; Detail = $detail })
}

$sdkBin = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.*\x64" -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-Path "$($_.FullName)\makeappx.exe" } | Sort-Object { [version]$_.Parent.Name } | Select-Object -Last 1
if (-not $sdkBin) { throw "makeappx.exe not found: install the Windows 10/11 SDK." }
$pkg = (Resolve-Path $Path).Path
$dir = Join-Path ([IO.Path]::GetTempPath()) ("orbit-msix-check-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
try {
  & "$($sdkBin.FullName)\makeappx.exe" unpack /p $pkg /d $dir /o | Out-Null
  Check "makeappx unpacks the package (format, block map)" ($LASTEXITCODE -eq 0)
  if ($LASTEXITCODE) { throw "makeappx unpack failed" }

  $raw = Get-Content -Raw "$dir\AppxManifest.xml"
  [xml]$m = $raw
  $ns = [Xml.XmlNamespaceManager]::new($m.NameTable)
  $ns.AddNamespace("f", "http://schemas.microsoft.com/appx/manifest/foundation/windows10")
  $ns.AddNamespace("uap", "http://schemas.microsoft.com/appx/manifest/uap/windows10")
  $ns.AddNamespace("rescap", "http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities")
  $id = $m.SelectSingleNode("/f:Package/f:Identity", $ns)

  Check "No template placeholders left" (-not $raw.Contains("{{"))
  $parts = $id.Version.Split(".")
  Check "Version A.B.C.0: A not 0, the fourth 0, each <= 65535" (($parts.Count -eq 4) -and ($parts[0] -ne "0") -and ($parts[3] -eq "0") -and -not ($parts | Where-Object { [int]$_ -gt 65535 })) $id.Version
  Check "Architecture is x64" ($id.ProcessorArchitecture -eq "x64") $id.ProcessorArchitecture
  $tdf = $m.SelectSingleNode("//f:TargetDeviceFamily", $ns)
  Check "MinVersion <= MaxVersionTested" ([version]$tdf.MinVersion -le [version]$tdf.MaxVersionTested) "$($tdf.MinVersion) .. $($tdf.MaxVersionTested)"
  $caps = @($m.SelectNodes("//f:Capabilities/*", $ns) | ForEach-Object { $_.Name })
  $extra = $caps | Where-Object { $_ -notin "runFullTrust", "internetClient", "microphone" }
  Check "Only the justified capabilities" (-not $extra) ($caps -join ", ")
  $test = $id.Name -eq "OrbitDesktop.Test" -or $id.Publisher -match "311729368913984317654407730594956997722"
  if ($Store) {
    Check "A Partner Center identity (not the test one)" (-not $test -and $id.Publisher -match '^CN=') "$($id.Name) / $($id.Publisher)"
  }
  $display = $m.SelectSingleNode("/f:Package/f:Properties/f:DisplayName", $ns).InnerText
  $visual = $m.SelectSingleNode("//uap:VisualElements", $ns)
  Check "Package and Start menu names match" ($display -eq $visual.DisplayName) $display

  # Images: the manifest's names (no qualifiers) -> the qualified files, each the size its qualifier promises.
  $base = @{ Square44x44Logo = 44, 44; Square71x71Logo = 71, 71; Square150x150Logo = 150, 150; Wide310x150Logo = 310, 150;
    Square310x310Logo = 310, 310; StoreLogo = 50, 50 }
  $refs = @($m.SelectSingleNode("/f:Package/f:Properties/f:Logo", $ns).InnerText)
  $refs += $m.SelectNodes("//uap:VisualElements/@*[contains(local-name(), 'Logo')] | //uap:DefaultTile/@*[contains(local-name(), 'Logo')]", $ns) |
    ForEach-Object { $_.Value }
  foreach ($ref in $refs | Sort-Object -Unique) {
    $stem = [IO.Path]::GetFileNameWithoutExtension($ref)
    $folder = Join-Path $dir ([IO.Path]::GetDirectoryName($ref))
    $files = @(Get-ChildItem $folder -Filter "$stem*.png" -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq "$stem.png" -or $_.Name.StartsWith("$stem.") })
    $has100 = $files | Where-Object { $_.Name -match '\.scale-100\.png$|^[^.]+\.png$' }
    Check "$ref resolves (scale-100 present)" ([bool]$has100) "$($files.Count) files"
  }
  $bad = @(); $big = @()
  foreach ($f in Get-ChildItem "$dir\Assets" -Filter *.png) {
    $b = [IO.File]::ReadAllBytes($f.FullName)
    $w = [BitConverter]::ToUInt32([byte[]]($b[19], $b[18], $b[17], $b[16]), 0)
    $h = [BitConverter]::ToUInt32([byte[]]($b[23], $b[22], $b[21], $b[20]), 0)
    $stem = $f.Name.Split(".")[0]
    $want = $null
    if ($f.Name -match '\.targetsize-(\d+)') { $want = [int]$Matches[1], [int]$Matches[1] }
    elseif ($f.Name -match '\.scale-(\d+)' -and $base.ContainsKey($stem)) {
      $s = [int]$Matches[1] / 100
      $want = [int][math]::Round($base[$stem][0] * $s, [MidpointRounding]::AwayFromZero),
        [int][math]::Round($base[$stem][1] * $s, [MidpointRounding]::AwayFromZero)
    }
    if ($want -and ($w -ne $want[0] -or $h -ne $want[1])) { $bad += "$($f.Name) is ${w}x$h, wants $($want[0])x$($want[1])" }
    if ($f.Name -match '\.scale-\d+' -and $f.Name -match 'targetsize-\d+') { $bad += "$($f.Name) has both scale and targetsize" }
    if ($f.Length -ge 200KB) { $big += $f.Name }
  }
  Check "Every image has the size its qualifier promises (one qualifier kind each)" (-not $bad) ($bad -join "; ")
  Check "Every image is under 204,800 bytes" (-not $big) ($big -join ", ")
  $noScale = $refs | Sort-Object -Unique | Where-Object {
    -not (Get-ChildItem (Join-Path $dir (Split-Path $_)) -Filter "$([IO.Path]::GetFileNameWithoutExtension($_)).*png" |
      Where-Object Name -NotMatch 'targetsize-') }
  Check "Every image has a variant without targetsize" (-not $noScale) ($noScale -join ", ")
  $kitImages = "${env:ProgramFiles(x86)}\Windows Kits\10\App Certification Kit\DefaultAppImages"
  if (Test-Path $kitImages) {
    $defaults = Get-ChildItem $kitImages -Recurse -File | ForEach-Object { (Get-FileHash $_.FullName).Hash }
    $same = Get-ChildItem "$dir\Assets" -File | Where-Object { (Get-FileHash $_.FullName).Hash -in $defaults }
    Check "No placeholder (default) images" (-not $same) ($same.Name -join ", ")
  }
  Check "resources.pri present" (Test-Path "$dir\resources.pri")
  $packs = @(Get-ChildItem $dir -Filter "resources.*.pri")
  Check "No resource-pack PRIs (those are for bundles)" (-not $packs) ($packs.Name -join ", ")
  # Every image variant is a candidate in resources.pri (else Windows only finds the scale-100 file).
  $dump = "$dir-pri.xml"
  & "$($sdkBin.FullName)\makepri.exe" dump /if "$dir\resources.pri" /of $dump /dt detailed /o | Out-Null
  [xml]$pri = Get-Content -Raw $dump
  Remove-Item $dump -ErrorAction SilentlyContinue
  $short = foreach ($ref in $refs | Sort-Object -Unique) {
    $leaf = Split-Path $ref -Leaf
    $count = @(Get-ChildItem (Join-Path $dir (Split-Path $ref)) -Filter "$([IO.Path]::GetFileNameWithoutExtension($leaf)).*png").Count
    $node = $pri.SelectSingleNode("//NamedResource[@name='$leaf']")
    $n = if ($node) { $node.SelectNodes("Candidate").Count } else { 0 }
    if ($n -lt $count) { "$leaf $n of $count" }
  }
  Check "resources.pri indexes every image variant" (-not $short) ($short -join "; ")
  Check "resources.pri has no reverse map" ($pri.OuterXml -notmatch '<ReverseMap>true')

  # Binaries: x64 PE files, no debug or redistributable C runtime.
  $wrongArch = @(); $crt = @()
  foreach ($pe in Get-ChildItem $dir -Recurse -File -Include *.exe, *.dll) {
    $b = [IO.File]::ReadAllBytes($pe.FullName)
    $off = [BitConverter]::ToInt32($b, 0x3C)
    if ([BitConverter]::ToUInt16($b, $off + 4) -ne 0x8664) { $wrongArch += $pe.Name }
    $text = [Text.Encoding]::ASCII.GetString($b)
    if ($text -match '(?i)(vcruntime140d?|msvcp140d?|ucrtbased|vcruntime140_1d?)\.dll') { $crt += "$($pe.Name): $($Matches[0])" }
  }
  Check "Every exe/dll is x64" (-not $wrongArch) ($wrongArch -join ", ")
  Check "No VC++ redistributable or debug runtime needed" (-not $crt) ($crt -join ", ")
  $exe = $m.SelectSingleNode("//f:Application", $ns).Executable
  Check "The entry exe is in the package" (Test-Path (Join-Path $dir $exe)) $exe

  # C:\Program Files\WindowsApps\<Name>_<Version>_x64__<13-char publisher id>\ + the file must stay under MAX_PATH.
  $root = "C:\Program Files\WindowsApps\$($id.Name)_$($id.Version)_x64__abcdefghijklm\".Length
  $long = Get-ChildItem $dir -Recurse -File | Where-Object { $root + $_.FullName.Substring($dir.Length + 1).Length -ge 260 }
  Check "Installed paths stay under 260 characters" (-not $long) ($long.Name -join ", ")
  Check "Package size" $true ("{0:N1} MB" -f ((Get-Item $pkg).Length / 1MB))
} finally {
  Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
}
$results | Format-Table -AutoSize -Wrap | Out-String -Width 160 | Write-Host
$failed = @($results | Where-Object Result -eq "FAIL").Count
if ($failed) { Write-Host "$failed check(s) failed." -ForegroundColor Red; exit 1 }
Write-Host "All $($results.Count) checks passed." -ForegroundColor Green
exit 0
