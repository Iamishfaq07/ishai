"""The voice-over's timing: trims each Deepgram file, finds its pauses, and times every caption word, for the films
(src/film/vo.ts reads vo/manifest.json) and the mix (audio/score.py reads the trimmed files).

    python tools/vo.py <dir with the TTS files>          ->  vo/manifest.json, <dir>/trim/<id>.wav

Each line's caption words are spread over its speech in proportion to their letters, with the pauses snapped to the
punctuation they fall on, so a caption chunk starts when its words are said.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SR = 48000


def read(path: str) -> np.ndarray:
    with wave.open(path, "rb") as w:
        assert w.getsampwidth() == 2, path
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768.0
        if w.getnchannels() > 1:
            x = x.reshape(-1, w.getnchannels()).mean(axis=1)
    if sr != SR:
        from scipy.signal import resample_poly
        g = math.gcd(sr, SR)
        x = resample_poly(x, SR // g, sr // g)
    return x


def write(path: str, x: np.ndarray) -> None:
    q = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(q.tobytes())


def envelope_db(x: np.ndarray, win: float = 0.02) -> np.ndarray:
    n = int(SR * win)
    pad = np.pad(x ** 2, (n // 2, n // 2))
    c = np.cumsum(pad)
    rms = np.sqrt(np.maximum((c[n:] - c[:-n]) / n, 1e-12))
    return 20 * np.log10(rms[: len(x)] + 1e-12)


def segments(x: np.ndarray, floor: float = -42.0, min_pause: float = 0.16, min_speech: float = 0.06):
    """Speech runs (start, end) in seconds, split at pauses of at least `min_pause` below `floor` dBFS."""
    db = envelope_db(x)
    on = db > floor
    runs, i, n = [], 0, len(on)
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]:
                j += 1
            runs.append([i / SR, j / SR])
            i = j
        else:
            i += 1
    merged: list[list[float]] = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < min_pause:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return [r for r in merged if r[1] - r[0] >= min_speech]


def stretch_pauses(x: np.ndarray, segs: list[list[float]]):
    """A calmer read: every pause the voice makes is held a little longer (a sentence's more than a comma's)."""
    if len(segs) < 2:
        return x, segs
    parts, new, t = [], [], 0.0
    cut = [0.0] + [(segs[k][1] + segs[k + 1][0]) / 2 for k in range(len(segs) - 1)] + [len(x) / SR]
    for k in range(len(segs)):
        a, b = cut[k], cut[k + 1]
        piece = x[int(a * SR): int(b * SR)]
        parts.append(piece)
        new.append([round(t + segs[k][0] - a, 3), round(t + segs[k][1] - a, 3)])
        t += len(piece) / SR
        if k < len(segs) - 1:
            gap = segs[k + 1][0] - segs[k][1]
            extra = 0.16 if gap >= 0.34 else 0.09
            parts.append(np.zeros(int(extra * SR)))
            t += extra
    return np.concatenate(parts), new


def phrases(text: str) -> list[list[str]]:
    words = text.split()
    out, cur = [], []
    for w in words:
        cur.append(w)
        if re.search(r"[.,:;?!]$", w):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def time_words(text: str, segs: list[list[float]]):
    """[(word, start, end)] for the caption words over the speech runs: each pause is matched to the punctuation it
    most likely falls on (by how far through the line it comes), and words are spread by letters between them."""
    runs: list[list[float]] = []
    for r in segs:  # a breath or a word's tail on its own isn't a phrase
        if runs and r[1] - r[0] < 0.12:
            runs[-1][1] = r[1]
        else:
            runs.append(list(r))
    words = text.split()
    letters = [len(w) + 1 for w in words]
    total_letters = sum(letters)
    # Phrase boundaries: after a word ending in punctuation, as a fraction of the letters.
    bounds = []
    acc = 0
    for i, w in enumerate(words[:-1]):
        acc += letters[i]
        if re.search(r"[.,:;?!]$", w):
            bounds.append((acc / total_letters, i + 1))
    speech = [r[1] - r[0] for r in runs]
    total = sum(speech)
    gaps = []
    acc = 0.0
    for k in range(len(runs) - 1):
        acc += speech[k]
        gaps.append(acc / total)
    # Monotonic matching of gaps to boundaries (DP), a gap far from every boundary stays inside a phrase.
    G, B = len(gaps), len(bounds)
    INF = 1e9
    best = [[INF] * (B + 1) for _ in range(G + 1)]
    pick = [[None] * (B + 1) for _ in range(G + 1)]
    for j in range(B + 1):
        best[0][j] = 0.0
    for k in range(1, G + 1):
        for j in range(B + 1):
            # gap k-1 unassigned
            c = best[k - 1][j] + 0.06
            if c < best[k][j]:
                best[k][j], pick[k][j] = c, ("skip", j)
            # gap k-1 assigned to boundary j-1
            if j >= 1:
                for jj in range(j):
                    d = abs(gaps[k - 1] - bounds[j - 1][0])
                    if d > 0.15:
                        continue
                    c = best[k - 1][jj] + d
                    if c < best[k][j]:
                        best[k][j], pick[k][j] = c, ("take", jj)
    j = min(range(B + 1), key=lambda jj: best[G][jj])
    assign = {}
    k = G
    while k > 0:
        kind, prev = pick[k][j]
        if kind == "take":
            assign[k - 1] = bounds[j - 1][1]
        j = prev if kind == "take" else j
        k -= 1
    # Groups of runs between assigned gaps, each with its words.
    out = []
    start_run, start_word = 0, 0
    cuts = sorted(assign.items())
    for gk, wi in cuts + [(len(runs) - 1, len(words))]:
        group = runs[start_run:gk + 1]
        ws = words[start_word:wi]
        out += spread_runs(ws, group)
        start_run, start_word = gk + 1, wi
    return out


def spread_runs(words: list[str], group: list[list[float]]):
    total = sum(r[1] - r[0] for r in group)
    letters = sum(len(w) + 1 for w in words) or 1
    out, pos = [], 0
    for w in words:
        a = speech_to_time(pos / letters * total, group)
        pos += len(w) + 1
        out.append((w, a, speech_to_time(pos / letters * total, group)))
    return out


def spread(words: list[str], a: float, b: float):
    letters = sum(len(w) + 1 for w in words)
    out, pos = [], 0
    for w in words:
        s = a + (b - a) * pos / letters
        pos += len(w) + 1
        out.append((w, s, a + (b - a) * pos / letters))
    return out


def speech_to_time(s: float, groups) -> float:
    for g in groups:
        d = g[1] - g[0]
        if s <= d:
            return g[0] + s
        s -= d
    return groups[-1][1]


def lufs(x: np.ndarray) -> float:
    from scipy import signal
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    y = signal.lfilter(b2, a2, signal.lfilter(b1, a1, x))
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    if len(y) < blk:
        return -70.0
    z = np.array([np.mean(y[i:i + blk] ** 2) for i in range(0, len(y) - blk + 1, hop)])
    lk = -0.691 + 10 * np.log10(z + 1e-30)
    g = lk > -70
    la = -0.691 + 10 * np.log10(z[g].mean() + 1e-30)
    g2 = g & (lk > la - 10)
    return float(-0.691 + 10 * np.log10(z[g2].mean() + 1e-30))


def main() -> None:
    src = sys.argv[1]
    lines = []
    for name in ("script.json", "saba.json"):
        f = os.path.join(ROOT, "vo", name)
        if os.path.exists(f):
            lines += json.load(open(f, encoding="utf-8"))["lines"]
    os.makedirs(os.path.join(src, "trim"), exist_ok=True)
    manifest = {}
    for line in lines:
        path = os.path.join(src, f"{line['id']}.wav")
        if not os.path.exists(path):
            print("missing", line["id"])
            continue
        x = read(path)
        segs = segments(x)
        saba = line["id"].startswith("saba-")
        if not saba:  # Saba's pieces play in the app exactly as made; the narration's pauses are held a little longer
            x, segs = stretch_pauses(x, segs)
        a = max(0.0, segs[0][0] - 0.03)
        b = min(len(x) / SR, segs[-1][1] + 0.12)
        y = x[int(a * SR): int(b * SR)].copy()
        fade = int(0.008 * SR)
        y[:fade] *= np.linspace(0, 1, fade)
        y[-fade:] *= np.linspace(1, 0, fade)
        write(os.path.join(src, "trim", f"{line['id']}.wav"), y)
        if saba:  # what the room asks the voice endpoint for (tools/render.mjs serves it at /__vo/)
            import subprocess
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(src, "trim", f"{line['id']}.wav"),
                            "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "48000", "-ac", "1", os.path.join(src, "trim", f"{line['id']}.mp3")], check=True)
        segs = [[round(s - a, 3), round(e - a, 3)] for s, e in segs]
        words = time_words(line["caption"], segs)
        manifest[line["id"]] = {
            "dur": round(len(y) / SR, 3), "caption": line["caption"], "segments": segs,
            "words": [[w, round(s, 3), round(e, 3)] for w, s, e in words],
            "lufs": round(lufs(y), 2), "peak": round(20 * math.log10(np.max(np.abs(y)) + 1e-12), 2),
        }
        if line.get("split"):
            # One file per sentence too (<id>.0, <id>.1, ...), cut in the pause after each, to place them apart.
            ws = manifest[line["id"]]["words"]
            ends = [i for i, w in enumerate(ws[:-1]) if re.search(r"[.?!]$", w[0])]
            cuts = [0.0] + [(ws[i][2] + ws[i + 1][1]) / 2 for i in ends] + [len(y) / SR]
            starts = [0] + [i + 1 for i in ends] + [len(ws)]
            for n in range(len(cuts) - 1):
                a2, b2 = cuts[n], cuts[n + 1]
                part = y[int(a2 * SR): int(b2 * SR)].copy()
                part[:fade] *= np.linspace(0, 1, fade)
                part[-fade:] *= np.linspace(1, 0, fade)
                pid = f"{line['id']}.{n}"
                write(os.path.join(src, "trim", f"{pid}.wav"), part)
                manifest[pid] = {"dur": round(len(part) / SR, 3), "caption": " ".join(w[0] for w in ws[starts[n]:starts[n + 1]]),
                                 "segments": [], "words": [[w[0], round(w[1] - a2, 3), round(w[2] - a2, 3)] for w in ws[starts[n]:starts[n + 1]]],
                                 "lufs": manifest[line["id"]]["lufs"], "peak": manifest[line["id"]]["peak"]}
        print(f"{line['id']:12s} {len(y) / SR:5.2f}s  {len(segs):2d} runs  {len(phrases(line['caption'])):2d} phrases  "
              f"{manifest[line['id']]['lufs']:6.1f} LUFS  peak {manifest[line['id']]['peak']:5.1f}")
    out = os.path.join(ROOT, "vo", "manifest.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1, ensure_ascii=False)
    print("wrote", out)


if __name__ == "__main__":
    main()
