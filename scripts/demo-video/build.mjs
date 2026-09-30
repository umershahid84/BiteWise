// Mixes the voice-over and background music into the recorded tours and encodes them for the web (see README.md in this folder).
// Needs an ffmpeg with libx264, libvpx-vp9 and libopus (set FFMPEG=/path/to/ffmpeg if it isn't on PATH).
// Writes public/videos/<tour>-tour.{mp4,webm,vtt,jpg}.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const TMP = path.resolve('.video-tmp');
const OUT = path.resolve('public/videos');
const TRIM = 0.6; // the first moments of a recording are a blank page
const script = JSON.parse(fs.readFileSync(new URL('./narration.json', import.meta.url), 'utf8'));
const durations = JSON.parse(fs.readFileSync(path.join(TMP, 'voice/durations.json'), 'utf8'));
// Poster frame: shortly after this line starts.
const POSTER = { customer: 'pin', restaurant: 'bell' };
const MUSIC_GAIN = 0.16; // background music level before ducking
const LOUDNESS = 'I=-16:TP=-1.5:LRA=11';

const ffmpeg = (args) => execFileSync(FFMPEG, ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
const vttTime = (s) => new Date(Math.max(0, s) * 1000).toISOString().slice(11, 23);

function length(file) {
  const [, h, m, s] = /Duration: (\d+):(\d+):([\d.]+)/.exec(spawnSync(FFMPEG, ['-i', file]).stderr.toString());
  const total = Math.round(Number(h) * 3600 + Number(m) * 60 + Number(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

for (const tour of ['customer', 'restaurant']) {
  const raw = path.join(TMP, `${tour}-raw.webm`);
  const cues = JSON.parse(fs.readFileSync(path.join(TMP, `${tour}-cues.json`), 'utf8'));
  const lines = new Map(script[tour].map((l) => [l.id, l.text]));

  // Voice lines and sound effects: one input per cue, each delayed to its moment in the video.
  const sounds = cues.filter((c) => !c.marker);
  const inputs = sounds.flatMap((c) => ['-i', path.join(TMP, 'voice', c.sound ? `${c.id}.wav` : `${tour}-${c.id}.wav`)]);
  const delayed = sounds.map((c, i) => {
    const ms = Math.max(0, Math.round((c.at - TRIM) * 1000));
    return `[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}:all=1${c.sound ? ',volume=0.6' : ''}[a${i}]`;
  });
  // Background music (music.py), turned down further whenever someone is speaking.
  const music = sounds.length + 1;
  const graph = [
    ...delayed,
    `${sounds.map((_, i) => `[a${i}]`).join('')}amix=inputs=${sounds.length}:normalize=0,asplit=2[vox][key]`,
    `[${music}:a]aresample=48000,highpass=f=70,volume=${MUSIC_GAIN}[bed]`,
    '[bed][key]sidechaincompress=threshold=0.015:ratio=6:attack=25:release=500[duck]',
    '[vox][duck]amix=inputs=2:normalize=0[mix]',
  ];
  const sources = [...inputs, '-i', path.join(TMP, `${tour}-music.wav`)];
  // Loudness in two passes (measure, then apply one fixed gain) so the music doesn't pump between lines.
  // (A short silent input stands in for the video, so the input numbers match the real encode.)
  const report = spawnSync(FFMPEG, ['-hide_banner', '-f', 'lavfi', '-t', '1', '-i', 'anullsrc=r=48000:cl=stereo', ...sources,
    '-filter_complex', [...graph, `[mix]loudnorm=${LOUDNESS}:print_format=json[out]`].join(';'), '-map', '[out]', '-f', 'null', '-'],
  { maxBuffer: 1 << 26 }).stderr.toString();
  const measured = JSON.parse(/\{[^{}]*"input_i"[^{}]*\}/.exec(report)[0]);
  const normalize = `[mix]loudnorm=${LOUDNESS}:linear=true:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
    `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset},aresample=48000[a]`;
  const end = cues.find((c) => c.id === 'finish').at - TRIM; // stop where the music has faded out
  const common = ['-ss', String(TRIM), '-i', raw, ...sources, '-filter_complex', [...graph, normalize].join(';'), '-map', '0:v', '-map', '[a]',
    '-t', end.toFixed(2)];

  const base = path.join(OUT, `${tour}-tour`);
  ffmpeg([...common, '-vf', 'fps=25,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-tune', 'stillimage',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', `${base}.mp4`]);
  ffmpeg([...common, '-vf', 'fps=25', '-c:v', 'libvpx-vp9', '-crf', '40', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2',
    '-c:a', 'libopus', '-b:a', '96k', '-ac', '2', `${base}.webm`]);

  // Subtitles (off by default in the player) with the same words as the voice-over.
  const vtt = ['WEBVTT', ''];
  for (const c of cues.filter((x) => !x.sound && !x.marker)) {
    const start = c.at - TRIM;
    vtt.push(`${vttTime(start)} --> ${vttTime(start + durations[`${tour}-${c.id}`])}`, lines.get(c.id), '');
  }
  fs.writeFileSync(`${base}.vtt`, vtt.join('\n'));

  const poster = cues.find((c) => c.id === POSTER[tour] && !c.sound && !c.marker);
  ffmpeg(['-ss', String(poster.at - TRIM + 1.5), '-i', `${base}.mp4`, '-frames:v', '1', '-q:v', '4', `${base}.jpg`]);

  console.log(`${tour}: ${length(`${base}.mp4`)} → ${base}.{mp4,webm,vtt,jpg}`);
}
