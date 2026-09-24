//! Windows endpoint capture (WASAPI, shared mode): the microphone, and loopback of an output device.
//!
//! Replaces cpal on Windows for three reasons:
//! - Devices are addressed by their stable MMDevice endpoint ID, not the friendly name (two identical USB
//!   mics, or a renamed device, are otherwise indistinguishable).
//! - Recovery: when the device disappears, is invalidated (unplugged headset, Bluetooth drop, format change) or
//!   Windows switches the default, capture reopens by itself — on the same device if it comes back, else the
//!   default — instead of dying silently for the rest of the interview.
//! - Windows converts to 16 kHz mono itself (AUTOCONVERTPCM + SRC_DEFAULT_QUALITY), so no hand-rolled
//!   resampler sits in the path.
//!
//! Output can be the default multimedia device, the default *communications* device (Teams/Zoom often play
//! calls there, e.g. through a headset while music goes to the speakers), or a specific endpoint.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::ipc::Channel;
use windows::core::{HSTRING, PWSTR};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    eCapture, eCommunications, eConsole, eRender, EDataFlow, IAudioCaptureClient, IAudioClient,
    IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT,
    AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK,
    AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, DEVICE_STATE_ACTIVE, WAVEFORMATEX, WAVE_FORMAT_PCM,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

use crate::audio::{encode_frame, CaptureEvent, FRAME_SAMPLES, TARGET_RATE};

/// How often a stream following the default device checks whether Windows switched it.
const DEFAULT_CHECK: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(2);
/// No packet for this long on a loopback stream means nothing is playing: feed silence so the transcriber
/// hears the pause (end-of-speech detection needs it) and the audio timeline keeps pace with the clock.
const SILENCE_GAP: Duration = Duration::from_millis(100);

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Flow {
    Microphone,
    /// Loopback of an output (render) device.
    Output,
}

/// Which endpoint to open. `Id` falls back to the default when that device isn't present.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Choice {
    Default,
    Communications,
    Id(String),
}

impl Choice {
    /// "default" | "communications" | an endpoint id. A legacy saved friendly name is also an `Id` here; it
    /// won't resolve as an endpoint id and is then matched by name (see `resolve`).
    pub fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            None | Some("") | Some("default") => Choice::Default,
            Some("communications") => Choice::Communications,
            Some(id) => Choice::Id(id.to_string()),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub is_communications: bool,
}

struct Com(bool);
impl Com {
    fn init() -> Self {
        Com(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
    }
}
impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

fn data_flow(flow: Flow) -> EDataFlow {
    match flow {
        Flow::Microphone => eCapture,
        Flow::Output => eRender,
    }
}

unsafe fn take_pwstr(p: PWSTR) -> String {
    let s = p.to_string().unwrap_or_default();
    CoTaskMemFree(Some(p.0 as _));
    s
}

unsafe fn device_id(device: &IMMDevice) -> windows::core::Result<String> {
    Ok(take_pwstr(device.GetId()?))
}

unsafe fn device_name(device: &IMMDevice) -> String {
    let read = || -> windows::core::Result<String> {
        let store = device.OpenPropertyStore(STGM_READ)?;
        let value = store.GetValue(&PKEY_Device_FriendlyName)?;
        Ok(take_pwstr(PropVariantToStringAlloc(&value)?))
    };
    read().unwrap_or_else(|_| "Unknown device".into())
}

unsafe fn default_id(enumr: &IMMDeviceEnumerator, flow: Flow, comms: bool) -> Option<String> {
    let role = if comms { eCommunications } else { eConsole };
    enumr
        .GetDefaultAudioEndpoint(data_flow(flow), role)
        .ok()
        .and_then(|d| device_id(&d).ok())
}

/// Active endpoints for `flow`, with which one is the default (multimedia) and default communications device.
pub fn list(flow: Flow) -> Result<Vec<Endpoint>, String> {
    let _com = Com::init();
    unsafe {
        let enumr: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("Couldn't list audio devices: {e}"))?;
        let default = default_id(&enumr, flow, false);
        let comms = default_id(&enumr, flow, true);
        let collection = enumr
            .EnumAudioEndpoints(data_flow(flow), DEVICE_STATE_ACTIVE)
            .map_err(|e| format!("Couldn't list audio devices: {e}"))?;
        let mut out = Vec::new();
        for i in 0..collection.GetCount().unwrap_or(0) {
            let Ok(device) = collection.Item(i) else {
                continue;
            };
            let Ok(id) = device_id(&device) else { continue };
            out.push(Endpoint {
                is_default: default.as_deref() == Some(id.as_str()),
                is_communications: comms.as_deref() == Some(id.as_str()),
                name: device_name(&device),
                id,
            });
        }
        out.sort_by(|a, b| {
            b.is_default
                .cmp(&a.is_default)
                .then_with(|| a.name.cmp(&b.name))
        });
        Ok(out)
    }
}

