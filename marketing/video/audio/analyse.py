"""Reads a finished mix back: loudness per section (from the film's markers), true peak, how far the voice sits over
the music, the stereo balance and the low/mid/high spread, and suspicious clicks. For checking a score without
listening to it on this machine.

    python audio/analyse.py <meta.json> <mix-vo.wav> <mix-music.wav>
"""
import json
import sys

import numpy as np
from scipy import signal

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
import score  # noqa: E402

SR = score.SR


def read24(path):
    import wave
    with wave.open(path, "rb") as w:
        raw = np.frombuffer(w.readframes(w.getnframes()), dtype=np.uint8).reshape(-1, 3)
    x = (raw[:, 0].astype(np.int32) | (raw[:, 1].astype(np.int32) << 8) | (raw[:, 2].astype(np.int32) << 16))
    x = np.where(x >= 2 ** 23, x - 2 ** 24, x) / float(2 ** 23)
    return x.reshape(-1, 2).T


def band(x, lo, hi):
    if lo <= 0:
        return score.filt(x, "lp", hi, 4)
    if hi >= SR / 2:
        return score.filt(x, "hp", lo, 4)
    return score.filt(x, "bp", (lo, hi), 4)


def main():
    meta = json.load(open(sys.argv[1], encoding="utf-8"))
    vo = read24(sys.argv[2])
    mu = read24(sys.argv[3])
    print(f"integrated: voice mix {score.lufs(vo):.2f} LUFS, music-only {score.lufs(mu):.2f} LUFS; true peak {score.true_peak_db(vo):.2f} / {score.true_peak_db(mu):.2f} dBTP")
    marks = sorted([(m["name"], m["t"]) for m in meta["music"]], key=lambda x: x[1])
    kw = score.k_weight(mu)
    print("\nsection      from    to    music LUFS (short)   low<150  mid 150-2k  high>2k (dB rel. total)")
    for i, (nm, t0) in enumerate(marks):
        t1 = marks[i + 1][1] if i + 1 < len(marks) else meta["duration"]
        if t1 - t0 < 0.4:
            continue
        a, b = score.S(t0), score.S(t1)
        seg = mu[:, a:b]
        l = -0.691 + 10 * np.log10(np.mean(kw[:, a:b] ** 2, axis=1).sum() + 1e-12)
        tot = np.mean(seg ** 2) + 1e-12
        parts = [10 * np.log10(np.mean(band(seg, lo, hi) ** 2) / tot + 1e-12) for lo, hi in ((0, 150), (150, 2000), (2000, SR / 2))]
        print(f"{nm:10s} {t0:6.2f} {t1:6.2f}   {l:8.1f}            {parts[0]:6.1f}   {parts[1]:6.1f}   {parts[2]:6.1f}")
    # the voice over the bed: where the voice speaks, compare the voice mix with the music-only mix
    speak = np.zeros(vo.shape[1], bool)
    for v in meta["vo"]:
        speak[score.S(v["t"]):score.S(v["t"] + v["dur"])] = True
    diff = vo - mu * 0  # placeholder for clarity
    kv = score.k_weight(vo)
    lv = -0.691 + 10 * np.log10(np.mean(kv[:, speak] ** 2, axis=1).sum() + 1e-12)
    lm = -0.691 + 10 * np.log10(np.mean(kw[:, speak] ** 2, axis=1).sum() + 1e-12)
    print(f"\nwhile the voice speaks: voice mix {lv:.1f} LUFS vs music-only {lm:.1f} LUFS there")
    side = (mu[0] - mu[1]) / 2
    mid = (mu[0] + mu[1]) / 2
    print(f"stereo: side/mid {10 * np.log10(np.mean(side ** 2) / (np.mean(mid ** 2) + 1e-12)):.1f} dB, L-R balance {10 * np.log10(np.mean(mu[0] ** 2) / np.mean(mu[1] ** 2)):+.2f} dB")
    for name, x in (("voice mix", vo), ("music only", mu)):
        d = np.abs(np.diff(x, axis=1)).max(axis=0)
        from scipy.ndimage import uniform_filter1d
        local = np.sqrt(uniform_filter1d(d ** 2, size=score.S(0.01))) + 1e-4
        flags = np.where((d > 10 * local) & (d > 0.03))[0]
        print(f"clicks ({name}): {len(flags)}" + (": " + ", ".join(f"{f / SR:.3f}" for f in flags[:10]) if len(flags) else ""))
    _ = diff, signal


if __name__ == "__main__":
    main()
