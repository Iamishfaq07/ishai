# Windows release & auto-update

Orbit ships on Windows first (macOS is deferred). A release is one CI build, one staging command, and
one API folder.

## 1. Build

```bash
gh workflow run ci.yml --ref main -f version_override=0.2.0
```

The `desktop-windows` job produces the `orbit-windows` artifact:

- `Orbit_0.2.0_x64-setup.exe`: NSIS installer, installs per user with no admin prompt
- `Orbit_0.2.0_x64-setup.exe.sig`: minisign signature the updater checks
- `orbit-desktop.exe`: the bare exe, for debugging

For a permanent version bump, also update `version` in `apps/desktop/src-tauri/tauri.conf.json` and
`Cargo.toml`, so local builds report it too.

## 2. Publish so installed apps update

**Hosted (Render): GitHub Releases.** With `ORBIT_UPDATES_GITHUB_REPO` + `ORBIT_UPDATES_GITHUB_TOKEN` set on the
API, the latest published release *is* the update: the API offers its `*-setup.exe` + `*-setup.exe.sig`
(installers without a `.sig` are never offered; drafts and pre-releases are ignored) and redirects the
download to GitHub's short-lived signed URL. So releasing is just:

```bash
# build locally (no Actions minutes needed) — the signing key comes from %USERPROFILE%\.orbit\updater
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.orbit/updater/orbit-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.orbit/updater/orbit-updater.key.password)"
pnpm --filter @orbit/desktop tauri build --bundles nsis --config '{"version":"0.2.0"}'
B=apps/desktop/src-tauri/target/release/bundle/nsis
gh release create v0.2.0 --target "$(git rev-parse HEAD)" --title "Orbit 0.2.0" --notes "What's new" \
  "$B/Orbit_0.2.0_x64-setup.exe" "$B/Orbit_0.2.0_x64-setup.exe.sig"
```

The API caches the release lookup for 5 minutes. The token needs only read access to this repo
(fine-grained PAT → Repository access: only this repo → Permissions: Contents → Read-only).

**Self-hosted with a disk:** stage into `ORBIT_DESKTOP_UPDATES_DIR` instead (takes precedence):

```bash
gh run download <run-id> -n orbit-windows -D ./artifact
cd apps/api
uv run python -m orbit_api.stage_release ../../artifact "$ORBIT_DESKTOP_UPDATES_DIR" --notes "What's new"
```

This refuses unsigned installers and never overwrites a published version. Installed clients pick the new version up on their next launch. The update check runs only on the setup screen, and installs are refused while a live session is recording.

## Update signing key (minisign), not code signing

