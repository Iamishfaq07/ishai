//! Self-hosted auto-update. The Orbit API serves the manifest and installer (the GitHub repo is private,
//! so release assets aren't publicly downloadable). Every installer is verified against the minisign
//! public key compiled in from tauri.conf.json before it runs, so a compromised server can't push code.
//!
//! Transport policy: https everywhere, except plain http to localhost/127.0.0.1 for local development.
//! (The plugin-level `dangerousInsecureTransportProtocol` flag is on only so this check can decide.)

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::audio::CaptureState;

#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
    date: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UpdateProgress {
    Downloading { downloaded: u64, total: Option<u64> },
    Installing,
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

#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    api_url: String,
) -> Result<Option<UpdateInfo>, String> {
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
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    });
    *pending.0.lock().map_err(|_| "update state poisoned")? = update;
    Ok(info)
}

#[tauri::command]
pub async fn install_update(
    pending: State<'_, PendingUpdate>,
    capture: State<'_, CaptureState>,
    on_event: Channel<UpdateProgress>,
) -> Result<(), String> {
    // Never restart the app under someone mid-interview.
    if capture.is_active() {
        return Err("Finish or end your live session before updating.".to_string());
    }
    let update = pending
        .0
        .lock()
        .map_err(|_| "update state poisoned")?
        .take()
        .ok_or("No update is ready — check for updates first.")?;
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = on_event.send(UpdateProgress::Downloading { downloaded, total });
            },
            || {
                let _ = on_event.send(UpdateProgress::Installing);
            },
        )
        .await
        .map_err(|e| format!("Update failed: {e}"))?;
    // On Windows the NSIS installer takes over (passive mode) and relaunches Orbit when done.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::endpoint_for;

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
