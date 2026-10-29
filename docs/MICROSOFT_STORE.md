# Orbit on the Microsoft Store

The Windows app is free on the Microsoft Store as an MSIX package that **Microsoft signs**. A Store install shows no
"unknown publisher" warning, and it costs nothing: no certificate, no registration fee. The direct download (the
NSIS installer) stays available alongside it. Decision: DECISIONS D78.

| | |
| --- | --- |
| Name (reserved) | **Orbit AI Career Assistant** |
| Store ID | `9NJ1ZXGTCZKL` |
| Listing | <https://apps.microsoft.com/detail/9NJ1ZXGTCZKL> |
| Store app link | `ms-windows-store://pdp/?productid=9NJ1ZXGTCZKL` |
| Package/Identity/Name | `Orbitanswer.OrbitAICareerAssistant` |
| Package/Identity/Publisher | `CN=52D50CE5-FB8B-4CF0-B5AC-A243A000EA67` |
| Publisher display name | `Orbitanswer` |
| Listing text and settings | [marketing/store/listing/](../marketing/store/listing/README.md) |

None of these are secrets. The identity values are in
`apps/desktop/src-tauri/windows/msix/store-identity.json`.

## Status

| # | Step | Who | State |
| --- | --- | --- | --- |
| 1 | Register a free individual developer account (government ID + selfie) | owner | **done** (2026-10-18) |
| 2 | Reserve the name "Orbit AI Career Assistant" | owner | **done** |
| 3 | Copy the three Product identity values into `store-identity.json` | owner → agent | **done** |
| 4 | Build the upload: `scripts/package-msix.ps1 -Version X.Y.Z` | agent | dry run done for 0.1.42 (see the CHANGELOG entry) |
| 5 | Create the reviewer account on orbitanswer.com, with interview minutes | owner | to do |
| 6 | Fill in the submission, page by page (below), upload, submit | owner | to do |
| 7 | Private-audience check, then public, then the website badge | owner + agent | after certification |

## What's in the package

`scripts/package-msix.ps1` wraps the same release exe as the direct download in
`apps/desktop/src-tauri/windows/msix/AppxManifest.xml`.

- **Identity and names.** They come from `store-identity.json`. The Start menu shows the reserved name; tiles show
  "Orbit".
- **Version: Orbit X.Y.Z is package (X+1).Y.Z.0** (0.1.42 is 1.1.42.0). The Store's rule:

  > the last (fourth) section of the version number is reserved for Store use and must be left as 0 [...] The other
  > sections must be set to an integer between 0 and 65535 (except for the first section, which cannot be 0).

  Source: <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements>.
  Adding 1 to the first part keeps every release higher than the last (1.0.0 becomes 2.0.0.0). The Store only
  updates users to a higher version. The app's own About and Settings keep saying 0.1.42.
- **Windows 10 2004 (19041) or later.** Per-app audio capture needs it. MaxVersionTested is Windows 11 26H2
  (10.0.26300.0). If Partner Center ever objects to it, use 10.0.26100.0.
- **Tiles and icons.** They're rendered from the brand mark by `marketing/brand/render-msix-assets.mjs` into
  `windows/msix/Assets`:
  - every scale (100–400%) of the medium, wide, large and small tiles, the app list icon and the package logo;
  - the taskbar's target sizes, 16–256 px, in plain, unplated and light-unplated versions.

  makepri indexes them into one `resources.pri` (`windows/msix/priconfig.xml`).
- **Capabilities.** Only these three; the Store shows them on the listing as what the app can do:

  | Capability | Why |
  | --- | --- |
  | `runFullTrust` (restricted) | Orbit is a Win32 app. Full trust is what lets it capture the microphone and the meeting app's audio with WASAPI (endpoint and per-process loopback), register global shortcuts, keep the sign-in in Windows Credential Manager, take region screenshots (GDI) and show an always-on-top window. None of these need a capability of their own once the app is full trust. |
  | `microphone` | Microsoft recommends declaring privacy-sensitive capabilities even for full-trust apps, so the app gets its own switch under Settings → Privacy & security → Microphone from install. |
  | `internetClient` | Full-trust apps don't need it to use the network. It's declared so the listing truthfully says Orbit uses the internet: it streams audio to Orbit's server. |

  Not declared, because nothing needs them:
  - `broadFileSystemAccess`: documents come in through the file picker;
  - `privateNetworkClientServer`: release builds talk only to `https://api.orbitanswer.com`; localhost is for
    development;
  - `graphicsCapture`: screenshots use GDI, not Windows.Graphics.Capture;
  - startup tasks and protocol handlers: Orbit registers neither.

