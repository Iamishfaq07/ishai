//! Windows per-application audio capture (WASAPI *process loopback*, Windows 10 2004+ / Windows 11).
//!
//! Captures only what one process tree plays — e.g. Zoom, Teams or the browser running the meeting —
//! instead of every sound on the PC. Whole-system loopback picks up games, videos and notifications,
//! which pollutes the interviewer transcript and keeps the speech-to-text VAD from hearing silence.
//!
//! Supervised like endpoint capture (wasapi_capture.rs, whose stream setup and pump it shares): a failing stream
//! (e.g. the Windows audio service restarted) reports `lost` and is re-activated with backoff, and so is the app
//! quitting: when it starts again (same exe, new process) capture follows it. Windows itself never says the app is
//! gone (process loopback on a dead, or never existing, PID activates fine and delivers silence for ever), so the
//! app's process is watched instead.

use std::cmp::Reverse;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use windows::core::{implement, Interface, Ref, HRESULT};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{
    eRender, ActivateAudioInterfaceAsync, AudioSessionStateActive,
    IActivateAudioInterfaceAsyncOperation, IActivateAudioInterfaceCompletionHandler,
    IActivateAudioInterfaceCompletionHandler_Impl, IAudioCaptureClient, IAudioClient,
    IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    DEVICE_STATE_ACTIVE, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
    VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
};
use windows::Win32::System::Com::StructuredStorage::{
    PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
};
use windows::Win32::System::Com::{CoCreateInstance, BLOB, CLSCTX_ALL};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    CreateEventW, OpenProcess, SetEvent, WaitForSingleObject, PROCESS_SYNCHRONIZE,
};
use windows::Win32::System::Variant::VT_BLOB;

