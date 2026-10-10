// 効果音（WebAudio で合成。音声ファイル不要）
let ctx = null;
let enabled = true;
try { enabled = localStorage.getItem('rkg_sound') !== 'off'; } catch (e) { /* ignore */ }

export function soundOn() { return enabled; }
export function setSound(on) {
  enabled = on;
  try { localStorage.setItem('rkg_sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
}

/** スマホは最初のタップで AudioContext を起こす必要がある */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tone({ f = 440, f2 = null, dur = 0.1, type = 'square', vol = 0.15, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.15, vol = 0.2, hp = 800, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource();
  s.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.value = vol;
  s.connect(f).connect(g).connect(ctx.destination);
  s.start(t);
}

export function sfx(name, power = 0) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  switch (name) {
    case 'tap': tone({ f: 600, f2: 300, dur: 0.05, vol: 0.06 }); break;
    case 'hit': noise({ dur: 0.08, vol: 0.18, hp: 1200 }); tone({ f: 260, f2: 120, dur: 0.08, vol: 0.12 }); break;
    case 'smash': noise({ dur: 0.25, vol: 0.3, hp: 400 }); tone({ f: 180, f2: 50, dur: 0.3, type: 'sawtooth', vol: 0.18 }); break;
    case 'ko': noise({ dur: 0.6, vol: 0.35, hp: 200 }); tone({ f: 900, f2: 60, dur: 0.7, type: 'sawtooth', vol: 0.15 }); break;
    case 'shield': tone({ f: 900, f2: 700, dur: 0.06, type: 'triangle', vol: 0.1 }); break;
    case 'break': tone({ f: 1200, f2: 200, dur: 0.5, type: 'square', vol: 0.12 }); break;
    case 'jump': tone({ f: 300, f2: 600, dur: 0.08, type: 'triangle', vol: 0.08 }); break;
    case 'shoot': tone({ f: 1200, f2: 400, dur: 0.1, type: 'square', vol: 0.06 }); break;
    case 'boom': noise({ dur: 0.4, vol: 0.3, hp: 100 }); break;
    case 'counter': tone({ f: 1500, f2: 1500, dur: 0.15, type: 'sine', vol: 0.12 }); break;
    case 'count': tone({ f: 660, dur: 0.12, type: 'square', vol: 0.08 }); break;
    case 'go': tone({ f: 990, dur: 0.3, type: 'square', vol: 0.1 }); break;
    case 'gameset': [523, 659, 784, 1046].forEach((f, i) => tone({ f, dur: 0.25, type: 'square', vol: 0.08, delay: i * 0.12 })); break;
    case 'ui': tone({ f: 880, f2: 1320, dur: 0.05, type: 'triangle', vol: 0.06 }); break;
    case 'reveal': [392, 523, 659, 784, 1046].forEach((f, i) => tone({ f, dur: 0.2, type: 'triangle', vol: 0.08, delay: i * 0.08 })); break;
    case 'roll': tone({ f: 500 + Math.random() * 500, dur: 0.04, type: 'square', vol: 0.05 }); break;
  }
}
