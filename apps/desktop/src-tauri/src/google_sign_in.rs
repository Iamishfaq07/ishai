//! "Continue with Google" (D81): the sign-in happens in the user's own browser, not in Orbit's window.
//!
//! RFC 8252 (OAuth for native apps): a PKCE verifier and S256 challenge, a random state, and a one-shot HTTP listener
//! on 127.0.0.1 on a port the OS picks. The browser opens the API's Google start with the port, the challenge and the
//! state; the API sends it back to `http://127.0.0.1:<port>/callback?code=..&state=..` (or `?error=..`). The listener
//! answers the tab with a small page, Orbit comes to the front, and the window trades the code and the verifier at
//! POST /v1/auth/desktop/exchange (api.ts), which answers like an email/password sign-in.
//!
//! One attempt at a time (a new one ends the last), five minutes at most, and Cancel in the window ends it.

use std::collections::VecDeque;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Manager, Url};
use tauri_plugin_opener::OpenerExt;

/// How long the browser has to come back.
const TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// How often the listener looks at Cancel while nothing arrives.
const POLL: Duration = Duration::from_millis(100);
/// A connection that sends nothing (a browser's speculative pre-connect) is dropped after this.
const READ_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REQUEST: usize = 8 * 1024;

type Outcome = Result<GoogleCode, String>;

/// An attempt's result, for a second call with the same attempt id to wait on.
#[derive(Default)]
struct Shared(Mutex<Option<Outcome>>, Condvar);

impl Shared {
    fn publish(&self, outcome: Outcome) {
        *self.0.lock().unwrap_or_else(|p| p.into_inner()) = Some(outcome);
        self.1.notify_all();
    }

    fn wait(&self) -> Outcome {
        let mut slot = self.0.lock().unwrap_or_else(|p| p.into_inner());
        loop {
            if let Some(outcome) = slot.as_ref() {
                return outcome.clone();
            }
            slot = self.1.wait(slot).unwrap_or_else(|p| p.into_inner());
        }
    }
}

struct Running {
    id: String,
    cancel: Arc<AtomicBool>,
    shared: Arc<Shared>,
}

/// How many finished attempt ids are remembered, so a late repeat of one is recognised.
const REMEMBERED: usize = 16;

/// The running attempt (its id from the window, its Cancel switch and its result), and recently finished ids.
///
/// The window names each attempt. Tauri's IPC re-sends a command over its fallback channel when the first request
/// fails (the page reloading while it waits, say): without the id that repeat would start a second sign-in and
/// open the browser again. A repeat of the running attempt waits for its result; one of a finished attempt gets
/// "duplicate".
#[derive(Default)]
pub struct GoogleAttempt(Mutex<(Option<Running>, VecDeque<String>)>);

enum Begun {
    New(Arc<AtomicBool>, Arc<Shared>),
    Running(Arc<Shared>),
    Finished,
}

impl GoogleAttempt {
    /// Attempt `id`: a new one (the one before it, if any, is cancelled), or the one already running or finished.
    fn begin(&self, id: &str) -> Begun {
        let mut state = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let (running, finished) = &mut *state;
        if let Some(run) = running.as_ref().filter(|r| r.id == id) {
            return Begun::Running(run.shared.clone());
        }
        if finished.iter().any(|f| f == id) {
            return Begun::Finished;
        }
        let cancel = Arc::new(AtomicBool::new(false));
        let shared = Arc::new(Shared::default());
        let new = Running {
            id: id.to_string(),
            cancel: cancel.clone(),
            shared: shared.clone(),
        };
        if let Some(old) = running.replace(new) {
            old.cancel.store(true, Ordering::Relaxed);
            remember(finished, old.id);
        }
        Begun::New(cancel, shared)
    }

    fn cancel(&self) {
        let state = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(run) = state.0.as_ref() {
            run.cancel.store(true, Ordering::Relaxed);
        }
    }