/// The device to open for `choice`, plus whether it had to fall back to the default.
unsafe fn resolve(
    enumr: &IMMDeviceEnumerator,
    flow: Flow,
    choice: &Choice,
) -> windows::core::Result<(IMMDevice, bool)> {
    let default_for = |comms: bool| {
        enumr.GetDefaultAudioEndpoint(
            data_flow(flow),
            if comms { eCommunications } else { eConsole },
        )
    };
    match choice {
        Choice::Default => Ok((default_for(false)?, false)),
        Choice::Communications => Ok((default_for(true)?, false)),
        Choice::Id(id) => {
            if let Ok(device) = enumr.GetDevice(&HSTRING::from(id.as_str())) {
                // GetDevice also returns unplugged/disabled endpoints; only an active one can be opened.
                if device
                    .GetState()
                    .map(|s| s == DEVICE_STATE_ACTIVE)
                    .unwrap_or(false)
                {
                    return Ok((device, false));
                }
            }
            // Legacy settings saved the friendly name as the id.
            if let Ok(collection) = enumr.EnumAudioEndpoints(data_flow(flow), DEVICE_STATE_ACTIVE) {
                for i in 0..collection.GetCount().unwrap_or(0) {
                    if let Ok(device) = collection.Item(i) {
                        if device_name(&device) == *id {
                            return Ok((device, false));
                        }
                    }
                }
            }
            Ok((default_for(false)?, true))
        }
    }
}

/// Why a stream stopped.
enum Ended {
    Stopped,
    /// The device went away or errored: reopen after a pause.
    Lost(String),
    /// Following the default, and Windows switched it: reopen immediately.
    DefaultChanged,
}

fn status(sink: &Channel<CaptureEvent>, channel: u8, state: &str, device: &str) {
    let _ = sink.send(CaptureEvent::Status {
        channel,
        state: state.to_string(),
        device: device.to_string(),
    });
}

