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

## Releasing from a workstation

Use `scripts/release-desktop.ps1 -Version X.Y.Z [-Publish -NotesFile notes.md]`. It clears `ORBIT_KEYRING_SERVICE`
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