use crate::audio::{CaptureEvent, CHANNEL_SYSTEM};
use crate::wasapi_capture::{
    default_id, device_id, pump, start_stream, status, Com, Ended, Flow, FIRST_BACKOFF, MAX_BACKOFF,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioApp {
    /// Root of the process tree to capture (e.g. the main chrome.exe, not its audio helper).
    pid: u32,
    exe: String,
    name: String,
    /// Currently producing sound.
    active: bool,
}

fn friendly_name(exe: &str) -> String {
    let lower = exe.to_ascii_lowercase();
    let known = [
        ("zoom.exe", "Zoom"),
        ("ms-teams.exe", "Microsoft Teams"),
        ("teams.exe", "Microsoft Teams (classic)"),
        ("chrome.exe", "Google Chrome"),
        ("msedge.exe", "Microsoft Edge"),
        ("firefox.exe", "Firefox"),
        ("brave.exe", "Brave"),
        ("opera.exe", "Opera"),
        ("slack.exe", "Slack"),
        ("discord.exe", "Discord"),
        ("webexmta.exe", "Webex"),
        ("ciscocollabhost.exe", "Webex"),
        ("skype.exe", "Skype"),
    ];
    known
        .iter()
        .find(|(e, _)| *e == lower)
        .map(|(_, n)| (*n).to_string())
        .unwrap_or_else(|| {
            exe.trim_end_matches(".exe")
                .trim_end_matches(".EXE")
                .to_string()
        })
}

/// pid → (parent pid, exe name) for every running process.
fn process_table() -> HashMap<u32, (u32, String)> {
    let mut table = HashMap::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return table;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let exe = String::from_utf16_lossy(&entry.szExeFile[..len]);
                table.insert(entry.th32ProcessID, (entry.th32ParentProcessID, exe));
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    table
}

/// Maps an audio-session process to the app that owns it. Walks up only through the *same* program
/// (chrome's audio helper → main chrome.exe) or an embedded WebView2 (new Teams plays audio from
/// msedgewebview2.exe) — never through unrelated parents like a terminal, which would lump the
/// meeting app together with everything else that terminal launched.
pub fn root_process(pid: u32, table: &HashMap<u32, (u32, String)>) -> u32 {
    let mut current = pid;
    for _ in 0..8 {
        let Some((parent, exe)) = table.get(&current) else {
            break;
        };
        let Some((_, parent_exe)) = table.get(parent) else {
            break;
        };
        let same_program = parent_exe.eq_ignore_ascii_case(exe);
        let embedded_webview = exe.eq_ignore_ascii_case("msedgewebview2.exe")
            && !parent_exe.eq_ignore_ascii_case("explorer.exe");
        if *parent <= 4 || !(same_program || embedded_webview) {
            break;
        }
        current = *parent;
    }
    current
}

/// `(process id, playing now)` for every app audio session on every active output device. Not just the default
/// one: Teams and Zoom often play the call on the *communications* device (a headset, Bluetooth hands-free) while
/// everything else uses the speakers, so the default device alone misses exactly the meeting app. Process loopback
/// isn't tied to a device, so an app found on any of them can be captured.
unsafe fn output_sessions() -> windows::core::Result<Vec<(u32, bool)>> {
    let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
    let devices = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
    let mut out = Vec::new();
    for i in 0..devices.GetCount()? {
        // One device failing (a Bluetooth headset mid-reconnect) mustn't hide the apps on the others.
        let Ok(device) = devices.Item(i) else {
            continue;
        };
        let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else {
            continue;
        };
        let Ok(sessions) = manager.GetSessionEnumerator() else {
            continue;
        };
        for j in 0..sessions.GetCount().unwrap_or(0) {
            let Ok(control) = sessions
                .GetSession(j)
                .and_then(|s| s.cast::<IAudioSessionControl2>())
            else {
                continue;
            };
            let pid = control.GetProcessId().unwrap_or(0);
            if pid == 0 {
                continue; // system sounds
            }
            let active = control
                .GetState()
                .map(|s| s == AudioSessionStateActive)
                .unwrap_or(false);
            out.push((pid, active));
        }
    }
    Ok(out)
}

/// One entry per app (process tree) from `(process id, playing)` sessions, never Orbit itself. An app is playing if
/// any of its sessions is, on any device. Playing apps first, then by name.
fn group_apps(
    sessions: &[(u32, bool)],
    table: &HashMap<u32, (u32, String)>,
    own_root: u32,
) -> Vec<AudioApp> {
    let mut apps: HashMap<u32, AudioApp> = HashMap::new();
    for &(pid, active) in sessions {
        let root = root_process(pid, table);
        if root == own_root {
            continue; // never offer to capture Orbit itself
        }
        let exe = table
            .get(&root)
            .map(|(_, e)| e.clone())
            .unwrap_or_else(|| format!("pid {root}"));
        apps.entry(root)
            .and_modify(|a| a.active |= active)
            .or_insert(AudioApp {
                pid: root,
                name: friendly_name(&exe),
                exe,
                active,
            });
    }
    let mut list: Vec<AudioApp> = apps.into_values().collect();
    list.sort_by(|a, b| b.active.cmp(&a.active).then_with(|| a.name.cmp(&b.name)));
    list
}

/// Apps that hold an audio session on any output device, grouped by process tree.
#[tauri::command]
pub async fn list_audio_apps() -> Result<Vec<AudioApp>, String> {
    // COM and the process snapshot block: off the async runtime, like the device lists (audio.rs).
    tauri::async_runtime::spawn_blocking(|| {
        let _com = Com::init();
        let table = process_table();
        let own_root = root_process(std::process::id(), &table);
        unsafe { output_sessions() }
            .map(|sessions| group_apps(&sessions, &table, own_root))
            .map_err(|e| format!("Couldn't list audio apps: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What's playing right now, as Windows' volume mixer shows it: each app's loudest session and each output
/// device's level, 0..1. Read from the audio engine's own peak meters (IAudioMeterInformation): no sound is
/// captured, nothing is recorded or sent, and the microphone is never opened, so Setup can show live meters on its
/// "Listen to" tiles before a session (or a test) starts capture.
#[derive(Serialize, Default, Debug, PartialEq)]
pub struct AudioLevels {
    apps: Vec<AppLevel>,
    outputs: Vec<OutputLevel>,
    /// The default output's and the default communications device's level.
    default_output: f32,
    communications: f32,
}

#[derive(Serialize, Debug, PartialEq)]
struct AppLevel {
    /// The app's process-tree root, the same pid `list_audio_apps` gives it.
    pid: u32,
    peak: f32,
}

#[derive(Serialize, Debug, PartialEq)]
struct OutputLevel {
    id: String,
    peak: f32,
}

/// Each app's level: the loudest of its sessions (an app plays through helper processes and on several devices),
/// never Orbit's own.
fn group_levels(
    sessions: &[(u32, f32)],
    table: &HashMap<u32, (u32, String)>,
    own_root: u32,
) -> Vec<AppLevel> {
    let mut peaks: HashMap<u32, f32> = HashMap::new();
    for &(pid, peak) in sessions {
        let root = root_process(pid, table);
        if root == own_root {
            continue;
        }
        let entry = peaks.entry(root).or_insert(0.0);
        *entry = entry.max(peak.clamp(0.0, 1.0));
    }
    let mut list: Vec<AppLevel> = peaks
        .into_iter()
        .map(|(pid, peak)| AppLevel { pid, peak })
        .collect();
    list.sort_by_key(|a| a.pid);
    list
}

/// `(session pid, peak)` for every app session, `(endpoint id, peak)` for every active output device, and the
/// default and communications outputs' ids.
type RawLevels = (
    Vec<(u32, f32)>,
    Vec<(String, f32)>,
    Option<String>,
    Option<String>,
);

unsafe fn read_levels() -> windows::core::Result<RawLevels> {
    let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
    let devices = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
    let mut sessions = Vec::new();
    let mut outputs = Vec::new();
    for i in 0..devices.GetCount()? {
        let Ok(device) = devices.Item(i) else {
            continue;
        };
        if let (Ok(id), Ok(meter)) = (
            device_id(&device),
            device.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None),
        ) {
            outputs.push((id, meter.GetPeakValue().unwrap_or(0.0)));
        }
        let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else {
            continue;
        };
        let Ok(list) = manager.GetSessionEnumerator() else {
            continue;
        };
        for j in 0..list.GetCount().unwrap_or(0) {
            let Ok(session) = list.GetSession(j) else {
                continue;
            };
            let pid = session
                .cast::<IAudioSessionControl2>()
                .and_then(|c| c.GetProcessId())
                .unwrap_or(0);
            if pid == 0 {
                continue; // system sounds
            }
            let peak = session
                .cast::<IAudioMeterInformation>()
                .and_then(|m| m.GetPeakValue())
                .unwrap_or(0.0);
            sessions.push((pid, peak));
        }
    }
    let default = default_id(&enumerator, Flow::Output, false);
    let comms = default_id(&enumerator, Flow::Output, true);
    Ok((sessions, outputs, default, comms))
}

/// Live levels for Setup's tiles (see `AudioLevels`). Cheap enough to ask a few times a second.
#[tauri::command]
pub async fn audio_levels() -> Result<AudioLevels, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let _com = Com::init();
        let (sessions, outputs, default, comms) =
            unsafe { read_levels() }.map_err(|e| format!("Couldn't read audio levels: {e}"))?;
        let table = process_table();
        let own_root = root_process(std::process::id(), &table);
        let level_of = |id: &Option<String>| {
            id.as_ref()
                .and_then(|id| outputs.iter().find(|(o, _)| o == id))
                .map_or(0.0, |(_, p)| p.clamp(0.0, 1.0))
        };
        Ok(AudioLevels {
            apps: group_levels(&sessions, &table, own_root),
            default_output: level_of(&default),
            communications: level_of(&comms),
            outputs: outputs
                .iter()
                .map(|(id, peak)| OutputLevel {
                    id: id.clone(),
                    peak: peak.clamp(0.0, 1.0),
                })
                .collect(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The process tree to capture for the app the user picked: `pid` while it's still that program, else (the app
/// quit and started again, e.g. a rejoined session) the tree running the same exe — one that's playing first, then
/// one with any audio session, then the lowest PID. None while it isn't running.
fn find_target(
    pid: u32,
    exe: &str,
    table: &HashMap<u32, (u32, String)>,
    sessions: &[(u32, bool)],
    own_root: u32,
) -> Option<u32> {
    if table
        .get(&pid)
        .is_some_and(|(_, e)| e.eq_ignore_ascii_case(exe))
    {
        return Some(pid);
    }
    let roots: HashSet<u32> = table
        .iter()
        .filter(|(_, (_, e))| e.eq_ignore_ascii_case(exe))
        .map(|(&p, _)| root_process(p, table))
        .filter(|&root| root != own_root)
        .collect();
    // 2 = playing, 1 = has a session.
    let mut score: HashMap<u32, u8> = HashMap::new();
    for &(session_pid, active) in sessions {
        let root = root_process(session_pid, table);
        if roots.contains(&root) {
            let s = score.entry(root).or_insert(0);
            *s = (*s).max(if active { 2 } else { 1 });
        }
    }
    roots
        .into_iter()
        .max_by_key(|root| (score.get(root).copied().unwrap_or(0), Reverse(*root)))
}

/// `find_target` against the running system (needs COM on this thread).
fn locate(pid: u32, exe: &str) -> Option<u32> {
    let table = process_table();
    let own_root = root_process(std::process::id(), &table);
    let sessions = unsafe { output_sessions() }.unwrap_or_default();
    find_target(pid, exe, &table, &sessions, own_root)
}

/// Notices the captured app quitting (see the module docs). Holding the handle also keeps Windows from reusing its
/// PID meanwhile.
struct ProcessWatch {
    pid: u32,
    exe: String,
    handle: Option<HANDLE>,
}

impl ProcessWatch {
    fn new(pid: u32, exe: &str) -> Self {
        // A refusal (e.g. the app runs elevated) only means looking it up in the process list instead.
        let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) }.ok();
        Self {
            pid,
            exe: exe.to_string(),
            handle,
        }
    }

    fn exited(&self) -> bool {
        match self.handle {
            // A zero timeout only polls: signalled = the process has exited.
            Some(handle) => unsafe { WaitForSingleObject(handle, 0) == WAIT_OBJECT_0 },
            None => !process_table()
                .get(&self.pid)
                .is_some_and(|(_, e)| e.eq_ignore_ascii_case(&self.exe)),
        }
    }
}

impl Drop for ProcessWatch {
    fn drop(&mut self) {
        if let Some(handle) = self.handle.take() {
            let _ = unsafe { CloseHandle(handle) };
        }
    }
}

/// Signals a Win32 event when activation completes. Holds only a raw HANDLE: nothing in this COM
/// object needs Rust-side cleanup, so however the system releases it, no Rust memory is freed twice.
#[implement(IActivateAudioInterfaceCompletionHandler)]
struct ActivationHandler {
    done: HANDLE,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationHandler_Impl {
    fn ActivateCompleted(
        &self,
        _op: Ref<'_, IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        unsafe { SetEvent(self.done) }
    }
}

unsafe fn activate_process_loopback(pid: u32) -> Result<IAudioClient, String> {
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };
    // VT_BLOB whose blob points at the stack `params`. PROPVARIANT's Drop calls PropVariantClear ->
    // CoTaskMemFree(pBlobData), which would free a stack pointer (heap corruption). It owns no heap,
    // so wrap it in ManuallyDrop and never run that Drop.
    let prop = std::mem::ManuallyDrop::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                        pBlobData: &mut params as *mut _ as *mut u8,
                    },
                },
            }),
        },
    });
    let done = CreateEventW(None, true, false, None).map_err(|e| e.to_string())?;
    let handler: IActivateAudioInterfaceCompletionHandler = ActivationHandler { done }.into();
    let operation = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        &IAudioClient::IID,
        Some(&*prop as *const PROPVARIANT),
        &handler,
    )
    .map_err(|e| format!("couldn't start app audio capture: {e}"))?;
    let waited = WaitForSingleObject(done, 5000);
    let _ = CloseHandle(done); // handler may still fire; it SetEvents a closed handle harmlessly
    if waited != WAIT_OBJECT_0 {
        return Err("activation timed out".to_string());
    }
    let mut hr = HRESULT(0);
    let mut unknown = None;
    operation
        .GetActivateResult(&mut hr, &mut unknown)
        .map_err(|e| e.to_string())?;
    hr.ok().map_err(|e| format!("capture was refused: {e}"))?;
    // `params`/`prop` (referenced by the blob) have outlived the completed async activation.
    unknown
        .ok_or("no audio client returned")?
        .cast::<IAudioClient>()
        .map_err(|e| e.to_string())
}

