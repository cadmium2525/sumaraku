// ファイターの状態 → ポーズ。角度は「右向きのとき」の絶対角度（前=0°, 上=90°, 下=-90°, 後ろ=180°）。
// null のパーツは描いたままの角度（＋ゆれ）。
const D = Math.PI / 180;

// 技アニメ：windup（ため）→ strike（攻撃）→ 元に戻る
const MOVE_ANIMS = {
  jab: { w: { armF: -30 }, s: { armF: 0, lean: 0.12 } },
  punch: { w: { armF: 160, lean: -0.1 }, s: { armF: 0, armB: -130, lean: 0.25 } },
  uppunch: { w: { armF: -70, lean: 0.2 }, s: { armF: 95, armB: -60, lean: -0.15 } },
  smashpunch: { w: { armF: 170, armB: 20, lean: -0.35 }, s: { armF: 0, armB: -150, lean: 0.45 } },
  kick: { w: { legF: -40, lean: -0.1 }, s: { legF: 5, armB: 130, lean: -0.3 } },
  upkick: { w: { legF: -60 }, s: { legF: 100, armF: -120, armB: 200, lean: -0.4 } },
  sweep: { w: { legF: -60, squash: 0.72 }, s: { legF: -10, squash: 0.65, lean: 0.35 } },
  dashkick: { w: { lean: -0.3 }, s: { legF: -15, legB: -100, lean: -0.7, squash: 0.85 } },
  smashkick: { w: { legF: -120, lean: 0.25 }, s: { legF: 10, armB: 150, lean: -0.5 } },
  flipkick: { w: { squash: 0.8 }, s: { legF: 90, legB: 70, spin: 'back' } },
  splitkick: { w: { squash: 0.8 }, s: { legF: -5, legB: 185, squash: 0.7, armF: 60, armB: 120 } },
  nair: { w: {}, s: { legF: -15, legB: -160, armF: 35, armB: 145 } },
  spike: { w: { armF: 120, armB: 110, lean: -0.2 }, s: { armF: -80, armB: -95, lean: 0.4, legF: -60 } },
  fairkick: { w: { legF: -50 }, s: { legF: 0, lean: -0.25, wobble: 'legF' } },
  backkick: { w: { legB: -60 }, s: { legB: 185, lean: 0.45, armF: 20 } },
  bicycle: { w: {}, s: { legF: 90, legB: 60, spin: 'back' } },
  stomp: { w: { legF: -20, legB: -40, armF: 80, armB: 100 }, s: { legF: -90, legB: -92, armF: 60, armB: 120, squash: 1.1 } },
  drill: { w: {}, s: { legF: -80, legB: -100, armF: 140, armB: 40, spin: 'drill' } },
  rush: { w: { armF: 170 }, s: { armF: 0, armB: 0, wobble: 'rush', lean: 0.2 } },
  dashpunch: { w: { armF: 170, lean: -0.2 }, s: { armF: 0, armB: -140, lean: 0.55 } },
  divekick: { w: { legF: 60 }, s: { legF: -30, legB: -110, lean: -0.35, armF: 140 } },
  axekick: { w: { legF: 120, lean: -0.3 }, s: { legF: -70, lean: 0.3 } },
  uppercut: { w: { armF: -70, squash: 0.8 }, s: { armF: 95, armB: -80, lean: -0.15, spinY: true } },
  spinkick: { w: {}, s: { legF: -10, legB: 190, armF: 30, armB: 150, spin: 'front' } },
  counter: { w: { armF: 100, armB: 70, lean: -0.15 }, s: { armF: 100, armB: 70, lean: -0.15 } },
  counterHit: { w: { armF: 160 }, s: { armF: 0, armB: -140, lean: 0.5 } },
  chargepunch: { w: { armF: 175, armB: -40, lean: -0.45 }, s: { armF: 0, armB: -150, lean: 0.55 } },
  headbutt: { w: { lean: -0.45, armF: -120, armB: -60 }, s: { lean: 0.7, armF: -140, armB: -120 } },
  tackle: { w: { lean: -0.2 }, s: { lean: 0.55, armF: -30, armB: -40 } },
  lariat: { w: {}, s: { armF: 0, armB: 180, spinY: 'fast' } },
  slam: { w: { armF: 110, armB: 115, lean: -0.25 }, s: { armF: -60, armB: -55, lean: 0.4 } },
  quake: { w: { armF: 110, armB: 115, squash: 1.05 }, s: { armF: -90, armB: -90, squash: 0.72 } },
  shoot: { w: { armF: -20 }, s: { armF: 0, armB: -120, lean: -0.08 } },
  shootcharge: { w: { armF: 0, armB: -30 }, s: { armF: 0, armB: -120, lean: -0.15 } },
  missile: { w: { armF: 60 }, s: { armF: 25, lean: -0.1 } },
  bomb: { w: { armF: 160 }, s: { armF: 30 } },
  rocket: { w: { squash: 0.75 }, s: { armF: -100, armB: -80, legF: -95, legB: -85 } },
  mine: { w: { squash: 0.7, armF: -40 }, s: { squash: 0.7, armF: -80, lean: 0.3 } },
  reflect: { w: { armF: 90, armB: 90 }, s: { armF: 90, armB: 90, spinY: 'fast' } },
  slash: { w: { armF: 125, lean: -0.15 }, s: { armF: -35, lean: 0.25 } },
  slashLow: { w: { armF: 50 }, s: { armF: -15, lean: 0.1 } },
  slashUp: { w: { armF: -60, squash: 0.85 }, s: { armF: 105, lean: -0.2 } },
  slashBack: { w: { armF: 40 }, s: { armF: 190, lean: 0.25 } },
  bigslash: { w: { armF: 155, lean: -0.35 }, s: { armF: -45, lean: 0.45 } },
  spinslash: { w: {}, s: { armF: 0, armB: 180, spin: 'front' } },
  splitslash: { w: { armF: 60, squash: 0.85 }, s: { armF: -10, squash: 0.8, wobble: 'split' } },
  plunge: { w: { armF: 90 }, s: { armF: -90, armB: -100, legF: -95, legB: -85 } },
  boomerang: { w: { armF: 160, lean: -0.2 }, s: { armF: 10, lean: 0.2 } },
  lunge: { w: { armF: 160, lean: -0.2 }, s: { armF: 0, armB: -150, lean: 0.55 } },
  grab: { w: { armF: 30, armB: 40 }, s: { armF: 0, armB: 5, lean: 0.25 } },
  pummel: { w: {}, s: { armF: -10, lean: 0.1 } },
  throwF: { w: { armF: 10, armB: 10 }, s: { armF: 40, armB: 40, lean: 0.35 } },
  throwB: { w: { armF: 0, armB: 0 }, s: { armF: 170, armB: 170, lean: -0.4, spinY: true } },
  throwU: { w: { armF: 0, armB: 0, squash: 0.85 }, s: { armF: 95, armB: 95 } },
  throwD: { w: { armF: 60, armB: 60 }, s: { armF: -80, armB: -80, squash: 0.8 } },
  spin: { w: {}, s: { legF: -10, legB: 190, spin: 'front' } },
};

