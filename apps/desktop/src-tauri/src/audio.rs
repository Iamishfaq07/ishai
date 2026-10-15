//! Microphone + system-audio capture.
//!
//! Each source is captured as its own channel (0 = mic/candidate, 1 = system/interviewer),
//! down-mixed to mono, resampled to 16 kHz, converted to PCM16LE and streamed to the webview
//! over a Tauri `Channel`. The webview forwards frames to the Orbit API; nothing is stored.
//!
//! cpal streams are `!Send`, so they live on a dedicated thread that parks until `stop_capture`.
//!
//! System audio:
//! - Windows: WASAPI loopback of an output device (wasapi_capture.rs) or of one app (process_loopback.rs).
//! - macOS: requires ScreenCaptureKit (not implemented yet) — reported explicitly, never faked.
//! - Linux: not supported yet (would use a PulseAudio/PipeWire monitor source).
//!
//! The commands are async and do their blocking work (COM, opening devices: up to 8 s per channel) on the blocking
//! pool, so the window keeps painting and taking input meanwhile.

use std::sync::{mpsc, Mutex, MutexGuard};
use std::thread;

use base64::Engine;
use cpal::traits::StreamTrait;
#[cfg(not(target_os = "windows"))]
use cpal::traits::{DeviceTrait, HostTrait};
#[cfg(not(target_os = "windows"))]
use cpal::{FromSample, Sample, SizedSample};
use serde::Serialize;
use tauri::ipc::Channel;

pub(crate) const TARGET_RATE: u32 = 16_000;
/// 50 ms of 16 kHz audio per frame.
pub(crate) const FRAME_SAMPLES: usize = 800;
const CHANNEL_MIC: u8 = 0;
pub(crate) const CHANNEL_SYSTEM: u8 = 1;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    /// Windows: the stable MMDevice endpoint id. Elsewhere: the device name.
    id: String,
    name: String,
    is_default: bool,
    is_communications: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureInfo {
    mic: bool,
    system: bool,
    mic_error: Option<String>,
    system_error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CaptureEvent {
    /// `pcm`: base64 PCM16LE mono 16 kHz. `rms`: 0..1 for level meters.
    Frame { channel: u8, pcm: String, rms: f32 },
    /// A stream error the cpal path (not Windows) can't recover from. Windows reports trouble as `Status` and
    /// recovers by itself.
    #[cfg_attr(target_os = "windows", allow(dead_code))]
    Error { channel: u8, message: String },
    /// Device lifecycle (Windows): `active` | `fallback` (chosen device missing, using the default) |
    /// `lost` (reopening) | `restored` | `switched` (Windows changed the default), with the device in use.
    /// One app's capture reports the same states with the app's name: `lost` when its stream fails or the app
    /// quits, `restored` once it's captured again (on the same process, or where the app restarted).
    Status {
        channel: u8,
        state: String,
        device: String,
    },
}

/// Which capture owns the audio devices. Captures are told apart by an id the webview picks, so a late stop from
/// one screen (the setup's audio test, unmounting) can't end the capture the next one (the live session) just
/// started — and the id is known before the start returns, so a capture can be stopped while it's still opening.
#[derive(Default)]
pub struct CaptureState(Mutex<Slot>);

#[derive(Default)]
struct Slot {
    current: Option<Running>,
    /// The updater is handing over to the installer, which closes Orbit: no capture may start any more.
    installing: bool,
}

struct Running {
    id: u64,
    /// None while the capture is still opening its devices.
    stop: Option<mpsc::Sender<()>>,
}

impl CaptureState {
    fn slot(&self) -> MutexGuard<'_, Slot> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// True while a capture is starting or running (a live session, or the audio test, is listening).
    pub fn is_active(&self) -> bool {
        self.slot().current.is_some()
    }

    /// Claims the devices for capture `id`, stopping whatever had them. Refused once an update is installing.
    fn begin(&self, id: u64) -> Result<(), String> {
        let mut slot = self.slot();
        if slot.installing {
            return Err("Orbit is restarting to finish an update.".into());
        }
        if let Some(Running { stop: Some(tx), .. }) = slot.current.take() {
            let _ = tx.send(());
        }
        slot.current = Some(Running { id, stop: None });
        Ok(())
    }

    /// Capture `id` is running: keep its stop switch — unless it was stopped or replaced while opening, in which
    /// case it stops now and this returns false.
    fn started(&self, id: u64, stop: mpsc::Sender<()>) -> bool {
        let mut slot = self.slot();
        match slot.current.as_mut() {
            Some(running) if running.id == id => {
                running.stop = Some(stop);
                true
            }
            _ => {
                let _ = stop.send(());
                false
            }
        }
    }

    /// Stops capture `id` (`None`: whichever is running). Does nothing if another capture has replaced it.
    fn stop(&self, id: Option<u64>) {
        let mut slot = self.slot();
        let matches = match (&slot.current, id) {
            (Some(running), Some(id)) => running.id == id,
            (Some(_), None) => true,
            (None, _) => false,
        };
        if matches {
            if let Some(Running { stop: Some(tx), .. }) = slot.current.take() {
                let _ = tx.send(());
            }
        }
    }

    /// For the updater, just before it runs the installer (which closes Orbit): true if nothing is capturing, and
    /// from then on no capture can start. `end_install` undoes it if the installer didn't start.
    pub fn begin_install(&self) -> bool {
        let mut slot = self.slot();
        if slot.current.is_some() {
            return false;
        }
        slot.installing = true;
        true
    }

    pub fn end_install(&self) {
        self.slot().installing = false;
    }
}

#[cfg(target_os = "windows")]
fn endpoints(flow: crate::wasapi_capture::Flow) -> Result<Vec<AudioDevice>, String> {
    Ok(crate::wasapi_capture::list(flow)?
        .into_iter()
        .map(|e| AudioDevice {
            id: e.id,
            name: e.name,
            is_default: e.is_default,
            is_communications: e.is_communications,
        })
        .collect())
}

/// Runs blocking device work on the blocking pool (see the module docs).
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

/// Microphones.
#[tauri::command]
pub async fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    blocking(|| {
        #[cfg(target_os = "windows")]
        return endpoints(crate::wasapi_capture::Flow::Microphone);
        #[cfg(not(target_os = "windows"))]
        list_cpal_inputs()
    })
    .await
}