- **Public key:** `plugins.updater.pubkey` in `tauri.conf.json`.
- **Private key and password:** the repo secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, with the offline copy in `%USERPROFILE%\.orbit\updater\`.
- **Back up the private key** (for example in a password manager). If it's lost, installed copies can't verify any future update, and every user has to reinstall by hand.
- **Rotating the key** means shipping one release, signed with the old key, that contains the new public key.

## Code signing (SmartScreen)

Installers are **not Authenticode-signed yet**, so Windows shows "Windows protected your PC". Updater
signatures don't help with this. It needs a code-signing certificate.

| Option | Fits Orbit if… | Notes |
|---|---|---|
| Azure Artifact Signing (formerly Trusted Signing) | you're an individual in the **US/Canada**, or an organization in a supported country | Cheapest and CI-native. Individuals elsewhere, including India, aren't eligible for public-trust certificates at the time of writing. |
| OV certificate with cloud/HSM signing (e.g. SSL.com eSigner, Certum SimplySign) | anyone, after identity validation | CA rules require the key to live on hardware or HSM, so pick a provider with a cloud API usable from CI. |
| EV certificate | an organization | No longer gives instant SmartScreen reputation. |

With any of these, SmartScreen reputation builds over time as you sign releases with the **same identity**.
EV certs get instant reputation; OV certs (and Azure Trusted Signing) may still warn on the first few
downloads, but the installer already shows your **verified name** instead of "Unknown publisher".

**Recommended for an individual (e.g. outside the US/Canada): Certum "Open Source Code Signing"** — a cloud
(SimplySign) OV certificate aimed at individual open-source developers, ~€70/year, usable from CI. SSL.com
eSigner (individual OV) is a comparable alternative. Azure Trusted Signing is cheapest and most CI-native but,
at the time of writing, only issues public-trust certs to US/Canada individuals or organizations.

**The signing pipeline is built and tested; it needs only a certificate.** It was checked end-to-end with a
throwaway self-signed certificate. Every binary was signed and timestamped (app exe, NSIS plugins, uninstaller,
installer), verification passed with `-AllowTestCertificate`, and it correctly **failed** without that flag
(untrusted root) and on unsigned files.

- `scripts/sign-windows.ps1 <file>` signs with signtool (SHA-256 + RFC 3161 timestamp). Credentials come only from
  the environment:
  - `ORBIT_SIGN_CERT_SHA1`: a certificate in the Windows store. This covers **Certum SimplySign** (a virtual
    card) and hardware tokens; the private key never leaves the card or HSM.
  - `ORBIT_SIGN_DLIB` + `ORBIT_SIGN_METADATA`: Azure Trusted Signing (plus `AZURE_*` credentials).
  - `ORBIT_SIGN_PFX` + `ORBIT_SIGN_PFX_PASSWORD`: a certificate file.
- `scripts/release-desktop.ps1 -Version X.Y.Z -Sign [-Publish]`:
  - makes Tauri run the signer on every binary before it writes the updater signature;
  - extracts the installer and verifies the installer, `orbit-desktop.exe` and `uninstall.exe` with
    `scripts/verify-authenticode.ps1` (valid chain, intact hash, timestamp present);
  - refuses to publish if any check fails;
  - with `ORBIT_REQUIRE_SIGNING=1`, refuses to build without `-Sign`.
- **CI** (`release.yml`):
  - set the repo variable `WINDOWS_SIGN_COMMAND` (and the signer's credentials as secrets);
  - signed builds are verified the same way before publishing;
  - the repo variable `ORBIT_REQUIRE_SIGNING=true` makes an unsigned release fail.

**To switch it on with Certum SimplySign:**
1. Buy the Open Source Code Signing certificate and complete identity validation.
2. Install SimplySign Desktop and sign in, so the certificate appears in `Cert:\CurrentUser\My`.
3. `$env:ORBIT_SIGN_CERT_SHA1 = "<thumbprint>"; $env:ORBIT_REQUIRE_SIGNING = "1"`.
4. Run `scripts/release-desktop.ps1 -Version X.Y.Z -Sign -Publish`.

**SmartScreen:** a signed installer shows your **verified name** instead of "Unknown publisher" immediately.
Reputation still builds over the first downloads for OV certificates, so a warning can appear at first; it fades
as releases are signed with the same identity. EV certificates no longer skip this.

**Release config:** `tauri.conf.json` (release) never allows plain-http updates. `tauri.dev.conf.json` enables it
for localhost development (`pnpm dev:desktop` passes it), and CI plus the release script fail if the release config
ever allows it.

Sources: [Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq),
[Code signing options for Windows apps](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).

## Free: the Microsoft Store (no "unknown publisher")

**The Microsoft Store signs the package itself**, so a Store install shows no SmartScreen warning and needs no
certificate. Individual developer accounts are free. The direct download (NSIS) keeps working alongside it and is
still unsigned until there's a certificate.

**How the Store build differs:**
- The exe is the same one. It's wrapped in an MSIX (`apps/desktop/src-tauri/windows/msix/AppxManifest.xml`) as a
  full-trust desktop app with the `microphone` capability. Audio capture, screenshots and the credential store
  work as in the NSIS build.
- **The Store delivers updates.** At runtime the exe detects its package identity (`updater::is_packaged`), then
  reports "no update" and refuses to self-install, as Store policy requires.
- Sign-in is shared with a direct install on the same PC, because both use the same Windows credential store.
  WebView settings (theme, preferences) are separate, since packaged apps get their own app-data folder.
- Minimum Windows version is 10 2004 (19041), which per-app audio capture needs.

**One-time setup (you):**
1. Register a free individual account at <https://storedeveloper.microsoft.com> (Microsoft account + ID check).
2. In Partner Center: **Apps and games → New product → MSIX or PWA app**, and reserve the name. "Orbit" is
   probably taken; try something like "Orbit Interview Copilot".
3. Open **Product management → Product identity** and copy `Package/Identity/Name`, `Package/Identity/Publisher`
   and `Package/Properties/PublisherDisplayName` into
   `apps/desktop/src-tauri/windows/msix/store-identity.json`. Set `displayName` to the reserved name. None of
   these are secrets.

**Each release:**
1. Run `scripts/package-msix.ps1 -Version X.Y.Z`. It does a clean build with the same sign-in storage guard as
   release-desktop.ps1 and writes `target/msix/Orbit_X.Y.Z_x64.msix`.
2. In Partner Center, open a new submission → **Packages**, and upload the `.msix` **unsigned**.
3. For the first submission you also need:
   - the listing (description, screenshots);
   - the age rating;
   - a **privacy policy URL**, required because Orbit uses the microphone and the internet. Use
     <https://orbit.ishfaq.workers.dev/privacy.html> (`apps/web/public/privacy.html`; keep it in step with PRIVACY.md);
   - a justification for the restricted capability `runFullTrust`, e.g. "desktop app: captures meeting audio
     with WASAPI and stores sign-in in Windows Credential Manager".
4. Publish to a **private audience** first, install it from the Store, and check sign-in, capture and a live
   session. Then make it public.

**Testing a package on this PC before uploading:**
- Windows refuses unsigned packages that contain a desktop exe (`0x80073D2B`: "an unsigned package cannot include
  Executable activations").
- So local testing needs one admin step, either:
  - turn on **Developer Mode** (Settings → System → For developers), then
    `Add-AppxPackage -Register apps\desktop\src-tauri\target\msix\layout\AppxManifest.xml`; or
  - sign a `-Test` package with a self-signed certificate trusted in `LocalMachine\TrustedPeople`.
- `scripts/package-msix.ps1 -Version X.Y.Z -Test` packages the current `target/release` exe under a test
  identity. Build that exe with `ORBIT_KEYRING_SERVICE=ai.orbit.desktop.test`, so a test never touches your
  real sign-in.

**Store policy caveat:** Microsoft reviews every submission. Orbit's own rules help here: it's a visible
assistant, with no stealth or proctoring evasion. Even so, a reviewer may ask how it's meant to be used, so say it
plainly in the description: practice interviews, meeting notes and live suggestions the user reads.

## Releasing from a workstation

Use `scripts/release-desktop.ps1 -Version X.Y.Z [-Publish -NotesFile notes.md]`. Windows blocks local scripts by
default ("running scripts is disabled on this system"), so run it through a one-off bypass that changes no system
setting: `powershell -ExecutionPolicy Bypass -File .\scripts\release-desktop.ps1 -Version X.Y.Z -Publish -NotesFile
docs\releases\X.Y.Z.md` (Windows PowerShell 5.1 or 7 both work; `-Sign` also needs `pwsh`). It clears `ORBIT_KEYRING_SERVICE`
(only test builds set it), builds the signed installer, and refuses to continue unless rustc's dep-info shows the
variable unset. 0.1.11 was built with the variable left at an empty string and looked for the saved sign-in under
an empty service name; `secrets.rs` now also treats an empty value as unset. To verify any built exe, run it with
an isolated `WEBVIEW2_USER_DATA_FOLDER` and call `load_token` over CDP: a real build finds the installed app's
saved sign-in (read-only).

## Install, upgrade, uninstall

Orbit installs per-user to `%LOCALAPPDATA%\Orbit` (no admin prompt). User state lives outside the install folder:

| What | Where | Upgrade | Uninstall | Uninstall + "Delete the application data" |
|---|---|---|---|---|
| Program + uninstaller | `%LOCALAPPDATA%\Orbit` | replaced | removed | removed |
| Settings (theme, design, glass, devices…) | WebView profile, `%LOCALAPPDATA%\ai.orbit.desktop\EBWebView` | kept | kept | removed |
| Window position | `%APPDATA%\ai.orbit.desktop` | kept | kept | removed |
| Sign-in token | Credential Manager, `access_token.ai.orbit.desktop` | kept | kept | removed (`windows/hooks.nsh`) |
| Install dir / language | `HKCU\Software\orbit\Orbit` | kept | kept | removed |
| Start-menu shortcut, Add/Remove Programs entry | | kept | removed | removed |

The checkbox is in the interactive uninstaller only; silent uninstalls (`uninstall.exe /S`) keep user data.
Sessions and documents are stored on the server and aren't affected by any of this.

Verified end-to-end on 2026-09-25 with the published installer:
- 0.1.6 → 0.1.15 silent upgrade: sign-in and every setting kept.
- Silent uninstall: leftovers exactly as in the table.
- Reinstall: signed in, settings byte-identical.

After changing `windows/hooks.nsh`, run `scripts/test-uninstall-hook.ps1`. It compiles the hook against a throwaway
credential and checks four cases: removed (box ticked), kept (box not ticked), kept (update), and no error when
nothing is saved.

**Testing gotcha:** WebView2 honours `WEBVIEW2_USER_DATA_FOLDER` even when it's set to an *empty* string. It then
ignores Orbit's profile and creates a blank one next to the exe (`Orbit\orbit-desktop.exe.WebView2`), so the app
looks like it lost its settings. Explorer and the Start menu never set it, but a shell left over from test runs can.
In PowerShell, clear it with `Remove-Item Env:WEBVIEW2_USER_DATA_FOLDER`. `[Environment]::SetEnvironmentVariable(…,
$null)` and `$env:X = ""` can leave it present but empty.
