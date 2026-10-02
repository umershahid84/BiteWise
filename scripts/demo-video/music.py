"""Composes the background music for the demo videos. The tune and arrangement are written here in code,
so the music is original and free to use anywhere. It is played by FluidSynth with the FluidR3 General MIDI
SoundFont (MIT licence), so the instruments are real recorded samples.

    sudo apt install fluidsynth fluid-soundfont-gm   # macOS: brew install fluid-synth, and download FluidR3_GM.sf2
    pip install mido numpy soundfile
    python scripts/demo-video/music.py      # after record.mjs; writes .video-tmp/<tour>-music.wav

A sunny acoustic-pop groove in D major at 112 BPM: strummed steel-string guitar, bass, electric piano,
claps, shaker and glockenspiel, with a whistled hook in the chorus. It runs in 16-bar rounds (verse:
D A Bm G twice; chorus: G A D Bm G A D A), counted back from the end so the last chorus resolves on a big
D chord, with strings and a cymbal, just as the Bite Wise logo pops in on the end screen.
Set SOUNDFONT=/path/to/font.sf2 to use a different General MIDI SoundFont.
"""
import json
import os
import pathlib
import shutil
import subprocess
import tempfile

import mido
import numpy as np
import soundfile as sf

RATE = 48000
TMP = pathlib.Path('.video-tmp')
TRIM = 0.6  # seconds cut from the start of each recording (keep in step with build.mjs)
LOGO_POP = 0.35  # the logo pops in this long after the end screen starts (record.mjs)
BPM = 112
BEAT = 60 / BPM
BAR = 4 * BEAT
TPB = 480  # MIDI ticks per beat
SOUNDFONTS = ['/usr/share/sounds/sf2/FluidR3_GM.sf2', '/usr/share/soundfonts/FluidR3_GM.sf2', 'FluidR3_GM.sf2']

# Open-position guitar voicings (MIDI note numbers), bass roots, and the notes the keys and glockenspiel use.
GUITAR = {'D': [50, 57, 62, 66], 'A': [45, 52, 57, 61, 64], 'Bm': [47, 54, 59, 62, 66], 'G': [43, 47, 50, 55, 59, 67]}
ROOT = {'D': 38, 'A': 33, 'Bm': 35, 'G': 31}
KEYS = {'D': [62, 66, 69, 73], 'A': [61, 64, 69, 71], 'Bm': [62, 66, 69, 71], 'G': [62, 66, 67, 71]}
VERSE = ['D', 'A', 'Bm', 'G'] * 2
CHORUS = ['G', 'A', 'D', 'Bm', 'G', 'A', 'D', 'A']
# The whistled chorus hook, one list per chorus bar: (note, start beat, length in beats).
HOOK = [[(79, 0, 1), (78, 1, .5), (76, 1.5, .5), (74, 2, 1.5)],
        [(76, 0, .5), (78, .5, .5), (79, 1, 1), (81, 2, 2)],
        [(81, 0, 1), (78, 1, 1), (74, 2, 1), (78, 3, 1)],
        [(76, 0, 1.5), (74, 1.5, .5), (71, 2, 2)],
        [(79, 0, 1), (81, 1, .5), (83, 1.5, 1.5), (81, 3, 1)],
        [(79, 0, 1), (78, 1, 1), (76, 2, 2)],
        [(78, 0, 1.5), (76, 1.5, .5), (74, 2, 2)],
        [(73, 0, 1), (76, 1, 1), (79, 2, 1), (81, 3, 1)]]
# Strumming: (beat, down or up, loudness) over one bar.
STRUM = [(0, 'down', 1.0), (1, 'down', .75), (1.5, 'up', .6), (2.5, 'up', .7), (3, 'down', .85), (3.5, 'up', .6)]

# Channel: (General MIDI program, volume, pan 0-127, reverb). Channel 9 is drums.
CHANNELS = {0: (25, 92, 44, 40), 1: (33, 100, 64, 10), 2: (4, 62, 84, 60), 3: (9, 70, 90, 70),
            4: (78, 84, 58, 80), 5: (48, 70, 64, 90), 9: (0, 96, 64, 30)}
KICK, RIM, CLAP, CLOSED_HAT, SHAKER, TAMBOURINE, CRASH = 36, 37, 39, 42, 70, 54, 49

rng = np.random.default_rng(7)


def soundfont():
    for path in [os.environ.get('SOUNDFONT')] + SOUNDFONTS:
        if path and pathlib.Path(path).exists():
            return path
    raise SystemExit('No General MIDI SoundFont found: install fluid-soundfont-gm or set SOUNDFONT=/path/to/font.sf2')


class Score:
    def __init__(self):
        self.notes = []  # (start s, length s, channel, note, velocity)

    def add(self, at, seconds, channel, note, velocity):
        if at >= 0:
            self.notes.append((at, seconds, channel, int(note), int(np.clip(velocity * rng.uniform(.92, 1.05), 1, 127))))

    def write(self, path):
        events = []
        for at, seconds, ch, note, vel in self.notes:
            events.append((round(at / BEAT * TPB), 1, mido.Message('note_on', channel=ch, note=note, velocity=vel)))
            events.append((round((at + seconds) / BEAT * TPB), 0, mido.Message('note_off', channel=ch, note=note, velocity=0)))
        track = mido.MidiTrack([mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(BPM))])
        for ch, (program, volume, pan, reverb) in CHANNELS.items():
            track += [mido.Message('program_change', channel=ch, program=program),
                      mido.Message('control_change', channel=ch, control=7, value=volume),
                      mido.Message('control_change', channel=ch, control=10, value=pan),
                      mido.Message('control_change', channel=ch, control=91, value=reverb)]
        now = 0
        for tick, _, msg in sorted(events, key=lambda e: (e[0], e[1])):
            track.append(msg.copy(time=tick - now))
            now = tick
        mid = mido.MidiFile(ticks_per_beat=TPB)
        mid.tracks.append(track)
        mid.save(path)


