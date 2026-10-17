//! Scrolling capture (user-initiated, like every screenshot, spec §27): the selected area is captured, scrolled a
//! little with the mouse wheel, captured again… and the frames are joined where they overlap, so a coding problem
//! longer than the screen arrives whole instead of as its first screen.
//!
//! Joining works on row fingerprints: each row of a frame is cut into STRIPS vertical strips and each strip hashed.
//! Between two frames that are the same page scrolled by `d` rows, row `i` of the new one equals row `i + d` of the
//! old one. On the first scroll the strips are sorted into moving ones (the content that scrolled), static ones (a
//! sliver of the editor next to the problem, say: cut off the result) and blank ones; and the rows into a fixed
//! header and footer (a pane's tab bar, a "Submit" bar: kept once, not between every screen) and the scrolling rows.
//! A scrollbar, a ticking timer or a hover highlight differ between frames without the page changing: a strip or two
//! of a row may differ, and some rows may.
#![cfg_attr(not(windows), allow(dead_code))] // the joining is everywhere (and tested); the wheel only on Windows

/// One capture of the area, RGBA.
#[derive(Clone)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

const STRIPS: usize = 24;
/// Two frames' rows must share at least this many non-blank rows, a few of them may differ.
const MIN_SAME_ROWS: i64 = 8;
const MIN_OVERLAP_ROWS: usize = 24;

#[derive(Clone, Copy)]
struct RowSig {
    hash: [u64; STRIPS],
    /// Bit `s`: strip `s` is a single colour.
    flat: u32,
}

fn strip_bounds(width: usize) -> [(usize, usize); STRIPS] {
    std::array::from_fn(|s| (s * width / STRIPS, (s + 1) * width / STRIPS))
}

fn row_sigs(f: &Frame) -> Vec<RowSig> {
    let w = f.width as usize;
    let bounds = strip_bounds(w);
    (0..f.height as usize)
        .map(|y| {
            let row = &f.rgba[y * w * 4..(y + 1) * w * 4];
            let mut sig = RowSig {
                hash: [0; STRIPS],
                flat: 0,
            };
            for (s, &(a, b)) in bounds.iter().enumerate() {
                let px = &row[a * 4..b * 4];
                let mut h: u64 = 0xcbf2_9ce4_8422_2325; // FNV-1a over the colour, alpha ignored
                let mut flat = true;
                for p in px.chunks_exact(4) {
                    h = (h ^ u64::from(u32::from_le_bytes([p[0], p[1], p[2], 0])))
                        .wrapping_mul(0x0100_0000_01b3);
                    flat = flat && p[..3] == px[..3];
                }
                sig.hash[s] = h;
                if flat {
                    sig.flat |= 1 << s;
                }
            }
            sig
        })
        .collect()
}

#[derive(PartialEq, Eq, Debug)]
enum Cmp {
    /// The same content.
    Same,
    /// Both blank (one flat colour in every strip looked at): tells nothing about alignment.
    Blank,
    Differ,
}

/// Strips that may differ in a row that's otherwise the same (a scrollbar, a timer, a caret).
fn tolerance(strips: u32) -> u32 {
    match strips {
        12.. => 2,
        6.. => 1,
        _ => 0,
    }
}

fn compare(a: &RowSig, b: &RowSig, cols: u32) -> Cmp {
    let mut differ = 0;
    let mut matched_content = 0;
    for s in 0..STRIPS {
        let bit = 1 << s;
        if cols & bit == 0 {
            continue;
        }
        if a.hash[s] != b.hash[s] {
            differ += 1;
        } else if a.flat & bit == 0 {
            matched_content += 1;
        }
    }
    if differ == 0 {
        if a.flat & b.flat & cols == cols {
            Cmp::Blank
        } else {
            Cmp::Same
        }
    } else if differ <= tolerance(cols.count_ones()) && matched_content >= 2 {
        Cmp::Same
    } else {
        Cmp::Differ
    }
}

/// Where the scrolled content sits in the area, learnt from the first scroll.
#[derive(Clone, Copy, Debug)]
struct Layout {
    /// Strips that scroll (bit per strip).
    cols: u32,
    /// The result's columns: the scrolling strips and the blank ones beside them, without static ones.
    x0: usize,
    x1: usize,
    /// Fixed rows at the top and bottom of the area.
    top: usize,
    bottom: usize,
}

