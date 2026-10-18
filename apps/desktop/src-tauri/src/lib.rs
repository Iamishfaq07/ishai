#[cfg(target_os = "windows")]
mod app_icons;
mod audio;
#[cfg(target_os = "windows")]
mod process_loopback;
mod screen;
mod scroll_capture;
mod secrets;
mod updater;
#[cfg(target_os = "windows")]
mod wasapi_capture;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};

/// Asks the window to confirm a tray "Quit Orbit" (CloseDialog.tsx).
const CONFIRM_QUIT_EVENT: &str = "orbit:confirm-quit";
/// A tray item the window acts on (tray.ts): "new-session", "history", "settings" or "web".
const TRAY_EVENT: &str = "orbit:tray";

/// What a tray menu item does.
#[derive(Debug, PartialEq, Eq)]
enum TrayAction {
    Show,
    Quit,
    /// Shown, then told which screen to open (the window ignores it during a live session).
    Open(&'static str),
    /// Orbit on the web: the window opens the browser (it knows the web address), without coming forward.
    Web,
}

fn tray_action(id: &str) -> Option<TrayAction> {
    match id {
        "show" => Some(TrayAction::Show),
        "quit" => Some(TrayAction::Quit),
        "new-session" => Some(TrayAction::Open("new-session")),
        "history" => Some(TrayAction::Open("history")),
        "settings" => Some(TrayAction::Open("settings")),
        "web" => Some(TrayAction::Web),
        _ => None,
    }
}

fn on_tray_item(app: &tauri::AppHandle, id: &str) {
    match tray_action(id) {
        Some(TrayAction::Show) => show_main(app),
        Some(TrayAction::Quit) => tray_quit(app),
        Some(TrayAction::Open(screen)) => {
            show_main(app);
            let _ = app.emit_to("main", TRAY_EVENT, screen);
        }
        Some(TrayAction::Web) => {
            let _ = app.emit_to("main", TRAY_EVENT, "web");
        }
        None => {}
    }
}

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

/// The user's window-privacy choices (Settings → Window privacy), both off until they choose. `shield` keeps
/// Orbit's windows out of screenshots, screen recordings and Windows Recall (Windows display affinity: not every
/// capture method honours it, and it hides nothing from Task Manager or anyone looking at the screen).
/// `hide_from_taskbar` is separate and also off by default, so Orbit shows in the taskbar like any app.
#[derive(Default)]
struct WindowPrivacy {
    shield: AtomicBool,
    hide_from_taskbar: AtomicBool,
    /// A scrolling screenshot is running (screen.rs): Orbit's windows stay out of its captures meanwhile, whatever
    /// `shield` says, or Orbit's own window over the problem would be joined in.
    capturing: AtomicBool,
}

impl WindowPrivacy {
    fn get(&self) -> (bool, bool) {
        (
            self.shield.load(Ordering::Relaxed) || self.capturing.load(Ordering::Relaxed),
            self.hide_from_taskbar.load(Ordering::Relaxed),
        )
    }
}

/// Keeps Orbit's windows out of screen captures while `on` (they stay on screen), then back to the user's choice.
pub(crate) fn set_capturing(app: &tauri::AppHandle, on: bool) {
    app.state::<WindowPrivacy>()
        .capturing
        .store(on, Ordering::Relaxed);
    protect_all(app);
}

fn protect_window(window: &tauri::WebviewWindow) {
    let (shield, hide) = window.app_handle().state::<WindowPrivacy>().get();
    let _ = window.set_content_protected(shield);
    let _ = window.set_skip_taskbar(hide);
}

/// Every Orbit window, including ones opened after startup.
fn protect_all(app: &tauri::AppHandle) {
    for (_, window) in app.webview_windows() {
        if window.label() != screen::OVERLAY_LABEL {
            protect_window(&window);
        }
    }
}

/// Settings → Window privacy (and the first-run choice). Applies at once to every window, no restart.
#[tauri::command]
fn set_window_privacy(app: tauri::AppHandle, shield: bool, hide_from_taskbar: bool) {
    let state = app.state::<WindowPrivacy>();
    state.shield.store(shield, Ordering::Relaxed);
    state
        .hide_from_taskbar
        .store(hide_from_taskbar, Ordering::Relaxed);
    protect_all(&app);
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
    let mut context = tauri::generate_context!();
    // A test build (secrets.rs) is a separate app on this PC: with its own identifier the single-instance guard
    // never hands a test launch over to the installed Orbit (or the reverse), and window positions are kept apart.
    if let Some(identifier) = secrets::test_build_identifier() {
        context.config_mut().identifier = identifier;
    }

    tauri::Builder::default()
        // First, per the plugin's docs: a second launch (Start menu, shortcut) while Orbit runs, maybe hidden in the
        // tray, brings this window back instead of starting another Orbit whose tray icon and global shortcuts
        // would clash with this one's.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app)
        }))
        // The region selector is placed over its monitor each time it opens: restoring its last geometry would put
        // it on the wrong spot (or the wrong monitor).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&[screen::OVERLAY_LABEL])
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(audio::CaptureState::default())
        .manage(updater::PendingUpdate::default())
        .manage(QuitRequest::default())
        .manage(WindowPrivacy::default())
        .on_window_event(|window, event| {
            if matches!(
                event,
                WindowEvent::Focused(_)
                    | WindowEvent::ScaleFactorChanged { .. }
                    | WindowEvent::ThemeChanged(_)
            ) {
                let label = window.label();
                if label == screen::OVERLAY_LABEL {
                    return;
                }
                if let Some(webview) = window.app_handle().get_webview_window(label) {
                    protect_window(&webview);
                }
            }
        })
        .setup(|app| {
            // The tray menu (right click): which Orbit this is, the usual places, the web, and Quit last.
            let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
            let version = MenuItem::with_id(
                app,
                "version",
                format!("Orbit {}", app.package_info().version),
                false,
                None::<&str>,
            )?;
            let menu = Menu::with_items(
                app,
                &[
                    &version,
                    &PredefinedMenuItem::separator(app)?,
                    &item("show", "Open Orbit")?,
                    &item("new-session", "New session…")?,
                    &item("history", "Past sessions")?,
                    &PredefinedMenuItem::separator(app)?,
                    &item("web", "Orbit on the web")?,
                    &item("settings", "Settings")?,
                    &PredefinedMenuItem::separator(app)?,
                    &item("quit", "Quit Orbit")?,
                ],
            )?;

            // A left click brings Orbit back, as Windows apps' tray icons do; the menu is on the right click.
            let mut tray = TrayIconBuilder::with_id("orbit-tray")
                .tooltip("Orbit: interview copilot")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| on_tray_item(app, event.id.as_ref()))
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            protect_all(app.handle());

            // Windows can drop capture-exclusion after DPI or fullscreen changes: re-apply the user's choice.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(2));
                protect_all(&handle);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_window_privacy,
            audio::list_audio_devices,
            audio::list_output_devices,
            audio::start_capture,
            audio::stop_capture,
            #[cfg(target_os = "windows")]
            process_loopback::list_audio_apps,
            #[cfg(target_os = "windows")]
            process_loopback::audio_levels,
            #[cfg(target_os = "windows")]
            app_icons::app_icon,
            screen::capture_screen,
            screen::capture_region,
            screen::capture_scrolling,
            screen::open_region_selector,
            secrets::save_token,
            secrets::load_token,
            secrets::clear_token,
            updater::check_update,
            updater::download_update,
            updater::install_update,
            quit_app,
        ])
        .run(context)
        .expect("error while running Orbit");
}