/// Activates process loopback on `pid`'s tree and starts it in the transcriber's format (16 kHz mono PCM16): the
/// audio engine converts with its quality resampler, so nothing above 8 kHz folds back into the speech band.
unsafe fn open(pid: u32) -> Result<(IAudioClient, IAudioCaptureClient, HANDLE), String> {
    let client = activate_process_loopback(pid)?;
    let (capture, event) = start_stream(&client, true)?;
    Ok((client, capture, event))
}

/// Starts capturing the app `pid` belongs to (its process tree) on its own COM thread, and keeps following it (see
/// the module docs). `exe` finds the app again after it restarts, or right away when `pid` is stale (a session
/// rejoined after the meeting app restarted); if the app isn't running at all, capture starts anyway and waits for
/// it, reported `lost` until it's there. Returns once capture is running (or failed); the thread exits when `stop`
/// is set.
pub fn spawn(
    pid: u32,
    exe: Option<String>,
    sink: Channel<CaptureEvent>,
    stop: Arc<AtomicBool>,
) -> Result<thread::JoinHandle<()>, String> {
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let handle = thread::Builder::new()
        .name("orbit-app-audio".into())
        .spawn(move || {
            let _com = Com::init();
            // No exe given: follow whatever program `pid` is now.
            let exe = exe
                .filter(|e| !e.trim().is_empty())
                .or_else(|| process_table().get(&pid).map(|(_, e)| e.clone()))
                .unwrap_or_default();
            let target = locate(pid, &exe);
            if target.is_none() && exe.is_empty() {
                // a dead PID and no exe to wait for
                let _ = ready_tx.send(Err(
                    "App audio unavailable: the app isn't running.".to_string()
                ));
                return;
            }
            let name = friendly_name(&exe);
            supervise(target, pid, &exe, &name, ready_tx, &sink, &stop);
        })
        .map_err(|e| e.to_string())?;
    match ready_rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(())) => Ok(handle),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("App audio capture didn't start".into()),
    }
}

