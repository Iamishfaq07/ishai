//! Windows per-application audio capture (WASAPI *process loopback*, Windows 10 2004+ / Windows 11).
//!
//! Captures only what one process tree plays — e.g. Zoom, Teams or the browser running the meeting —
//! instead of every sound on the PC. Whole-system loopback picks up games, videos and notifications,
//! which pollutes the interviewer transcript and keeps the speech-to-text VAD from hearing silence.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use windows::core::{implement, Interface, Ref, HRESULT};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    eConsole, eRender, ActivateAudioInterfaceAsync, AudioSessionStateActive, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl, IAudioCaptureClient,
    IAudioClient, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
    AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
    VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, WAVEFORMATEX, WAVE_FORMAT_PCM,
};
use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, BLOB, CLSCTX_ALL, COINIT_MULTITHREADED};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject};
use windows::Win32::System::Variant::VT_BLOB;

use crate::audio::{encode_frame, to_i16, CaptureEvent, Resampler, CHANNEL_SYSTEM, FRAME_SAMPLES, TARGET_RATE};

const CAPTURE_RATE: u32 = 48_000;
const CAPTURE_CHANNELS: u16 = 2;

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
        .unwrap_or_else(|| exe.trim_end_matches(".exe").trim_end_matches(".EXE").to_string())
}

/// pid → (parent pid, exe name) for every running process.
fn process_table() -> HashMap<u32, (u32, String)> {
    let mut table = HashMap::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return table };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
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
        let Some((parent, exe)) = table.get(&current) else { break };
        let Some((_, parent_exe)) = table.get(parent) else { break };
        let same_program = parent_exe.eq_ignore_ascii_case(exe);
        let embedded_webview = exe.eq_ignore_ascii_case("msedgewebview2.exe") && !parent_exe.eq_ignore_ascii_case("explorer.exe");
        if *parent <= 4 || !(same_program || embedded_webview) {
            break;
        }
        current = *parent;
    }
    current
}

/// Apps that currently hold an audio session on the default output device, grouped by process tree.
#[tauri::command]
pub fn list_audio_apps() -> Result<Vec<AudioApp>, String> {
    unsafe {
        let com = CoInitializeEx(None, COINIT_MULTITHREADED);
        let result = (|| -> windows::core::Result<Vec<AudioApp>> {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
            let sessions = manager.GetSessionEnumerator()?;
            let table = process_table();
            let own_root = root_process(std::process::id(), &table);
            let mut apps: HashMap<u32, AudioApp> = HashMap::new();
            for i in 0..sessions.GetCount()? {
                let control: IAudioSessionControl2 = sessions.GetSession(i)?.cast()?;
                let pid = control.GetProcessId().unwrap_or(0);
                if pid == 0 {
                    continue; // system sounds
                }
                let root = root_process(pid, &table);
                if root == own_root {
                    continue; // never offer to capture Orbit itself
                }
                let exe = table.get(&root).map(|(_, e)| e.clone()).unwrap_or_else(|| format!("pid {root}"));
                let active = control.GetState().map(|s| s == AudioSessionStateActive).unwrap_or(false);
                apps.entry(root)
                    .and_modify(|a| a.active |= active)
                    .or_insert(AudioApp { pid: root, name: friendly_name(&exe), exe, active });
            }
            let mut list: Vec<AudioApp> = apps.into_values().collect();
            list.sort_by(|a, b| b.active.cmp(&a.active).then_with(|| a.name.cmp(&b.name)));
            Ok(list)
        })();
        if com.is_ok() {
            CoUninitialize();
        }
        result.map_err(|e| format!("Couldn't list audio apps: {e}"))
    }
}