/// Output devices whose sound can be captured (loopback). Windows only.
#[tauri::command]
pub async fn list_output_devices() -> Result<Vec<AudioDevice>, String> {
    blocking(|| {
        #[cfg(target_os = "windows")]
        return endpoints(crate::wasapi_capture::Flow::Output);
        #[cfg(not(target_os = "windows"))]
        Ok(Vec::new())
    })
    .await
}

/// A device's name (cpal 0.18 replaced `name()` with `description()`).
#[cfg(not(target_os = "windows"))]
fn cpal_name(device: &cpal::Device) -> Option<String> {
    device.description().ok().map(|d| d.name().to_string())
}

#[cfg(not(target_os = "windows"))]
fn list_cpal_inputs() -> Result<Vec<AudioDevice>, String> {
    let host = cpal::default_host();
    let default_name = host.default_input_device().and_then(|d| cpal_name(&d));
    let devices = host.input_devices().map_err(|e| e.to_string())?;
    Ok(devices
        .filter_map(|d| cpal_name(&d))
        .map(|name| AudioDevice {
            is_default: default_name.as_deref() == Some(name.as_str()),
            is_communications: false,
            id: name.clone(),
            name,
        })
        .collect())
}

/// What to capture (see `start_capture`).
struct Request {
    mic_device_id: Option<String>,
    system_audio: bool,
    system_process_id: Option<u32>,
    system_process_exe: Option<String>,
    system_device: Option<String>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_capture(
    state: tauri::State<'_, CaptureState>,
    // Picked by the webview; `stop_capture` with the same id stops this capture and no other.
    capture_id: u64,
    mic_device_id: Option<String>,
    system_audio: bool,
    // Windows: capture only this app's process tree (Zoom, Teams, the browser…). None = an output device.
    system_process_id: Option<u32>,
    // Windows: that app's exe, to find it again if it restarted (new PID) before or during the capture.
    system_process_exe: Option<String>,
    // Windows: which output to capture when no app is chosen: "default" | "communications" | endpoint id.
    system_device: Option<String>,
    on_event: Channel<CaptureEvent>,
) -> Result<CaptureInfo, String> {
    state.begin(capture_id)?;
    let request = Request {
        mic_device_id,
        system_audio,
        system_process_id,
        system_process_exe,
        system_device,
    };
    match blocking(move || open_capture(request, on_event)).await {
        Ok((info, stop)) => {
            if state.started(capture_id, stop) {
                Ok(info)
            } else {
                Err("Audio capture was stopped before it started.".into())
            }
        }
        Err(e) => {
            state.stop(Some(capture_id));
            Err(e)
        }
    }
}

/// Opens the requested sources on a capture thread that parks until its stop switch (the returned sender) fires
/// or is dropped. Blocks until both sources opened or failed.
fn open_capture(
    request: Request,
    on_event: Channel<CaptureEvent>,
) -> Result<(CaptureInfo, mpsc::Sender<()>), String> {
    let Request {
        mic_device_id,
        system_audio,
        system_process_id,
        system_process_exe,
        system_device,
    } = request;
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<CaptureInfo, String>>();

    thread::Builder::new()
        .name("orbit-audio".into())
        .spawn(move || {
            // Mic and system audio are independent: a busy mic must not stop Orbit from hearing the interviewer.
            let mut info = CaptureInfo {
                mic: false,
                system: false,
                mic_error: None,
                system_error: None,
            };
            let native_stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let mut native_threads: Vec<thread::JoinHandle<()>> = Vec::new();
            #[cfg_attr(target_os = "windows", allow(unused_mut))]
            let mut streams: Vec<cpal::Stream> = Vec::new();

            #[cfg(target_os = "windows")]
            {
                use crate::wasapi_capture::{spawn, Choice, Flow};
                match spawn(
                    Flow::Microphone,
                    Choice::parse(mic_device_id.as_deref()),
                    CHANNEL_MIC,
                    on_event.clone(),
                    native_stop.clone(),
                ) {
                    Ok(handle) => {
                        native_threads.push(handle);
                        info.mic = true;
                    }
                    Err(e) => info.mic_error = Some(e),
                }
                if system_audio {
                    let started = match system_process_id {
                        // one app's process tree (Zoom, Teams, the browser…)
                        Some(pid) => crate::process_loopback::spawn(
                            pid,
                            system_process_exe,
                            on_event.clone(),
                            native_stop.clone(),
                        ),
                        // an output device: default, communications, or a specific one
                        None => spawn(
                            Flow::Output,
                            Choice::parse(system_device.as_deref()),
                            CHANNEL_SYSTEM,
                            on_event.clone(),
                            native_stop.clone(),
                        ),
                    };
                    match started {
                        Ok(handle) => {
                            native_threads.push(handle);
                            info.system = true;
                        }
                        Err(e) => info.system_error = Some(e),
                    }
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = (system_process_id, &system_process_exe, &system_device);
                let host = cpal::default_host();
                match open_mic(&host, mic_device_id.as_deref(), on_event.clone()) {
                    Ok(stream) => {
                        streams.push(stream);
                        info.mic = true;
                    }
                    Err(e) => info.mic_error = Some(format!("Microphone unavailable: {e}")),
                }
                if system_audio {
                    match open_system(&host, on_event.clone()) {
                        Ok(stream) => {
                            streams.push(stream);
                            info.system = true;
                        }
                        Err(e) => info.system_error = Some(e),
                    }
                }
            }

            for stream in &streams {
                if let Err(e) = stream.play() {
                    let _ = ready_tx.send(Err(format!("Couldn't start audio: {e}")));
                    return;
                }
            }
            if !info.mic && !info.system {
                native_stop.store(true, std::sync::atomic::Ordering::Relaxed);
                let mic_msg = info.mic_error.clone().unwrap_or_default();
                let sys_msg = info.system_error.clone().unwrap_or_default();
                let _ = ready_tx.send(Err(if !mic_msg.is_empty() {
                    mic_msg
                } else if !sys_msg.is_empty() {
                    sys_msg
                } else {
                    "No audio available".into()
                }));
                return;
            }
            let _ = ready_tx.send(Ok(info));

            // Park until stop_capture (or the sender is dropped); dropping the streams stops them.
            let _ = stop_rx.recv();
            drop(streams);
            native_stop.store(true, std::sync::atomic::Ordering::Relaxed);
            for handle in native_threads {
                let _ = handle.join();
            }
        })
        .map_err(|e| e.to_string())?;

    let info = ready_rx
        .recv()
        .map_err(|_| "audio thread exited unexpectedly".to_string())??;
    Ok((info, stop_tx))
}

/// Stops capture `capture_id` (without one: whatever is capturing).
#[tauri::command]
pub fn stop_capture(state: tauri::State<'_, CaptureState>, capture_id: Option<u64>) {
    state.stop(capture_id);
}

#[cfg(not(target_os = "windows"))]
fn open_mic(
    host: &cpal::Host,
    device_id: Option<&str>,
    sink: Channel<CaptureEvent>,
) -> Result<cpal::Stream, String> {
    let device = match device_id {
        Some(id) => host
            .input_devices()
            .map_err(|e| e.to_string())?
            .find(|d| cpal_name(d).is_some_and(|n| n == id))
            .ok_or_else(|| format!("device \"{id}\" not found"))?,
        None => host.default_input_device().ok_or("no default microphone")?,
    };
    let config = device.default_input_config().map_err(|e| e.to_string())?;
    open_stream(&device, config, CHANNEL_MIC, sink)
}

#[cfg(target_os = "macos")]
fn open_system(_host: &cpal::Host, _sink: Channel<CaptureEvent>) -> Result<cpal::Stream, String> {
    Err("macOS system audio requires ScreenCaptureKit — not implemented yet.".into())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn open_system(_host: &cpal::Host, _sink: Channel<CaptureEvent>) -> Result<cpal::Stream, String> {
    Err("System audio capture isn't supported on this platform yet.".into())
}

#[cfg(not(target_os = "windows"))]
fn open_stream(
    device: &cpal::Device,
    config: cpal::SupportedStreamConfig,
    channel: u8,
    sink: Channel<CaptureEvent>,
) -> Result<cpal::Stream, String> {
    let format = config.sample_format();
    let stream_config: cpal::StreamConfig = config.into();
    match format {
        cpal::SampleFormat::F32 => build_stream::<f32>(device, &stream_config, channel, sink),
        cpal::SampleFormat::I16 => build_stream::<i16>(device, &stream_config, channel, sink),
        cpal::SampleFormat::U16 => build_stream::<u16>(device, &stream_config, channel, sink),
        cpal::SampleFormat::I32 => build_stream::<i32>(device, &stream_config, channel, sink),
        other => Err(format!("unsupported sample format {other:?}")),
    }
}

#[cfg(not(target_os = "windows"))]
fn build_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channel: u8,
    sink: Channel<CaptureEvent>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let channels = usize::from(config.channels.max(1));
    let mut resampler = Resampler::new(config.sample_rate, TARGET_RATE);
    let mut pending: Vec<i16> = Vec::with_capacity(FRAME_SAMPLES * 2);
    let err_sink = sink.clone();

    device
        .build_input_stream(
            config.clone(),
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                for frame in data.chunks(channels) {
                    let sum: f32 = frame.iter().map(|s| f32::from_sample(*s)).sum();
                    let mono = sum / frame.len() as f32;
                    resampler.push(mono, |v| pending.push(to_i16(v)));
                }
                while pending.len() >= FRAME_SAMPLES {
                    let chunk: Vec<i16> = pending.drain(..FRAME_SAMPLES).collect();
                    let _ = sink.send(encode_frame(channel, &chunk));
                }
            },
            move |err| {
                let _ = err_sink.send(CaptureEvent::Error {
                    channel,
                    message: err.to_string(),
                });
            },
            None,
        )
        .map_err(|e| e.to_string())
}

// Windows captures in the transcriber's format already (the audio engine converts), so only the cpal path converts.
#[cfg_attr(target_os = "windows", allow(dead_code))]
pub(crate) fn to_i16(v: f32) -> i16 {
    let clamped = v.clamp(-1.0, 1.0);
    if clamped < 0.0 {
        (clamped * 32768.0) as i16
    } else {
        (clamped * 32767.0) as i16
    }
}

pub(crate) fn encode_frame(channel: u8, samples: &[i16]) -> CaptureEvent {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    let mut sum_sq = 0.0f32;
    for &s in samples {
        bytes.extend_from_slice(&s.to_le_bytes());
        let f = f32::from(s) / 32768.0;
        sum_sq += f * f;
    }
    let rms = (sum_sq / samples.len().max(1) as f32).sqrt();
    CaptureEvent::Frame {
        channel,
        pcm: base64::engine::general_purpose::STANDARD.encode(bytes),
        rms,
    }
}

/// Linear-interpolating resampler with a one-pole low-pass ahead of decimation, for the cpal path (not Windows,
/// where WASAPI resamples). The one-pole filter lets some content above 8 kHz alias into the speech band when
/// decimating 48 kHz by 3, so Windows doesn't use it any more.
#[cfg_attr(target_os = "windows", allow(dead_code))]
pub(crate) struct Resampler {
    step: f64,
    pos: f64,
    prev: f32,
    has_prev: bool,
    alpha: f32,
    lp: f32,
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
impl Resampler {
    pub(crate) fn new(from_rate: u32, to_rate: u32) -> Self {
        let from = f64::from(from_rate.max(1));
        let cutoff = f64::from(to_rate) * 0.45;
        let alpha = 1.0 - (-2.0 * std::f64::consts::PI * cutoff / from).exp();
        Self {
            step: from / f64::from(to_rate),
            pos: 0.0,
            prev: 0.0,
            has_prev: false,
            alpha: alpha as f32,
            lp: 0.0,
        }
    }