/// Sorts the strips between two frames: None if nothing moved.
fn learn_columns(prev: &[RowSig], cur: &[RowSig], width: usize) -> Option<(u32, usize, usize)> {
    #[derive(Clone, Copy, PartialEq)]
    enum Kind {
        Blank,
        Static,
        Moving,
    }
    let kinds: Vec<Kind> = (0..STRIPS)
        .map(|s| {
            let bit = 1 << s;
            let (mut content, mut equal) = (0usize, 0usize);
            for (a, b) in prev.iter().zip(cur) {
                if a.flat & b.flat & bit == 0 {
                    content += 1;
                    if a.hash[s] == b.hash[s] {
                        equal += 1;
                    }
                }
            }
            if content < 4 {
                Kind::Blank
            } else if equal * 10 >= content * 9 {
                Kind::Static
            } else {
                Kind::Moving
            }
        })
        .collect();
    let first = kinds.iter().position(|&k| k == Kind::Moving)?;
    let last = kinds.iter().rposition(|&k| k == Kind::Moving)?;
    let cols = (first..=last)
        .filter(|&s| kinds[s] == Kind::Moving)
        .fold(0u32, |m, s| m | (1 << s));
    let (mut lo, mut hi) = (first, last);
    while lo > 0 && kinds[lo - 1] == Kind::Blank {
        lo -= 1;
    }
    while hi + 1 < STRIPS && kinds[hi + 1] == Kind::Blank {
        hi += 1;
    }
    let bounds = strip_bounds(width);
    Some((cols, bounds[lo].0, bounds[hi].1))
}

/// Rows that stayed put at the top and at the bottom (a header and a footer), with the blank rows between them and
/// the content (a border, a pane's padding). A blank row of content that happened to match is counted too, harmlessly:
/// it scrolls up into the joined rows on the next screen. Leaving a footer's border out instead pasted it in at every
/// join, over rows of the problem.
fn learn_bands(prev: &[RowSig], cur: &[RowSig], cols: u32) -> (usize, usize) {
    let h = prev.len();
    let band = |rows: &mut dyn Iterator<Item = usize>| {
        let mut end = 0;
        for (n, i) in rows.enumerate() {
            match compare(&prev[i], &cur[i], cols) {
                Cmp::Same | Cmp::Blank => end = n + 1,
                Cmp::Differ => break,
            }
        }
        end
    };
    let top = band(&mut (0..h));
    let bottom = band(&mut (0..h).rev());
    if top + bottom + MIN_OVERLAP_ROWS * 2 > h {
        (0, 0) // a "header" and "footer" leaving no room to scroll aren't ones
    } else {
        (top, bottom)
    }
}

/// How far the content moved up from `prev` to `cur` (`cur[i] == prev[i + d]`), if they overlap convincingly.
/// Ties go to the shift nearest `expect` (what the wheel should have done), else the smallest.
fn convincing(same: i64, differ: i64) -> bool {
    same >= MIN_SAME_ROWS && differ * 3 <= same
}

/// The best-scoring shift and its (same, differ) row counts, convincing or not.
fn best_shift(
    prev: &[RowSig],
    cur: &[RowSig],
    l: &Layout,
    expect: Option<usize>,
) -> Option<(usize, i64, i64)> {
    let (lo, hi) = (l.top, prev.len() - l.bottom);
    let usable = hi.saturating_sub(lo);
    if usable <= MIN_OVERLAP_ROWS {
        return None;
    }
    let mut best: Option<(i64, usize, i64, i64)> = None; // (score, d, same, differ)
    for d in 1..=usable - MIN_OVERLAP_ROWS {
        let (mut same, mut differ) = (0i64, 0i64);
        for i in lo..hi - d {
            match compare(&prev[i + d], &cur[i], l.cols) {
                Cmp::Same => same += 1,
                Cmp::Blank => {}
                Cmp::Differ => differ += 1,
            }
        }
        let score = same - differ;
        let better = match best {
            None => true,
            Some((s, bd, ..)) => {
                score > s || (score == s && expect.is_some_and(|e| d.abs_diff(e) < bd.abs_diff(e)))
            }
        };
        if better {
            best = Some((score, d, same, differ));
        }
    }
    best.map(|(_, d, same, differ)| (d, same, differ))
}

