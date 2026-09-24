; Tauri NSIS installer hooks (bundle.windows.nsis.installerHooks).
;
; The sign-in token lives in Windows Credential Manager (keyring crate: target "<account>.<service>", see
; src/secrets.rs), not in the app-data folders, so Tauri's "Delete the application data" uninstall option left it
; behind. Remove it too, under exactly the same conditions Tauri uses for app data: the user ticked the box, and
; this is a real uninstall, not an update (updates must keep the user signed in).
;
; ORBIT_CREDENTIAL_TARGET can be overridden (makensis /D...) so the hook can be tested against a throwaway
; credential; see scripts/test-uninstall-hook.ps1.

!ifndef ORBIT_CREDENTIAL_TARGET
  !define ORBIT_CREDENTIAL_TARGET "access_token.ai.orbit.desktop"
!endif

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    nsExec::Exec '"$SYSDIR\cmdkey.exe" /delete:${ORBIT_CREDENTIAL_TARGET}'
    Pop $0 ; exit code: 0 = removed; non-zero = there was no saved sign-in, which is fine
  ${EndIf}
!macroend
