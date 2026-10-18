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

This refuses unsigned installers and never overwrites a published version. Installed apps check when they open, every hour while running (even hidden in the tray), and when brought back after 10 minutes or more. A newer version appears as **Update to X.Y.Z** in the title bar of every screen, and as a banner with the release notes on Home and Setup. It never shows during a live session, and installs are refused while audio is being captured.

## 3. Public download (the web app's Download button)

GitHub release downloads need a GitHub sign-in while the repo is private, so new users download from
**https://orbit-downloads.ishfaq.workers.dev** instead: a Cloudflare Worker with static assets only
(`apps/downloads/wrangler.jsonc`). It's free (static-asset requests aren't billed, no card needed) and takes files
up to 25 MiB. It isn't connected to git, so web deploys never touch it.

```powershell
./scripts/publish-download.ps1 -Version 0.2.0   # release-desktop.ps1 -Publish runs this after gh release create
```

- **What it serves:**
  - `/Orbit-Setup.exe`: always the latest installer, downloaded as `Orbit_X.Y.Z_x64-setup.exe`. The web button and
    README link here.
  - `/v/X.Y.Z/…`: the same file under its versioned path.
  - `/latest.json`: version, size, SHA-256 and the updater signature.
  - `/`: a small download page.
- **Latest only:** each deploy replaces the whole site.
- **Check:** the script downloads the live file again and compares its SHA-256 with the local installer.
- **Cloudflare sign-in, once per machine:** `pnpm dlx wrangler@4 login`, or `CLOUDFLARE_API_TOKEN` with "Workers
  Scripts: Edit".

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

**Microsoft signs the Store package itself**, so a Store install shows no SmartScreen warning and needs no
certificate. Registration is free. The app is **Orbit AI Career Assistant**, Store ID `9NJ1ZXGTCZKL`
(<https://apps.microsoft.com/detail/9NJ1ZXGTCZKL>). The direct download (NSIS) keeps working alongside it, still
unsigned until there's a certificate.

**The whole guide is [MICROSOFT_STORE.md](MICROSOFT_STORE.md)**: the owner's steps, the Partner Center pages, what
certification checks, updates, the website badge and the policy risks. The listing text is in
`marketing/store/listing/`. In short:

- **Same exe, packaged.** `scripts/package-msix.ps1 -Version X.Y.Z` builds it with the same sign-in storage guard as
  `release-desktop.ps1`, wraps it in `apps/desktop/src-tauri/windows/msix/AppxManifest.xml` (full trust, microphone,
  internetClient) with the brand tiles in `windows/msix/Assets`, and writes `target/msix/Orbit_X.Y.Z_x64.msixupload`.
  Upload that file unsigned.
- **Package version (X+1).Y.Z.0.** The Store refuses a first part of 0, so 0.1.42 is 1.1.42.0. The app itself still
  says 0.1.42.
- **The Store delivers updates.** The exe sees its package identity (`updater::is_packaged`), reports no update and
  refuses to install one. Each release goes to both channels: `release-desktop.ps1 -Publish`, then
  `package-msix.ps1` and a Partner Center update.
- **Sign-in is shared** with a direct install on the same PC (Windows Credential Manager). WebView settings are
  separate, because packaged apps get their own app-data folder.
- **Windows 10 2004 (19041) or later**, which per-app audio capture needs. WebView2 comes with Windows 11 and,
  from Microsoft, with Windows 10. If it's missing, Tauri says so and links to Microsoft's download.
- **Checks without installing:** `scripts/check-msix.ps1 -Path <msix> [-Store]` runs the App Certification Kit's
  static checks. The kit itself needs admin rights and installs the package, so it isn't run on this PC. Partner
  Center runs it during certification.
- **Testing a package on a PC:** Windows refuses unsigned packages that contain an exe (`0x80073D2B`). Use a spare
  PC or VM with Developer Mode, or the private-audience Store listing. `package-msix.ps1 -Test` packages a test build
  from `target/release` under a throwaway identity, for validation only. Build that exe with a test
  `ORBIT_KEYRING_SERVICE` (e.g. `orbit-store-test`), so it never touches the real sign-in.

## Releasing from a workstation

Use `scripts/release-desktop.ps1 -Version X.Y.Z [-Publish -NotesFile notes.md]`. Windows blocks local scripts by
default ("running scripts is disabled on this system"), so run it through a one-off bypass that changes no system
setting: `powershell -ExecutionPolicy Bypass -File .\scripts\release-desktop.ps1 -Version X.Y.Z -Publish -NotesFile
docs\releases\X.Y.Z.md` (Windows PowerShell 5.1 or 7 both work; `-Sign` also needs `pwsh`). It clears `ORBIT_KEYRING_SERVICE`
(only test builds set it), builds the signed installer, and refuses to continue unless rustc's dep-info shows the
variable unset. 0.1.11 was built with the variable left at an empty string and looked for the saved sign-in under
an empty service name; `secrets.rs` now also treats an empty value as unset. To verify any built exe, quit the installed Orbit (a real build is single-instance and would hand over to
it), run the exe with an isolated `WEBVIEW2_USER_DATA_FOLDER` and call `load_token` over CDP: a real build finds the
installed app's saved sign-in (read-only).

## The installer (what people see)

The NSIS installer is Orbit's own (DECISIONS D77), built by Tauri from `bundle.windows.nsis` in `tauri.conf.json`:

| Setting | File | What it is |
|---|---|---|
| `template` | `src-tauri/windows/installer.nsi` | Tauri's own template with Orbit's blocks added (below) |
| `headerImage` | `src-tauri/windows/installer/header.bmp` | 150 × 57: the wordmark, at the header's right |
| `sidebarImage` | `src-tauri/windows/installer/sidebar.bmp` | 164 × 314: the mark on the app icon's ink, for Welcome and Finish |
| `installerIcon`, `uninstallerIcon` | `src-tauri/icons/icon.ico` | the app's icon (NSIS's own otherwise) |
| `installerHooks` | `src-tauri/windows/hooks.nsh` | unchanged: "Delete the application data" also removes the sign-in |

