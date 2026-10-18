//! The icon Windows shows for an app (its exe's main icon), for Setup's "Listen to" tiles: a 32 px PNG as a data
//! URL. Read from the program file only; nothing about the app's window or audio is touched. Kept per exe path for
//! the life of the process (icons don't change while Orbit runs). None when Windows has no icon for it (a packaged
//! Store app's exe is often unreadable): the tile then shows the app's initial.

use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Mutex;

use base64::Engine;
use windows::core::PWSTR;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, GetIconInfo, PrivateExtractIconsW, HICON, ICONINFO,
};

/// Drawn at 32 px and shown at 20–28 CSS px, so it stays sharp at 150% scaling.
const ICON_PX: i32 = 32;

static CACHE: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);

/// The app's icon as `data:image/png;base64,…`, or None.
#[tauri::command]
pub async fn app_icon(pid: u32) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(icon_for_pid(pid)))
        .await
        .map_err(|e| e.to_string())?
}

fn icon_for_pid(pid: u32) -> Option<String> {
    let path = exe_path(pid)?;
    let mut cache = CACHE.lock().unwrap_or_else(|p| p.into_inner());
    let cache = cache.get_or_insert_with(HashMap::new);
    if let Some(hit) = cache.get(&path) {
        return hit.clone();
    }
    let url = icon_png(&path, ICON_PX).map(|png| {
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png)
        )
    });
    cache.insert(path, url.clone());
    url
}

/// The full path of a running process's program file.
fn exe_path(pid: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
        .is_ok();
        let _ = CloseHandle(process);
        ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// The first icon in `path`, drawn at `size` px, as PNG bytes.
pub(crate) fn icon_png(path: &str, size: i32) -> Option<Vec<u8>> {
    // PrivateExtractIconsW takes a MAX_PATH buffer: a longer path has no icon here.
    let wide: Vec<u16> = path.encode_utf16().collect();
    if wide.len() >= 260 {
        return None;
    }
    let mut name = [0u16; 260];
    name[..wide.len()].copy_from_slice(&wide);
    let mut icons = [HICON::default()];
    let found = unsafe { PrivateExtractIconsW(&name, 0, size, size, Some(&mut icons), None, 0) };
    // 0: no icons; u32::MAX (0xFFFFFFFF): the file couldn't be read.
    if found == 0 || found == u32::MAX || icons[0].is_invalid() {
        return None;
    }
    let rgba = unsafe { icon_rgba(icons[0], size) };
    unsafe {
        let _ = DestroyIcon(icons[0]);
    }
    encode_png(&rgba?, size as u32)
}

/// The icon's pixels, top row first, RGBA. Icons without an alpha channel (old 24-bit ones) take it from their mask.
unsafe fn icon_rgba(icon: HICON, size: i32) -> Option<Vec<u8>> {
    let mut info = ICONINFO::default();
    GetIconInfo(icon, &mut info).ok()?;
    let dc = CreateCompatibleDC(None);
    let color = read_bits(dc, info.hbmColor, size);
    let mask = read_bits(dc, info.hbmMask, size);
    let _ = DeleteDC(dc);
    if !info.hbmColor.is_invalid() {
        let _ = DeleteObject(HGDIOBJ(info.hbmColor.0));
    }
    if !info.hbmMask.is_invalid() {
        let _ = DeleteObject(HGDIOBJ(info.hbmMask.0));
    }
    Some(bgra_to_rgba(color?, mask.as_deref()))
}

/// A bitmap's pixels as 32-bit BGRA, top row first.
unsafe fn read_bits(
    dc: windows::Win32::Graphics::Gdi::HDC,
    bitmap: HBITMAP,
    size: i32,
) -> Option<Vec<u8>> {
    if bitmap.is_invalid() {
        return None;
    }
    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: size,
            biHeight: -size, // negative: top-down rows
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut pixels = vec![0u8; (size * size * 4) as usize];
    let lines = GetDIBits(
        dc,
        bitmap,
        0,
        size as u32,
        Some(pixels.as_mut_ptr().cast()),
        &mut bmi,
        DIB_RGB_COLORS,
    );
    (lines > 0).then_some(pixels)
}

/// BGRA → RGBA. Without any alpha in the colour bitmap, a pixel is opaque where the mask is black.
pub(crate) fn bgra_to_rgba(mut bgra: Vec<u8>, mask: Option<&[u8]>) -> Vec<u8> {
    let has_alpha = bgra.chunks_exact(4).any(|p| p[3] != 0);
    for (i, p) in bgra.chunks_exact_mut(4).enumerate() {
        p.swap(0, 2);
        if !has_alpha {
            let transparent = mask.and_then(|m| m.get(i * 4)).is_some_and(|&v| v != 0);
            p[3] = if transparent { 0 } else { 255 };
        }
    }
    bgra
}

fn encode_png(rgba: &[u8], size: u32) -> Option<Vec<u8>> {
    let mut out = Cursor::new(Vec::new());
    {
        let mut encoder = png::Encoder::new(&mut out, size, size);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }
    Some(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::{bgra_to_rgba, icon_png};

    #[test]
    fn colour_channels_swap_and_alpha_is_kept() {
        let px = bgra_to_rgba(vec![10, 20, 30, 128], None);
        assert_eq!(px, vec![30, 20, 10, 128]);
    }

    #[test]
    fn an_icon_without_alpha_takes_it_from_the_mask() {
        // Two pixels, no alpha: the first is opaque (mask black), the second transparent (mask white).
        let mask = [0, 0, 0, 0, 255, 255, 255, 0];
        let px = bgra_to_rgba(vec![1, 2, 3, 0, 4, 5, 6, 0], Some(&mask));
        assert_eq!(px, vec![3, 2, 1, 255, 6, 5, 4, 0]);
    }

    #[test]
    fn a_system_program_has_an_icon_and_a_missing_one_has_none() {
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into());
        let png =
            icon_png(&format!(r"{windir}\explorer.exe"), 32).expect("explorer.exe has an icon");
        assert_eq!(&png[1..4], b"PNG");
        assert!(icon_png(r"C:\no\such\program.exe", 32).is_none());
    }
}
