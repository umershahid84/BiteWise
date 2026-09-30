# Demo videos

The narrated tours in `public/videos/` (home page, **How it works** on the deals page, **Watch the tour** on the restaurant dashboard) are recorded from the real app and end on an animated Rescue Bites logo ("Happy rescuing!" / "Happy selling!"). The voice-over is generated with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx), an open-source text-to-speech model (Apache 2.0) that runs on your own computer. The upbeat background music is an original tune written in code by `music.py` and played with real instrument samples by [FluidSynth](https://www.fluidsynth.org/) and the FluidR3 General MIDI SoundFont (MIT licence), so no music licences are needed. It dips automatically while the narrator speaks.

To change what is said, edit `narration.json`, then rebuild:

```bash
# 1. Voice (Python 3.10+; model files from https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0)
pip install kokoro-onnx soundfile
python scripts/demo-video/voice.py kokoro-v1.0.onnx voices-v1.0.bin   # → .video-tmp/voice/

# 2. Screen recording, timed to the voice (needs Playwright's Chromium: npx playwright install chromium)
npm run db:reset && npm run seed      # fresh demo data
npm run dev                           # in another terminal
node scripts/demo-video/record.mjs    # → .video-tmp/*-raw.webm, *-cues.json

# 3. Background music, fitted to each recording
sudo apt install fluidsynth fluid-soundfont-gm   # macOS: brew install fluid-synth, then SOUNDFONT=/path/to/FluidR3_GM.sf2
pip install mido
python scripts/demo-video/music.py    # → .video-tmp/*-music.wav

# 4. Mix and encode (ffmpeg with libx264, libvpx-vp9 and libopus)
node scripts/demo-video/build.mjs     # → public/videos/*-tour.{mp4,webm,vtt,jpg}
```

`build.mjs` prints each video's length; update `length` in `src/components/app/demo-video.tsx` if it changed. The `.vtt` files are optional subtitles (off by default in the player) with the same words as the voice-over. The bell in the restaurant tour is the dashboard's own order bell (`src/components/restaurant/bell.ts`), recreated in `voice.py`.

The music's volume is `MUSIC_GAIN` in `build.mjs`; its tempo, chords, instruments and the whistled hook are at the top of `music.py`. The end screen's wording is `OUTRO` in `record.mjs`.

Words the voice would spell out letter by letter (it reads capitals as abbreviations) go in `pronounce` in `narration.json`: `"PIN": "pin"` makes it say the word, while the subtitles keep "PIN". Voice and speed are set at the top of `narration.json`: `af_jessica`, a bright, youthful US English voice, slightly faster than normal. Other voices include `af_bella`, `af_heart`, `bf_emma` and `bf_alice` (British); a blend of several can be given with weights, e.g. `{ "af_heart": 0.6, "af_sarah": 0.4 }`.
