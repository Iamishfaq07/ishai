<#
.SYNOPSIS
  Test the uninstall hook (apps/desktop/src-tauri/windows/hooks.nsh) without touching a real Orbit install or sign-in.

.DESCRIPTION
  Compiles the hook into a tiny NSIS program that points at a throwaway Credential Manager entry, then checks that the
  saved sign-in is removed only when the user chose "Delete the application data" on a real uninstall, and is kept
  otherwise (box not ticked, or an update).
  Needs the NSIS that Tauri downloads on first bundle (%LOCALAPPDATA%\tauri\NSIS).
#>
$ErrorActionPreference = "Stop"
$makensis = "$env:LOCALAPPDATA\tauri\NSIS\makensis.exe"
if (-not (Test-Path $makensis)) { throw "makensis not found at $makensis - run a desktop bundle build once first." }
$hooks = Resolve-Path "$PSScriptRoot\..\apps\desktop\src-tauri\windows\hooks.nsh"
$target = "orbit.uninstall-hook-test"
$work = Join-Path $env:TEMP "orbit-hook-test-$(Get-Random)"
New-Item -ItemType Directory $work | Out-Null

@"
Unicode true
!include LogicLib.nsh
!include FileFunc.nsh
!define ORBIT_CREDENTIAL_TARGET "$target"
Var DeleteAppDataCheckboxState
Var UpdateMode
!include "$hooks"
OutFile "$work\hook-test.exe"
RequestExecutionLevel user
SilentInstall silent
Section
  `${GetParameters} `$R0
  StrCpy `$DeleteAppDataCheckboxState 0
  StrCpy `$UpdateMode 0
  ClearErrors
  `${GetOptions} `$R0 "/DELETEDATA" `$R1
  `${IfNot} `${Errors}
    StrCpy `$DeleteAppDataCheckboxState 1
  `${EndIf}
  ClearErrors
  `${GetOptions} `$R0 "/UPDATE" `$R1
  `${IfNot} `${Errors}
    StrCpy `$UpdateMode 1
  `${EndIf}
  !insertmacro NSIS_HOOK_POSTUNINSTALL
SectionEnd
"@ | Set-Content -Encoding utf8 "$work\hook-test.nsi"

& $makensis /V1 "$work\hook-test.nsi" | Out-Null
if ($LASTEXITCODE) { throw "makensis failed to compile the hook" }

function Has-Credential { [bool](cmdkey /list | Select-String -SimpleMatch "target=$target") }
function Run-Case($name, $cmdArgs, $seed, $expectKept) {
  cmdkey /delete:$target 2>&1 | Out-Null
  if ($seed) { cmdkey /generic:$target /user:access_token /pass:hook-test 2>&1 | Out-Null }
  $p = Start-Process "$work\hook-test.exe" -ArgumentList $cmdArgs -Wait -PassThru
  $kept = Has-Credential
  $ok = ($p.ExitCode -eq 0) -and ($kept -eq $expectKept)
  Write-Host ("{0} {1,-48} exit {2}, sign-in {3}" -f $(if ($ok) { "PASS" } else { "FAIL" }), $name, $p.ExitCode, $(if ($kept) { "kept" } else { "removed" }))
  return $ok
}

$results = @(
  Run-Case "uninstall + delete app data -> removed" "/DELETEDATA" $true $false
  Run-Case "uninstall, box not ticked -> kept" "" $true $true
  Run-Case "update (even with the box state set) -> kept" "/DELETEDATA /UPDATE" $true $true
  Run-Case "delete app data, nothing saved -> no error" "/DELETEDATA" $false $false
)
cmdkey /delete:$target 2>&1 | Out-Null
[IO.Directory]::Delete($work, $true)
if ($results -contains $false) { throw "uninstall hook test failed" }
"all uninstall hook cases passed"