function phases(f) {
  const m = f.move;
  let s0 = Infinity, s1 = -Infinity;
  for (const h of m.hb || []) { s0 = Math.min(s0, h.f0); s1 = Math.max(s1, h.f1); }
  if (m.proj) for (const p of m.proj) { s0 = Math.min(s0, p.f); s1 = Math.max(s1, p.f + 4); }
  if (m.counter) { s0 = m.counter[0]; s1 = m.counter[1]; }
  if (m.reflect) { s0 = m.reflect[0]; s1 = m.reflect[1]; }
  if (m.thr) { s0 = m.thr.f - 2; s1 = m.thr.f + 3; }
  if (s0 === Infinity) { s0 = Math.round(m.total * 0.3); s1 = Math.round(m.total * 0.55); }
  return { s0, s1 };
}

/**
 * 1フレーム分のポーズを返す。
 * { armF, armB, legF, legB: 絶対角(rad) or null, lean, spin, spinY, squash, offY, alpha, swing }
 */
export function poseFor(f, t) {
  const P = { armF: null, armB: null, legF: null, legB: null, lean: 0, spin: 0, spinY: 0, squash: 1, offY: 0, alpha: 1, swing: 0, armSwing: 0, flash: 0 };
  const st = f.state;
  const sf = f.sf;
  switch (st) {
    case 'idle': P.offY = Math.sin(t * 3) * 0.02; P.swing = Math.sin(t * 2.5) * 0.06; break;
    case 'walk': P.swing = Math.sin(t * 9) * 0.45; P.armSwing = -P.swing * 0.8; P.lean = 0.06; break;
    case 'run': P.swing = Math.sin(t * 15) * 0.85; P.armSwing = -P.swing; P.lean = 0.22; P.offY = Math.abs(Math.sin(t * 15)) * 0.06; break;
    case 'crouch': P.squash = 0.65; P.lean = 0.15; break;
    case 'jumpsquat': P.squash = 0.78; break;
    case 'land': P.squash = 0.82; break;
    case 'air':
      if (f.vy > 0) { P.legF = -60; P.legB = -120; P.armF = 30; P.armB = 150; }
      else { P.legF = -75; P.legB = -105; P.armF = 60; P.armB = 120; }
      if (f.jumps < f.st.midair && f.vy > 0.05) P.spin = -Math.min(1, (f.sf / 22)) * Math.PI * 2;
      break;
    case 'helpless': P.armF = 100; P.armB = 80; P.legF = -80; P.legB = -100; P.alpha = 0.75; P.swing = Math.sin(t * 20) * 0.1; break;
    case 'shield': case 'shieldstun': P.squash = 0.9; P.armF = 70; P.armB = 110; break;
    case 'roll': P.spin = (f.dodgeDir === f.facing ? -1 : 1) * Math.min(1, sf / 26) * Math.PI * 2; P.squash = 0.8; P.alpha = f.isIntangible() ? 0.45 : 1; break;
    case 'spotdodge': P.spinY = Math.min(1, sf / 20) * Math.PI * 2; P.alpha = f.isIntangible() ? 0.45 : 1; break;
    case 'airdodge': P.spinY = Math.min(1, sf / 20) * Math.PI * 2; P.alpha = f.isIntangible() ? 0.45 : 1; P.legF = -80; P.legB = -100; break;
    case 'hitstun':
      if (f.tumble) { P.spin = t * 14 * (f.kbx * f.facing > 0 ? -1 : 1); P.armF = 130; P.armB = 50; P.legF = -40; P.legB = -140; }
      else { P.lean = -0.4; P.armF = 140; P.armB = 160; }
      break;
    case 'down': P.spin = Math.PI / 2; P.offY = -0.15; break;
    case 'getup': case 'tech': P.spin = (Math.PI / 2) * Math.max(0, 1 - sf / 12); P.alpha = 0.6; break;
    case 'ledge': P.armF = 75; P.armB = 105; P.legF = -95; P.legB = -85; P.swing = Math.sin(t * 3) * 0.05; break;
    case 'ledgeclimb': P.armF = 40; P.armB = 140; P.legF = -40; P.squash = 0.9; P.alpha = 0.7; break;
    case 'holding': P.armF = 0; P.armB = 5; P.lean = 0.15; break;
    case 'grabbed': P.lean = -0.3; P.armF = 150 + Math.sin(t * 25) * 30; P.armB = 160; P.swing = Math.sin(t * 30) * 0.3; break;
    case 'shieldbreak': P.spin = t * 10; break;
    case 'dizzy': P.lean = Math.sin(t * 4) * 0.35; P.armF = -100; P.armB = -80; break;
    case 'respawn': P.armF = 30; P.armB = 150; P.offY = Math.sin(t * 3) * 0.05; break;
    case 'attack': moveAnim(f, t, P); break;
  }
  if (f.inv > 0 && st !== 'respawn') P.flash = Math.sin(t * 40) > 0 ? 0.5 : 0;
  return P;
}