/// The capture loop: (re)activate, pump, and on a failure or the app quitting report `lost` and try again — on the
/// same process while it runs, else wherever the app (re)starts (`target` None: not running yet). The first
/// activation's result goes to `ready`.
fn supervise(
    mut target: Option<u32>,
    pid_hint: u32,
    exe: &str,
    name: &str,
    ready: mpsc::Sender<Result<(), String>>,
    sink: &Channel<CaptureEvent>,
    stop: &AtomicBool,
) {
    let mut ready = Some(ready);
    let mut backoff = FIRST_BACKOFF;
    let mut watch = target.map(|pid| ProcessWatch::new(pid, exe));
    while !stop.load(Ordering::Relaxed) {
        let Some(pid) = target else {
            if let Some(tx) = ready.take() {
                let _ = tx.send(Ok(()));
            }
            status(sink, CHANNEL_SYSTEM, "lost", name);
            if !wait_for_app(&mut target, &mut watch, pid_hint, exe, &mut backoff, stop) {
                return;
            }
            continue;
        };
        match unsafe { open(pid) } {
            Ok((client, capture, event)) => {
                backoff = FIRST_BACKOFF;
                let state = match ready.take() {
                    Some(tx) => {
                        let _ = tx.send(Ok(()));
                        "active"
                    }
                    None => "restored",
                };
                status(sink, CHANNEL_SYSTEM, state, name);
                let ended = unsafe {
                    pump(
                        &client,
                        &capture,
                        event,
                        Flow::Output,
                        CHANNEL_SYSTEM,
                        sink,
                        stop,
                        || watch.as_ref().is_some_and(ProcessWatch::exited),
                    )
                };
                unsafe {
                    let _ = client.Stop();
                    let _ = CloseHandle(event);
                }
                match ended {
                    Ended::Stopped => break,
                    Ended::Switch => eprintln!("orbit: {name} quit; waiting for it to start again"),
                    Ended::Lost(why) => {
                        eprintln!("orbit: app audio stream lost ({why}); reopening")
                    }
                }
            }
            Err(e) => {
                if let Some(tx) = ready.take() {
                    let _ = tx.send(Err(format!("App audio unavailable: {e}")));
                    return;
                }
                eprintln!("orbit: app audio didn't reopen ({e}); retrying");
            }
        }
        status(sink, CHANNEL_SYSTEM, "lost", name);
        if !wait_for_app(&mut target, &mut watch, pid_hint, exe, &mut backoff, stop) {
            return;
        }
    }
}

