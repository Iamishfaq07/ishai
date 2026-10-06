//! Self-hosted auto-update. The Orbit API serves the manifest and installer (the GitHub repo is private,
//! so release assets aren't publicly downloadable). Every installer is verified against the minisign
//! public key compiled in from tauri.conf.json before it runs, so a compromised server can't push code.
//!
//! Microsoft Store (MSIX) installs never self-update: the Store delivers their updates (Store policy 10.2.3), so
//! a packaged process reports "no update" and refuses to install one.
//!
//! Transport policy: https everywhere, except plain http to localhost/127.0.0.1 for local development.
//! (The plugin-level `dangerousInsecureTransportProtocol` flag is on only so this check can decide.)
//!
//! Downloading and installing are separate steps, because installing closes Orbit (on Windows the plugin starts the
//! installer, then exits the process). The download can run while the user sets up; the install re-checks right
//! before it starts that nothing is capturing, so it never closes Orbit under a live session — the webview offers
//! "Restart to update" once the session is over instead.

use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::audio::CaptureState;

#[derive(Default)]
pub struct PendingUpdate(Mutex<Pending>);

#[derive(Default)]
struct Pending {
    update: Option<Update>,
    /// The downloaded, signature-checked installer, waiting for `install_update`.
    installer: Option<Vec<u8>>,
    downloading: bool,
}

impl PendingUpdate {
    fn lock(&self) -> MutexGuard<'_, Pending> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
    date: Option<String>,
}

impl UpdateInfo {
    fn of(update: &Update) -> Self {
        UpdateInfo {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            notes: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UpdateProgress {
    Downloading {
        downloaded: u64,
        total: Option<u64>,
    },
    /// Downloaded; checking the signature.
    Verifying,
}

/// Builds `{api}/v1/desktop/update/{target}/{arch}/{version}` and enforces the transport policy.
pub fn endpoint_for(
    api_url: &str,
    target: &str,
    arch: &str,
    current_version: &str,
) -> Result<Url, String> {
    let base = Url::parse(api_url.trim()).map_err(|_| "Invalid server URL".to_string())?;
    let local = matches!(base.host_str(), Some("localhost" | "127.0.0.1"));
    match base.scheme() {
        "https" => {}
        "http" if local => {}
        _ => return Err("Updates need an https server".to_string()),
    }
    let root = base.as_str().trim_end_matches('/');
    Url::parse(&format!(
        "{root}/v1/desktop/update/{target}/{arch}/{current_version}"
    ))
    .map_err(|e| format!("Invalid update URL: {e}"))
}

/// Running from an MSIX package (the Microsoft Store build)? Asked once; package identity can't change at runtime.
pub fn is_packaged() -> bool {
    #[cfg(windows)]
    {
        use std::sync::OnceLock;
        use windows::Win32::Foundation::APPMODEL_ERROR_NO_PACKAGE;
        use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
        static PACKAGED: OnceLock<bool> = OnceLock::new();
        *PACKAGED.get_or_init(|| {
            let mut len = 0u32;
            // SAFETY: a length query with no buffer; the API only writes `len`.
            let rc = unsafe { GetCurrentPackageFullName(&mut len, None) };
            rc != APPMODEL_ERROR_NO_PACKAGE
        })
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    api_url: String,
) -> Result<Option<UpdateInfo>, String> {
    if is_packaged() {
        return Ok(None); // the Microsoft Store updates this install
    }
    {
        // Downloading (or downloaded) already: that is the update, don't swap it for a fresh check.
        let state = pending.lock();
        if state.downloading || state.installer.is_some() {
            return Ok(state.update.as_ref().map(UpdateInfo::of));
        }
    }
    let current = app.package_info().version.to_string();
    let endpoint = endpoint_for(&api_url, "windows", std::env::consts::ARCH, &current)?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?;
    let mut state = pending.lock();
    if !(state.downloading || state.installer.is_some()) {
        state.update = update;
    }
    Ok(state.update.as_ref().map(UpdateInfo::of))
}

/// Downloads the pending update and checks its signature, keeping the installer for `install_update`.
#[tauri::command]
pub async fn download_update(
    pending: State<'_, PendingUpdate>,
    on_event: Channel<UpdateProgress>,
) -> Result<(), String> {
    if is_packaged() {
        return Err("This copy of Orbit is updated by the Microsoft Store.".to_string());
    }
    let update = {
        let mut state = pending.lock();
        if state.installer.is_some() {
            return Ok(());
        }
        if state.downloading {
            return Err("The update is already downloading.".to_string());
        }
        let update = state
            .update
            .clone()
            .ok_or("No update is ready — check for updates first.")?;
        state.downloading = true;
        update
    };
    let mut downloaded: u64 = 0;
    let result = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = on_event.send(UpdateProgress::Downloading { downloaded, total });
            },
            || {
                let _ = on_event.send(UpdateProgress::Verifying);
            },
        )
        .await;
    let mut state = pending.lock();
    state.downloading = false;
    state.installer = Some(result.map_err(|e| format!("Update download failed: {e}"))?);
    Ok(())
}

/// Runs the downloaded installer, which closes Orbit (on Windows the NSIS installer takes over in passive mode and
/// relaunches Orbit when done). Re-checked right here, not just in the UI: nothing may be capturing, and nothing
/// can start capturing from now on, so a live session never loses Orbit under it.
#[tauri::command]
pub async fn install_update(
    pending: State<'_, PendingUpdate>,
    capture: State<'_, CaptureState>,
) -> Result<(), String> {
    if is_packaged() {
        return Err("This copy of Orbit is updated by the Microsoft Store.".to_string());
    }
    let state = pending.lock();
    let (Some(update), Some(installer)) = (state.update.as_ref(), state.installer.as_ref()) else {
        return Err("The update hasn't been downloaded yet.".to_string());
    };
    if !capture.begin_install() {
        return Err(
            "Orbit is still listening. End the session (or stop the audio test), then restart to update."
                .to_string(),
        );
    }
    // On Windows this returns only if the installer didn't start; on success the plugin exits Orbit for it.
    let result = update.install(installer);
    capture.end_install();
    result.map_err(|e| format!("Update failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{endpoint_for, is_packaged};

    #[test]
    fn an_unpackaged_process_is_not_the_store_build() {
        assert!(!is_packaged()); // cargo test runs without package identity
    }

    #[test]
    fn https_endpoint_is_built() {
        let url = endpoint_for("https://api.orbit.example/", "windows", "x86_64", "0.1.0").unwrap();
        assert_eq!(
            url.as_str(),
            "https://api.orbit.example/v1/desktop/update/windows/x86_64/0.1.0"
        );
    }

    #[test]
    fn http_only_for_localhost() {
        assert!(endpoint_for("http://localhost:8010", "windows", "x86_64", "0.1.0").is_ok());
        assert!(endpoint_for("http://127.0.0.1:8000", "windows", "x86_64", "0.1.0").is_ok());
        assert!(endpoint_for("http://api.orbit.example", "windows", "x86_64", "0.1.0").is_err());
        assert!(endpoint_for("ftp://localhost", "windows", "x86_64", "0.1.0").is_err());
        assert!(endpoint_for("not a url", "windows", "x86_64", "0.1.0").is_err());
    }

    #[test]
    fn keeps_a_base_path() {
        let url = endpoint_for("https://example.com/orbit", "windows", "x86_64", "1.2.3").unwrap();
        assert_eq!(
            url.as_str(),
            "https://example.com/orbit/v1/desktop/update/windows/x86_64/1.2.3"
        );
    }
}