/// The result's columns without the pixel columns at its edges that stayed put while the content moved `d` rows (a
/// scrollbar, whose thumb moves a little and whose arrows don't; a border): those would be repeated down the joined
/// image. Flat columns (a margin) say nothing either way; the first column that scrolled stops the trim.
fn trim_static_edges(prev: &Frame, cur: &Frame, l: &Layout, d: usize) -> (usize, usize) {
    let w = cur.width as usize;
    let (lo, hi) = (l.top, cur.height as usize - l.bottom);
    if hi <= lo + d + MIN_OVERLAP_ROWS {
        return (l.x0, l.x1);
    }
    let rows = (hi - d - lo) as i64;
    let px = |f: &Frame, x: usize, y: usize| {
        let i = (y * w + x) * 4;
        [f.rgba[i], f.rgba[i + 1], f.rgba[i + 2]]
    };
    // > 0: stayed put; < 0: scrolled; 0: can't tell
    let kind = |x: usize| {
        let (mut still, mut moved) = (0i64, 0i64);
        for y in lo..hi - d {
            let c = px(cur, x, y);
            still += i64::from(px(prev, x, y) == c);
            moved += i64::from(px(prev, x, y + d) == c);
        }
        let margin = rows / 20;
        if still > moved + margin {
            1
        } else if moved > still + margin {
            -1
        } else {
            0
        }
    };
    let max_trim = (l.x1 - l.x0) / 8;
    let mut x1 = l.x1;
    for x in (l.x1 - max_trim..l.x1).rev() {
        match kind(x) {
            1 => x1 = x,
            -1 => break,
            _ => {}
        }
    }
    let mut x0 = l.x0;
    for x in l.x0..(l.x0 + max_trim).min(x1) {
        match kind(x) {
            1 => x0 = x + 1,
            -1 => break,
            _ => {}
        }
    }
    (x0, x1.max(x0 + 1))
}

/// Of the rows `lo..hi`, the percentage that changed in place between two frames.
fn changed_pct(prev: &[RowSig], cur: &[RowSig], cols: u32, lo: usize, hi: usize) -> usize {
    let rows = hi.saturating_sub(lo).max(1);
    let differ = (lo..hi)
        .filter(|&i| compare(&prev[i], &cur[i], cols) == Cmp::Differ)
        .count();
    differ * 100 / rows
}

/// Whether the content stayed where it was (the end of the page, or the wheel did nothing).
fn unmoved(prev: &[RowSig], cur: &[RowSig], cols: u32, lo: usize, hi: usize) -> bool {
    changed_pct(prev, cur, cols, lo, hi) <= 1
}