#[cfg(test)]
mod tests {
    use super::{tray_action, QuitRequest, TrayAction, WindowPrivacy};
    use std::time::Duration;

    #[test]
    fn window_privacy_is_off_until_the_user_chooses() {
        // Not hidden from screenshots, and in the taskbar like any app, until Settings says otherwise.
        assert_eq!(WindowPrivacy::default().get(), (false, false));
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let main = &conf["app"]["windows"][0];
        assert_eq!(main["contentProtected"], false);
        assert_eq!(main["skipTaskbar"], false);
    }

    #[test]
    fn tray_items_show_quit_or_hand_the_window_a_screen() {
        assert_eq!(tray_action("show"), Some(TrayAction::Show));
        assert_eq!(tray_action("quit"), Some(TrayAction::Quit));
        assert_eq!(
            tray_action("new-session"),
            Some(TrayAction::Open("new-session"))
        );
        assert_eq!(tray_action("history"), Some(TrayAction::Open("history")));
        assert_eq!(tray_action("settings"), Some(TrayAction::Open("settings")));
        assert_eq!(tray_action("web"), Some(TrayAction::Web));
        assert_eq!(tray_action("version"), None); // the disabled "Orbit X.Y.Z" line does nothing
    }

    #[test]
    fn a_second_tray_quit_soon_after_the_first_quits_anyway() {
        let quit = QuitRequest::default();
        assert!(!quit.repeated(Duration::from_secs(5)));
        assert!(quit.repeated(Duration::from_secs(5)));
        assert!(!quit.repeated(Duration::ZERO)); // long after: asks again
    }
}