function moveAnim(f, t, P) {
  const m = f.move;
  const A = MOVE_ANIMS[m.anim] || MOVE_ANIMS.punch;
  const { s0, s1 } = phases(f);
  const mf = f.mf;
  let k, from, to;
  if (mf < s0) { k = mf / Math.max(1, s0); from = {}; to = A.w; }
  else if (mf <= s1) { k = Math.min(1, (mf - s0) / 2 + 0.5); from = A.w; to = A.s; }
  else { k = Math.min(1, (mf - s1) / Math.max(1, (m.total - s1) * 0.7)); from = A.s; to = {}; }
  k = Math.max(0, Math.min(1, k));
  for (const key of ['armF', 'armB', 'legF', 'legB']) {
    const a = from[key], b = to[key];
    if (a === undefined && b === undefined) continue;
    if (a === undefined) { P[key] = b * D; P[key + 'W'] = k; }
    else if (b === undefined) { P[key] = a * D; P[key + 'W'] = 1 - k; }
    else { P[key] = (a + (b - a) * k) * D; P[key + 'W'] = 1; }
  }
  for (const key of ['lean']) P[key] = (from[key] || 0) + ((to[key] || 0) - (from[key] || 0)) * k;
  P.squash = (from.squash || 1) + ((to.squash || 1) - (from.squash || 1)) * k;
  // 回転系
  const strike = mf >= s0 && mf <= s1 + 6;
  const prog = Math.max(0, Math.min(1, (mf - s0 + 2) / Math.max(4, s1 - s0 + 8)));
  if (A.s.spin === 'back' && strike) P.spin = prog * Math.PI * 2;
  if (A.s.spin === 'front' && mf >= s0 - 2) P.spin = -Math.min(1, (mf - s0 + 2) / Math.max(6, s1 - s0 + 4)) * Math.PI * 2 * (m.mv ? 2 : 1);
  if (A.s.spin === 'drill' && strike) P.spinY = t * 30;
  if (A.s.spinY === 'fast' && mf >= s0 - 2 && mf <= s1 + 2) P.spinY = t * 25;
  else if (A.s.spinY === true && strike) P.spinY = prog * Math.PI * 2;
  if (A.s.wobble === 'rush' && strike) { const o = Math.sin(t * 50); P.armF = (o > 0 ? 0 : 120) * D; P.armB = (o > 0 ? 130 : 0) * D; P.armFW = P.armBW = 1; }
  if (A.s.wobble === 'legF' && strike) { P.legF = (Math.sin(t * 45) * 40) * D; P.legFW = 1; }
  if (A.s.wobble === 'split' && mf > s1 - 4) { P.armF = 190 * D; P.armFW = 1; }
  // ため中は震える
  if (m.charge && mf === m.charge.at && !f.charged) {
    P.shake = 0.03 + 0.05 * (f.charge / m.charge.max);
    P.flash = Math.sin(t * 30) > 0 ? 0.25 + 0.4 * (f.charge / m.charge.max) : 0;
  }
  if (m.armor && mf >= m.armor[0] && mf <= m.armor[1]) P.armorGlow = 1;
  if (m.counter && mf >= m.counter[0] && mf <= m.counter[1]) P.counterGlow = 1;
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