    pub(crate) fn push(&mut self, sample: f32, mut out: impl FnMut(f32)) {
        let x = if self.step > 1.0 {
            self.lp += self.alpha * (sample - self.lp);
            self.lp
        } else {
            sample
        };
        if !self.has_prev {
            self.prev = x;
            self.has_prev = true;
            return;
        }
        while self.pos < 1.0 {
            out(self.prev + (x - self.prev) * self.pos as f32);
            self.pos += self.step;
        }
        self.pos -= 1.0;
        self.prev = x;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(from: u32, input_len: usize) -> usize {
        let mut r = Resampler::new(from, TARGET_RATE);
        let mut n = 0;
        for i in 0..input_len {
            r.push((i as f32 * 0.01).sin(), |_| n += 1);
        }
        n
    }

    #[test]
    fn resamples_48k_to_16k() {
        let out = run(48_000, 48_000);
        assert!((15_990..=16_010).contains(&out), "got {out}");
    }

    #[test]
    fn resamples_44k1_to_16k() {
        let out = run(44_100, 44_100);
        assert!((15_990..=16_010).contains(&out), "got {out}");
    }

    #[test]
    fn passes_through_16k() {
        let out = run(16_000, 16_000);
        assert!((15_998..=16_000).contains(&out), "got {out}");
    }

    #[test]
    fn pcm_conversion_clamps() {
        assert_eq!(to_i16(2.0), i16::MAX);
        assert_eq!(to_i16(-2.0), i16::MIN);
        assert_eq!(to_i16(0.0), 0);
    }

    #[test]
    fn frame_is_little_endian_base64() {
        let CaptureEvent::Frame { pcm, channel, .. } = encode_frame(1, &[1, -2]) else {
            panic!("expected frame");
        };
        assert_eq!(channel, 1);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(pcm)
            .unwrap();
        assert_eq!(bytes, vec![0x01, 0x00, 0xfe, 0xff]);
    }

    /// A running capture's stop switch, and whether it has been flipped.
    fn switch() -> (mpsc::Sender<()>, mpsc::Receiver<()>) {
        mpsc::channel()
    }
    fn stopped(rx: &mpsc::Receiver<()>) -> bool {
        // a sent stop, or the sender dropped: either way the capture thread stops
        !matches!(rx.try_recv(), Err(mpsc::TryRecvError::Empty))
    }

    #[test]
    fn a_late_stop_from_an_earlier_capture_does_not_stop_the_next() {
        let state = CaptureState::default();
        let (test_tx, test_rx) = switch();
        state.begin(1).unwrap();
        assert!(state.started(1, test_tx));
        // the live session starts (stopping the audio test), then the test's unmount stop arrives
        let (live_tx, live_rx) = switch();
        state.begin(2).unwrap();
        assert!(stopped(&test_rx));
        assert!(state.started(2, live_tx));
        state.stop(Some(1));
        assert!(!stopped(&live_rx));
        assert!(state.is_active());
        state.stop(Some(2));
        assert!(stopped(&live_rx));
        assert!(!state.is_active());
    }

    #[test]
    fn a_capture_stopped_while_opening_stops_once_it_is_up() {
        let state = CaptureState::default();
        state.begin(7).unwrap();
        assert!(state.is_active()); // opening counts: the updater must wait for it
        state.stop(Some(7));
        let (tx, rx) = switch();
        assert!(!state.started(7, tx));
        assert!(stopped(&rx));
        assert!(!state.is_active());
    }

    #[test]
    fn a_replaced_capture_stops_once_it_is_up() {
        let state = CaptureState::default();
        state.begin(1).unwrap();
        state.begin(2).unwrap(); // a retry while the first was still opening
        let (old_tx, old_rx) = switch();
        assert!(!state.started(1, old_tx));
        assert!(stopped(&old_rx));
        let (tx, rx) = switch();
        assert!(state.started(2, tx));
        assert!(!stopped(&rx));
    }

    #[test]
    fn an_install_waits_for_capture_and_then_blocks_it() {
        let state = CaptureState::default();
        state.begin(1).unwrap();
        assert!(!state.begin_install());
        state.stop(None);
        assert!(state.begin_install());
        assert!(state.begin(2).is_err());
        state.end_install(); // the installer didn't start
        assert!(state.begin(2).is_ok());
    }
}
