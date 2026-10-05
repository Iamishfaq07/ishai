mod audio;
#[cfg(target_os = "windows")]
mod process_loopback;
mod screen;
mod secrets;
mod updater;
#[cfg(target_os = "windows")]
mod wasapi_capture;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WindowEvent};

/// Asks the window to confirm a tray "Quit Orbit" (CloseDialog.tsx).
const CONFIRM_QUIT_EVENT: &str = "orbit:confirm-quit";

/// "Quit Orbit" from the close dialog.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// When the tray's "Quit Orbit" was last clicked.
#[derive(Default)]
struct QuitRequest(Mutex<Option<Instant>>);

impl QuitRequest {
    /// Remembers this request; true if there was another one within `window`.
    fn repeated(&self, window: Duration) -> bool {
        let mut last = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let again = last.is_some_and(|at| at.elapsed() < window);
        *last = Some(Instant::now());
        again
    }
}

/// Tray "Quit Orbit". While Orbit is capturing (a live session, most likely) the window comes forward and asks
/// first, as the close dialog does: quitting ends the session. A second Quit within a few seconds quits anyway, in
/// case the window can't answer.
fn tray_quit(app: &tauri::AppHandle) {
    let repeated = app.state::<QuitRequest>().repeated(Duration::from_secs(5));
    if repeated || !app.state::<audio::CaptureState>().is_active() {
        app.exit(0);
        return;
    }
    show_main(app);
    let _ = app.emit_to("main", CONFIRM_QUIT_EVENT, ());
}

fn protect_window(window: &tauri::WebviewWindow) {
    let _ = window.set_content_protected(true);
    let _ = window.set_skip_taskbar(true);
}

/// Every Orbit window, including ones opened after startup.
fn protect_all(app: &tauri::AppHandle) {
    for (_, window) in app.webview_windows() {
        protect_window(&window);
    }
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        protect_window(&window);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(audio::CaptureState::default())
        .manage(updater::PendingUpdate::default())
        .manage(QuitRequest::default())
        .on_window_event(|window, event| {
            if matches!(
                event,
                WindowEvent::Focused(_) | WindowEvent::ScaleFactorChanged { .. } | WindowEvent::ThemeChanged(_)
            ) {
                if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                    protect_window(&webview);
                }
            }
        })
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show Orbit", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Orbit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let mut tray = TrayIconBuilder::with_id("orbit-tray")
                .tooltip("Orbit")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => tray_quit(app),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            protect_all(app.handle());

            // Windows can drop capture-exclusion after DPI or fullscreen changes.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(2));
                protect_all(&handle);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            audio::list_audio_devices,
            audio::list_output_devices,
            audio::start_capture,
            audio::stop_capture,
            #[cfg(target_os = "windows")]
            process_loopback::list_audio_apps,
            screen::capture_screen,
            screen::capture_region,
            screen::open_region_selector,
            secrets::save_token,
            secrets::load_token,
            secrets::clear_token,
            updater::check_update,
            updater::install_update,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Orbit");
}

#[cfg(test)]
mod tests {
    use super::QuitRequest;
    use std::time::Duration;

    #[test]
    fn a_second_tray_quit_soon_after_the_first_quits_anyway() {
        let quit = QuitRequest::default();
        assert!(!quit.repeated(Duration::from_secs(5)));
        assert!(quit.repeated(Duration::from_secs(5)));
        assert!(!quit.repeated(Duration::ZERO)); // long after: asks again
    }
}