/// Capture `flow`/`choice` on `channel` until `stop`, reopening across device loss and default switches.
/// Returns once the first open succeeded (or failed, with the error).
pub fn spawn(
    flow: Flow,
    choice: Choice,
    channel: u8,
    sink: Channel<CaptureEvent>,
    stop: Arc<AtomicBool>,
) -> Result<thread::JoinHandle<()>, String> {
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let label = if flow == Flow::Microphone {
        "Microphone"
    } else {
        "System audio"
    };
    let handle = thread::Builder::new()
        .name(format!("orbit-wasapi-{channel}"))
        .spawn(move || {
            let _com = Com::init();
            let enumr: IMMDeviceEnumerator =
                match unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) } {
                    Ok(e) => e,
                    Err(e) => {
                        let _ = ready_tx.send(Err(format!("{label} unavailable: {e}")));
                        return;
                    }
                };
            let mut ready = Some(ready_tx);
            let mut backoff = Duration::from_millis(250);
            let mut last_device = String::new();
            while !stop.load(Ordering::Relaxed) {
                let opened =
                    unsafe { resolve(&enumr, flow, &choice) }.and_then(|(device, fell_back)| {
                        let id = unsafe { device_id(&device) }?;
                        Ok((device, id, fell_back))
                    });
                let (device, id, fell_back) = match opened {
                    Ok(v) => v,
                    Err(e) => {
                        let msg = format!("{label} unavailable: no device ({e})");
                        if let Some(tx) = ready.take() {
                            let _ = tx.send(Err(msg));
                            return;
                        }
                        status(&sink, channel, "lost", "");
                        thread::sleep(backoff);
                        backoff = (backoff * 2).min(MAX_BACKOFF);
                        continue;
                    }
                };
                let name = unsafe { device_name(&device) };
                match unsafe { open_client(&device, flow) } {
                    Ok((client, capture, event)) => {
                        backoff = Duration::from_millis(250);
                        let state = if let Some(tx) = ready.take() {
                            let _ = tx.send(Ok(()));
                            if fell_back {
                                "fallback"
                            } else {
                                "active"
                            }
                        } else if fell_back {
                            "fallback"
                        } else if last_device == id {
                            "restored"
                        } else {
                            "switched"
                        };
                        status(&sink, channel, state, &name);
                        last_device = id.clone();
                        // Default/communications: follow Windows' current choice. An explicit device we had to
                        // replace with the default: switch back as soon as it's present again.
                        let follow = match &choice {
                            Choice::Default => Some(false),
                            Choice::Communications => Some(true),
                            Choice::Id(_) => None,
                        };
                        let ended = unsafe {
                            pump(
                                &client,
                                &capture,
                                event,
                                flow,
                                channel,
                                &sink,
                                &stop,
                                || match follow {
                                    Some(comms) => {
                                        default_id(&enumr, flow, comms).is_some_and(|d| d != id)
                                    }
                                    None => {
                                        fell_back
                                            && resolve(&enumr, flow, &choice)
                                                .map(|(_, still_fallback)| !still_fallback)
                                                .unwrap_or(false)
                                    }
                                },
                            )
                        };
                        unsafe {
                            let _ = client.Stop();
                            let _ = CloseHandle(event);
                        }
                        match ended {
                            Ended::Stopped => break,
                            Ended::DefaultChanged => continue,
                            Ended::Lost(why) => {
                                eprintln!("orbit: {label} stream lost ({why}); reopening");
                                status(&sink, channel, "lost", &name);
                                thread::sleep(backoff);
                                backoff = (backoff * 2).min(MAX_BACKOFF);
                            }
                        }
                    }
                    Err(e) => {
                        let msg = format!("{label} unavailable: {e}");
                        if let Some(tx) = ready.take() {
                            let _ = tx.send(Err(msg));
                            return;
                        }
                        status(&sink, channel, "lost", &name);
                        thread::sleep(backoff);
                        backoff = (backoff * 2).min(MAX_BACKOFF);
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;
    match ready_rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(())) => Ok(handle),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(format!("{label} didn't start")),
    }
}

unsafe fn open_client(
    device: &IMMDevice,
    flow: Flow,
) -> Result<
    (
        IAudioClient,
        IAudioCaptureClient,
        windows::Win32::Foundation::HANDLE,
    ),
    String,
> {
    let client: IAudioClient = device
        .Activate(CLSCTX_ALL, None)
        .map_err(|e| e.to_string())?;
    // Ask for the transcriber's format directly; the audio engine converts (channel mix + quality SRC).
    let format = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: 1,
        nSamplesPerSec: TARGET_RATE,
        wBitsPerSample: 16,
        nBlockAlign: 2,
        nAvgBytesPerSec: TARGET_RATE * 2,
        cbSize: 0,
    };
    let mut flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK
        | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
        | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
    if flow == Flow::Output {
        flags |= AUDCLNT_STREAMFLAGS_LOOPBACK;
    }
    client
        .Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 1_000_000, 0, &format, None)
        .map_err(|e| format!("couldn't open the device: {e}"))?;
    let event = CreateEventW(None, false, false, None).map_err(|e| e.to_string())?;
    let setup = || -> Result<IAudioCaptureClient, String> {
        client.SetEventHandle(event).map_err(|e| e.to_string())?;
        let capture: IAudioCaptureClient = client.GetService().map_err(|e| e.to_string())?;
        client.Start().map_err(|e| e.to_string())?;
        Ok(capture)
    };
    match setup() {
        Ok(capture) => Ok((client, capture, event)),
        Err(e) => {
            let _ = CloseHandle(event);
            Err(e)
        }
    }
}