/// Sleeps (with backoff) until there's something to capture again: the same process while it still runs (the stream
/// failed, not the app), else the app wherever it (re)started. False if stopped meanwhile.
fn wait_for_app(
    target: &mut Option<u32>,
    watch: &mut Option<ProcessWatch>,
    pid_hint: u32,
    exe: &str,
    backoff: &mut Duration,
    stop: &AtomicBool,
) -> bool {
    loop {
        thread::sleep(*backoff);
        *backoff = (*backoff * 2).min(MAX_BACKOFF);
        if stop.load(Ordering::Relaxed) {
            return false;
        }
        if watch.as_ref().is_some_and(|w| !w.exited()) {
            return true;
        }
        if let Some(next) = locate(target.unwrap_or(pid_hint), exe) {
            *target = Some(next);
            *watch = Some(ProcessWatch::new(next, exe));
            return true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{find_target, group_apps, group_levels, root_process, AppLevel};
    use std::collections::HashMap;

    fn table(rows: &[(u32, u32, &str)]) -> HashMap<u32, (u32, String)> {
        rows.iter()
            .map(|(pid, ppid, exe)| (*pid, (*ppid, (*exe).to_string())))
            .collect()
    }

    #[test]
    fn browser_helpers_map_to_the_main_browser_process() {
        let t = table(&[
            (1, 0, "explorer.exe"),
            (10, 1, "chrome.exe"),
            (11, 10, "chrome.exe"),
            (12, 11, "chrome.exe"),
        ]);
        assert_eq!(root_process(12, &t), 10);
    }

    #[test]
    fn teams_webview_maps_to_teams() {
        let t = table(&[
            (1, 0, "explorer.exe"),
            (20, 1, "ms-teams.exe"),
            (21, 20, "msedgewebview2.exe"),
            (22, 21, "msedgewebview2.exe"),
        ]);
        assert_eq!(root_process(22, &t), 20);
    }

    #[test]
    fn never_climbs_into_an_unrelated_launcher() {
        // zoom started from a terminal must not be grouped with the terminal (or Orbit, or a game)
        let t = table(&[
            (1, 0, "explorer.exe"),
            (30, 1, "WindowsTerminal.exe"),
            (31, 30, "pwsh.exe"),
            (32, 31, "Zoom.exe"),
            (33, 31, "orbit-desktop.exe"),
            (34, 33, "msedgewebview2.exe"),
        ]);
        assert_eq!(root_process(32, &t), 32);
        assert_eq!(root_process(34, &t), 33); // Orbit's own webview maps to Orbit, which the list skips
    }

    #[test]
    fn missing_or_system_parents_stop_the_walk() {
        let t = table(&[(40, 4, "svchost.exe"), (41, 999, "game.exe")]);
        assert_eq!(root_process(40, &t), 40);
        assert_eq!(root_process(41, &t), 41);
    }

    fn system() -> HashMap<u32, (u32, String)> {
        table(&[
            (1, 0, "explorer.exe"),
            (10, 1, "chrome.exe"),
            (11, 10, "chrome.exe"),
            (20, 1, "ms-teams.exe"),
            (21, 20, "msedgewebview2.exe"),
            (30, 1, "slack.exe"),
            (40, 1, "orbit-desktop.exe"),
            (41, 40, "msedgewebview2.exe"),
        ])
    }

    #[test]
    fn apps_merge_across_output_devices() {
        // Chrome: an idle session on the speakers, the call on the headset. Teams idle; Slack idle; Orbit playing.
        let sessions = [
            (11, false),
            (11, true),
            (21, false),
            (30, false),
            (41, true),
        ];
        let apps = group_apps(&sessions, &system(), 40);
        let got: Vec<(u32, &str, bool)> = apps
            .iter()
            .map(|a| (a.pid, a.name.as_str(), a.active))
            .collect();
        assert_eq!(
            got,
            vec![
                (10, "Google Chrome", true),
                (20, "Microsoft Teams", false),
                (30, "Slack", false),
            ]
        );
    }

    #[test]
    fn an_apps_level_is_its_loudest_session_and_orbit_is_left_out() {
        // Chrome's speakers session is quiet, its headset session loud; Orbit's own sound never shows.
        let sessions = [(11, 0.05), (11, 0.6), (21, 0.0), (41, 0.9), (30, 1.7)];
        let levels = group_levels(&sessions, &system(), 40);
        assert_eq!(
            levels,
            vec![
                AppLevel { pid: 10, peak: 0.6 },
                AppLevel { pid: 20, peak: 0.0 },
                AppLevel { pid: 30, peak: 1.0 },
            ]
        );
    }

    #[test]
    fn a_running_app_keeps_its_process() {
        assert_eq!(
            find_target(20, "MS-Teams.exe", &system(), &[], 40),
            Some(20)
        );
    }

    #[test]
    fn a_restarted_app_is_found_by_exe() {
        // Zoom 50 quit; Zoom came back as 60 (idle) and a second instance 70 is in the call.
        let t = table(&[
            (1, 0, "explorer.exe"),
            (60, 1, "Zoom.exe"),
            (70, 1, "Zoom.exe"),
            (71, 70, "Zoom.exe"),
            (80, 1, "chrome.exe"),
        ]);
        assert_eq!(
            find_target(50, "zoom.exe", &t, &[(60, false), (71, true)], 0),
            Some(70)
        );
        // nothing playing: one with a session beats one without; else the lowest pid
        assert_eq!(find_target(50, "zoom.exe", &t, &[(70, false)], 0), Some(70));
        assert_eq!(find_target(50, "zoom.exe", &t, &[], 0), Some(60));
    }

    #[test]
    fn a_reused_pid_is_not_the_app() {
        // pid 20 now belongs to another program: follow the exe instead (or report it gone)
        let t = table(&[
            (1, 0, "explorer.exe"),
            (20, 1, "notepad.exe"),
            (90, 1, "ms-teams.exe"),
        ]);
        assert_eq!(find_target(20, "ms-teams.exe", &t, &[], 0), Some(90));
        assert_eq!(find_target(20, "zoom.exe", &t, &[], 0), None);
    }

    #[test]
    fn never_targets_orbit_itself() {
        assert_eq!(
            find_target(999, "orbit-desktop.exe", &system(), &[(41, true)], 40),
            None
        );
    }
}