    /// Attempt `id` is over: forgotten as the running one (if it still is), remembered as finished.
    fn end(&self, id: &str) {
        let mut state = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let (running, finished) = &mut *state;
        if running.as_ref().is_some_and(|r| r.id == id) {
            *running = None;
        }
        if !finished.iter().any(|f| f == id) {
            remember(finished, id.to_string());
        }
    }
}

fn remember(finished: &mut VecDeque<String>, id: String) {
    finished.push_back(id);
    while finished.len() > REMEMBERED {
        finished.pop_front();
    }
}

/// What the window gets back: the code to trade, with the verifier only this attempt knows.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCode {
    pub code: String,
    pub verifier: String,
}

/// Why it ended without a code. Shown to the window as the error string (api.ts maps it to words).
#[derive(Debug, PartialEq, Eq)]
enum Ended {
    Cancelled,
    TimedOut,
    /// The API's error code: denied, google_off, busy, suspended, unverified, private, server, google.
    Refused(String),
    Failed(String),
}

impl Ended {
    fn code(self) -> String {
        match self {
            Ended::Cancelled => "cancelled".into(),
            Ended::TimedOut => "timeout".into(),
            Ended::Refused(code) => code,
            Ended::Failed(why) => format!("failed: {why}"),
        }
    }
}

fn random_token(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| format!("no randomness: {e}"))?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

/// RFC 7636 §4.2: BASE64URL(SHA256(verifier)), no padding.
fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// `{api}/v1/auth/google/start?desktop_port=..&desktop_challenge=..&desktop_state=..`. The API address must be http(s).
fn start_url(api: &str, port: u16, challenge: &str, state: &str) -> Result<Url, String> {
    let mut url =
        Url::parse(api.trim()).map_err(|_| "the server address isn't valid".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.cannot_be_a_base() {
        return Err("the server address isn't valid".into());
    }
    let path = format!("{}/v1/auth/google/start", url.path().trim_end_matches('/'));
    url.set_path(&path);
    url.set_fragment(None);
    url.query_pairs_mut()
        .clear()
        .append_pair("desktop_port", &port.to_string())
        .append_pair("desktop_challenge", challenge)
        .append_pair("desktop_state", state);
    Ok(url)
}

/// The request line's target, if it's a GET: "/callback?code=..".
fn request_target(head: &str) -> Option<&str> {
    let line = head.lines().next()?;
    let mut parts = line.split(' ');
    match (parts.next(), parts.next()) {
        (Some("GET"), Some(target)) => Some(target),
        _ => None,
    }
}

fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => match (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                (Some(hi), Some(lo)) => {
                    out.push(hi << 4 | lo);
                    i += 2;
                }
                _ => out.push(b'%'),
            },
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(digit: u8) -> Option<u8> {
    (digit as char).to_digit(16).map(|d| d as u8)
}

fn query_param(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        (percent_decode(key) == name).then(|| percent_decode(value))
    })
}

/// What a request to the listener means.
#[derive(Debug, PartialEq, Eq)]
enum Visit {
    /// Not ours (a favicon, a stray page, another state): answered and ignored, the attempt goes on.
    Ignore,
    Code(String),
    Refused(String),
}

fn visit(target: &str, state: &str) -> Visit {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != "/callback" {
        return Visit::Ignore;
    }
    let same_state =
        query_param(query, "state").is_some_and(|s| constant_eq(s.as_bytes(), state.as_bytes()));
    if !same_state {
        return Visit::Ignore;
    }
    match (query_param(query, "code"), query_param(query, "error")) {
        (Some(code), None) if !code.is_empty() && code.len() <= 200 => Visit::Code(code),
        (_, Some(error)) => Visit::Refused(clean_error(&error)),
        _ => Visit::Refused("google".into()),
    }
}

fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The API's error codes are short words; anything else becomes the generic one.
fn clean_error(error: &str) -> String {
    if !error.is_empty()
        && error.len() <= 32
        && error.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
    {
        error.to_string()
    } else {
        "google".into()
    }
}