/// Signals a Win32 event when activation completes. Holds only a raw HANDLE: nothing in this COM
/// object needs Rust-side cleanup, so however the system releases it, no Rust memory is freed twice.
#[implement(IActivateAudioInterfaceCompletionHandler)]
struct ActivationHandler {
    done: HANDLE,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationHandler_Impl {
    fn ActivateCompleted(&self, _op: Ref<'_, IActivateAudioInterfaceAsyncOperation>) -> windows::core::Result<()> {
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
    .map_err(|e| format!("Couldn't start app audio capture: {e}"))?;
    let waited = WaitForSingleObject(done, 5000);
    let _ = CloseHandle(done); // handler may still fire; it SetEvents a closed handle harmlessly
    if waited != WAIT_OBJECT_0 {
        return Err("App audio capture timed out".to_string());
    }
    let mut hr = HRESULT(0);
    let mut unknown = None;
    operation.GetActivateResult(&mut hr, &mut unknown).map_err(|e| e.to_string())?;
    hr.ok().map_err(|e| format!("App audio capture was refused: {e}"))?;
    // `params`/`prop` (referenced by the blob) have outlived the completed async activation.
    unknown.ok_or("No audio client returned")?.cast::<IAudioClient>().map_err(|e| e.to_string())
}

/// Starts capturing `pid`'s process tree on its own COM thread. Returns once capture is running
/// (or failed); the thread exits when `stop` is set.
pub fn spawn(pid: u32, sink: Channel<CaptureEvent>, stop: Arc<AtomicBool>) -> Result<thread::JoinHandle<()>, String> {
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let handle = thread::Builder::new()
        .name("orbit-app-audio".into())
        .spawn(move || unsafe {
            let com = CoInitializeEx(None, COINIT_MULTITHREADED);
            let run = || -> Result<(), String> {
                let client = activate_process_loopback(pid)?;
                let format = WAVEFORMATEX {
                    wFormatTag: WAVE_FORMAT_PCM as u16,
                    nChannels: CAPTURE_CHANNELS,
                    nSamplesPerSec: CAPTURE_RATE,
                    wBitsPerSample: 16,
                    nBlockAlign: CAPTURE_CHANNELS * 2,
                    nAvgBytesPerSec: CAPTURE_RATE * u32::from(CAPTURE_CHANNELS) * 2,
                    cbSize: 0,
                };
                client
                    .Initialize(
                        AUDCLNT_SHAREMODE_SHARED,
                        AUDCLNT_STREAMFLAGS_LOOPBACK
                            | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                            | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                            | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                        1_000_000, // 100 ms buffer (100-ns units)
                        0,
                        &format,
                        None,
                    )
                    .map_err(|e| format!("App audio init failed: {e}"))?;
                let event = CreateEventW(None, false, false, None).map_err(|e| e.to_string())?;
                client.SetEventHandle(event).map_err(|e| e.to_string())?;
                let capture: IAudioCaptureClient = client.GetService().map_err(|e| e.to_string())?;
                client.Start().map_err(|e| e.to_string())?;
                let _ = ready_tx.send(Ok(()));

                let mut resampler = Resampler::new(CAPTURE_RATE, TARGET_RATE);
                let mut pending: Vec<i16> = Vec::with_capacity(FRAME_SAMPLES * 2);
                while !stop.load(Ordering::Relaxed) {
                    if WaitForSingleObject(event, 100) != WAIT_OBJECT_0 {
                        continue;
                    }
                    loop {
                        let packet = capture.GetNextPacketSize().unwrap_or(0);
                        if packet == 0 {
                            break;
                        }
                        let mut data: *mut u8 = std::ptr::null_mut();
                        let mut frames = 0u32;
                        let mut flags = 0u32;
                        if capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None).is_err() {
                            break;
                        }
                        let silent = flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null();
                        let samples = std::slice::from_raw_parts(data as *const i16,
                                                                 frames as usize * usize::from(CAPTURE_CHANNELS));
                        for i in 0..frames as usize {
                            let mono = if silent {
                                0.0
                            } else {
                                let l = f32::from(samples[i * 2]) / 32768.0;
                                let r = f32::from(samples[i * 2 + 1]) / 32768.0;
                                (l + r) * 0.5
                            };
                            resampler.push(mono, |v| pending.push(to_i16(v)));
                        }
                        let _ = capture.ReleaseBuffer(frames);
                        while pending.len() >= FRAME_SAMPLES {
                            let chunk: Vec<i16> = pending.drain(..FRAME_SAMPLES).collect();
                            let _ = sink.send(encode_frame(CHANNEL_SYSTEM, &chunk));
                        }
                    }
                }
                let _ = client.Stop();
                let _ = CloseHandle(event);
                Ok(())
            };
            if let Err(e) = run() {
                let _ = ready_tx.send(Err(e.clone()));
                let _ = sink.send(CaptureEvent::Error { channel: CHANNEL_SYSTEM, message: e });
            }
            if com.is_ok() {
                CoUninitialize();
            }
        })
        .map_err(|e| e.to_string())?;
    match ready_rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(())) => Ok(handle),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("App audio capture didn't start".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::root_process;
    use std::collections::HashMap;

    fn table(rows: &[(u32, u32, &str)]) -> HashMap<u32, (u32, String)> {
        rows.iter().map(|(pid, ppid, exe)| (*pid, (*ppid, (*exe).to_string()))).collect()
    }

    #[test]
    fn browser_helpers_map_to_the_main_browser_process() {
        let t = table(&[(1, 0, "explorer.exe"), (10, 1, "chrome.exe"), (11, 10, "chrome.exe"), (12, 11, "chrome.exe")]);
        assert_eq!(root_process(12, &t), 10);
    }

    #[test]
    fn teams_webview_maps_to_teams() {
        let t = table(&[(1, 0, "explorer.exe"), (20, 1, "ms-teams.exe"), (21, 20, "msedgewebview2.exe"),
                        (22, 21, "msedgewebview2.exe")]);
        assert_eq!(root_process(22, &t), 20);
    }

    #[test]
    fn never_climbs_into_an_unrelated_launcher() {
        // zoom started from a terminal must not be grouped with the terminal (or Orbit, or a game)
        let t = table(&[(1, 0, "explorer.exe"), (30, 1, "WindowsTerminal.exe"), (31, 30, "pwsh.exe"),
                        (32, 31, "Zoom.exe"), (33, 31, "orbit-desktop.exe"), (34, 33, "msedgewebview2.exe")]);
        assert_eq!(root_process(32, &t), 32);
        assert_eq!(root_process(34, &t), 33); // Orbit's own webview maps to Orbit, which the list skips
    }

    #[test]
    fn missing_or_system_parents_stop_the_walk() {
        let t = table(&[(40, 4, "svchost.exe"), (41, 999, "game.exe")]);
        assert_eq!(root_process(40, &t), 40);
        assert_eq!(root_process(41, &t), 41);
    }
}
