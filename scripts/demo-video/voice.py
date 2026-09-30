"""Speaks the narration in narration.json with Kokoro (open-source neural text-to-speech, Apache 2.0).

    pip install kokoro-onnx soundfile
    # model files (about 350 MB) from https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
    python scripts/demo-video/voice.py path/to/kokoro-v1.0.onnx path/to/voices-v1.0.bin

Writes .video-tmp/voice/<tour>-<id>.wav, bell.wav and durations.json (seconds per line).
"""
import json
import pathlib
import re
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = pathlib.Path(__file__).parent
OUT = pathlib.Path('.video-tmp/voice')
RATE = 24000


def bell():
    """The dashboard's counter bell (src/components/restaurant/bell.ts): two strikes of an E6 bell."""
    t = np.arange(int(RATE * 2.2)) / RATE
    out = np.zeros_like(t)
    for start, volume in ((0.0, 0.35), (0.32, 0.315)):
        for ratio, level, decay in ((1, 1, 1.6), (2.76, 0.45, 0.9), (5.4, 0.25, 0.5), (8.93, 0.12, 0.3)):
            s = t - start
            env = np.where(s >= 0, level * np.exp(-np.clip(s, 0, None) * 9.2 / decay), 0)
            out += volume * env * np.sin(2 * np.pi * 1318.5 * ratio * s)
    return (out / np.abs(out).max() * 0.5).astype(np.float32)


def spoken(text, pronounce):
    """Applies narration.json's "pronounce" list, so words like PIN are said as words, not spelled out.
    Only the voice uses this; the subtitles keep the written form."""
    for written, said in pronounce.items():
        text = re.sub(rf'\b{re.escape(written)}\b', said, text)
    return text


def voice_style(kokoro, voice):
    """narration.json's "voice" is one Kokoro voice ("af_heart") or a blend of several, weighted
    ({"af_heart": 0.6, "af_sarah": 0.4}): here, the natural af_heart with the livelier af_sarah."""
    if isinstance(voice, str):
        return voice
    total = sum(voice.values())
    return sum(kokoro.get_voice_style(name) * weight / total for name, weight in voice.items())


def main(model, voices):
    script = json.loads((HERE / 'narration.json').read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    kokoro = Kokoro(model, voices)
    voice = voice_style(kokoro, script['voice'])
    durations = {}
    for tour in ('customer', 'restaurant'):
        for line in script[tour]:
            samples, rate = kokoro.create(spoken(line['text'], script.get('pronounce', {})), voice=voice, speed=script['speed'], lang='en-us')
            sf.write(OUT / f"{tour}-{line['id']}.wav", samples, rate)
            durations[f"{tour}-{line['id']}"] = round(len(samples) / rate, 3)
            print(f"{tour}-{line['id']}: {durations[tour + '-' + line['id']]}s")
    sf.write(OUT / 'bell.wav', bell(), RATE)
    (OUT / 'durations.json').write_text(json.dumps(durations, indent=2))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