const PAGE_DONE: &str = "You're signed in to Orbit";
const PAGE_DONE_TEXT: &str = "You can close this tab and return to the app.";
const PAGE_FAILED: &str = "Orbit couldn't sign you in";
const PAGE_FAILED_TEXT: &str = "Return to the Orbit app to see why, then try again.";

/// A self-contained page: no scripts, no outside fonts or images, light and dark.
fn page(title: &str, text: &str) -> String {
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" \
         content=\"width=device-width,initial-scale=1\"><meta name=\"color-scheme\" content=\"light dark\">\
         <title>{title}</title><style>body{{margin:0;min-height:100vh;display:flex;align-items:center;\
         justify-content:center;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f4f4f5;\
         color:#18181b}}main{{max-width:28rem;margin:1.5rem;padding:2rem;border-radius:1rem;background:#fff;\
         box-shadow:0 1px 3px rgba(0,0,0,.12);text-align:center}}h1{{font-size:1.25rem;margin:0 0 .5rem}}\
         p{{margin:0;color:#52525b;line-height:1.5}}@media (prefers-color-scheme:dark){{body{{background:#09090b;\
         color:#fafafa}}main{{background:#18181b}}p{{color:#a1a1aa}}}}</style></head><body><main><h1>{title}</h1>\
         <p>{text}</p></main></body></html>"
    )
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\n\
         Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; \
         frame-ancestors 'none'\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
    let _ = stream.flush();
}