#[allow(clippy::too_many_arguments)]
unsafe fn pump(
    _client: &IAudioClient,
    capture: &IAudioCaptureClient,
    event: windows::Win32::Foundation::HANDLE,
    flow: Flow,
    channel: u8,
    sink: &Channel<CaptureEvent>,
    stop: &AtomicBool,
    should_switch: impl Fn() -> bool,
) -> Ended {
    let mut pending: Vec<i16> = Vec::with_capacity(FRAME_SAMPLES * 2);
    let mut last_check = Instant::now();
    let mut last_data = Instant::now();
    let emit = |pending: &mut Vec<i16>| {
        while pending.len() >= FRAME_SAMPLES {
            let chunk: Vec<i16> = pending.drain(..FRAME_SAMPLES).collect();
            let _ = sink.send(encode_frame(channel, &chunk));
        }
    };
    while !stop.load(Ordering::Relaxed) {
        let signalled = WaitForSingleObject(event, 100) == WAIT_OBJECT_0;
        loop {
            let packet = match capture.GetNextPacketSize() {
                Ok(n) => n,
                Err(e) => return Ended::Lost(e.message()), // e.g. AUDCLNT_E_DEVICE_INVALIDATED
            };
            if packet == 0 {
                break;
            }
            let mut data: *mut u8 = std::ptr::null_mut();
            let mut frames = 0u32;
            let mut flags = 0u32;
            if let Err(e) = capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None) {
                return Ended::Lost(e.message());
            }
            let n = frames as usize;
            // Never build a slice over a silent/null buffer (see process_loopback.rs).
            if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() || n == 0 {
                pending.resize(pending.len() + n, 0);
            } else {
                pending.extend_from_slice(std::slice::from_raw_parts(data as *const i16, n));
            }
            let _ = capture.ReleaseBuffer(frames);
            last_data = Instant::now();
            emit(&mut pending);
        }
        if flow == Flow::Output && !signalled && last_data.elapsed() >= SILENCE_GAP {
            let gap = last_data.elapsed();
            let samples = (gap.as_millis() as usize) * (TARGET_RATE as usize) / 1000;
            pending.resize(pending.len() + samples, 0);
            last_data = Instant::now();
            emit(&mut pending);
        }
        if last_check.elapsed() >= DEFAULT_CHECK {
            last_check = Instant::now();
            if should_switch() {
                return Ended::DefaultChanged;
            }
        }
    }
    Ended::Stopped
}

#[cfg(test)]
mod tests {
    use super::Choice;

    #[test]
    fn choices_parse_from_saved_settings() {
        assert_eq!(Choice::parse(None), Choice::Default);
        assert_eq!(Choice::parse(Some("")), Choice::Default);
        assert_eq!(Choice::parse(Some("default")), Choice::Default);
        assert_eq!(
            Choice::parse(Some("communications")),
            Choice::Communications
        );
        let id = "{0.0.1.00000000}.{8f5c0e2a-1b1c-4c1e-9b8d-3c1f2e5a6b7c}";
        assert_eq!(Choice::parse(Some(id)), Choice::Id(id.into()));
        // a legacy friendly name is carried as an id and matched by name when opening
        assert_eq!(
            Choice::parse(Some("Microphone (Realtek)")),
            Choice::Id("Microphone (Realtek)".into())
        );
    }
}
