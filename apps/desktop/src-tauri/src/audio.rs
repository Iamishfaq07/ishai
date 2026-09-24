//! Microphone + system-audio capture.
//!
//! Each source is captured as its own channel (0 = mic/candidate, 1 = system/interviewer),
//! down-mixed to mono, resampled to 16 kHz, converted to PCM16LE and streamed to the webview
//! over a Tauri `Channel`. The webview forwards frames to the Orbit API; nothing is stored.
//!
//! cpal streams are `!Send`, so they live on a dedicated thread that parks until `stop_capture`.
//!
//! System audio:
//! - Windows: WASAPI loopback — cpal opens an *input* stream on the default *output* device.
//! - macOS: requires ScreenCaptureKit (not implemented yet) — reported explicitly, never faked.
//! - Linux: not supported yet (would use a PulseAudio/PipeWire monitor source).

use std::sync::{mpsc, Mutex};
use std::thread;

use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
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
    id: String,
    name: String,
    is_default: bool,
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
    Frame {
        channel: u8,
        pcm: String,
        rms: f32,
    },
    Error {
        channel: u8,
        message: String,
    },
}

#[derive(Default)]
pub struct CaptureState {
    stop: Mutex<Option<mpsc::Sender<()>>>,
}

impl CaptureState {
    /// True while a capture thread is running (a live session is recording).
    pub fn is_active(&self) -> bool {
        self.stop.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    fn stop_existing(&self) {
        if let Ok(mut guard) = self.stop.lock() {
            if let Some(tx) = guard.take() {
                let _ = tx.send(());
            }
        }
    }
}

#[tauri::command]
pub fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    let host = cpal::default_host();
    let default_name = host.default_input_device().and_then(|d| d.name().ok());
    let devices = host.input_devices().map_err(|e| e.to_string())?;
    Ok(devices
        .filter_map(|d| d.name().ok())
        .map(|name| AudioDevice {
            is_default: default_name.as_deref() == Some(name.as_str()),
            id: name.clone(),
            name,
        })
        .collect())
}

#[tauri::command]
pub fn start_capture(
    state: tauri::State<'_, CaptureState>,
    mic_device_id: Option<String>,
    system_audio: bool,
    // Windows: capture only this app's process tree (Zoom, Teams, the browser…). None = all system audio.
    system_process_id: Option<u32>,
    on_event: Channel<CaptureEvent>,
) -> Result<CaptureInfo, String> {
    state.stop_existing();

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<CaptureInfo, String>>();

    thread::Builder::new()
        .name("orbit-audio".into())
        .spawn(move || {
            let host = cpal::default_host();
            let mut streams: Vec<cpal::Stream> = Vec::new();

            // Mic and system audio are independent: a busy mic must not stop Orbit from hearing the interviewer.
            let mut info = CaptureInfo {
                mic: false,
                system: false,
                mic_error: None,
                system_error: None,
            };
            match open_mic(&host, mic_device_id.as_deref(), on_event.clone()) {
                Ok(stream) => {
                    streams.push(stream);
                    info.mic = true;
                }
                Err(e) => info.mic_error = Some(format!("Microphone unavailable: {e}")),
            }
            let app_stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let mut app_thread: Option<thread::JoinHandle<()>> = None;
            #[cfg(target_os = "windows")]
            if system_audio {
                if let Some(pid) = system_process_id {
                    match crate::process_loopback::spawn(pid, on_event.clone(), app_stop.clone()) {
                        Ok(handle) => {
                            app_thread = Some(handle);
                            info.system = true;
                        }
                        Err(e) => info.system_error = Some(e),
                    }
                }
            }
            #[cfg(not(target_os = "windows"))]
            let _ = system_process_id;
            if system_audio && app_thread.is_none() && info.system_error.is_none() {
                match open_system(&host, on_event.clone()) {
                    Ok(stream) => {
                        streams.push(stream);
                        info.system = true;
                    }
                    Err(e) => info.system_error = Some(e),
                }
            }

            for stream in &streams {
                if let Err(e) = stream.play() {
                    let _ = ready_tx.send(Err(format!("Couldn't start audio: {e}")));
                    return;
                }
            }
            if !info.mic && !info.system {
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
            app_stop.store(true, std::sync::atomic::Ordering::Relaxed);
            if let Some(handle) = app_thread {
                let _ = handle.join();
            }
        })
        .map_err(|e| e.to_string())?;

    let info = ready_rx
        .recv()
        .map_err(|_| "audio thread exited unexpectedly".to_string())??;
    if let Ok(mut guard) = state.stop.lock() {
        *guard = Some(stop_tx);
    }
    Ok(info)
}

#[tauri::command]
pub fn stop_capture(state: tauri::State<'_, CaptureState>) {
    state.stop_existing();
}

fn open_mic(
    host: &cpal::Host,
    device_id: Option<&str>,
    sink: Channel<CaptureEvent>,
) -> Result<cpal::Stream, String> {
    let device = match device_id {
        Some(id) => host
            .input_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.name().map(|n| n == id).unwrap_or(false))
            .ok_or_else(|| format!("device \"{id}\" not found"))?,
        None => host.default_input_device().ok_or("no default microphone")?,
    };
    let config = device.default_input_config().map_err(|e| e.to_string())?;
    open_stream(&device, config, CHANNEL_MIC, sink)
}

#[cfg(target_os = "windows")]
fn open_system(host: &cpal::Host, sink: Channel<CaptureEvent>) -> Result<cpal::Stream, String> {
    // WASAPI loopback: an input stream on the render (output) device.
    let device = host
        .default_output_device()
        .ok_or("no default output device")?;
    let config = device.default_output_config().map_err(|e| e.to_string())?;
    open_stream(&device, config, CHANNEL_SYSTEM, sink)
        .map_err(|e| format!("System audio loopback failed: {e}"))
}

#[cfg(target_os = "macos")]
fn open_system(_host: &cpal::Host, _sink: Channel<CaptureEvent>) -> Result<cpal::Stream, String> {
    Err("macOS system audio requires ScreenCaptureKit — not implemented yet.".into())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn open_system(_host: &cpal::Host, _sink: Channel<CaptureEvent>) -> Result<cpal::Stream, String> {
    Err("System audio capture isn't supported on this platform yet.".into())
}

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
    let mut resampler = Resampler::new(config.sample_rate.0, TARGET_RATE);
    let mut pending: Vec<i16> = Vec::with_capacity(FRAME_SAMPLES * 2);
    let err_sink = sink.clone();

    device
        .build_input_stream(
            config,
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

/// Linear-interpolating resampler with a one-pole low-pass ahead of decimation.
/// Good enough for speech-to-text; not intended for music playback.
pub(crate) struct Resampler {
    step: f64,
    pos: f64,
    prev: f32,
    has_prev: bool,
    alpha: f32,
    lp: f32,
}

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
}
