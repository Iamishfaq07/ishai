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

## 2. Stage on the update server

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

With any of these, SmartScreen reputation builds over time as you sign releases with the same identity. The first
releases may still warn.

**Wiring it in (once you have a certificate):** Tauri runs `bundle.windows.signCommand` for every binary it
bundles. Add the provider's CLI to the CI job, put its credentials in repo secrets, and pass for example
`--config '{"bundle":{"windows":{"signCommand":"<provider-cli> sign ... %1"}}}'` to `tauri build`. Do this
**before** `createUpdaterArtifacts` signs the installer, which Tauri already does in the right order within one
`tauri build`. This step is intentionally not in CI yet: it can't be tested without a real certificate.

Sources: [Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq),
[Code signing options for Windows apps](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).
