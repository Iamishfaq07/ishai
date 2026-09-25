//! User-initiated screenshots only (spec §27): full monitor or a dragged region.
//! There is no background or continuous capture.

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const OVERLAY_LABEL: &str = "region";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    png_base64: String,
    width: u32,
    height: u32,
}

struct TargetMonitor {
    xcap: xcap::Monitor,
    /// Monitor size in physical pixels (as Tauri reports it).
    physical_width: u32,
    scale_factor: f64,
}

/// The monitor under `window_label` (falls back to the main window).
fn target_monitor(app: &AppHandle, window_label: &str) -> Result<TargetMonitor, String> {
    let window = app
        .get_webview_window(window_label)
        .or_else(|| app.get_webview_window("main"))
        .ok_or("Orbit window not found")?;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("No monitor found for the Orbit window")?;
    let pos = monitor.position();
    let size = monitor.size();
    let cx = pos.x + (size.width / 2) as i32;
    let cy = pos.y + (size.height / 2) as i32;
    let xcap = xcap::Monitor::from_point(cx, cy)
        .map_err(|e| format!("Screen capture unavailable: {e}"))?;
    Ok(TargetMonitor {
        xcap,
        physical_width: size.width,
        scale_factor: monitor.scale_factor(),
    })
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<String, String> {
    let mut buf: Vec<u8> = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgba).map_err(|e| e.to_string())?;
        writer.finish().map_err(|e| e.to_string())?;
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(buf))
}

/// Crops an RGBA buffer. Coordinates are clamped to the image bounds.
fn crop_rgba(
    src: &[u8],
    src_width: u32,
    src_height: u32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
) -> (Vec<u8>, u32, u32) {
    let x = x.min(src_width.saturating_sub(1));
    let y = y.min(src_height.saturating_sub(1));
    let w = w.min(src_width - x).max(1);
    let h = h.min(src_height - y).max(1);
    let mut out = Vec::with_capacity((w * h * 4) as usize);
    for row in y..y + h {
        let start = ((row * src_width + x) * 4) as usize;
        let end = start + (w * 4) as usize;
        out.extend_from_slice(&src[start..end]);
    }
    (out, w, h)
}

#[tauri::command]
pub async fn capture_screen(app: AppHandle) -> Result<Capture, String> {
    let target = target_monitor(&app, "main")?;
    let image = target
        .xcap
        .capture_image()
        .map_err(|e| format!("Screenshot failed: {e}"))?;
    let (width, height) = (image.width(), image.height());
    Ok(Capture {
        png_base64: encode_png(width, height, image.as_raw())?,
        width,
        height,
    })
}

/// `x/y/width/height` are logical (CSS) pixels relative to the overlay's monitor origin.
#[tauri::command]
pub async fn capture_region(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<Capture, String> {
    if width < 1.0 || height < 1.0 {
        return Err("Selection is empty".into());
    }
    let target = target_monitor(&app, OVERLAY_LABEL)?;
    let image = target
        .xcap
        .capture_image()
        .map_err(|e| format!("Screenshot failed: {e}"))?;
    let (img_w, img_h) = (image.width(), image.height());

    // logical → physical, then physical → image pixels (the capture may differ from the reported size).
    let ratio = if target.physical_width > 0 {
        f64::from(img_w) / f64::from(target.physical_width)
    } else {
        1.0
    };
    let k = target.scale_factor * ratio;
    let to_px = |v: f64| (v * k).round().max(0.0) as u32;

    let (rgba, w, h) = crop_rgba(
        image.as_raw(),
        img_w,
        img_h,
        to_px(x),
        to_px(y),
        to_px(width),
        to_px(height),
    );
    Ok(Capture {
        png_base64: encode_png(w, h, &rgba)?,
        width: w,
        height: h,
    })
}

/// Opens (or focuses) the transparent full-monitor region-selection window.
#[tauri::command]
pub async fn open_region_selector(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = existing.set_content_protected(true);
        let _ = existing.set_skip_taskbar(true);
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let main = app
        .get_webview_window("main")
        .ok_or("Orbit window not found")?;
    let monitor = main
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("No monitor found for the Orbit window")?;
    let scale = monitor.scale_factor();
    let pos = monitor.position().to_logical::<f64>(scale);
    let size = monitor.size().to_logical::<f64>(scale);

    WebviewWindowBuilder::new(&app, OVERLAY_LABEL, WebviewUrl::App("overlay.html".into()))
        .title("Orbit — select area")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .content_protected(true)
        .resizable(false)
        .position(pos.x, pos.y)
        .inner_size(size.width, size.height)
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::crop_rgba;

    #[test]
    fn crops_and_clamps() {
        // 3x2 image, pixel value = index
        let src: Vec<u8> = (0..6u8).flat_map(|i| [i, i, i, 255]).collect();
        let (out, w, h) = crop_rgba(&src, 3, 2, 1, 0, 5, 5);
        assert_eq!((w, h), (2, 2));
        assert_eq!(
            out.chunks(4).map(|p| p[0]).collect::<Vec<_>>(),
            vec![1, 2, 4, 5]
        );
    }
}