- **WebView2.**
  - Windows 11 has the runtime built in. Microsoft says it "installed the WebView2 Runtime to all eligible Windows 10
    devices" ([Evergreen vs fixed](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version)).
  - An MSIX installed by the Store can't pull the runtime in as a dependency. `ExternalDependency` "applies only to
    installs that use the Microsoft App Installer app"
    ([docs](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-win32dependencies-externaldependency)).
  - For the rare PC without it, Microsoft recommends checking at runtime
    ([Distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)). Tauri
    already does. A release build that finds no runtime shows "Could not find the WebView2 Runtime. Make sure it is
    installed or download it from https://developer.microsoft.com/en-us/microsoft-edge/webview2" and closes
    (tauri-runtime-wry, `create_webview`). Orbit doesn't launch an installer itself.
  - The NSIS installer still installs the runtime when it's missing, as before.
- **No self-updates.** At runtime the exe sees its package identity (`updater::is_packaged`):
  - `check_update` reports nothing, so the update banner never appears;
  - `download_update` and `install_update` refuse;
  - the webview has no updater permission of its own, and Settings has no "check for updates" button.

  The Store delivers updates.
- **Sign-in and data.**
  - The sign-in token lives in Windows Credential Manager (`access_token.ai.orbit.desktop`), which isn't
    virtualized, so a Store install and a direct install on one PC share it.
  - WebView settings are separate: the Store copy's app data goes to its own package folder, and Windows removes that
    folder on uninstall.
  - Uninstalling the Store copy leaves the Credential Manager entry, which the direct install also uses.
  - Both copies use the same single-instance lock: opening one while the other runs brings the running one forward.

## Building the upload (agent)

```powershell
# from a clean checkout of the release commit, node + cargo on PATH, in pwsh 7
./scripts/release-desktop.ps1 -Version 0.1.43 -Publish -NotesFile docs/releases/0.1.43.md   # the direct download, as now
./scripts/package-msix.ps1 -Version 0.1.43                                                   # the Store package
```

`package-msix.ps1` without `-Test`:
1. Stops with the names of any missing identity values, before building anything.
2. Refuses a dirty tree.
3. Clears `ORBIT_KEYRING_SERVICE`, `VITE_API_URL` and `VITE_WEB_URL`.
4. Builds the release exe with the version.
5. Checks:
   - rustc's dep-info shows `ORBIT_KEYRING_SERVICE` unset, so it uses the real sign-in storage;
   - the built app contains `.env.production`'s API address;
   - the exe's version matches.