/// Two captures that show the same thing (the scroll finished animating), give or take a caret or a timer.
pub fn alike(a: &Frame, b: &Frame) -> bool {
    if a.width != b.width || a.height != b.height {
        return false;
    }
    a.rgba == b.rgba || {
        let all = (1u32 << STRIPS) - 1;
        unmoved(&row_sigs(a), &row_sigs(b), all, 0, a.height as usize)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Step {
    /// The content moved up this many rows and the new rows were added.
    Moved(usize),
    /// Nothing moved: the end of the page (or the area doesn't scroll).
    Still,
    /// The new frame doesn't line up with the last one: stop and keep what was joined.
    Lost,
}

pub struct Stitcher {
    first: Frame,
    prev: Frame,
    prev_sigs: Vec<RowSig>,
    layout: Option<Layout>,
    /// The joined image so far, `layout.x1 - layout.x0` wide.
    out: Vec<u8>,
    /// The row of `prev` the joined content reaches (exclusive).
    end: usize,
    screens: u32,
    /// What the last push saw, for test builds' debug log.
    pub diag: String,
}

impl Stitcher {
    pub fn new(first: Frame) -> Self {
        let prev_sigs = row_sigs(&first);
        Self {
            prev: first.clone(),
            first,
            prev_sigs,
            layout: None,
            out: Vec::new(),
            end: 0,
            screens: 1,
            diag: String::new(),
        }
    }

    /// Frames joined so far.
    pub fn screens(&self) -> u32 {
        self.screens
    }

    /// The scrolling rows of the area, once known.
    pub fn layout_rows(&self) -> Option<usize> {
        self.layout
            .map(|l| (self.prev.height as usize).saturating_sub(l.top + l.bottom))
    }

    /// Rows in the result so far.
    pub fn height(&self) -> usize {
        match self.layout {
            Some(l) => self.out.len() / ((l.x1 - l.x0) * 4) + l.bottom,
            None => self.first.height as usize,
        }
    }

    fn append(&mut self, from: &Frame, rows: std::ops::Range<usize>) {
        let Some(l) = self.layout else { return };
        let w = from.width as usize;
        for y in rows {
            self.out
                .extend_from_slice(&from.rgba[(y * w + l.x0) * 4..(y * w + l.x1) * 4]);
        }
    }

    /// Adds the next capture, taken after scrolling down. `expect` = the rows the wheel should have moved, if known.
    pub fn push(&mut self, cur: Frame, expect: Option<usize>) -> Step {
        if cur.width != self.prev.width || cur.height != self.prev.height {
            return Step::Lost;
        }
        let h = cur.height as usize;
        let sigs = row_sigs(&cur);
        let layout = match self.layout {
            Some(l) => {
                if unmoved(&self.prev_sigs, &sigs, l.cols, l.top, h - l.bottom) {
                    return Step::Still;
                }
                l
            }
            None => {
                let Some((cols, x0, x1)) =
                    learn_columns(&self.prev_sigs, &sigs, cur.width as usize)
                else {
                    return Step::Still;
                };
                let (top, bottom) = learn_bands(&self.prev_sigs, &sigs, cols);
                Layout {
                    cols,
                    x0,
                    x1,
                    top,
                    bottom,
                }
            }
        };
        let best = best_shift(&self.prev_sigs, &sigs, &layout, expect);
        if option_env!("ORBIT_SCROLL_DEBUG_DIR").is_some() {
            self.diag = format!(
                "layout {layout:?} best (d, same, differ) {best:?} changed-in-place {}%",
                changed_pct(
                    &self.prev_sigs,
                    &sigs,
                    layout.cols,
                    layout.top,
                    h - layout.bottom
                )
            );
        }
        let Some(d) = best.filter(|&(_, s, x)| convincing(s, x)).map(|(d, ..)| d) else {
            // No shift lines them up. A hover highlight or an animation at the bottom of the page changes a few
            // rows without any scroll; more than that, the screens really lost each other.
            let changed = changed_pct(
                &self.prev_sigs,
                &sigs,
                layout.cols,
                layout.top,
                h - layout.bottom,
            );
            return if self.layout.is_some() && changed <= 15 {
                Step::Still
            } else {
                Step::Lost
            };
        };
        if self.layout.is_none() {
            let (x0, x1) = trim_static_edges(&self.prev, &cur, &layout, d);
            let layout = Layout { x0, x1, ..layout };
            // The first frame, all of it but its footer (that comes once, from the last frame).
            self.layout = Some(layout);
            let first = self.first.clone();
            self.append(&first, 0..h - layout.bottom);
            self.end = h - layout.bottom;
        }
        // Rows of `cur` not seen before: from where the joined content reaches, now `d` rows higher.
        let Some(from) = self.end.checked_sub(d).filter(|&y| y >= layout.top) else {
            return Step::Lost; // scrolled past rows never captured
        };
        self.append(&cur, from..h - layout.bottom);
        self.end = h - layout.bottom;
        self.prev = cur;
        self.prev_sigs = sigs;
        self.screens += 1;
        Step::Moved(d)
    }

    /// The joined image: the last frame's footer closes it. Without any scroll, the first frame as it was.
    pub fn finish(mut self) -> Frame {
        let Some(l) = self.layout else {
            return self.first;
        };
        let last = std::mem::replace(
            &mut self.prev,
            Frame {
                width: 0,
                height: 0,
                rgba: Vec::new(),
            },
        );
        self.append(&last, self.end..last.height as usize);
        let width = (l.x1 - l.x0) as u32;
        let height = (self.out.len() / (width as usize * 4)) as u32;
        Frame {
            width,
            height,
            rgba: self.out,
        }
    }
}

/// The top `rows` of a frame.
pub fn cut_height(f: &Frame, rows: u32) -> Frame {
    let rows = rows.min(f.height);
    Frame {
        width: f.width,
        height: rows,
        rgba: f.rgba[..(f.width * rows * 4) as usize].to_vec(),
    }
}

/// The capture loop on Windows: mouse wheel over the area, wait for the page to settle, capture, join.
#[cfg(windows)]
pub mod driver {
    use super::{alike, Frame, Step, Stitcher};
    use std::time::{Duration, Instant};
    use windows::Win32::Foundation::POINT;
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_WHEEL, MOUSEINPUT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetCursorPos, GetWindowThreadProcessId, SetCursorPos, WindowFromPoint,
        GA_ROOT, WHEEL_DELTA,
    };

    const MAX_STEPS: u32 = 40;
    const MAX_NOTCHES: u32 = 12;
    const SETTLE_TIMEOUT: Duration = Duration::from_millis(1500);
    /// The result stays readable to the AI model and inside the server's limits (16 MP, 5 MB).
    pub const MAX_PIXELS: u64 = 12_000_000;
    pub const MAX_HEIGHT: u32 = 12_000;

    #[derive(Debug, PartialEq, Eq)]
    pub enum Stop {
        /// The bottom of the page (or the area didn't scroll, with one screen).
        End,
        /// The length limit.
        Limit,
        /// The user moved the mouse: that's how a capture is stopped early.
        MouseMoved,
        /// The screens stopped lining up.
        Lost,
    }

    pub struct Outcome {
        pub frame: Frame,
        pub screens: u32,
        pub stop: Stop,
    }

    fn cursor() -> Option<POINT> {
        let mut p = POINT::default();
        unsafe { GetCursorPos(&mut p) }.ok().map(|()| p)
    }

    /// Whether one of Orbit's own windows is at `p` (the wheel would scroll Orbit, not the problem).
    fn ours(p: POINT) -> bool {
        unsafe {
            let hwnd = WindowFromPoint(p);
            if hwnd.is_invalid() {
                return false;
            }
            let root = GetAncestor(hwnd, GA_ROOT);
            let mut pid = 0u32;
            GetWindowThreadProcessId(
                if root.is_invalid() { hwnd } else { root },
                Some(&raw mut pid),
            );
            pid == GetCurrentProcessId()
        }
    }

    /// Where to turn the wheel: the middle of the area, or another spot in it that Orbit's window doesn't cover.
    pub fn scroll_point(left: i32, top: i32, width: i32, height: i32) -> Option<POINT> {
        [
            (2, 2),
            (2, 1),
            (2, 3),
            (1, 2),
            (3, 2),
            (1, 1),
            (3, 1),
            (1, 3),
            (3, 3),
        ]
        .into_iter()
        .map(|(fx, fy)| POINT {
            x: left + width * fx / 4,
            y: top + height * fy / 4,
        })
        .find(|&p| !ours(p))
    }

    /// Turns the wheel `notches` notches (negative = towards the user = down), one notch per event like a real
    /// wheel: a browser doesn't scroll a big multi-notch event as far as the same notches one by one, so down and back
    /// up wouldn't cancel out.
    fn turn(notches: i32) {
        let one = if notches < 0 {
            -(WHEEL_DELTA as i32)
        } else {
            WHEEL_DELTA as i32
        };
        for i in 0..notches.unsigned_abs() {
            if i > 0 {
                std::thread::sleep(Duration::from_millis(12));
            }
            let input = INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        mouseData: one as u32,
                        dwFlags: MOUSEEVENTF_WHEEL,
                        ..Default::default()
                    },
                },
            };
            unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) };
        }
    }

    /// Test builds only: compiled with ORBIT_SCROLL_DEBUG_DIR set, every capture and step is written there. Release
    /// builds never set it, so they never write a capture to disk.
    fn debug(step: usize, frame: Option<&Frame>, note: &str) {
        let Some(dir) = option_env!("ORBIT_SCROLL_DEBUG_DIR") else {
            return;
        };
        use std::io::Write;
        let _ = std::fs::create_dir_all(dir);
        if let Some(f) = frame {
            if let Ok(file) = std::fs::File::create(format!("{dir}/frame-{step:02}.png")) {
                let mut enc = png::Encoder::new(std::io::BufWriter::new(file), f.width, f.height);
                enc.set_color(png::ColorType::Rgba);
                enc.set_depth(png::BitDepth::Eight);
                if let Ok(mut w) = enc.write_header() {
                    let _ = w.write_image_data(&f.rgba);
                }
            }
        }
        if let Ok(mut log) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(format!("{dir}/steps.txt"))
        {
            let _ = writeln!(log, "{step:02} {note}");
        }
    }

    fn moved(at: POINT) -> bool {
        cursor().is_some_and(|p| (p.x - at.x).abs() + (p.y - at.y).abs() > 4)
    }

    /// Captures until two captures in a row agree (a smooth scroll has finished), or the timeout.
    fn settle(grab: &mut dyn FnMut() -> Result<Frame, String>) -> Result<Frame, String> {
        std::thread::sleep(Duration::from_millis(80));
        let started = Instant::now();
        let mut last = grab()?;
        loop {
            std::thread::sleep(Duration::from_millis(45));
            let next = grab()?;
            if alike(&last, &next) || started.elapsed() > SETTLE_TIMEOUT {
                return Ok(next);
            }
            last = next;
        }
    }

    /// Scrolls the area under `at` from where it is to the end (or a stop), joining the captures, then scrolls it
    /// back and puts the mouse back where it was.
    pub fn run(
        at: POINT,
        grab: &mut dyn FnMut() -> Result<Frame, String>,
    ) -> Result<Outcome, String> {
        let home = cursor();
        unsafe { SetCursorPos(at.x, at.y) }
            .map_err(|e| format!("Couldn't point at the area: {e}"))?;
        std::thread::sleep(Duration::from_millis(60));
        let mut sent = 0i32; // notches turned down, to turn back up
        let result = scroll_and_join(at, grab, &mut sent);
        // Leave the page and the mouse as they were, however the capture ended.
        let _ = unsafe { SetCursorPos(at.x, at.y) };
        turn(sent);
        if let Some(p) = home {
            let _ = unsafe { SetCursorPos(p.x, p.y) };
        }
        result
    }

    fn scroll_and_join(
        at: POINT,
        grab: &mut dyn FnMut() -> Result<Frame, String>,
        sent: &mut i32,
    ) -> Result<Outcome, String> {
        let first = grab()?;
        debug(
            0,
            Some(&first),
            &format!("first {}x{}", first.width, first.height),
        );
        let width = u64::from(first.width).max(1);
        let max_height = (MAX_PIXELS / width).min(u64::from(MAX_HEIGHT)) as usize;
        let mut st = Stitcher::new(first);
        let mut notches: u32 = 1; // the first turn measures how far one notch scrolls
        let mut per_notch: Option<usize> = None;
        let mut stop = Stop::End;
        for step in 1..=MAX_STEPS as usize {
            if moved(at) {
                stop = Stop::MouseMoved;
                break;
            }
            turn(-(notches as i32));
            *sent += notches as i32;
            let frame = settle(grab)?;
            let expect = per_notch.map(|p| p * notches as usize);
            debug(
                step,
                Some(&frame),
                &format!("turned {notches} expect {expect:?}"),
            );
            let result = st.push(frame, expect);
            debug(step, None, &format!("  -> {result:?} {}", st.diag));
            match result {
                Step::Moved(d) => {
                    if per_notch.is_none() || d >= expect.unwrap_or(0) {
                        per_notch = Some((d / notches as usize).max(1));
                    }
                    // About half the area per turn: plenty of overlap to line the next screen up.
                    let area = st.layout_rows().unwrap_or(d.max(1));
                    let p = per_notch.unwrap_or(1);
                    notches = ((area / 2) / p).clamp(1, MAX_NOTCHES as usize) as u32;
                }
                Step::Still => break,
                Step::Lost => {
                    stop = Stop::Lost;
                    break;
                }
            }
            if st.height() >= max_height {
                stop = Stop::Limit;
                break;
            }
        }
        let screens = st.screens();
        let mut frame = st.finish();
        if frame.height as usize > max_height {
            frame = super::cut_height(&frame, max_height as u32);
        }
        Ok(Outcome {
            frame,
            screens,
            stop,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{Frame, Step, Stitcher};

    /// A page of `rows` rows, `width` wide: each row noise (text-like), with a blank row every 7th.
    fn page(width: u32, rows: u32, seed: u32) -> Vec<[u8; 4]> {
        let mut x = seed.wrapping_mul(2_654_435_761).wrapping_add(1);
        (0..width * rows)
            .map(|i| {
                if (i / width) % 7 == 3 {
                    return [250, 250, 250, 255];
                }
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                let v = (x % 200) as u8;
                [v, v.wrapping_add(17), v / 2, 255]
            })
            .collect()
    }

    fn frame(width: u32, rows: &[&[[u8; 4]]]) -> Frame {
        let height = rows.iter().map(|r| r.len() as u32).sum::<u32>() / width;
        Frame {
            width,
            height,
            rgba: rows
                .iter()
                .flat_map(|r| r.iter().flatten().copied())
                .collect(),
        }
    }

    /// Rows `a..b` of a page.
    fn rows(page: &[[u8; 4]], width: u32, a: u32, b: u32) -> &[[u8; 4]] {
        &page[(a * width) as usize..(b * width) as usize]
    }

    fn pixels(f: &Frame) -> Vec<[u8; 4]> {
        f.rgba
            .chunks_exact(4)
            .map(|p| [p[0], p[1], p[2], p[3]])
            .collect()
    }

    #[test]
    fn screens_of_a_long_page_are_joined_into_the_whole_page() {
        let (w, h) = (96, 200);
        let p = page(w, 640, 1);
        let mut st = Stitcher::new(frame(w, &[rows(&p, w, 0, h)]));
        for off in [90u32, 180, 270, 360, 440] {
            assert!(matches!(
                st.push(frame(w, &[rows(&p, w, off, off + h)]), None),
                Step::Moved(_)
            ));
        }
        // the bottom: the wheel moves nothing more
        assert_eq!(
            st.push(frame(w, &[rows(&p, w, 440, 640)]), None),
            Step::Still
        );
        assert_eq!(st.screens(), 6);
        let out = st.finish();
        assert_eq!((out.width, out.height), (w, 640));
        assert_eq!(pixels(&out), p);
    }

    #[test]
    fn a_sticky_header_and_footer_come_once() {
        let (w, h) = (96, 200);
        let header = page(w, 20, 7);
        let footer = page(w, 16, 9);
        let body = page(w, 500, 2);
        let screen = |off: u32| frame(w, &[&header, rows(&body, w, off, off + h - 36), &footer]);
        let mut st = Stitcher::new(screen(0));
        for off in [70u32, 140, 210, 280, 336] {
            assert!(
                matches!(st.push(screen(off), None), Step::Moved(_)),
                "at {off}"
            );
        }
        assert_eq!(st.push(screen(336), None), Step::Still);
        let out = st.finish();
        let want: Vec<[u8; 4]> = [&header[..], &body[..], &footer[..]].concat();
        assert_eq!(out.height, 20 + 500 + 16);
        assert_eq!(pixels(&out), want);
    }

    #[test]
    fn a_static_pane_beside_the_problem_is_left_out() {
        // 72 px of problem that scrolls, then 24 px of an editor that doesn't (strips are 4 px wide)
        let (w, pw, h) = (96u32, 72u32, 160u32);
        let body = page(pw, 400, 3);
        let editor = page(w - pw, h, 5);
        let screen = |off: u32| {
            let mut px = Vec::new();
            for y in 0..h {
                px.extend_from_slice(
                    &body[((off + y) * pw) as usize..((off + y + 1) * pw) as usize],
                );
                px.extend_from_slice(
                    &editor[(y * (w - pw)) as usize..((y + 1) * (w - pw)) as usize],
                );
            }
            Frame {
                width: w,
                height: h,
                rgba: px.iter().flatten().copied().collect(),
            }
        };
        let mut st = Stitcher::new(screen(0));
        for off in [60u32, 120, 180, 240] {
            assert!(matches!(st.push(screen(off), None), Step::Moved(_)));
        }
        let out = st.finish();
        assert_eq!((out.width, out.height), (pw, 400));
        assert_eq!(pixels(&out), body);
    }

    #[test]
    fn a_moving_scrollbar_and_a_ticking_timer_dont_stop_the_join() {
        let (w, h) = (96u32, 200u32);
        let p = page(w, 560, 4);
        let screen = |off: u32| {
            let mut f = frame(w, &[rows(&p, w, off, off + h)]);
            for y in 0..h {
                // a 3 px scrollbar whose thumb follows the scroll position
                let thumb = y >= off * h / 560 && y < (off + h) * h / 560;
                for x in w - 3..w {
                    let i = ((y * w + x) * 4) as usize;
                    f.rgba[i..i + 4].copy_from_slice(if thumb {
                        &[90, 90, 90, 255]
                    } else {
                        &[230, 230, 230, 255]
                    });
                }
            }
            // a timer in the corner, different on every screen
            for x in 0..4 {
                let i = ((5 * w + x) * 4) as usize;
                f.rgba[i] = (off % 251) as u8;
            }
            f
        };
        let mut st = Stitcher::new(screen(0));
        for off in [90u32, 180, 270, 360] {
            assert!(
                matches!(st.push(screen(off), None), Step::Moved(_)),
                "at {off}"
            );
        }
        let out = st.finish();
        // the scrollbar is left out, and the page's own pixels arrive whole (below the timer's row)
        assert_eq!((out.width, out.height), (w - 3, 560));
        let got = pixels(&out);
        for y in 10..560u32 {
            let (a, b) = ((y * (w - 3)) as usize, (y * w) as usize);
            assert_eq!(
                got[a..a + (w - 3) as usize],
                p[b..b + (w - 3) as usize],
                "row {y}"
            );
        }
    }

    /// Joins real captures saved as frame-00.png, frame-01.png… (a browser's screenshots at the wheel's scroll
    /// steps, or a test build's ORBIT_SCROLL_DEBUG_DIR) into joined.png beside them, printing each step:
    /// `ORBIT_SCROLL_FRAMES=<dir> cargo test --lib joins_frames_from_a_folder -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn joins_frames_from_a_folder() {
        let dir = std::env::var("ORBIT_SCROLL_FRAMES").expect("set ORBIT_SCROLL_FRAMES");
        let load = |i: usize| -> Option<Frame> {
            let file = std::fs::File::open(format!("{dir}/frame-{i:02}.png")).ok()?;
            let mut reader = png::Decoder::new(std::io::BufReader::new(file))
                .read_info()
                .ok()?;
            let mut buf = vec![0; reader.output_buffer_size()?];
            let info = reader.next_frame(&mut buf).ok()?;
            let rgba = match info.color_type {
                png::ColorType::Rgba => buf[..info.buffer_size()].to_vec(),
                png::ColorType::Rgb => buf[..info.buffer_size()]
                    .chunks_exact(3)
                    .flat_map(|p| [p[0], p[1], p[2], 255])
                    .collect(),
                other => panic!("frame {i}: {other:?}"),
            };
            Some(Frame {
                width: info.width,
                height: info.height,
                rgba,
            })
        };
        let mut st = Stitcher::new(load(0).expect("frame-00.png"));
        for i in 1.. {
            let Some(f) = load(i) else { break };
            let step = st.push(f, None);
            println!("frame {i:02}: {step:?}");
            if !matches!(step, Step::Moved(_)) {
                break;
            }
        }
        let out = st.finish();
        println!("joined {}x{}", out.width, out.height);
        let file = std::fs::File::create(format!("{dir}/joined.png")).unwrap();
        let mut enc = png::Encoder::new(std::io::BufWriter::new(file), out.width, out.height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header()
            .unwrap()
            .write_image_data(&out.rgba)
            .unwrap();
    }

    #[test]
    fn an_area_that_doesnt_scroll_is_the_one_screen_it_shows() {
        let (w, h) = (96, 150);
        let p = page(w, h, 6);
        let first = frame(w, &[rows(&p, w, 0, h)]);
        let mut st = Stitcher::new(first.clone());
        assert_eq!(st.push(first.clone(), None), Step::Still);
        let out = st.finish();
        assert_eq!(
            (out.width, out.height, out.rgba),
            (first.width, first.height, first.rgba)
        );
    }

    #[test]
    fn a_jump_past_the_last_screen_stops_with_what_lines_up() {
        let (w, h) = (96, 150);
        let p = page(w, 900, 8);
        let mut st = Stitcher::new(frame(w, &[rows(&p, w, 0, h)]));
        assert!(matches!(
            st.push(frame(w, &[rows(&p, w, 70, 70 + h)]), None),
            Step::Moved(70)
        ));
        assert_eq!(
            st.push(frame(w, &[rows(&p, w, 400, 400 + h)]), None),
            Step::Lost
        );
        let out = st.finish();
        assert_eq!(out.height, 70 + h);
        assert_eq!(pixels(&out), rows(&p, w, 0, 70 + h));
    }
}
