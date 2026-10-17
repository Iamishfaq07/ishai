//! User-initiated screenshots only (spec §27): full monitor or a dragged region.
//! There is no background or continuous capture.

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub(crate) const OVERLAY_LABEL: &str = "region";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    png_base64: String,
    width: u32,
    height: u32,
}

struct TargetMonitor {
    xcap: xcap::Monitor,
    /// Monitor origin and size in physical pixels (as Tauri reports them).
    physical_x: i32,
    physical_y: i32,
    physical_width: u32,
}

/// The monitor under `window`.
fn target_monitor(window: &tauri::WebviewWindow) -> Result<TargetMonitor, String> {
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
        physical_x: pos.x,
        physical_y: pos.y,
        physical_width: size.width,
    })
}

/// A selection in the overlay's CSS pixels → a crop of the monitor image `(x, y, width, height)`. The overlay's
/// client area starts at `overlay_origin` (physical, virtual-screen coordinates), which needn't be the monitor's
/// origin (the window is placed in logical units, which mixed-DPI monitors convert ambiguously), so its real
/// position is used. `scale` is the overlay's DPI scale; `image_ratio` = image pixels per physical pixel. Clamped
/// to the image; None if nothing of the selection is on it.
fn selection_crop(
    selection: (f64, f64, f64, f64),
    overlay_origin: (i32, i32),
    monitor_origin: (i32, i32),
    scale: f64,
    image_ratio: f64,
    image_size: (u32, u32),
) -> Option<(u32, u32, u32, u32)> {
    let (x, y, width, height) = selection;
    // One axis: where `start..start + len` (CSS px) lands in the image, clamped to it.
    let span = |start: f64, len: f64, overlay: i32, monitor: i32, size: u32| {
        let to_image = |css: f64| {
            ((f64::from(overlay - monitor) + css * scale) * image_ratio)
                .round()
                .clamp(0.0, f64::from(size))
        };
        (to_image(start), to_image(start + len))
    };
    let (left, right) = span(x, width, overlay_origin.0, monitor_origin.0, image_size.0);
    let (top, bottom) = span(y, height, overlay_origin.1, monitor_origin.1, image_size.1);
    if right - left < 1.0 || bottom - top < 1.0 {
        return None;
    }
    Some((
        left as u32,
        top as u32,
        (right - left) as u32,
        (bottom - top) as u32,
    ))
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
    let main = app
        .get_webview_window("main")
        .ok_or("Orbit window not found")?;
    let target = target_monitor(&main)?;
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

/// `x/y/width/height` are logical (CSS) pixels in the overlay window.
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
    // Hidden while capturing (so it isn't in the shot), but still where the selection was made.
    let overlay = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or("The selection window was closed")?;
    let origin = overlay.inner_position().map_err(|e| e.to_string())?;
    let scale = overlay.scale_factor().map_err(|e| e.to_string())?;
    let target = target_monitor(&overlay)?;
    let image = target
        .xcap
        .capture_image()
        .map_err(|e| format!("Screenshot failed: {e}"))?;
    let (img_w, img_h) = (image.width(), image.height());

    // physical → image pixels: the capture may differ from the reported size.
    let ratio = if target.physical_width > 0 {
        f64::from(img_w) / f64::from(target.physical_width)
    } else {
        1.0
    };
    let (cx, cy, cw, ch) = selection_crop(
        (x, y, width, height),
        (origin.x, origin.y),
        (target.physical_x, target.physical_y),
        scale,
        ratio,
        (img_w, img_h),
    )
    .ok_or("The selection is outside the screen")?;
    let (rgba, w, h) = crop_rgba(image.as_raw(), img_w, img_h, cx, cy, cw, ch);
    Ok(Capture {
        png_base64: encode_png(w, h, &rgba)?,
        width: w,
        height: h,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollCapture {
    png_base64: String,
    width: u32,
    height: u32,
    /// Screens joined; 1 = the area didn't scroll.
    screens: u32,
    /// Why it stopped: "end" (the bottom), "limit" (the length or size limit), "mouse" (the user moved the mouse)
    /// or "lost" (the screens stopped lining up).
    stop: &'static str,
}

/// The server takes screenshots up to 5 MB.
#[cfg(windows)]
const MAX_PNG_BYTES: usize = 4_800_000;

/// RGB PNG bytes (no alpha: smaller, and a screenshot has none).
#[cfg(windows)]
fn png_rgb(f: &crate::scroll_capture::Frame) -> Result<Vec<u8>, String> {
    let rgb: Vec<u8> = f
        .rgba
        .chunks_exact(4)
        .flat_map(|p| [p[0], p[1], p[2]])
        .collect();
    let mut buf: Vec<u8> = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, f.width, f.height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(&rgb).map_err(|e| e.to_string())?;
        writer.finish().map_err(|e| e.to_string())?;
    }
    Ok(buf)
}

/// Captures the selected area while scrolling it to the bottom, joined into one tall image; then scrolls it back.
/// `x/y/width/height` are logical (CSS) pixels in the overlay window, which is hidden by now (the wheel must reach
/// the window under it). Moving the mouse stops it early.
#[tauri::command]
pub async fn capture_scrolling(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<ScrollCapture, String> {
    #[cfg(not(windows))]
    {
        let _ = (app, x, y, width, height);
        Err("Scrolling capture is only available on Windows.".into())
    }
    #[cfg(windows)]
    {
        use crate::scroll_capture::{cut_height, driver, Frame};

        if width < 1.0 || height < 1.0 {
            return Err("Selection is empty".into());
        }
        let overlay = app
            .get_webview_window(OVERLAY_LABEL)
            .ok_or("The selection window was closed")?;
        let origin = overlay.inner_position().map_err(|e| e.to_string())?;
        let scale = overlay.scale_factor().map_err(|e| e.to_string())?;
        // xcap's monitor handle isn't Send: only plain numbers outlive this block (and cross to the capture thread).
        let (monitor_x, monitor_y, img_w, img_h, ratio) = {
            let target = target_monitor(&overlay)?;
            let img_w = target.xcap.width().map_err(|e| e.to_string())?;
            let img_h = target.xcap.height().map_err(|e| e.to_string())?;
            let ratio = if target.physical_width > 0 {
                f64::from(img_w) / f64::from(target.physical_width)
            } else {
                1.0
            };
            (target.physical_x, target.physical_y, img_w, img_h, ratio)
        };
        let (cx, cy, cw, ch) = selection_crop(
            (x, y, width, height),
            (origin.x, origin.y),
            (monitor_x, monitor_y),
            scale,
            ratio,
            (img_w, img_h),
        )
        .ok_or("The selection is outside the screen")?;
        // The area on the screen, in physical pixels: where the wheel turns.
        let to_screen = |v: u32| (f64::from(v) / ratio).round() as i32;
        let (sx, sy) = (monitor_x + to_screen(cx), monitor_y + to_screen(cy));
        let (sw, sh) = (to_screen(cw).max(1), to_screen(ch).max(1));
        let at = driver::scroll_point(sx, sy, sw, sh)
            .ok_or("Orbit's window covers that area. Move it aside and try again.")?;

        // Orbit's own window often floats over the problem, and it doesn't scroll with it: a capture with it in
        // would never line up (and would paste it in over and over). Left out of the captures for these seconds,
        // still on screen; then back to the user's Window privacy choice.
        crate::set_capturing(&app, true);
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            // for the display to apply that
            std::thread::sleep(std::time::Duration::from_millis(150));
            // The monitor found again on this thread (the area's middle is on it).
            let monitor = xcap::Monitor::from_point(sx + sw / 2, sy + sh / 2)
                .map_err(|e| format!("Screen capture unavailable: {e}"))?;
            let exact = (ratio - 1.0).abs() < 0.001;
            let mut grab = move || -> Result<Frame, String> {
                let (rgba, w, h) = if exact {
                    let img = monitor
                        .capture_region(cx, cy, cw, ch)
                        .map_err(|e| format!("Screenshot failed: {e}"))?;
                    let (w, h) = (img.width(), img.height());
                    (img.into_raw(), w, h)
                } else {
                    let img = monitor
                        .capture_image()
                        .map_err(|e| format!("Screenshot failed: {e}"))?;
                    crop_rgba(img.as_raw(), img.width(), img.height(), cx, cy, cw, ch)
                };
                Ok(Frame {
                    width: w,
                    height: h,
                    rgba,
                })
            };
            driver::run(at, &mut grab)
        })
        .await;
        crate::set_capturing(&app, false);
        let outcome = outcome.map_err(|e| e.to_string())??;

        let mut frame = outcome.frame;
        let mut stop = match outcome.stop {
            driver::Stop::End => "end",
            driver::Stop::Limit => "limit",
            driver::Stop::MouseMoved => "mouse",
            driver::Stop::Lost => "lost",
        };
        let mut png = png_rgb(&frame)?;
        while png.len() > MAX_PNG_BYTES && frame.height > 64 {
            // Too big to upload: keep the top part that fits.
            let keep =
                (f64::from(frame.height) * MAX_PNG_BYTES as f64 / png.len() as f64 * 0.95) as u32;
            frame = cut_height(&frame, keep.max(64));
            png = png_rgb(&frame)?;
            stop = "limit";
        }
        Ok(ScrollCapture {
            png_base64: base64::engine::general_purpose::STANDARD.encode(png),
            width: frame.width,
            height: frame.height,
            screens: outcome.screens,
            stop,
        })
    }
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
    use super::{crop_rgba, selection_crop};

    const IMAGE: (u32, u32) = (2880, 1620);

    #[test]
    fn a_selection_maps_through_the_overlays_scale() {
        // overlay exactly on the monitor at 150 %
        assert_eq!(
            selection_crop((10.0, 20.0, 100.0, 50.0), (0, 0), (0, 0), 1.5, 1.0, IMAGE),
            Some((15, 30, 150, 75))
        );
        // the capture came back at half the reported size
        assert_eq!(
            selection_crop((10.0, 20.0, 100.0, 50.0), (0, 0), (0, 0), 1.5, 0.5, IMAGE),
            Some((8, 15, 75, 38))
        );
    }

    #[test]
    fn the_overlays_real_position_is_used_not_the_monitor_origin() {
        // second monitor at x=1920; the overlay landed 8 px right and 4 px down of its corner
        assert_eq!(
            selection_crop(
                (10.0, 20.0, 100.0, 50.0),
                (1928, 4),
                (1920, 0),
                1.0,
                1.0,
                IMAGE
            ),
            Some((18, 24, 100, 50))
        );
        // a monitor left of the primary (negative coordinates)
        assert_eq!(
            selection_crop(
                (10.0, 20.0, 100.0, 50.0),
                (-1920, 0),
                (-1920, 0),
                1.0,
                1.0,
                IMAGE
            ),
            Some((10, 20, 100, 50))
        );
    }

    #[test]
    fn a_selection_partly_off_the_monitor_is_clamped_and_one_fully_off_is_refused() {
        // overlay starts 50 px left of the monitor: the left 40 px of the selection aren't on it
        assert_eq!(
            selection_crop((10.0, 0.0, 100.0, 50.0), (-50, 0), (0, 0), 1.0, 1.0, IMAGE),
            Some((0, 0, 60, 50))
        );
        assert_eq!(
            selection_crop((0.0, 0.0, 40.0, 40.0), (-50, 0), (0, 0), 1.0, 1.0, IMAGE),
            None
        );
    }

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