6. Writes `apps/desktop/src-tauri/target/msix/Orbit_X.Y.Z_x64.msix` and `Orbit_X.Y.Z_x64.msixupload`. Upload the
   `.msixupload`, unsigned. It is the `.msix` in a zip, which is all an upload file is without symbol files
   ([Microsoft](https://learn.microsoft.com/en-us/windows/msix/package/packaging-uwp-apps)); Partner Center takes
   either.
7. Runs `scripts/check-msix.ps1`. These are the App Certification Kit's static checks, run without installing
   anything:
   - the manifest;
   - image sizes and qualifiers;
   - the 204,800-byte image limit;
   - default (placeholder) images;
   - PRI candidates and no resource packs;
   - x64 binaries;
   - no VC++ redistributable;
   - path lengths.

`-Test` packages a test build already in `target/release` under a throwaway identity, for checking the package. It
can't be installed here: an unsigned package with an exe needs Developer Mode or a trusted test certificate, and this
PC gets neither.

**The App Certification Kit itself isn't run here.**
- `appcert.exe` declares `requireAdministrator`.
- Microsoft's instructions say to run it "with admin rights", and it launches the app
  (`IApplicationActivationManager::ActivateApplication`), so it installs the package.
- Microsoft now calls the kit "deprecated and no longer maintained … Official certification is performed
  automatically when you submit your package to Partner Center"
  ([source](https://learn.microsoft.com/en-us/windows/msix/package/packaging-uwp-apps)).

To run it anyway, use a spare PC or a VM with Developer Mode, in an elevated prompt:
`appcert.exe reset`, then `appcert.exe test -appxpackagepath <msix> -reportoutputpath <report.xml>`.

## The submission, page by page (owner)

Partner Center → Apps and games → Orbit AI Career Assistant → **Start your submission**. Microsoft's checklist:
<https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission>. The pages can be
done in any order.

1. **Pricing and availability** ([pricing.md](../marketing/store/listing/pricing.md)).
   - Free, all markets.
   - First submission: **Private audience**. Make a known user group with your own Microsoft account and one tester.
     Public can't go back to private, so start private.
2. **Properties** ([properties.md](../marketing/store/listing/properties.md)).
   - Category: Productivity (secondary: Education → Study aids).
   - Privacy policy: `https://orbitanswer.com/privacy`. Website: `https://orbitanswer.com`. Support:
     `https://orbitanswer.com/contact`.
   - Tick **"This product allows users to make purchases, but does not use the Microsoft Store commerce system"**
     and **"This product incorporates generative AI features"**.
   - System requirements: Microphone.
3. **Age ratings** ([age-rating.md](../marketing/store/listing/age-rating.md)). Answer the IARC questionnaire
   truthfully. Expect Everyone / 3+ with "In-App Purchases".
4. **Packages.** Upload `Orbit_X.Y.Z_x64.msixupload`. Partner Center reads the identity, version (1.1.42.0 for 0.1.42),
   x64 and Windows 10/11 desktop from it. Leave the device families as detected.
5. **Store listings → English (United States)** ([README](../marketing/store/listing/README.md)). Paste:
   - description.txt;
   - short-description.txt;
   - features.txt;
   - search-terms.txt (7 lines);
   - the screenshots with their captions (screenshots.md);
   - app-tile-icon-300x300.png under Store logos.

   What's new (whats-new-0.1.42.txt) is for updates; leave it empty if the first submission doesn't show it.
6. **Submission options** ([certification-notes.md](../marketing/store/listing/certification-notes.md)).
   - Publishing hold: **"Don't publish this submission until I select Publish now"**.
   - Notes for certification: paste the block after filling in `<reviewer email>` and `<reviewer password>`.
   - Restricted capabilities: paste the `runFullTrust` text:

```text
runFullTrust: Orbit is a desktop (Win32) app, the same program as our direct download, packaged as MSIX. It needs full trust to capture the user's microphone and the meeting app's audio with WASAPI (including per-app loopback), register the keyboard shortcuts the user sets, keep the sign-in token in Windows Credential Manager, and show its always-on-top window and screenshot selector. It installs no services or drivers and never asks for admin rights.
```

7. **Submit for certification.**

**Before you submit:**
- The reviewer account works: you can sign in to the app with it, and it has minutes.
- The certification notes still match the app after the redesign (D77): screen names, where the mock interview
  starts, the window-privacy prompt.
- The screenshots show the current design.

## What certification checks

<https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-certification-process>

- **Security:** malware scans of the package.
- **Technical compliance:** the App Certification Kit's tests, run by Microsoft: manifest, resources and branding,
  supported APIs, no admin elevation, x64 files and so on.
- **Content compliance:** a person installs and runs the app and compares it with the listing and the Store Policies
  (version 7.20 from 22 October 2026). They'll sign in with the reviewer account.
- **Restricted capability:** `runFullTrust` is approved from your justification. Microsoft says it generally isn't
  asked again for updates.

It "can take up to three business days". After it passes, the listing appears within about 15 minutes (or when you
press Publish now). Microsoft also spot-checks published apps.

## If certification flags window privacy

The owner has decided to keep the opt-in privacy shield, with its one-time prompt on Home, and accepts the risk.
Commit 38493684:
- The shield uses Windows display affinity: `WDA_EXCLUDEFROMCAPTURE` via `set_window_privacy` in
  `apps/desktop/src-tauri/src/lib.rs`.
- The Home prompt is `WindowPrivacyChoice` in `apps/desktop/src/WindowPrivacyCard.tsx`.

**What a rejection would most likely cite** (Store Policies 7.20, <https://learn.microsoft.com/en-us/windows/apps/publish/store-policies>):
- **10.1.1**: "Your product must not in any way attempt to mislead customers as to its actual features,
  functionality, or relationship to other products". The argument would be that the listing says "for calls where AI
  help is allowed" while the app offers to keep itself out of screen captures during those calls.
- **The policies' principle**: "Don't attempt to cheat customers, the system or the ecosystem. There is no place in
  our Store for any kind of fraud."
- **11.8**: "Your product must not contain content or functionality that encourages, facilitates or glamorizes
  illegal activity in the real world." Less likely: hiding from a screen share isn't illegal in itself.
- **Developer Code of Conduct §3**: "You may not, directly or indirectly, engage in inducing users to commit
  fraudulent or dishonest activities"
  (<https://learn.microsoft.com/en-us/windows/apps/publish/store-developer-code-of-conduct>). Microsoft could raise it
  later even if certification passes.

**The fix: turn it off in the Store build.** One line in `set_window_privacy` (lib.rs) makes the shield do nothing
when the app runs from its package. The direct download keeps it.

```rust
    state.shield.store(shield && !updater::is_packaged(), Ordering::Relaxed); // the Store copy has no privacy shield
```

Then hide the setting, so the Store copy doesn't offer a switch that does nothing:
1. Register a command, `#[tauri::command] fn is_store_build() -> bool { updater::is_packaged() }`, in
   `generate_handler!`.
2. In `WindowPrivacyCard.tsx`, return `null` from `WindowPrivacyCard` and `WindowPrivacyChoice` when it says `true`.

Scrolling screenshots still keep Orbit's own window out of the picture while they run (`capturing`, a separate
flag). Rebuild with `package-msix.ps1`, upload a new package to the same submission or a new one, and say in the
reply to the reviewer that the setting is gone from the Store version.

## After it's live: updates

Each release:
1. Run `release-desktop.ps1 -Publish` as now. Direct installs update themselves.
2. Run `package-msix.ps1 -Version X.Y.Z`.
3. In Partner Center: **Start update**. This copies the last submission.
4. Packages: remove the old package and upload the new `.msixupload`.
5. Store listings: fill in What's new.
6. Submit.

Each update is certified again. The Store re-signs it and moves users to the higher version, and you can choose a
gradual rollout on the Packages page. The listing text changes only when you edit it. Source:
<https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/publish-update-to-your-app-on-store>.

## The website once the listing is public

**Main download:** Microsoft's Store badge, linking `https://apps.microsoft.com/detail/9NJ1ZXGTCZKL?mode=direct`.
Its current artwork reads "Download from the Microsoft Store"; the older badge said "Get it from Microsoft". That's the badge generator's "Direct" launch mode,
Microsoft's web installer for free packaged apps
([docs](https://learn.microsoft.com/en-us/windows/apps/distribute-through-store/how-to-use-store-web-installer-for-distribution)).

**Alternative:** the NSIS installer, as "Or download the installer". It's still unsigned, so it keeps its Beta note.

**How it's built.**
- `apps/web/src/components/StoreBadge.tsx` is behind the flag `VITE_MS_STORE_LIVE`, which is **on** since the listing
  went public (29 October 2026; `apps/web/.env.production`). Off, the component renders nothing.
- "Get the Windows app" in the account menu, the front page and Sessions goes to the listing too (`WINDOWS_APP_URL`,
  no Beta label: Microsoft signs the Store copy); the structured data's `downloadUrl` and `sameAs` name the listing.
- It's wired into the signed-in Home's "Get Orbit for Windows" card and the interview assistant page
  (`CopilotPublic`).
- The artwork is Microsoft's own badge, unmodified, from its generator: <https://apps.microsoft.com/badge>, static
  images `get.microsoft.com/images/en-us dark.svg` / `light.svg` per <https://github.com/microsoft/app-store-badge>.
  It's served from `apps/web/public/badges/` because the site's CSP allows images from itself only.
- Microsoft's separate badge usage guidelines page currently doesn't resolve. Use the artwork as provided: don't
  recolour, crop or redraw it.

**Turn it on only after certification passes and the listing is public:**
1. Add `VITE_MS_STORE_LIVE=true` to `apps/web/.env.production`.
2. Deploy.
3. Check the badge opens the listing.

Later, if you want: the Landing page and the account menu can switch to the badge too, and the direct-download
Orbit's Settings could mention the Store copy with `ms-windows-store://pdp/?productid=9NJ1ZXGTCZKL`.

## Risks to know before submitting

Checked against Store Policies 7.20 (published 15 Sep 2026, in force 22 Oct 2026) on 2026-10-18.

1. **Window privacy** (above). No Store policy bans display affinity, overlays or hiding from the taskbar. Interview
   assistants that advertise being "hidden in screen sharing" are live on the Store today; for example, "Ai Interview
   Assistant" (9NSFDNFWZQT6) says so in its own description. So rejection is possible but not likely.
   - The larger risk is later: a complaint or spot check, read against 10.1.1 and the Code of Conduct, now that the
     setting sits next to "where AI help is allowed".
   - It also contradicts Orbit's own D8 ("Orbit doesn't hide itself from screen sharing").
   - Kept by the owner's decision; the fix is ready.
2. **Account type (10.14).** "Company accounts must be used for organizations, businesses, and any person acting in
   relation to their trade or profession."
   - Microsoft's account guide puts developers whose distribution "is in relation to their business, trade, or
     profession" under Company.
   - Orbit sells plans, and the publisher name "Orbitanswer" reads like a business. Microsoft could ask for a
     Company account.
   - An account can't be converted. A Company account is free too: it needs a D-U-N-S number or official business
     documents (in India, for example, a GST or Udyam certificate), plus an email on the orbitanswer.com domain.
   - Nothing to do unless Microsoft asks, but know that switching means a new account and re-reserving the name.
3. **Name (10.1.1).** The name "must not contain marketing or descriptive text". "Career Assistant" is descriptive,
   though Microsoft let it be reserved. The fallback is "Orbit AI" or "Orbit Answer" (name.md).
4. **Generative AI (11.16).** Requires "a means for users to report inappropriate content to the developer".
   - Today that's the thumbs-down on an answer, whose reasons are about quality ("Not accurate", "Missed the
     question"), and the Contact page on the website.
   - A clearer route would help: an "Inappropriate or harmful" thumbs-down reason, and a "Help & contact" link in
     the app's Settings. Both are app changes for the owner to schedule.
5. **Other people's words (10.5.3).**

   > If you publish a person's Personal Information to an outside service or third party through your product [...]
   > but the person whose information is being shared is not a customer of your product, you must obtain express
   > written consent

   The interviewer's voice goes to the transcription provider and the AI model. The terms already forbid
   transcribing people without telling them where the law requires it, and the listing says the same. That's the
   defence; an in-app reminder before the first live session would make it stronger.
6. **Screenshots (10.1.1).** The five current screenshots were captured from the web app. The captions say which
   tools open in the browser. Add a real screenshot of the Windows app's window (screenshots.md).

## Testing a package on a PC (not this one)

- Windows refuses to install unsigned packages that contain an exe (`0x80073D2B`).
- To try a package before the Store has it, use a spare PC or VM with Developer Mode, then run
  `Add-AppxPackage -Register <layout>\AppxManifest.xml` on the `target/msix/layout` folder.
- Or sign a `-Test` package with a self-signed certificate trusted on that machine.
- Simplest: the private-audience listing. Microsoft signs it, and you install it from the Store like a customer
  would.