def strum(score, at, chord, direction, level, seconds):
    notes = GUITAR[chord] if direction == 'down' else GUITAR[chord][::-1][:4]
    for i, note in enumerate(notes):
        score.add(at + i * .011, seconds, 0, note, 88 * level)


def bar_music(score, t0, chord, part, intro):
    """One bar of the groove. part is 'verse' or 'chorus'; intro bars are just guitar and shaker."""
    chorus = part == 'chorus'
    for beat, direction, level in STRUM:
        strum(score, t0 + beat * BEAT, chord, direction, level * (.8 if intro else 1), BEAT * (1.4 if beat == 3.5 else .9))
    for i in range(8):
        score.add(t0 + i * BEAT / 2, .1, 9, SHAKER, 58 if i % 2 else 40)
    if intro:
        return
    root = ROOT[chord]
    for beat, note, length in ((0, root, 1.4), (1.5, root + 7, .45), (2, root + 12, .9), (3, root + 7, .45), (3.5, root + 2 if chord != 'Bm' else root + 5, .45)):
        score.add(t0 + beat * BEAT, length * BEAT, 1, note, 96 if beat in (0, 2) else 80)
    for beat in ((0, 1.5, 2) if chorus else (0, 2)):
        score.add(t0 + beat * BEAT, .2, 9, KICK, 92 if beat == 0 else 78)
    for beat in (1, 3):
        score.add(t0 + beat * BEAT, .2, 9, CLAP if chorus else RIM, 84 if chorus else 70)
    if chorus:
        for beat in (1, 3):
            score.add(t0 + beat * BEAT, .2, 9, TAMBOURINE, 56)
        for note in KEYS[chord]:  # off-beat electric piano stabs
            for beat in (.5, 1.5, 2.5, 3.5):
                score.add(t0 + beat * BEAT, BEAT * .35, 2, note, 58)
    else:
        for note in KEYS[chord]:  # sustained electric piano chords
            score.add(t0, BAR * .95, 2, note, 46)
        score.add(t0, BEAT * 1.5, 3, KEYS[chord][2] + 12, 58)  # glockenspiel sparkles
        score.add(t0 + 2.5 * BEAT, BEAT * 1.5, 3, KEYS[chord][1] + 12, 50)


def compose(length, final_at, soundfont_path):
    """length: video length in seconds; final_at: when the final chord should land."""
    score = Score()
    last = int(np.floor(final_at / BAR))  # the bar that starts on the final chord
    origin = final_at - last * BAR  # time of bar 0's downbeat
    first = -1 if origin > .2 else 0
    for bar in range(first, last):
        t0 = origin + bar * BAR
        step = (bar - last + 16) % 16  # 16-bar rounds, counted so the bar before the ending is the chorus's last bar
        part = 'verse' if step < 8 else 'chorus'
        chord = (VERSE if part == 'verse' else CHORUS)[step % 8]
        bar_music(score, t0, chord, part, intro=bar - first < 2)
        if part == 'chorus' and bar - first >= 2:
            for note, start, beats in HOOK[step - 8]:
                score.add(t0 + start * BEAT, beats * BEAT * .92, 4, note, 82)
    # The ending: a big D chord with strings, a glockenspiel run and a cymbal, ringing out.
    tail = max(3.0, length - final_at)
    strum(score, final_at, 'D', 'down', 1.1, tail)
    for note in (50, 57, 62, 66, 69, 74):
        score.add(final_at, tail, 5, note, 80)
    for note in (62, 66, 69, 74):
        score.add(final_at, tail * .8, 2, note, 60)
    for i, note in enumerate((74, 78, 81, 86, 90)):
        score.add(final_at + .1 + i * .09, 1.6, 3, note, 66)
    score.add(final_at, tail, 1, 38, 100)
    score.add(final_at, .3, 9, KICK, 100)
    score.add(final_at, 3, 9, CRASH, 76)

    with tempfile.TemporaryDirectory() as tmp:
        mid, wav = pathlib.Path(tmp, 'music.mid'), pathlib.Path(tmp, 'music.wav')
        score.write(mid)
        subprocess.run([shutil.which('fluidsynth') or 'fluidsynth', '-ni', '-q', '-g', '0.5', '-r', str(RATE), '-F', str(wav),
                        soundfont_path, str(mid)], check=True)
        out, rate = sf.read(wav, always_2d=True)
    assert rate == RATE
    n = int(length * RATE)
    out = np.pad(out, ((0, max(0, n - len(out))), (0, 0)))[:n]
    t = np.arange(n) / RATE
    fade = np.minimum(1, t / 1.0) * np.clip((length - t) / 2.2, 0, 1)
    out = out * fade[:, None]
    return (out / np.abs(out).max() * 0.89).astype(np.float32)


def main():
    font = soundfont()
    for tour in ('customer', 'restaurant'):
        cues = json.loads((TMP / f'{tour}-cues.json').read_text())
        at = {c['id']: c['at'] - TRIM for c in cues if c.get('marker')}
        music = compose(at['finish'], at['outro'] + LOGO_POP, font)
        sf.write(TMP / f'{tour}-music.wav', music, RATE)
        print(f'{tour}: {len(music) / RATE:.1f}s of music, final chord at {at["outro"] + LOGO_POP:.1f}s')


if __name__ == '__main__':
    main()
