#!/usr/bin/env python3
"""Generates the built-in ambience loops shared by the Mac and iPad soundboards.

Every sound is synthesised to be exactly periodic over LOOP seconds (spectral
noise shaping, whole-cycle modulators, wrap-around events and circular reverb),
so the files loop with no seam. Run from the repository root:

    pip install numpy
    python3 tools/generate-ambience.py
"""
import os
import wave

import numpy as np

SR = 22050
LOOP = 20.0
N = int(SR * LOOP)
T = np.arange(N) / SR
OUTPUTS = [
    'soundboard-mac/src/ambience',
    'soundboard-ipad/Soundboard.swiftpm/Resources/Ambience',
]

rng = np.random.default_rng(20261001)


def noise(lo, hi, tilt=0.0, order=2):
    """Periodic band-limited noise; tilt < 0 darkens (-1 = pink-ish power)."""
    spec = np.fft.rfft(rng.standard_normal(N))
    f = np.fft.rfftfreq(N, 1 / SR)
    f[0] = 1e-3
    gain = f ** (tilt / 2)
    if lo > 0:
        gain = gain / (1 + (lo / f) ** (2 * order))
    gain = gain / (1 + (f / hi) ** (2 * order))
    out = np.fft.irfft(spec * gain, N)
    return out / (np.std(out) + 1e-12)


def slow(lo_hz, hi_hz):
    """Smooth periodic random modulator in roughly [-1, 1]."""
    spec = np.fft.rfft(rng.standard_normal(N))
    f = np.fft.rfftfreq(N, 1 / SR)
    spec[(f < lo_hz) | (f > hi_hz)] = 0
    m = np.fft.irfft(spec, N)
    return m / (np.max(np.abs(m)) + 1e-12)


def cycles(target_hz):
    """Nearest frequency with a whole number of cycles per loop."""
    return max(1, round(target_hz * LOOP)) / LOOP


def add_event(buf, start, wave_):
    idx = (np.arange(len(wave_)) + int(start * SR)) % N
    np.add.at(buf, idx, wave_)


def decay(seconds, tau):
    n = int(seconds * SR)
    return np.exp(-np.arange(n) / (tau * SR))


