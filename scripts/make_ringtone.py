#!/usr/bin/env python3
"""Synthesize a pleasant, modern incoming-call ringtone as a WAV file.

The tone is a gentle two-note "marimba/bell" motif repeated with a short gap,
designed to sound calm and premium rather than harsh. 16-bit PCM, 44.1kHz mono.
"""
import math
import struct
import wave

SAMPLE_RATE = 44100


def tone(freq, duration, volume=0.5, decay=6.0):
    """A plucked/bell-like tone using a sine with exponential decay + soft harmonic."""
    n = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        env = math.exp(-decay * t)
        # fundamental + a soft octave harmonic for a bell-ish timbre
        s = math.sin(2 * math.pi * freq * t)
        s += 0.35 * math.sin(2 * math.pi * freq * 2 * t)
        s += 0.15 * math.sin(2 * math.pi * freq * 3 * t)
        samples.append(volume * env * s / 1.5)
    return samples


def silence(duration):
    return [0.0] * int(SAMPLE_RATE * duration)


def build():
    # Notes (Hz): a warm rising motif C5 -> E5 -> G5, then a calm fall.
    C5, E5, G5, A5 = 523.25, 659.25, 783.99, 880.0
    motif = []
    motif += tone(C5, 0.22, 0.55)
    motif += tone(E5, 0.22, 0.55)
    motif += tone(G5, 0.30, 0.60)
    motif += silence(0.10)
    motif += tone(A5, 0.26, 0.50)
    motif += tone(G5, 0.40, 0.55, decay=4.5)
    motif += silence(0.55)

    # Repeat the motif a few times to make a loop-friendly ~6s ringtone.
    data = motif * 3
    return data


def write_wav(path, samples):
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for s in samples:
            v = max(-1.0, min(1.0, s))
            frames += struct.pack("<h", int(v * 32767))
        w.writeframes(bytes(frames))


if __name__ == "__main__":
    import sys

    out = sys.argv[1] if len(sys.argv) > 1 else "ringtone.wav"
    write_wav(out, build())
    print("wrote", out)
