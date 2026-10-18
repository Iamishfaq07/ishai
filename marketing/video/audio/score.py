#!/usr/bin/env python3
"""The Orbit films' music and sound, synthesised from each film's own timing. Nothing is sampled or licensed: sines,
band-limited saws, plucked and FM tones, shaped noise, a synthesised room, sidechain, a bus compressor and a
lookahead true-peak limiter. Technique after Zoon's launch score (Tools/launch-video/launch90-score.py, same owner).

    node tools/render.mjs meta <film> <fmt> meta.json           # the film's sections, sound cues and voice-over
    python audio/score.py meta.json <vo dir> <out dir> [--key 0] [--style launch|feature] [--name <name>]

Writes <out>/<name>-vo.wav (score + sound + voice-over) and <out>/<name>-music.wav (score + sound, no voice), both
48 kHz 24-bit stereo, each mastered to about -14 LUFS integrated with true peaks at or under -1 dBTP, and prints
their loudness. The voice ducks the music by about 7 dB while it speaks.

The music: 116 BPM, in D major unless --key moves it (semitones). The sections come from the film's markers:
intro and tension (B minor, a clock and a pulse in the dark), reveal (a bloom, bells), journey and groove (D - A/C# -
Bm - G, plucked sixteenths, bass, a four-on-the-floor kick), lift (a breath before the hero), hero (everything, and
a four-note motif), reach and more (lighter), outro and logo (the motif on bells, a D add9 bloom that rings out).
A feature film uses hook, body, peak, outro, logo.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import wave

import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 48000
TARGET = -14.0
TP_LIMIT = -2.0  # the WAV; AAC adds up to about 0.6 dB of overshoot, and the MP4 must stay at or under -1 dBTP
RNG = np.random.default_rng(20261018)


# ── basics ──────────────────────────────────────────────────────────────────────────────────────────────────────
def S(t: float) -> int:
    return int(round(t * SR))


def hz(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


def rcos(n: int) -> np.ndarray:
    return 0.5 - 0.5 * np.cos(np.linspace(0.0, np.pi, max(n, 1)))


def ar(n: int, attack: float, release: float) -> np.ndarray:
    e = np.ones(n)
    a = min(n, max(1, S(attack)))
    e[:a] = rcos(a)
    r = min(n - a, max(1, S(release)))
    if r > 0:
        e[n - r:] *= rcos(r)[::-1]
    return e


def adsr(n: int, a: float, d: float, s: float, r: float, hold: float) -> np.ndarray:
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), np.where(t < a + d, 1 - (1 - s) * (t - a) / max(d, 1e-4), s))
    h = a + d + hold
    e = np.where(t > h, s * np.exp(-(t - h) / max(r, 1e-4) * 4.0), e)
    return e * ar(n, 0.002, 0.01)


def pan_lr(p: float) -> tuple[float, float]:
    p = max(-1.0, min(1.0, p))
    return math.cos((p + 1) * math.pi / 4), math.sin((p + 1) * math.pi / 4)


class Bus:
    def __init__(self, n: int) -> None:
        self.x = np.zeros((2, n), np.float64)
        self.n = n

    def put(self, t0: float, sig: np.ndarray, pan: float = 0.0, gain: float = 1.0) -> None:
        if sig.ndim == 1:
            gl, gr = pan_lr(pan)
            sig = np.vstack([sig * gl, sig * gr]) * math.sqrt(2)
        i0 = S(t0)
        a, b = max(0, i0), min(self.n, i0 + sig.shape[1])
        if b > a:
            self.x[:, a:b] += sig[:, a - i0:b - i0] * gain


# ── oscillators ─────────────────────────────────────────────────────────────────────────────────────────────────
def saw(freq, n: int, phase0: float = 0.0) -> np.ndarray:
    if np.isscalar(freq):
        dt = np.full(n, freq / SR)
        ph = (phase0 + (freq / SR) * np.arange(n)) % 1.0
    else:
        dt = np.asarray(freq, np.float64) / SR
        ph = (phase0 + np.cumsum(dt) - dt[0]) % 1.0
    y = 2.0 * ph - 1.0
    m = ph < dt
    u = ph[m] / dt[m]
    y[m] -= 2 * u - u * u - 1.0
    m = ph > 1.0 - dt
    u = (ph[m] - 1.0) / dt[m]
    y[m] -= u * u + 2 * u + 1.0
    return y


def saw_stack(f: float, n: int, voices: int = 5, cents: float = 12, width: float = 0.9) -> np.ndarray:
    L = np.zeros(n)
    R = np.zeros(n)
    for i in range(voices):
        k = (i / (voices - 1)) * 2 - 1 if voices > 1 else 0.0
        v = saw(f * 2 ** (k * cents / 1200.0), n, RNG.random())
        gl, gr = pan_lr(k * width)
        L += v * gl
        R += v * gr
    return np.vstack([L, R]) / math.sqrt(voices)


def pluck(f: float, dur: float, decay: float = 7.0, bright: float = 1.0, kmax: int = 28) -> np.ndarray:
    n = S(dur)
    t = np.arange(n) / SR
    K = int(max(1, min(kmax, (SR * 0.42) // f)))
    y = np.zeros(n)
    for k in range(1, K + 1):
        dk = decay * (1.0 + (k - 1) * 0.55 / max(bright, 0.05))
        nk = min(n, S(9.0 / dk) + 1)
        y[:nk] += np.sin(2 * np.pi * k * f * t[:nk] + RNG.random() * 6.283) * np.exp(-t[:nk] * dk) / k ** 1.15
    return y * ar(n, 0.0015, min(0.03, dur * 0.25))


def fm_bell(f: float, dur: float, ratio: float = 3.5, index: float = 2.2, decay: float = 2.4, idecay: float = 6.0) -> np.ndarray:
    n = S(dur)
    t = np.arange(n) / SR
    mod = index * np.exp(-t * idecay) * np.sin(2 * np.pi * f * ratio * t)
    y = np.sin(2 * np.pi * f * t + mod) * np.exp(-t * decay)
    y += 0.18 * np.sin(2 * np.pi * 2 * f * t + 0.5 * mod) * np.exp(-t * decay * 1.7)
    return y * ar(n, 0.0015, min(0.08, dur * 0.2))


def glide(f_of_t: np.ndarray) -> np.ndarray:
    return np.sin(2 * np.pi * np.cumsum(f_of_t) / SR)


# ── filters ─────────────────────────────────────────────────────────────────────────────────────────────────────
def filt(x: np.ndarray, kind: str, f, order: int = 2) -> np.ndarray:
    btype = {"lp": "lowpass", "hp": "highpass", "bp": "bandpass"}[kind]
    return signal.sosfilt(signal.butter(order, f, btype, fs=SR, output="sos"), x, axis=-1)


def biquad(kind: str, fc: float, q: float):
    fc = min(max(float(fc), 15.0), SR * 0.45)
    w = 2 * math.pi * fc / SR
    cw, sw = math.cos(w), math.sin(w)
    al = sw / (2 * q)
    if kind == "lp":
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
    elif kind == "hp":
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
    else:
        b = [al, 0.0, -al]
    a0 = 1 + al
    return np.array(b) / a0, np.array([1.0, -2 * cw / a0, (1 - al) / a0])


def tv_filter(x: np.ndarray, fc, kind: str = "lp", q: float = 0.707, block: int = 256) -> np.ndarray:
    x2 = np.atleast_2d(np.asarray(x, np.float64))
    n = x2.shape[1]
    nb = (n + block - 1) // block
    fcs = fc((np.arange(nb) * block + block * 0.5) / SR)
    y = np.empty_like(x2)
    zi = np.zeros((x2.shape[0], 2))
    for i in range(nb):
        s, e = i * block, min(n, (i + 1) * block)
        b, a = biquad(kind, fcs[i], q)
        y[:, s:e], zi = signal.lfilter(b, a, x2[:, s:e], axis=-1, zi=zi)
    return y if np.ndim(x) == 2 else y[0]


# ── drums ───────────────────────────────────────────────────────────────────────────────────────────────────────
def kick(soft: float = 0.0) -> np.ndarray:
    n = S(0.5)
    t = np.arange(n) / SR
    f = 46 + 70 * np.exp(-t * 28) + 300 * np.exp(-t * 180)
    body = np.tanh(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (7.5 + soft * 3)) * 1.8) / math.tanh(1.8)
    tick = filt(RNG.standard_normal(n), "bp", (1800, 6000)) * np.exp(-t * 420) * (0.32 - soft * 0.2)
    return (body + tick) * ar(n, 0.0004, 0.05)


def clap() -> np.ndarray:
    n = S(0.35)
    t = np.arange(n) / SR
    env = np.zeros(n)
    for k, d in enumerate((0.0, 0.008, 0.017, 0.027)):
        i = S(d)
        env[i:] += np.exp(-(t[i:] - d) * (230.0 if k < 3 else 22.0)) * (0.7 if k < 3 else 1.0)
    y = filt(RNG.standard_normal(n), "bp", (1000, 5600)) * env
    return filt(y, "hp", 700) * ar(n, 0.0004, 0.05)


def hat(open_: bool = False) -> np.ndarray:
    n = S(0.4 if open_ else 0.07)
    t = np.arange(n) / SR
    x = RNG.standard_normal(n) * 0.7
    for f in (6100.0, 7400.0, 8300.0, 9600.0):
        x += 0.2 * np.sign(np.sin(2 * np.pi * f * t + RNG.random() * 6.28))
    return filt(x, "hp", 7500, order=4) * np.exp(-t * (9.0 if open_ else 70.0)) * ar(n, 0.0003, 0.01)


def crash(dur: float = 2.6) -> np.ndarray:
    n = S(dur)
    t = np.arange(n) / SR
    x = RNG.standard_normal((2, n))
    y = filt(x, "hp", 3200) * np.exp(-t * 1.9) + filt(x, "bp", (5000, 11000)) * np.exp(-t * 2.8) * 0.4
    return filt(y, "lp", 9000) * ar(n, 0.002, 0.3)[None, :]


# ── sound effects (the interface's small sounds, and the film's moves) ──────────────────────────────────────────
def sfx_click() -> np.ndarray:
    n = S(0.06)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * 1700 * t) * np.exp(-t * 260) * 0.5 + np.sin(2 * np.pi * 900 * t) * np.exp(-t * 140) * 0.35
    y += filt(RNG.standard_normal(n), "bp", (1500, 5000)) * np.exp(-t * 600) * 0.4
    return y * ar(n, 0.0003, 0.01)


def sfx_tick() -> np.ndarray:
    n = S(0.03)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * 3600 * t) * np.exp(-t * 500) + filt(RNG.standard_normal(n), "bp", (2500, 8000)) * np.exp(-t * 800) * 0.6
    return y * ar(n, 0.0003, 0.006)


def sfx_whoosh(dur: float = 0.7) -> np.ndarray:
    dur = max(0.3, dur)
    n = S(dur)
    t = np.arange(n) / SR
    u = t / dur
    x = RNG.standard_normal((2, n))
    y = tv_filter(x, lambda tb: 300 * 12 ** (np.sin(np.pi * np.clip(tb / dur, 0, 1)) ** 1.3), "bp", 0.9)
    env = np.where(u < 0.6, (u / 0.6) ** 2, np.cos(np.clip((u - 0.6) / 0.4, 0, 1) * np.pi / 2) ** 1.4)
    sweep = np.clip(u * 2 - 1, -1, 1) * 0.6
    gl = np.cos((sweep + 1) * np.pi / 4)
    gr = np.sin((sweep + 1) * np.pi / 4)
    return np.vstack([y[0] * env * gl, y[1] * env * gr]) * 1.2 * ar(n, 0.01, 0.02)[None, :]


def sfx_swish(dur: float = 0.5) -> np.ndarray:
    return sfx_whoosh(max(0.3, dur * 0.8)) * 0.7


def sfx_pop() -> np.ndarray:
    n = S(0.18)
    t = np.arange(n) / SR
    f = 520 + 600 * np.exp(-t * 40)
    return glide(f) * np.exp(-t * 22) * ar(n, 0.001, 0.03) * 0.8


def sfx_chime(root: int) -> np.ndarray:
    n = S(1.3)
    y = np.zeros(n)
    for i, m in enumerate((root + 24 + 7, root + 24 + 12)):
        b = fm_bell(hz(m), 1.3 - i * 0.08, ratio=2.0, index=1.0, decay=3.2)
        o = S(i * 0.08)
        y[o:o + len(b)] += b[: n - o] * (0.6 if i else 0.5)
    return y


def sfx_detect(root: int) -> np.ndarray:
    n = S(0.35)
    t = np.arange(n) / SR
    f = hz(root + 31) * (1 + 0.5 * np.minimum(t / 0.08, 1))
    return glide(f) * np.exp(-t * 11) * ar(n, 0.004, 0.08) * 0.45


def sfx_stream(dur: float) -> np.ndarray:
    """Writing: a very quiet patter of soft taps, like keys far off."""
    n = S(dur + 0.2)
    y = np.zeros(n)
    t = 0.0
    while t < dur:
        tap = sfx_tick() * (0.25 + 0.2 * RNG.random())
        tap = filt(tap, "lp", 5000)
        i = S(t)
        y[i:i + len(tap)] += tap[: n - i]
        t += 0.045 + RNG.random() * 0.05
    return y * 0.6


def sfx_riser(dur: float, root: int) -> np.ndarray:
    n = S(dur)
    t = np.arange(n) / SR
    u = t / dur
    nz = filt(RNG.standard_normal((2, n)), "hp", 400)
    y = tv_filter(nz, lambda tb: 500 * 16 ** np.clip(tb / dur, 0, 1), "bp", 1.4) * (u ** 2.2)[None, :]
    tone = glide(hz(root + 12) * (1 + 1.0 * u ** 2)) * u ** 3 * 0.25
    return (y + tone[None, :]) * ar(n, 0.02, 0.01)[None, :]


def sfx_impact() -> np.ndarray:
    n = S(2.2)
    t = np.arange(n) / SR
    sub = glide(30 + 60 * np.exp(-t * 4)) * np.exp(-t * 1.8)
    punch = np.sin(2 * np.pi * 90 * t) * np.exp(-t * 14)
    body = np.tanh((sub * 0.9 + punch * 0.8) * 2.0)
    nz = RNG.standard_normal((2, n))
    y = body[None, :] + filt(nz, "lp", 4000) * np.exp(-t * 9) * 0.45 + filt(nz, "bp", (180, 900)) * np.exp(-t * 6) * 0.6
    return y * ar(n, 0.0005, 0.4)[None, :]


def sfx_rumble(dur: float) -> np.ndarray:
    n = S(dur)
    t = np.arange(n) / SR
    y = filt(RNG.standard_normal((2, n)), "lp", 140) * 3.0
    y += np.sin(2 * np.pi * 41 * t)[None, :] * 0.25
    return y * ar(n, 1.5, 0.6)[None, :] * (0.6 + 0.4 * np.sin(2 * np.pi * t / 4.0))[None, :]


def sfx_note(step: int, root: int) -> np.ndarray:
    scale = [0, 2, 4, 7, 9, 12]
    m = root + 24 + scale[step % len(scale)] + 2
    return pluck(hz(m), 0.9, decay=5, bright=1.6) * 0.7 + fm_bell(hz(m + 12), 0.9, decay=4) * 0.2


def sfx_sparkle(root: int) -> np.ndarray:
    n = S(1.4)
    y = np.zeros((2, n))
    for i, m in enumerate([root + 36, root + 43, root + 48, root + 52, root + 55]):
        b = fm_bell(hz(m), 1.0, ratio=4.0, index=0.8, decay=5) * 0.3
        o = S(i * 0.05)
        gl, gr = pan_lr((i / 4) * 1.4 - 0.7)
        y[0, o:o + len(b)] += b[: n - o] * gl
        y[1, o:o + len(b)] += b[: n - o] * gr
    return y


# ── room and echoes ─────────────────────────────────────────────────────────────────────────────────────────────
def room_ir(rt60: float = 2.2, length: float = 2.8, predelay: float = 0.016) -> np.ndarray:
    rng = np.random.default_rng(7)
    n = S(length)
    t = np.arange(n) / SR
    out = []
    for _ in range(2):
        noise = rng.standard_normal(n)
        lo = filt(noise, "lp", 3500)
        hi = noise - lo
        ir = lo * 10 ** (-3 * t / rt60) + hi * 10 ** (-3 * t / (rt60 * 0.4)) * 0.5
        ir[: S(predelay)] = 0.0
        ir = filt(ir, "hp", 180)
        out.append(ir)
    ir = np.vstack(out)
    return ir / math.sqrt(np.sum(ir ** 2) / 2)


def convolve(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    y = np.zeros_like(x)
    for ch in range(2):
        y[ch] = signal.oaconvolve(x[ch] + 0.25 * x[1 - ch], ir[ch])[: x.shape[1]]
    return y


def pingpong(x: np.ndarray, delay: float, fb: float = 0.38, repeats: int = 6, lp: float = 4500) -> np.ndarray:
    mono = (x[0] + x[1]) * 0.5
    d = S(delay)
    y = np.zeros_like(x)
    tap = mono
    sos = signal.butter(1, lp, "lowpass", fs=SR, output="sos")
    for r in range(1, repeats + 1):
        tap = signal.sosfilt(sos, tap)
        k = r * d
        if k >= x.shape[1]:
            break
        y[r % 2, k:] += fb ** r * tap[: x.shape[1] - k]
    return y


# ── loudness ────────────────────────────────────────────────────────────────────────────────────────────────────
def k_weight(x: np.ndarray) -> np.ndarray:
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, np.asarray(x, np.float64), axis=-1), axis=-1)


def lufs(x: np.ndarray) -> float:
    y = k_weight(x)
    n = y.shape[1]
    blk, hop = S(0.4), S(0.1)
    if n < blk:
        return -70.0
    c = np.concatenate([np.zeros((2, 1)), np.cumsum(y * y, axis=1)], axis=1)
    st = np.arange(0, n - blk + 1, hop)
    z = (c[:, st + blk] - c[:, st]) / blk
    lk = -0.691 + 10 * np.log10(z.sum(axis=0) + 1e-30)
    g1 = lk > -70
    la = -0.691 + 10 * np.log10(z[:, g1].mean(axis=1).sum() + 1e-30)
    g2 = g1 & (lk > la - 10)
    return float(-0.691 + 10 * np.log10(z[:, g2].mean(axis=1).sum() + 1e-30))


def tp_envelope(x: np.ndarray) -> np.ndarray:
    n = x.shape[1]
    out = np.empty(n)
    chunk, pad = S(5.0), 256
    for s in range(0, n, chunk):
        a, e = max(0, s - pad), min(n, s + chunk)
        b = min(n, e + pad)
        up = signal.resample_poly(x[:, a:b], 4, 1, axis=1)
        out[s:e] = np.abs(up[:, (s - a) * 4:(e - a) * 4]).max(axis=0).reshape(-1, 4).max(axis=1)
    return np.maximum(out, np.max(np.abs(x), axis=0))


def true_peak_db(x: np.ndarray) -> float:
    return 20 * math.log10(float(np.max(tp_envelope(x))) + 1e-12)


def glue(x: np.ndarray, thresh: float = -20.0, ratio: float = 2.0, knee: float = 6.0, attack: float = 0.012, release: float = 0.2) -> np.ndarray:
    B = 48
    n = x.shape[1]
    nb = (n + B - 1) // B
    p = np.zeros(nb * B)
    p[:n] = (x[0] ** 2 + x[1] ** 2) * 0.5
    ldb = 10 * np.log10(p.reshape(nb, B).mean(axis=1) + 1e-12)
    over = ldb - thresh
    gr = np.where(over <= -knee / 2, 0.0, np.where(over >= knee / 2, over * (1 - 1 / ratio), (1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee)))
    aa, rr = math.exp(-1 / (attack * 1000)), math.exp(-1 / (release * 1000))
    out = np.empty(nb)
    cur = 0.0
    for i, v in enumerate(gr.tolist()):
        cur = aa * cur + (1 - aa) * v if v > cur else rr * cur + (1 - rr) * v
        out[i] = cur
    g = uniform_filter1d(10 ** (-np.repeat(out, B)[:n] / 20), size=B)
    return x * g[None, :]


def limiter(x: np.ndarray, ceiling_db: float, lookahead: float = 0.005, release: float = 0.08) -> np.ndarray:
    c = 10 ** (ceiling_db / 20)
    n = x.shape[1]
    need = np.minimum(1.0, c / np.maximum(tp_envelope(x), 1e-12))
    A = S(lookahead)
    g = minimum_filter1d(need, size=2 * A + 1)
    B = 48
    nb = (n + B - 1) // B
    gp = np.ones(nb * B)
    gp[:n] = g
    gb = gp.reshape(nb, B).min(axis=1)
    rr = math.exp(-1 / (release * 1000))
    out = np.empty(nb)
    cur = 1.0
    for i, v in enumerate(gb.tolist()):
        cur = v if v < cur else v + (cur - v) * rr
        out[i] = cur
    gs = np.minimum(np.repeat(out, B)[:n], g)
    gs = uniform_filter1d(gs, size=2 * A + 1)
    return x * gs[None, :]


def master(x: np.ndarray, target: float = TARGET) -> tuple[np.ndarray, float, float]:
    gain = 10 ** ((target - lufs(x)) / 20)
    ceiling = TP_LIMIT - 0.2
    out = x
    for _ in range(7):
        out = limiter(x * gain, ceiling)
        L = lufs(out)
        tp = true_peak_db(out)
        if tp > TP_LIMIT - 0.05:
            ceiling -= (tp - TP_LIMIT) + 0.1
        if abs(L - target) < 0.05 and tp <= TP_LIMIT:
            break
        gain *= 10 ** ((target - L) / 20)
    return out, lufs(out), true_peak_db(out)


def write_wav24(path: str, x: np.ndarray) -> None:
    full = 2 ** 23 - 1
    tpdf = (RNG.random(x.shape) - RNG.random(x.shape)) / full
    q = np.clip(np.round((np.clip(x, -1.0, 1.0) + tpdf) * full), -full - 1, full).astype("<i4")
    raw = q.T.reshape(-1).view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(raw)


def read_mono(path: str) -> np.ndarray:
    with wave.open(path, "rb") as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768.0
    return x


# ── harmony ─────────────────────────────────────────────────────────────────────────────────────────────────────
# Chords as (bass note, tones) in MIDI around D major; --key moves everything.
CH = {
    "Bm9": (35, [59, 62, 66, 73]), "Bm(add9)/A": (33, [59, 62, 66, 73]), "Gmaj9": (31, [59, 62, 66, 69]),
    "A6sus": (33, [57, 62, 64, 66]), "D": (38, [62, 66, 69, 74]), "Dadd9": (38, [62, 64, 66, 69]),
    "A/C#": (37, [61, 64, 69, 73]), "Bm7": (35, [62, 66, 69, 71]), "Gadd9": (31, [59, 62, 67, 69]),
    "Em7": (40, [62, 66, 67, 71]), "Asus": (33, [62, 64, 69, 76]), "G6/9": (31, [59, 64, 67, 69]), "A": (33, [61, 64, 69, 73]),
}
PROG = {
    "dark": [("Bm9", 8), ("Bm(add9)/A", 8), ("Gmaj9", 8), ("A6sus", 8)],
    "reveal": [("Gmaj9", 4), ("A6sus", 4), ("Dadd9", 8)],
    "main": [("D", 4), ("A/C#", 4), ("Bm7", 4), ("Gadd9", 4)],
    "lift": [("Em7", 4), ("Asus", 4)],
    "outro": [("G6/9", 8), ("A", 4), ("Dadd9", 16)],
}
SECTION_PROG = {"intro": "dark", "tension": "dark", "reveal": "reveal", "journey": "main", "groove": "main", "lift": "lift",
                "hero": "main", "reach": "main", "more": "main", "outro": "outro", "logo": "outro", "hook": "main", "body": "main",
                "peak": "main"}
# How loud each part is in each section (0..1).
PROFILE = {
    "intro": dict(drone=1.0, tick=0.55, pad=0.25),
    "tension": dict(drone=1.0, tick=1.0, pulse=1.0, pad=0.45, arp=0.25),
    "reveal": dict(pad=1.0, bells=0.9, arp=0.25, bass=0.35),
    "journey": dict(pad=0.8, arp=0.8, bass=0.55, kick=0.5),
    "groove": dict(pad=0.65, arp=1.0, bass=1.0, kick=1.0, hats=0.75, clap=0.8),
    "lift": dict(pad=0.95, arp=0.9, bass=0.4, hats=0.45),
    "hero": dict(pad=0.9, arp=1.0, bass=1.0, kick=1.0, hats=0.9, clap=0.9, lead=1.0),
    "reach": dict(pad=0.75, arp=0.95, bass=0.9, kick=0.95, hats=0.7, clap=0.7, lead=0.4),
    "more": dict(pad=0.75, arp=0.9, bass=0.85, kick=0.9, hats=0.7, clap=0.65),
    "outro": dict(pad=1.0, arp=0.45, bells=0.6, bass=0.4),
    "logo": dict(pad=0.7, bells=0.3),
    "hook": dict(pad=0.6, arp=0.9, bass=0.7, kick=0.7, hats=0.4),
    "body": dict(pad=0.65, arp=1.0, bass=0.95, kick=0.95, hats=0.75, clap=0.7),
    "peak": dict(pad=0.85, arp=1.0, bass=1.0, kick=1.0, hats=0.9, clap=0.85, lead=0.9),
}
PARTS = ["drone", "tick", "pulse", "pad", "arp", "bass", "kick", "hats", "clap", "lead", "bells"]
# The film's shape: how loud the whole score sits in each section (dB), before the master evens out the total.
ENERGY = {"intro": -7.0, "tension": -4.0, "reveal": -1.5, "journey": -5.0, "groove": -3.0, "lift": -4.5, "hero": 0.0, "reach": -1.5,
          "more": -2.5, "outro": -3.5, "logo": -2.0, "hook": -2.0, "body": -2.5, "peak": 0.0}


def chart(marks: list[tuple[str, float]], dur: float, beat: float) -> list[tuple[float, float, str, str]]:
    """(start, end, chord, section) over the film, each section running its progression from its start."""
    out = []
    for i, (name, t0) in enumerate(marks):
        t1 = marks[i + 1][1] if i + 1 < len(marks) else dur
        prog = PROG[SECTION_PROG.get(name, "main")]
        t, k = t0, 0
        while t < t1 - 1e-6:
            sym, beats = prog[k % len(prog)]
            end = min(t1, t + beats * beat)
            out.append((t, end, sym, name))
            t, k = end, k + 1
    return out


def section_curves(marks: list[tuple[str, float]], n: int, fade: float = 0.3) -> dict[str, np.ndarray]:
    t = np.arange(n) / SR
    curves = {}
    for part in PARTS:
        ks = []
        for i, (name, t0) in enumerate(marks):
            v = PROFILE.get(name, PROFILE["body"]).get(part, 0.0)
            ks.append((t0, v))
        ts = []
        vs = []
        for i, (t0, v) in enumerate(ks):
            if i:
                ts.append(t0 - fade / 2)
                vs.append(ks[i - 1][1])
            ts.append(t0 + (fade / 2 if i else 0))
            vs.append(v)
        curves[part] = np.interp(t, ts, vs)
    return curves


# ── the arrangement ─────────────────────────────────────────────────────────────────────────────────────────────
def compose(meta: dict, key: int, style: str):
    dur = float(meta["duration"])
    n = S(dur) + S(0.02)
    bpm = float(meta.get("bpm") or 116)
    beat = 60.0 / bpm
    marks = sorted([(m["name"], float(m["t"])) for m in meta["music"]], key=lambda x: x[1]) or [("body", 0.0)]
    if marks[0][1] > 0:
        marks.insert(0, ("intro" if style == "launch" else "hook", 0.0))
    ch = chart(marks, dur, beat)
    cur = section_curves(marks, n)
    B = {k: Bus(n) for k in PARTS + ["sfx", "send", "echo"]}
    # The beat grid starts at the first section with drums, so the downbeat lands on the cut.
    drum_start = next((t for nm, t in marks if PROFILE.get(nm, {}).get("kick", 0) > 0), marks[0][1])
    grid0 = drum_start
    kicks = []

    def tr(m: int) -> int:
        return m + key

    def level(part: str, t: float) -> float:
        i = min(n - 1, max(0, S(t)))
        return float(cur[part][i])

    # chords: pad, bass, arp, bells
    for (t0, t1, sym, sec) in ch:
        bass, tones = CH[sym]
        length = t1 - t0
        # pad: detuned saws, filter opening with the section
        if max(level("pad", t0), level("pad", t1 - 0.01)) > 0:
            nn = S(length + 0.8)
            sig = sum(saw_stack(hz(tr(m)), nn, 5, 11, 0.95) for m in tones) / len(tones)
            bright = 1600 if sec in ("intro", "tension") else 2600 if sec not in ("hero", "peak") else 3600
            sig = tv_filter(sig, lambda tb, b=bright: b * (0.6 + 0.4 * np.sin(np.pi * np.clip(tb / max(length, 0.1), 0, 1))), "lp", 0.8)
            env = ar(nn, 0.35, 0.7)
            B["pad"].put(t0, sig * env[None, :] * 0.5)
        # bass: eighths on the root, ducked by the kick later
        if max(level("bass", t0), level("bass", t1 - 0.01)) > 0:
            k = math.ceil((t0 - grid0) / (beat / 2) - 1e-6)
            while grid0 + k * beat / 2 < t1 - 1e-6:
                t = grid0 + k * beat / 2
                if t >= t0:
                    f = hz(tr(bass) + 12)
                    nn = S(beat / 2 * 0.95)
                    s = saw(f, nn) * 0.5 + np.sin(2 * np.pi * f / 2 * np.arange(nn) / SR) * 0.9
                    s = filt(s, "lp", 380 if k % 2 else 520) * adsr(nn, 0.004, 0.12, 0.55, 0.06, beat / 2 * 0.6)
                    B["bass"].put(t, s * (0.8 if k % 2 else 1.0))
                k += 1
        # arp: plucked sixteenths over two octaves of chord tones
        if max(level("arp", t0), level("arp", t1 - 0.01)) > 0:
            pool = sorted(set([tr(m) for m in tones] + [tr(m) + 12 for m in tones]))
            pattern = [0, 2, 4, 1, 3, 5, 2, 4]
            k = math.ceil((t0 - grid0) / (beat / 4) - 1e-6)
            while grid0 + k * beat / 4 < t1 - 1e-6:
                t = grid0 + k * beat / 4
                if t >= t0:
                    m = pool[pattern[k % len(pattern)] % len(pool)]
                    acc = 1.0 if k % 4 == 0 else 0.62 if k % 2 == 0 else 0.48
                    p = pluck(hz(m), 0.45, decay=9, bright=1.2) * acc
                    B["arp"].put(t, p, pan=0.35 * math.sin(k * 0.9))
                k += 1
        # bells on chord changes in the reveal and outro
        if level("bells", t0 + 0.01) > 0:
            for i, m in enumerate(sorted(tones)[1:4]):
                B["bells"].put(t0 + i * 0.12, fm_bell(hz(tr(m) + 12), 2.4, ratio=3.0, index=1.4, decay=1.6) * 0.5, pan=(i - 1) * 0.5)

    # drums on the grid
    k = 0
    while grid0 + k * beat < dur:
        t = grid0 + k * beat
        sec = next((nm for nm, t0 in reversed(marks) if t >= t0 - 1e-6), marks[0][0])
        half = sec in ("journey",)
        if level("kick", t) > 0.01 and (not half or k % 2 == 0):
            B["kick"].put(t, kick(0.3 if half else 0.0))
            kicks.append(t)
        if level("clap", t) > 0.01 and k % 2 == 1:
            B["clap"].put(t, clap(), pan=0.05)
        if level("hats", t) > 0.01:
            B["hats"].put(t + beat / 2, hat(), pan=0.25)
            B["hats"].put(t + beat / 4, hat() * 0.35, pan=-0.2)
            B["hats"].put(t + 3 * beat / 4, hat() * 0.35, pan=-0.2)
        k += 1

    # the dark intro: a clock and a slow pulse over a drone
    for nm, t0 in marks:
        if nm not in ("intro", "tension"):
            continue
        t1 = next((t for m2, t in marks if t > t0), dur)
        t = t0
        i = 0
        while t < t1:
            B["tick"].put(t, sfx_tick() * (0.9 if i % 2 == 0 else 0.55), pan=0.3 if i % 2 else -0.3)
            t += beat / 2
            i += 1
        if nm == "tension":
            t = t0
            while t < t1:
                nn = S(0.5)
                tt = np.arange(nn) / SR
                thump = np.tanh(glide(42 + 30 * np.exp(-tt * 20)) * np.exp(-tt * 9) * 1.6) * ar(nn, 0.003, 0.08)
                B["pulse"].put(t, thump)
                B["pulse"].put(t + beat * 0.42, thump * 0.6)
                t += beat * 2
        nn = S(t1 - t0 + 1.0)
        tt = np.arange(nn) / SR
        drone = np.sin(2 * np.pi * hz(tr(35) - 12) * tt) * 0.8 + filt(RNG.standard_normal(nn), "lp", 220) * 1.4
        drone *= (0.75 + 0.25 * np.sin(2 * np.pi * tt / 5.3)) * ar(nn, 1.2, 0.9)
        B["drone"].put(t0, drone)

    # the motif: D E F# A in the hero, and the end's bells
    motif = [(0, 0, 1), (1, 2, 1), (2, 4, 1), (3, 7, 2)]  # (beat, degree, beats)
    for nm, t0 in marks:
        if nm not in ("hero", "peak"):
            continue
        t1 = next((t for m2, t in marks if t > t0), dur)
        bar = 4 * beat
        start = grid0 + math.ceil((t0 + bar * 2 - grid0) / (bar * 2)) * bar * 2
        t = start
        while t + bar * 2 <= t1 + 0.01:
            for b, deg, ln in motif:
                f = hz(tr(74 + deg))
                nn = S(ln * beat * 0.95 + 0.4)
                tt = np.arange(nn) / SR
                vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * tt) * np.clip(tt / 0.3, 0, 1)
                s = saw(f * vib, nn) * 0.35 + np.sin(2 * np.pi * f * tt) * 0.5
                s = filt(s, "lp", 3200) * adsr(nn, 0.02, 0.2, 0.7, 0.3, ln * beat * 0.7)
                B["lead"].put(t + b * beat, s)
            t += bar * 4
    root = tr(62)
    logo_t = next((t for nm, t in marks if nm == "logo"), None)
    if logo_t is not None:
        # the sonic logo: the motif on bells, then a D add9 bloom that rings out
        for i, deg in enumerate([0, 2, 4, 7]):
            B["bells"].put(logo_t + 0.1 + i * beat * 0.5, fm_bell(hz(tr(74 + deg)), 2.8, ratio=3.0, index=1.2, decay=1.4) * 0.9, pan=(i - 1.5) * 0.3)
        bloom_t = logo_t + 0.1 + 4 * beat * 0.5
        nn = S(min(5.0, dur - bloom_t + 0.5))
        bl = sum(saw_stack(hz(tr(m)), nn, 6, 9, 1.0) for m in [50, 57, 62, 64, 66, 69]) / 6
        bl = tv_filter(bl, lambda tb: 800 + 2600 * np.exp(-tb * 0.6), "lp", 0.7) * ar(nn, 0.06, 2.2)[None, :]
        B["bells"].put(bloom_t, bl * 0.9)
        nn2 = S(2.5)
        tt = np.arange(nn2) / SR
        B["bells"].put(bloom_t, np.sin(2 * np.pi * hz(tr(38)) * tt) * np.exp(-tt * 1.4) * ar(nn2, 0.01, 0.6) * 0.9)

    # sound effects from the film's cues
    sfx_gain = {"click": 0.22, "tick": 0.16, "whoosh": 0.42, "swish": 0.32, "pop": 0.3, "chime": 0.32, "detect": 0.3, "stream": 0.18,
                "riser": 0.6, "impact": 0.9, "rumble": 0.35, "note": 0.36, "sparkle": 0.35, "bloom": 0.0, "logo": 0.0, "voicebed": 0.0, "crash": 0.5}
    for c in meta.get("cues", []):
        kind = c["kind"]
        g = sfx_gain.get(kind, 0.2) * float(c.get("gain", 1.0))
        if g <= 0:
            continue
        t = float(c["t"])
        d = float(c.get("dur", 0.6) or 0.6)
        pan = float(c.get("pan", 0.0))
        sig = {
            "click": lambda: sfx_click(), "tick": lambda: sfx_tick(), "whoosh": lambda: sfx_whoosh(d), "swish": lambda: sfx_swish(d),
            "pop": lambda: sfx_pop(), "chime": lambda: sfx_chime(root), "detect": lambda: sfx_detect(root), "stream": lambda: sfx_stream(d),
            "riser": lambda: sfx_riser(d, root), "impact": lambda: sfx_impact(), "rumble": lambda: sfx_rumble(d),
            "note": lambda: sfx_note(int(c.get("step", 0)), root), "sparkle": lambda: sfx_sparkle(root),
            "crash": lambda: crash(2.6),
        }.get(kind)
        if not sig:
            continue
        s = sig()
        if kind == "riser":
            B["sfx"].put(t, s, pan=pan, gain=g)
        else:
            B["sfx"].put(t, s, pan=pan, gain=g)
        if kind in ("impact",):
            B["sfx"].put(t, crash(2.4) * 0.35, gain=g)
    return B, cur, kicks, beat, n, dur, marks


def build(meta: dict, key: int, style: str) -> tuple[np.ndarray, np.ndarray]:
    B, cur, kicks, beat, n, dur, marks = compose(meta, key, style)
    stems = {"drone": -27, "tick": -31, "pulse": -24, "pad": -24.5, "arp": -23.5, "bass": -21.5, "kick": -18.5, "hats": -31, "clap": -27, "lead": -24, "bells": -25}
    for k, target in stems.items():
        x = B[k].x
        e = np.sqrt(np.mean(x ** 2) + 1e-20)
        if e > 1e-9:
            # scale each part by its own level where it plays
            active = np.mean(np.abs(x), axis=0) > 1e-5
            rms = np.sqrt(np.mean(x[:, active] ** 2)) if active.any() else e
            x *= 10 ** (target / 20) / rms
        B[k].x = x * cur[k][None, :]
    # sidechain: the harmony breathes with the kick
    pump = np.ones(n)
    for t in kicks:
        i = S(t)
        L = S(beat * 0.9)
        seg = 1 - 0.75 * np.exp(-np.arange(L) / SR / (beat * 0.22))
        b = min(n, i + L)
        pump[i:b] = np.minimum(pump[i:b], seg[: b - i])
    for k, depth in (("pad", 0.35), ("bass", 0.7), ("arp", 0.2), ("lead", 0.1)):
        B[k].x *= (1 - depth * (1 - pump))[None, :]
    ir = room_ir()
    send = np.zeros((2, n))
    for k, s in (("pad", 0.25), ("arp", 0.28), ("lead", 0.3), ("bells", 0.55), ("clap", 0.2), ("tick", 0.25), ("sfx", 0.18)):
        send += B[k].x * s
    echo_in = B["arp"].x * 0.35 + B["lead"].x * 0.3 + B["bells"].x * 0.25
    echoes = pingpong(echo_in, 3 * beat / 4)
    send += echoes * 0.3
    wet = convolve(send, ir) * 0.3
    music = sum(B[k].x for k in PARTS) + echoes * 0.45 + wet
    music = filt(music, "hp", 28)
    shape = np.zeros(n)
    tt = np.arange(n) / SR
    ts, vs = [], []
    for i, (nm, t0) in enumerate(marks):
        if i:
            ts.append(t0 - 0.35)
            vs.append(ENERGY.get(marks[i - 1][0], -2.0))
        ts.append(t0 + (0.05 if i else 0))
        vs.append(ENERGY.get(nm, -2.0))
    shape = 10 ** (np.interp(tt, ts, vs) / 20)
    music = music * shape[None, :]
    music = glue(music, thresh=-24, ratio=1.8)
    fx = filt(B["sfx"].x, "hp", 40)
    fade = np.ones(n)
    tail = S(max(0.0, dur - 0.8))
    fade[tail:] = rcos(n - tail)[::-1] ** 0.8
    fade[: S(0.02)] = rcos(S(0.02))
    return music * fade[None, :], fx * fade[None, :]


def place_vo(meta: dict, vo_dir: str, n: int) -> np.ndarray:
    vo = np.zeros(n)
    for v in meta.get("vo", []):
        path = os.path.join(vo_dir, "trim", f"{v['id']}.wav")
        if not os.path.exists(path):
            print("  (no voice file", v["id"], ")")
            continue
        x = read_mono(path)
        i = S(float(v["t"]))
        b = min(n, i + len(x))
        if b > i:
            vo[i:b] += x[: b - i]
    # the voice: no rumble, a touch of presence, a gentle level rider
    vo = filt(vo, "hp", 85)
    pres = filt(vo, "bp", (2500, 5500)) * 0.18
    vo = vo + pres
    v2 = np.vstack([vo, vo])
    v2 = glue(v2, thresh=-24, ratio=2.5, attack=0.006, release=0.12)
    return v2


def duck_curve(vo: np.ndarray, depth_db: float = 7.5) -> np.ndarray:
    env = np.sqrt(np.maximum(uniform_filter1d(vo[0] ** 2, size=S(0.05)), 0))
    on = (env > 10 ** (-46 / 20)).astype(float)
    # hold through short pauses, glide in 120 ms and out 450 ms
    on = np.maximum.accumulate(on[::-1])[::-1] * 0 + on
    held = minimum_filter1d(1 - on, size=S(0.35))  # 0 where speech within 175 ms
    target = 1 - (1 - held)
    g = np.empty_like(target)
    a, r = math.exp(-1 / (0.12 * SR)), math.exp(-1 / (0.45 * SR))
    cur = 1.0
    lo = 10 ** (-depth_db / 20)
    tgt = lo + (1 - lo) * target
    # one-pole smoothing, decimated for speed
    step = 48
    out = np.empty(len(tgt[::step]))
    a2, r2 = a ** step, r ** step
    for i, v in enumerate(tgt[::step].tolist()):
        cur = a2 * cur + (1 - a2) * v if v < cur else r2 * cur + (1 - r2) * v
        out[i] = cur
    g = np.repeat(out, step)[: len(tgt)]
    return g


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("meta")
    p.add_argument("vo_dir")
    p.add_argument("out_dir")
    p.add_argument("--key", type=int, default=0)
    p.add_argument("--style", default="launch")
    p.add_argument("--name", default=None)
    a = p.parse_args()
    meta = json.load(open(a.meta, encoding="utf-8"))
    name = a.name or meta["id"]
    os.makedirs(a.out_dir, exist_ok=True)
    music, fx = build(meta, a.key, a.style)
    n = music.shape[1]
    vo = place_vo(meta, a.vo_dir, n)
    # music only: the score and the sound effects
    mo, L1, tp1 = master(music + fx * 0.9)
    write_wav24(os.path.join(a.out_dir, f"{name}-music.wav"), mo)
    # with the voice: the music ducks under it; the voice sits about 6 LU over the bed
    if np.max(np.abs(vo)) > 0:
        g = duck_curve(vo)
        bed = music * g[None, :] + fx * (0.75 + 0.25 * g)[None, :]
        lv = lufs(vo * (np.abs(vo) > 0))
        lb = lufs(bed)
        vo_gain = 10 ** (((lb + 7.0) - lv) / 20)
        mix = bed + vo * vo_gain
        mv, L2, tp2 = master(mix)
        write_wav24(os.path.join(a.out_dir, f"{name}-vo.wav"), mv)
        print(f"{name}: voice {L2:.2f} LUFS, {tp2:.2f} dBTP | music only {L1:.2f} LUFS, {tp1:.2f} dBTP | {n / SR:.2f} s")
    else:
        print(f"{name}: music only {L1:.2f} LUFS, {tp1:.2f} dBTP | {n / SR:.2f} s (no voice-over)")


if __name__ == "__main__":
    main()