`bundle.homepage` (https://orbitanswer.com) is the Support link in Windows' installed apps.

**The bitmaps** come from the brand: `node marketing/brand/render-installer.mjs` (headless Chrome, system Chrome
needed) renders them and writes 8-bit palette BMPs, uncompressed (RLE bitmaps don't load everywhere): 9.7 KB and
52.6 KB instead of 26 KB and 154 KB at 24-bit; the installer LZMA-compresses them again.

**The pages**, in order:
1. **Welcome**: "Welcome to Orbit", what it does, and that it installs for this user only with no admin rights.
2. *(Already installed: Tauri's maintenance page, unchanged.)*
3. **Install location**, Tauri's.
4. **Installing**: "Installing Orbit", and under the progress bar **What you get with Orbit**: the app's icon and
   Orbit's own tools in native text (Interview copilot, Practice with Saba, Resume AI, Jobs AI, LinkedIn AI, Learning
   AI, KashSec Academy, and Code AI and Offer AI on the web), sharp at any scaling and read by screen readers. It stays
   in view once installed ("Orbit is installed", Next); "Show details" still shows the log over it.
5. **Finish**: "Orbit is ready", **Open Orbit** and **Create desktop shortcut** (Tauri's, ticked as before), and
   **Explore Orbit's free tools on the web**: an opt-in, unticked, that opens
   `https://orbitanswer.com/?utm_source=orbit-desktop&utm_campaign=installer-finish` on Finish. Nothing else is
   offered, bundled or ticked for anyone.

The bottom line of every page reads "Orbit · orbitanswer.com" instead of NSIS's name.

**Passive and silent installs show none of it.** The updater installs with `/P /UPDATE` (`installMode: "passive"`):
only the progress page, without the panel (its function returns at once when `$PassiveMode` or `$UpdateMode` is set),
then it closes and Orbit restarts. `/S` shows nothing at all. Welcome and Finish are skipped in passive mode by
Tauri's own `SkipIfPassive`, so their words and the opt-in never appear there. Checked on 2026-10-18 with a test
product (below): `/P /UPDATE` 0.5 s and `/P` 0.9 s, each one window with only "Installing Orbit"; `/S` no window.

**The template is Tauri's plus Orbit's blocks**, each between `; ORBIT:BEGIN <name>` and `; ORBIT:END`; nothing of
Tauri's is edited. `apps/desktop/src/installer-template.test.ts` checks that the file minus the blocks is the installed
CLI's template line for line (`node apps/desktop/scripts/tauri-nsis-template.mjs` prints it), that the panel returns
in passive and update modes, that no block adds a page, and that the opt-in starts unticked. **After a Tauri CLI
update that test fails until the template is refreshed**: take the new template from that script, and put the
blocks back where they were (each anchors to a line Tauri has kept for years: `BrandingText`, the header image
defines, `MUI_PAGE_WELCOME`, `MUI_PAGE_INSTFILES`, `MUI_PAGE_FINISH` and `RunMainBinary`).

**Testing the installer without touching the real install**: build a test product whose name, identifier and
publisher all differ, from a config file (inline JSON breaks in PowerShell):

```powershell
# test-override.json: {"productName":"Orbit Redesign Test","identifier":"ai.orbit.desktop.redesigntest",
#                      "bundle":{"publisher":"Orbit Redesign Test Publisher","createUpdaterArtifacts":false}}
$env:ORBIT_KEYRING_SERVICE = "orbit-redesign-test"   # its own sign-in; remove the variable afterwards
pnpm --filter @orbit/desktop tauri build --bundles nsis --config C:\path\to\test-override.json
```

It installs to `%LOCALAPPDATA%\Orbit Redesign Test` with its own uninstall key and shortcuts. Drive its pages by its
process id only: capture its own window with `PrintWindow`, press its own buttons with `BM_CLICK` posted to the
button (Finish sometimes ignores it: post `WM_COMMAND(IDOK)` to the installer's window), never `SendInput` or the
real cursor. Untick Open Orbit before Finish with `BM_SETCHECK` (a posted click can be dropped) and check it took, so
nothing launches. Remove it with `uninstall.exe /S` (silent
uninstalls keep app data, so the hook below never runs). **Never tick "Delete the application data" on a test
product**: `hooks.nsh` removes the real app's sign-in (`access_token.ai.orbit.desktop`) whatever the product's name.

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
