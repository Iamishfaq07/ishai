mod audio;
#[cfg(target_os = "windows")]
mod process_loopback;
mod screen;
mod secrets;
mod updater;
#[cfg(target_os = "windows")]
mod wasapi_capture;

use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};

/// "Quit Orbit" from the close dialog (the tray menu quits the same way).
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
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
                    "quit" => app.exit(0),
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
