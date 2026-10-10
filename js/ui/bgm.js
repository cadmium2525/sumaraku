// BGM：WebAudio でその場で演奏するオリジナルのチップチューン（音声ファイル不要）
import { audioCtx } from './sound.js';

let enabled = true;
try { enabled = localStorage.getItem('rkg_bgm') !== 'off'; } catch (e) { /* ignore */ }
export function bgmOn() { return enabled; }
export function setBgm(on) {
  enabled = on;
  try { localStorage.setItem('rkg_bgm', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
  if (!on) stopNow(); else if (wanted) start(wanted);
}

const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
export function freq(name) {
  const m = /^([A-G]#?)(\d)$/.exec(name);
  if (!m) return 0;
  const n = NOTE[m[1]] + (Number(m[2]) + 1) * 12;
  return 440 * Math.pow(2, (n - 69) / 12);
}

/** "A4 - C5 . ..." → 16分音符ごとの配列（音名 / '-' のばす / '.' 休み） */
function bar(str) {
  const t = str.trim().split(/\s+/);
  while (t.length < 16) t.push('.');
  return t.slice(0, 16);
}

// 和音（ベース音と構成音）
const CH = {
  C: ['C3', ['C4', 'E4', 'G4']], Am: ['A2', ['A3', 'C4', 'E4']], F: ['F2', ['F3', 'A3', 'C4']], G: ['G2', ['G3', 'B3', 'D4']],
  Em: ['E2', ['E3', 'G3', 'B3']], Dm: ['D2', ['D3', 'F3', 'A3']],
  Fmaj7: ['F2', ['F3', 'A3', 'C4', 'E4']], Em7: ['E2', ['E3', 'G3', 'B3', 'D4']], Dm7: ['D2', ['D3', 'F3', 'A3', 'C4']], Cmaj7: ['C3', ['C4', 'E4', 'G4', 'B4']],
};

export const TRACKS = {
  // タイトル・メニュー：明るく軽快
  menu: {
    bpm: 120, chords: ['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G'], drums: 'light', bass: 'bounce', comp: 'offbeat',
    melody: [
      'E5 - G5 - C6 - G5 - E5 - - - C5 - D5 -',
      'E5 - - - C5 - A4 - C5 - E5 - A5 - - -',
      'A5 - G5 - F5 - E5 - F5 - A5 - C6 - - -',
      'B5 - - - G5 - - - D5 - E5 - F5 - G5 -',
      'E5 - G5 - C6 - G5 - E5 - - - G5 - A5 -',
      'C6 - - - B5 - A5 - E5 - - - A5 - - -',
      'F5 - A5 - C6 - A5 - G5 - F5 - E5 - D5 -',
      'C5 - - - - - - - . . . . G4 - B4 -',
    ],
  },
  // ラクガキ中：ゆったり
  draw: {
    bpm: 92, chords: ['Fmaj7', 'Em7', 'Dm7', 'Cmaj7'], drums: 'hat', bass: 'long', comp: 'arp',
    melody: [
      'A5 - - - - - - - G5 - - - E5 - - -',
      'D5 - - - - - - - E5 - - - G5 - - -',
      'F5 - - - - - - - E5 - - - D5 - C5 -',
      'E5 - - - - - - - - - - - . . . .',
    ],
  },
  // 対戦：アップテンポ
  battle: {
    bpm: 150, chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'], drums: 'full', bass: 'drive', comp: 'stab',
    melody: [
      'A4 - C5 - E5 - A5 - G5 - E5 - C5 - E5 -',
      'F5 - - - E5 - C5 - A4 - C5 - D5 - - -',
      'E5 - G5 - C6 - B5 - G5 - E5 - G5 - - -',
      'D5 - B4 - G4 - B4 - D5 - - - B4 - - -',
      'A5 - . A5 G5 - E5 - . E5 D5 - C5 - D5 -',
      'C5 - - - A4 - C5 - F5 - - - E5 - D5 -',
      'E5 - - - G5 - - - C6 - B5 - A5 - G5 -',
      'B5 - - - G5 - D5 - B4 - D5 - G5 - - -',
    ],
  },
};

// ジングル（1回だけ）
const JINGLES = {
  win: { bpm: 160, notes: 'C5 E5 G5 C6 - G5 C6 - - - E6 - - - - -', chord: 'C' },
  lose: { bpm: 110, notes: 'G4 - F4 - E4 - D4 - C4 - - - - - - -', chord: 'Am' },
};

let wanted = null; // 鳴らしたい曲
let cur = null; // 鳴っている曲 { name, track, step, next, out, bars }
let timer = null;
let master = null;
let duck = 1;

function out(ctx) {
  if (!master) {
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  }
  return master;
}

/** 曲をかえる。null で止める。音がまだ使えないときは使えるようになったら鳴らす */
export function playBgm(name) {
  if (wanted === name && cur && cur.name === name) return;
  wanted = name;
  if (!name) { fadeOut(); return; }
  start(name);
}

/** ポーズ中などは小さく */
export function duckBgm(on) {
  duck = on ? 0.35 : 1;
  const ctx = audioCtx();
  if (master && ctx) master.gain.setTargetAtTime(0.32 * duck, ctx.currentTime, 0.1);
}

export function jingle(name) {
  const ctx = audioCtx();
  const J = JINGLES[name];
  if (!enabled || !ctx || ctx.state !== 'running' || !J) return;
  const o = out(ctx);
  const spb = 60 / J.bpm / 4;
  const t0 = ctx.currentTime + 0.05;
  const steps = bar(J.notes);
  steps.forEach((n, i) => {
    if (n === '-' || n === '.') return;
    let len = 1;
    while (steps[i + len] === '-') len++;
    voice(ctx, o, freq(n), t0 + i * spb, len * spb * 0.95, 'square', 0.12);
  });
  const [b, tones] = CH[J.chord];
  voice(ctx, o, freq(b), t0 + 4 * spb, 8 * spb, 'triangle', 0.25);
  tones.forEach((n) => voice(ctx, o, freq(n), t0 + 4 * spb, 8 * spb, 'triangle', 0.05));
}

function start(name) {
  const ctx = audioCtx();
  if (!timer) timer = setInterval(tick, 30);
  if (!enabled || !ctx || ctx.state !== 'running') return; // 起きたら tick から始まる
  if (cur && cur.name === name) return;
  if (cur) cur.out.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
  const g = ctx.createGain();
  g.gain.value = 0;
  g.gain.setTargetAtTime(1, ctx.currentTime, 0.15);
  g.connect(out(ctx));
  const track = TRACKS[name];
  cur = { name, track, step: 0, next: ctx.currentTime + 0.1, out: g, mel: track.melody.map(bar) };
}

function fadeOut() {
  const ctx = audioCtx();
  if (cur && ctx) cur.out.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
  cur = null;
}
function stopNow() {
  const ctx = audioCtx();
  if (cur && ctx) cur.out.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
  cur = null;
}

// 少し先までの音を予約していく（setInterval のずれに強い）
function tick() {
  const ctx = audioCtx();
  if (!ctx || ctx.state !== 'running' || !enabled) return;
  if (wanted && (!cur || cur.name !== wanted)) start(wanted);
  if (!cur) return;
  const T = cur.track;
  const spb = 60 / T.bpm / 4; // 16分音符の長さ
  while (cur.next < ctx.currentTime + 0.15) {
    playStep(ctx, cur, cur.step, cur.next, spb);
    cur.step++;
    cur.next += spb;
  }
}

function playStep(ctx, c, step, t, spb) {
  const T = c.track;
  const o = c.out;
  const nBars = c.mel.length;
  const b = Math.floor(step / 16) % nBars;
  const s = step % 16;
  const [root, tones] = CH[T.chords[b % T.chords.length]];
  // メロディ
  const m = c.mel[b];
  const n = m[s];
  if (n !== '-' && n !== '.') {
    let len = 1;
    while (s + len < 16 && m[s + len] === '-') len++;
    voice(ctx, o, freq(n), t, len * spb * 0.9, T.comp === 'arp' ? 'triangle' : 'square', T.comp === 'arp' ? 0.13 : 0.07, true);
  }
  // ベース
  const rf = freq(root);
  if (T.bass === 'drive' && s % 2 === 0) voice(ctx, o, s % 4 === 0 ? rf : rf * 2, t, spb * 1.6, 'triangle', 0.32);
  if (T.bass === 'bounce' && s % 4 === 0) voice(ctx, o, s % 8 === 0 ? rf : rf * 1.5, t, spb * 3, 'triangle', 0.3);
  if (T.bass === 'long' && s === 0) voice(ctx, o, rf, t, spb * 15, 'sine', 0.28);
  // 伴奏
  if (T.comp === 'stab' && s % 4 === 2) tones.forEach((x) => voice(ctx, o, freq(x), t, spb * 0.8, 'square', 0.025));
  if (T.comp === 'offbeat' && s % 4 === 2) tones.forEach((x) => voice(ctx, o, freq(x), t, spb * 1.2, 'triangle', 0.05));
  if (T.comp === 'arp' && s % 2 === 0) voice(ctx, o, freq(tones[(s / 2) % tones.length]) * 2, t, spb * 2.5, 'sine', 0.05);
  // ドラム
  if (T.drums === 'full') {
    if (s % 8 === 0 || s === 10) kick(ctx, o, t);
    if (s % 8 === 4) snare(ctx, o, t, 0.18);
    if (s % 2 === 0) hat(ctx, o, t, s % 4 === 2 ? 0.06 : 0.035);
  } else if (T.drums === 'light') {
    if (s % 8 === 0) kick(ctx, o, t, 0.5);
    if (s % 8 === 4) snare(ctx, o, t, 0.08);
    if (s % 4 === 2) hat(ctx, o, t, 0.04);
  } else if (T.drums === 'hat') {
    if (s % 4 === 2) hat(ctx, o, t, 0.025);
  }
}

function voice(ctx, dest, f, t, dur, type, vol, vibrato = false) {
  if (!f) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (vibrato && dur > 0.25) {
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 6;
    lg.gain.value = f * 0.006;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t + 0.12); lfo.stop(t + dur + 0.05);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.setValueAtTime(vol, t + Math.max(0.01, dur - 0.04));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf = null;
function noise(ctx) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}
function kick(ctx, dest, t, vol = 0.8) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + 0.16);
}
function snare(ctx, dest, t, vol) {
  const s = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = 1200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  s.connect(f).connect(g).connect(dest);
  s.start(t); s.stop(t + 0.15);
}
function hat(ctx, dest, t, vol) {
  const s = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  s.connect(f).connect(g).connect(dest);
  s.start(t); s.stop(t + 0.05);
}

/** いま鳴っている曲の名前（テスト・デバッグ用） */
export function bgmState() { return cur ? cur.name : null; }

/** 曲をオフラインで録音する（確認用）。OfflineAudioContext を渡す */
export function renderTrack(ctx, name, seconds) {
  const track = TRACKS[name];
  const g = ctx.createGain();
  g.gain.value = 0.32;
  g.connect(ctx.destination);
  const c = { name, track, out: g, mel: track.melody.map(bar) };
  const spb = 60 / track.bpm / 4;
  for (let step = 0, t = 0.05; t < seconds - 0.3; step++, t += spb) playStep(ctx, c, step, t, spb);
  return ctx.startRendering();
}
