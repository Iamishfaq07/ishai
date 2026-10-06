//! The Orbit *user session* token lives in the OS credential store (macOS Keychain,
//! Windows Credential Manager, Secret Service on Linux) — never in localStorage or on disk.
//! Provider API keys (DeepSeek, Deepgram) never reach the desktop app at all.

const DEFAULT_SERVICE: &str = "ai.orbit.desktop";

// Test/dev builds can set ORBIT_KEYRING_SERVICE at compile time so they never read (or, on a 401, delete)
// the real app's saved sign-in. An EMPTY value counts as unset: 0.1.11 shipped built with the variable set to ""
// (a shell that couldn't delete it), so it looked for the sign-in under an empty service name and lost it.
const SERVICE: &str = service_name(option_env!("ORBIT_KEYRING_SERVICE"));
const ACCOUNT: &str = "access_token";

const fn service_name(configured: Option<&'static str>) -> &'static str {
    match configured {
        Some(service) if !service.is_empty() => service,
        _ => DEFAULT_SERVICE,
    }
}

/// A test build's app identifier (lib.rs runs it as a separate app): its keyring service, kept to characters that
/// are safe in a folder and mutex name. None for the real app.
pub(crate) fn test_build_identifier() -> Option<String> {
    identifier_for(SERVICE)
}

fn identifier_for(service: &str) -> Option<String> {
    (service != DEFAULT_SERVICE).then(|| {
        service
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
                    c
                } else {
                    '-'
                }
            })
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::{identifier_for, service_name, DEFAULT_SERVICE};

    #[test]
    fn empty_or_missing_service_falls_back_to_the_real_app() {
        assert_eq!(service_name(None), DEFAULT_SERVICE);
        assert_eq!(service_name(Some("")), DEFAULT_SERVICE);
        assert_eq!(
            service_name(Some("ai.orbit.desktop.test")),
            "ai.orbit.desktop.test"
        );
    }

    #[test]
    fn only_test_builds_get_their_own_identifier() {
        assert_eq!(identifier_for(DEFAULT_SERVICE), None);
        assert_eq!(
            identifier_for("ai.orbit.desktop.test").as_deref(),
            Some("ai.orbit.desktop.test")
        );
        assert_eq!(
            identifier_for("orbit polish/test").as_deref(),
            Some("orbit-polish-test")
        );
    }
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_token(token: String) -> Result<(), String> {
    entry()?.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_token() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn clear_token() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