/// Reads the request head (up to a blank line or MAX_REQUEST bytes).
fn read_head(stream: &mut TcpStream) -> Option<String> {
    stream.set_nonblocking(false).ok()?;
    stream.set_read_timeout(Some(READ_TIMEOUT)).ok()?;
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while buf.len() < MAX_REQUEST {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// Waits for the browser to come back to `listener` with `state`, until `deadline` or `cancel`.
fn wait_for_callback(
    listener: &TcpListener,
    state: &str,
    cancel: &AtomicBool,
    deadline: Instant,
) -> Result<String, Ended> {
    listener
        .set_nonblocking(true)
        .map_err(|e| Ended::Failed(e.to_string()))?;
    // Each connection is read on its own thread: a browser's pre-connect that never sends a request can't hold up
    // the one that does.
    let (tx, rx) = mpsc::channel::<Visit>();
    loop {
        if let Ok(found) = rx.try_recv() {
            return match found {
                Visit::Code(code) => Ok(code),
                Visit::Refused(error) => Err(Ended::Refused(error)),
                Visit::Ignore => continue,
            };
        }
        if cancel.load(Ordering::Relaxed) {
            return Err(Ended::Cancelled);
        }
        if Instant::now() >= deadline {
            return Err(Ended::TimedOut);
        }
        match listener.accept() {
            Ok((stream, _)) => {
                let tx = tx.clone();
                let state = state.to_string();
                std::thread::spawn(move || {
                    let _ = tx.send(serve(stream, &state));
                });
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => std::thread::sleep(POLL),
            Err(e) if e.kind() == ErrorKind::Interrupted => {}
            Err(e) => return Err(Ended::Failed(e.to_string())),
        }
    }
}

/// Answers one connection and says what it meant.
fn serve(mut stream: TcpStream, state: &str) -> Visit {
    let found = read_head(&mut stream)
        .and_then(|head| request_target(&head).map(|t| visit(t, state)))
        .unwrap_or(Visit::Ignore);
    match &found {
        Visit::Code(_) => respond(&mut stream, "200 OK", &page(PAGE_DONE, PAGE_DONE_TEXT)),
        Visit::Refused(_) => respond(&mut stream, "200 OK", &page(PAGE_FAILED, PAGE_FAILED_TEXT)),
        Visit::Ignore => respond(
            &mut stream,
            "404 Not Found",
            &page("Not found", "Nothing here."),
        ),
    }
    found
}

/// Test builds only (an ORBIT_KEYRING_SERVICE build, secrets.rs): ORBIT_TEST_GOOGLE_HANDOFF names a file that gets
/// the start URL instead of the browser opening it, and "focus" instead of the window coming forward. An automated
/// run then drives a headless browser and never touches the PC's own browser or foreground window. The real app
/// never reads it.
fn test_handoff() -> Option<PathBuf> {
    crate::secrets::test_build_identifier()?;
    std::env::var_os("ORBIT_TEST_GOOGLE_HANDOFF")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

fn note(file: &Path, line: &str) -> Result<(), String> {
    let mut out = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file)
        .map_err(|e| e.to_string())?;
    writeln!(out, "{line}").map_err(|e| e.to_string())
}

/// Opens the browser at the API's Google sign-in and waits for it to come back. Resolves with the code and the
/// verifier for POST /v1/auth/desktop/exchange; rejects with "cancelled", "timeout", the API's error code,
/// "duplicate" (a repeat of a finished attempt) or "failed: ..". `attempt` is the window's id for this attempt.
#[tauri::command]
pub async fn google_sign_in(
    app: tauri::AppHandle,
    api_url: String,
    attempt: String,
) -> Result<GoogleCode, String> {
    if attempt.is_empty() || attempt.len() > 64 {
        return Err(Ended::Failed("no attempt id".into()).code());
    }
    let (cancel, shared) = match app.state::<GoogleAttempt>().begin(&attempt) {
        Begun::New(cancel, shared) => (cancel, shared),
        Begun::Running(shared) => {
            return tauri::async_runtime::spawn_blocking(move || shared.wait())
                .await
                .unwrap_or_else(|e| Err(Ended::Failed(e.to_string()).code()));
        }
        Begun::Finished => return Err("duplicate".into()),
    };
    let outcome = run(&app, &api_url, cancel).await;
    shared.publish(outcome.clone());
    app.state::<GoogleAttempt>().end(&attempt);
    outcome
}

async fn run(app: &tauri::AppHandle, api_url: &str, cancel: Arc<AtomicBool>) -> Outcome {
    let verifier = random_token(32)?;
    let state = random_token(24)?;
    let listener =
        TcpListener::bind(("127.0.0.1", 0)).map_err(|e| Ended::Failed(e.to_string()).code())?;
    let port = listener
        .local_addr()
        .map_err(|e| Ended::Failed(e.to_string()).code())?
        .port();
    let url = start_url(api_url, port, &challenge_for(&verifier), &state)
        .map_err(|e| Ended::Failed(e).code())?;

    let handoff = test_handoff();
    let opened = match &handoff {
        Some(file) => note(file, url.as_str()),
        None => app
            .opener()
            .open_url(url.as_str(), None::<&str>)
            .map_err(|e| e.to_string()),
    };
    if let Err(e) = opened {
        return Err(Ended::Failed(format!("couldn't open the browser: {e}")).code());
    }
    let waited = tauri::async_runtime::spawn_blocking(move || {
        wait_for_callback(&listener, &state, &cancel, Instant::now() + TIMEOUT)
    })
    .await
    .unwrap_or_else(|e| Err(Ended::Failed(e.to_string())));
    if !matches!(waited, Err(Ended::Cancelled)) {
        match &handoff {
            Some(file) => drop(note(file, "focus")),
            None => crate::show_main(app), // back from the browser: Orbit comes forward
        }
    }
    waited
        .map(|code| GoogleCode { code, verifier })
        .map_err(Ended::code)
}

/// The window's Cancel.
#[tauri::command]
pub fn google_sign_in_cancel(app: tauri::AppHandle) {
    app.state::<GoogleAttempt>().cancel();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn the_challenge_is_rfc_7636s_s256() {
        // RFC 7636 appendix B.
        assert_eq!(
            challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifiers_and_states_are_random_and_url_safe() {
        let a = random_token(32).unwrap();
        let b = random_token(32).unwrap();
        assert_ne!(a, b);
        assert_eq!(a.len(), 43); // RFC 7636's minimum, exactly
        assert!(a
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'));
        assert_eq!(random_token(24).unwrap().len(), 32);
        assert_eq!(challenge_for(&a).len(), 43);
    }

    #[test]
    fn the_start_url_carries_port_challenge_and_state() {
        let url = start_url(
            "https://api.orbitanswer.com",
            50123,
            "c".repeat(43).as_str(),
            "st-1",
        )
        .unwrap();
        assert_eq!(
            url.as_str(),
            format!(
                "https://api.orbitanswer.com/v1/auth/google/start?desktop_port=50123&desktop_challenge={}&desktop_state=st-1",
                "c".repeat(43)
            )
        );
        // A server under a path (a site's /api proxy), with or without the slash.
        for api in [
            "https://orbitanswer.com/api",
            "https://orbitanswer.com/api/",
        ] {
            let url = start_url(api, 1024, "x", "y").unwrap();
            assert_eq!(url.path(), "/api/v1/auth/google/start");
        }
        assert_eq!(
            start_url("http://localhost:8036", 2000, "x", "y")
                .unwrap()
                .host_str(),
            Some("localhost")
        );
        assert!(start_url("file:///c:/x", 2000, "x", "y").is_err());
        assert!(start_url("javascript:alert(1)", 2000, "x", "y").is_err());
        assert!(start_url("not a url", 2000, "x", "y").is_err());
    }

    #[test]
    fn requests_are_read_for_their_code_or_error() {
        assert_eq!(
            request_target("GET /callback?code=a HTTP/1.1\r\nHost: x\r\n\r\n"),
            Some("/callback?code=a")
        );
        assert_eq!(request_target("POST /callback HTTP/1.1\r\n"), None);
        assert_eq!(
            visit("/callback?code=abc&state=s1", "s1"),
            Visit::Code("abc".into())
        );
        assert_eq!(
            visit("/callback?state=s1&code=a%2Db", "s1"),
            Visit::Code("a-b".into())
        );
        assert_eq!(
            visit("/callback?error=denied&state=s1", "s1"),
            Visit::Refused("denied".into())
        );
        assert_eq!(
            visit("/callback?error=%3Cscript%3E&state=s1", "s1"),
            Visit::Refused("google".into())
        );
        assert_eq!(
            visit("/callback?state=s1", "s1"),
            Visit::Refused("google".into())
        );
        // Not ours: another state, no state, another path.
        assert_eq!(visit("/callback?code=abc&state=s2", "s1"), Visit::Ignore);
        assert_eq!(visit("/callback?code=abc", "s1"), Visit::Ignore);
        assert_eq!(visit("/favicon.ico", "s1"), Visit::Ignore);
        assert_eq!(percent_decode("a+b%20c%zz%4"), "a b c%zz%4");
    }

    fn get(port: u16, target: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(stream, "GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut answer = String::new();
        stream.read_to_string(&mut answer).unwrap();
        answer
    }

    fn listen() -> (TcpListener, u16) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        (listener, port)
    }

    #[test]
    fn the_listener_answers_the_browser_and_hands_over_the_code() {
        let (listener, port) = listen();
        let waiting = thread::spawn(move || {
            wait_for_callback(
                &listener,
                "the-state",
                &AtomicBool::new(false),
                Instant::now() + Duration::from_secs(10),
            )
        });
        // A pre-connect that never speaks, a favicon and a stranger's state don't end it.
        let idle = TcpStream::connect(("127.0.0.1", port)).unwrap();
        drop(idle);
        assert!(get(port, "/favicon.ico").starts_with("HTTP/1.1 404"));
        assert!(get(port, "/callback?code=evil&state=guess").starts_with("HTTP/1.1 404"));
        let page = get(port, "/callback?code=the-code&state=the-state");
        assert!(page.starts_with("HTTP/1.1 200 OK"));
        assert!(page.contains("You're signed in to Orbit"));
        assert!(page.contains("Content-Security-Policy: default-src 'none'"));
        assert!(
            !page.contains("http://") && !page.contains("https://") && !page.contains("<script")
        );
        assert_eq!(waiting.join().unwrap(), Ok("the-code".into()));
        // One shot: the listener is gone with the attempt.
        assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
    }

    #[test]
    fn the_listener_passes_on_the_apis_refusal() {
        let (listener, port) = listen();
        let waiting = thread::spawn(move || {
            wait_for_callback(
                &listener,
                "s",
                &AtomicBool::new(false),
                Instant::now() + Duration::from_secs(10),
            )
        });
        let page = get(port, "/callback?error=suspended&state=s");
        assert!(page.contains("Orbit couldn't sign you in"));
        assert_eq!(
            waiting.join().unwrap(),
            Err(Ended::Refused("suspended".into()))
        );
    }

    #[test]
    fn cancel_and_the_deadline_end_the_wait() {
        let (listener, _) = listen();
        let cancel = AtomicBool::new(true);
        assert_eq!(
            wait_for_callback(&listener, "s", &cancel, Instant::now() + TIMEOUT),
            Err(Ended::Cancelled)
        );
        let (listener, _) = listen();
        assert_eq!(
            wait_for_callback(
                &listener,
                "s",
                &AtomicBool::new(false),
                Instant::now() + Duration::from_millis(150)
            ),
            Err(Ended::TimedOut)
        );
        assert_eq!(Ended::TimedOut.code(), "timeout");
        assert_eq!(Ended::Refused("busy".into()).code(), "busy");
    }

    #[test]
    fn only_one_attempt_runs_at_a_time() {
        let attempts = GoogleAttempt::default();
        let Begun::New(first, _) = attempts.begin("a1") else {
            panic!("a new attempt")
        };
        let Begun::New(second, shared) = attempts.begin("a2") else {
            panic!("a new attempt")
        };
        assert!(
            first.load(Ordering::Relaxed),
            "a new attempt ends the last one"
        );
        assert!(!second.load(Ordering::Relaxed));
        attempts.end("a1"); // the old one finishing doesn't forget the new one
        attempts.cancel();
        assert!(second.load(Ordering::Relaxed));
        attempts.end("a2");
        attempts.cancel(); // nothing running: nothing happens
        drop(shared);
    }

    #[test]
    fn a_repeated_command_joins_its_attempt_instead_of_opening_the_browser_again() {
        // Tauri's IPC re-sends a command whose first request failed (the page reloading while it waits).
        let attempts = GoogleAttempt::default();
        let Begun::New(_, shared) = attempts.begin("a1") else {
            panic!("a new attempt")
        };
        let Begun::Running(joined) = attempts.begin("a1") else {
            panic!("the repeat joins the running attempt")
        };
        let waiter = thread::spawn(move || joined.wait());
        let code = GoogleCode {
            code: "c".into(),
            verifier: "v".into(),
        };
        shared.publish(Ok(code.clone()));
        assert_eq!(waiter.join().unwrap(), Ok(code));
        attempts.end("a1");
        assert!(matches!(attempts.begin("a1"), Begun::Finished));
        // Only the last few are remembered.
        for n in 0..REMEMBERED {
            attempts.end(&format!("x{n}"));
        }
        assert!(matches!(attempts.begin("a1"), Begun::New(..)));
    }

    #[test]
    fn only_a_test_build_hands_the_url_to_a_file() {
        if crate::secrets::test_build_identifier().is_some() {
            return; // this run was built as a test build: the switch is meant to work here
        }
        std::env::set_var("ORBIT_TEST_GOOGLE_HANDOFF", "handoff.txt");
        assert_eq!(
            test_handoff(),
            None,
            "the real app always opens the browser"
        );
        std::env::remove_var("ORBIT_TEST_GOOGLE_HANDOFF");
    }
}