def burst(seconds, tau, lo, hi):
    n = int(seconds * SR)
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    spec[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(spec, n) * np.exp(-np.arange(n) / (tau * SR))


def reverb(x, seconds, wet):
    ir = np.zeros(N)
    n = int(seconds * 1.5 * SR)
    ir[:n] = rng.standard_normal(n) * np.exp(-np.arange(n) / (seconds / 6.9 * SR))
    ir[0] = 0
    ir /= np.sqrt(np.sum(ir ** 2))
    tail = np.fft.irfft(np.fft.rfft(x) * np.fft.rfft(ir), N)
    return x + wet * tail * (np.std(x) / (np.std(tail) + 1e-12))


def poisson_times(rate):
    count = rng.poisson(rate * LOOP)
    return np.sort(rng.uniform(0, LOOP, count))


# ---------------------------------------------------------------- sounds

def rain():
    bed = noise(500, 9000, tilt=-0.6) * 0.55
    rumble = noise(60, 400, tilt=-1) * 0.25
    drops = np.zeros(N)
    for t in poisson_times(220):
        add_event(drops, t, burst(0.012, rng.uniform(0.0008, 0.003), 1500, 9000) * rng.uniform(0.2, 1.0) ** 2)
    drops /= np.std(drops)
    return bed * (1 + 0.15 * slow(0.05, 0.4)) + rumble + drops * 0.35


def campfire():
    roar = noise(30, 250, tilt=-1) * (0.9 + 0.3 * slow(0.1, 1.5))
    hiss = noise(1500, 6000, tilt=-0.5) * 0.12 * (1 + 0.5 * slow(0.2, 2))
    crackle = np.zeros(N)
    # Crackles come in little clusters, plus the odd loud pop.
    for t in poisson_times(4):
        for _ in range(rng.integers(1, 7)):
            add_event(crackle, t + rng.uniform(0, 0.25),
                      burst(0.03, rng.uniform(0.001, 0.005), 800, 8000) * rng.uniform(0.2, 1))
    for t in poisson_times(0.6):
        add_event(crackle, t, burst(0.06, 0.008, 300, 5000) * 2.5)
    crackle /= np.std(crackle)
    return roar * 0.45 + hiss + crackle * 0.35


def wind():
    gust = slow(0.04, 0.25)
    low = noise(100, 500, tilt=-1) * (0.7 + 0.5 * gust)
    high = noise(400, 1600, tilt=-0.5) * np.clip(0.2 + 0.6 * gust, 0, None)
    whistle = noise(cycles(700) - 25, cycles(700) + 25, order=4) * np.clip(gust, 0, None) ** 2 * 0.5
    return low * 0.7 + high * 0.5 + whistle


def ocean():
    # Four waves per loop of slightly different strength.
    env = np.zeros(N)
    foam_env = np.zeros(N)
    for i, strength in enumerate([1.0, 0.75, 0.9, 0.65]):
        phase = ((T - i * LOOP / 4 - rng.uniform(0, 0.8)) % LOOP) / (LOOP / 4)
        # Slow swell, faster crash, both easing smoothly to zero.
        rise = np.sin(np.pi / 2 * np.clip(phase / 0.45, 0, 1)) ** 2
        fall = np.clip(1 - (phase - 0.45) / 0.55, 0, 1) ** 3
        swell = np.where(phase < 0.45, rise, fall)
        env += swell * strength
        # Foam hiss swells up as the wave breaks and fades as it recedes.
        foam_env += np.where(phase < 0.45, 0, np.sin(np.pi * (1 - fall)) ** 2) * strength
    env = np.convolve(np.concatenate([env[-400:], env, env[:400]]), np.hanning(801) / np.sum(np.hanning(801)), 'same')[400:-400]
    surf = noise(80, 2500, tilt=-1) * (0.15 + env)
    foam = noise(2000, 8000, tilt=-0.4) * foam_env
    return surf + foam * 0.35


def stream():
    flow = noise(250, 3500, tilt=-0.6) * (0.8 + 0.4 * slow(1, 8))
    bubbles = np.zeros(N)
    for t in poisson_times(25):
        dur = rng.uniform(0.01, 0.035)
        n = int(dur * SR)
        f0 = rng.uniform(400, 1400)
        f = f0 * (1 + np.linspace(0, rng.uniform(0.3, 1.2), n))
        bubbles_wave = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.hanning(n) * rng.uniform(0.2, 1)
        add_event(bubbles, t, bubbles_wave)
    return flow * 0.6 + bubbles / (np.std(bubbles) + 1e-9) * 0.3


def cave():
    rumble = noise(25, 140, tilt=-1) * (0.8 + 0.3 * slow(0.03, 0.2))
    drips = np.zeros(N)
    times = poisson_times(0.8)
    for t in times:
        n = int(0.09 * SR)
        f0 = rng.uniform(700, 2000)
        f = f0 * (1 + 0.6 * np.linspace(0, 1, n) ** 0.5)
        attack = np.minimum(1, np.arange(n) / (0.002 * SR))
        add_event(drips, t, np.sin(2 * np.pi * np.cumsum(f) / SR) * decay(0.09, 0.018) * attack * rng.uniform(0.3, 1))
    drips = reverb(drips, 2.0, 0.6)
    return rumble * 0.35 + drips / (np.std(drips) + 1e-9) * 0.3


def night_forest():
    bed = noise(150, 1200, tilt=-1) * 0.25 * (1 + 0.3 * slow(0.05, 0.3))
    crickets = np.zeros(N)
    for c in range(5):
        freq = rng.uniform(3800, 5200)
        level = rng.uniform(0.3, 1)
        period = rng.uniform(0.45, 0.9)
        t = rng.uniform(0, period)
        while t < LOOP:
            pulses = rng.integers(2, 5)
            for p in range(pulses):
                n = int(0.018 * SR)
                tone = np.sin(2 * np.pi * freq * np.arange(n) / SR) * np.hanning(n)
                add_event(crickets, t + p * 0.032, tone * level)
            t += period * rng.uniform(0.85, 1.15)
    crickets = reverb(crickets, 0.8, 0.5)
    return bed + crickets / (np.std(crickets) + 1e-9) * 0.25


def dark_drone():
    out = np.zeros(N)
    for target, level in [(55, 1.0), (55.25, 0.8), (82.4, 0.5), (110.2, 0.35), (164.8, 0.15)]:
        f = cycles(target)
        out += level * np.sin(2 * np.pi * f * T + rng.uniform(0, 6.28)) * (0.7 + 0.3 * slow(0.03, 0.15))
    air = noise(120, 500, tilt=-1) * 0.4 * (0.6 + 0.4 * slow(0.04, 0.2))
    return reverb(out / np.std(out) * 0.6 + air, 2.5, 0.6)


SOUNDS = {
    'Rain': rain,
    'Campfire': campfire,
    'Wind': wind,
    'Ocean Waves': ocean,
    'Forest Stream': stream,
    'Cave Drips': cave,
    'Night Forest': night_forest,
    'Dark Drone': dark_drone,
}


def write(path, x):
    x = x - np.mean(x)
    x = x / (np.sqrt(np.mean(x ** 2)) + 1e-12) * 10 ** (-20 / 20)  # -20 dBFS RMS so layers match
    peak = np.max(np.abs(x))
    if peak > 0.89:
        x = np.tanh(x / 0.89) * 0.89  # soft-limit rare peaks
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    for out in OUTPUTS:
        os.makedirs(out, exist_ok=True)
    for name, make in SOUNDS.items():
        x = make()
        file = name.lower().replace(' ', '-') + '.wav'
        for out in OUTPUTS:
            write(os.path.join(out, file), x)
        print(f'{file}: {LOOP:.0f}s')


if __name__ == '__main__':
    main()
