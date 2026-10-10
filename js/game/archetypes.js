// キャラタイプ（軽量格闘 / 重量破壊 / 射撃 / 武器）ごとの性能と技。
// 技は seed から決定論的に選ばれるので、同じラクガキはいつでも同じ技になる。
// ヒットボックスの x, y, r は「身長 = 1」とした比率。
import { RNG } from './rng.js';

export const TYPES = {
  light: { name: '軽量近接格闘型', short: '格闘', color: '#ff8a3d' },
  heavy: { name: '重量破壊型', short: '重量', color: '#c0392b' },
  shooter: { name: '射撃型', short: '射撃', color: '#2e86de' },
  weapon: { name: '武器キャラ', short: '武器', color: '#8e44ad' },
};
export const TYPE_KEYS = Object.keys(TYPES);

export const MOVE_SLOTS = [
  ['jab', '弱攻撃'], ['ftilt', '横強'], ['utilt', '上強'], ['dtilt', '下強'], ['dash', 'ダッシュ攻撃'],
  ['fsmash', '横スマッシュ'], ['usmash', '上スマッシュ'], ['dsmash', '下スマッシュ'],
  ['nair', '空N'], ['fair', '空前'], ['bair', '空後'], ['uair', '空上'], ['dair', '空下'],
  ['nspec', '通常必殺ワザ'], ['sspec', '横必殺ワザ'], ['uspec', '上必殺ワザ'], ['dspec', '下必殺ワザ'],
];

const hb = (f0, f1, x, y, r, dmg, ang, bkb, kbg, o = {}) => ({ f0, f1, x, y, r, dmg, ang, bkb, kbg, ...o });
const mv = (o) => ({ total: 30, hb: [], anim: 'punch', ...o });
const aerial = (o) => mv({ aerial: true, landingLag: 9, ...o });

// 連続ヒット（多段技）のヒットボックスを並べる
function multi(from, to, every, x, y, r, dmg, ang, bkb, kbg, o = {}) {
  const out = [];
  for (let f = from; f <= to; f += every) out.push(hb(f, f + 1, x, y, r, dmg, ang, bkb, kbg, o));
  return out;
}

const STATS = {
  light: { weight: 86, h: 1.6, w: 0.62, walk: 0.095, run: 0.205, air: 0.12, airAccel: 0.009, grav: 0.0105, fall: 0.17, ffall: 0.27, jumpV: 0.29, shortV: 0.19, djV: 0.28, midair: 1 },
  heavy: { weight: 114, h: 1.92, w: 0.95, walk: 0.07, run: 0.15, air: 0.095, airAccel: 0.0065, grav: 0.0115, fall: 0.19, ffall: 0.3, jumpV: 0.275, shortV: 0.175, djV: 0.26, midair: 1 },
  shooter: { weight: 98, h: 1.75, w: 0.75, walk: 0.08, run: 0.168, air: 0.105, airAccel: 0.0075, grav: 0.0095, fall: 0.155, ffall: 0.25, jumpV: 0.28, shortV: 0.18, djV: 0.27, midair: 1 },
  weapon: { weight: 100, h: 1.8, w: 0.78, walk: 0.085, run: 0.178, air: 0.11, airAccel: 0.008, grav: 0.01, fall: 0.165, ffall: 0.26, jumpV: 0.28, shortV: 0.18, djV: 0.27, midair: 1 },
};

// ---- 共通の技（つかみ・投げ・崖攻撃） ----
function commonMoves(power = 1) {
  return {
    grab: mv({ name: 'つかみ', anim: 'grab', total: 32, hb: [hb(6, 8, 0.38, 0.5, 0.26, 0, 0, 0, 0, { grab: true })] }),
    pummel: mv({ name: 'つかみ攻撃', anim: 'pummel', total: 16 }),
    fthrow: mv({ name: '前投げ', anim: 'throwF', total: 30, thr: { f: 10, dmg: 8 * power, ang: 45, bkb: 60, kbg: 62 } }),
    bthrow: mv({ name: '後投げ', anim: 'throwB', total: 34, thr: { f: 14, dmg: 10 * power, ang: 45, bkb: 60, kbg: 70, back: true } }),
    uthrow: mv({ name: '上投げ', anim: 'throwU', total: 32, thr: { f: 12, dmg: 7 * power, ang: 90, bkb: 70, kbg: 60 } }),
    dthrow: mv({ name: '下投げ', anim: 'throwD', total: 32, thr: { f: 14, dmg: 6 * power, ang: 75, bkb: 60, kbg: 45 } }),
    ledgeatk: mv({ name: '崖のぼり攻撃', anim: 'kick', total: 34, intang: [0, 10], hb: [hb(10, 13, 0.45, 0.35, 0.36, 9, 45, 90, 20)] }),
    getupatk: mv({ name: 'おきあがり攻撃', anim: 'spin', total: 36, intang: [0, 14], hb: [hb(12, 13, 0.5, 0.2, 0.34, 7, 361, 80, 20), hb(16, 17, -0.5, 0.2, 0.34, 7, 361, 80, 20)] }),
    counterAtk: mv({ name: 'カウンター攻撃', anim: 'counterHit', total: 30, intang: [0, 20] }),
  };
}

// ---- 軽量近接格闘型 ----
function lightMoves(r) {
  return {
    jab: mv({ name: 'ジャブ連打', anim: 'jab', total: 16, cancel: 8, hb: [hb(2, 3, 0.42, 0.6, 0.2, 2.5, 361, 18, 25)] }),
    ftilt: r.pick([
      mv({ name: 'まえげり', anim: 'kick', total: 24, hb: [hb(5, 7, 0.5, 0.42, 0.24, 7.5, 361, 12, 100)] }),
      mv({ name: 'ストレート', anim: 'punch', total: 22, hb: [hb(5, 7, 0.55, 0.6, 0.24, 7, 361, 15, 95)] }),
    ]),
    utilt: mv({ name: 'うえげり', anim: 'upkick', total: 26, hb: [hb(5, 10, 0.15, 0.98, 0.32, 6, 95, 40, 115)] }),
    dtilt: mv({ name: 'あしばらい', anim: 'sweep', total: 20, crouch: true, hb: [hb(5, 7, 0.52, 0.08, 0.22, 6, 75, 45, 55)] }),
    dash: mv({ name: 'スライディング', anim: 'dashkick', total: 34, slide: 0.94, hb: [hb(6, 14, 0.45, 0.3, 0.3, 8, 60, 60, 62)] }),
    fsmash: r.pick([
      mv({ name: 'スマッシュパンチ', anim: 'smashpunch', total: 50, charge: { at: 8, max: 60 }, hb: [hb(14, 16, 0.62, 0.58, 0.3, 16, 361, 30, 100)] }),
      mv({ name: 'まわしげり', anim: 'smashkick', total: 48, charge: { at: 8, max: 60 }, hb: [hb(12, 14, 0.6, 0.5, 0.32, 15, 361, 32, 102)] }),
    ]),
    usmash: mv({ name: 'サマーソルト', anim: 'flipkick', total: 42, charge: { at: 5, max: 60 }, hb: [hb(10, 14, 0.12, 1.05, 0.36, 14, 90, 32, 97)] }),
    dsmash: mv({ name: '開脚げり', anim: 'splitkick', total: 44, charge: { at: 3, max: 60 }, hb: [hb(6, 7, 0.5, 0.1, 0.3, 12, 30, 30, 100), hb(12, 13, -0.5, 0.1, 0.3, 12, 30, 30, 100, { g: 1 })] }),
    nair: aerial({ name: 'くうちゅうキック', anim: 'nair', total: 36, landingLag: 6, hb: [hb(3, 6, 0.15, 0.5, 0.45, 9, 361, 10, 98), hb(7, 24, 0.15, 0.5, 0.42, 5, 361, 8, 90)] }),
    fair: r.pick([
      aerial({ name: 'メテオかかと', anim: 'spike', total: 44, landingLag: 14, hb: [hb(15, 18, 0.45, 0.32, 0.28, 13, 280, 25, 80)] }),
      aerial({ name: 'れんぞくキック', anim: 'fairkick', total: 40, landingLag: 10, hb: [...multi(5, 14, 3, 0.45, 0.45, 0.32, 2, 60, 25, 20), hb(17, 19, 0.45, 0.45, 0.36, 6, 361, 30, 120, { g: 9 })] }),
    ]),
    bair: aerial({ name: 'うしろげり', anim: 'backkick', total: 30, landingLag: 8, hb: [hb(6, 9, -0.52, 0.5, 0.3, 12, 361, 12, 100)] }),
    uair: aerial({ name: 'バク転キック', anim: 'bicycle', total: 30, landingLag: 6, hb: [hb(4, 10, 0.0, 1.05, 0.35, 7, 75, 35, 112)] }),
    dair: r.pick([
      aerial({ name: 'ふみつけ', anim: 'stomp', total: 40, landingLag: 14, hb: [hb(14, 16, 0, -0.05, 0.3, 12, 270, 20, 90)] }),
      aerial({ name: 'ドリルキック', anim: 'drill', total: 40, landingLag: 12, hb: [...multi(6, 21, 3, 0.05, 0.0, 0.32, 1.6, 290, 20, 10), hb(24, 25, 0, 0, 0.36, 4, 60, 50, 90, { g: 9 })] }),
    ]),
    nspec: r.pick([
      mv({ name: 'れんだラッシュ', anim: 'rush', total: 52, hb: [...multi(5, 29, 4, 0.5, 0.55, 0.32, 1.2, 361, 12, 8), hb(34, 36, 0.55, 0.55, 0.36, 5, 361, 55, 110, { g: 20 })] }),
      mv({ name: 'ダッシュストレート', anim: 'dashpunch', total: 46, mv: [{ f0: 8, f1: 20, vx: 0.26 }], hb: [hb(10, 20, 0.5, 0.55, 0.32, 11, 40, 50, 78)] }),
    ]),
    sspec: r.pick([
      mv({ name: 'とびげり', anim: 'divekick', total: 40, mv: [{ f0: 6, f1: 22, vx: 0.32, vy: 0.03 }], hb: [hb(8, 22, 0.45, 0.4, 0.3, 9, 45, 50, 70)] }),
      mv({ name: 'かかとおとし', anim: 'axekick', total: 44, mv: [{ f0: 4, f1: 12, vx: 0.18, vy: 0.08 }], hb: [hb(14, 17, 0.5, 0.55, 0.33, 12, 280, 30, 70)] }),
    ]),
    uspec: r.pick([
      mv({ name: 'しょうりゅうけん', anim: 'uppercut', total: 50, helpless: true, steer: 0.05, mv: [{ f0: 3, f1: 20, vy: 0.36 }], hb: [hb(3, 5, 0.3, 0.6, 0.32, 10, 80, 60, 80), hb(6, 16, 0.2, 0.9, 0.26, 4, 80, 30, 60, { g: 0 })] }),
      mv({ name: 'かいてんジャンプ', anim: 'spinkick', total: 50, helpless: true, steer: 0.07, mv: [{ f0: 4, f1: 26, vy: 0.32 }], hb: [...multi(4, 20, 4, 0, 0.6, 0.45, 1.5, 90, 30, 10), hb(24, 26, 0, 0.7, 0.48, 4, 70, 50, 100, { g: 20 })] }),
    ]),
    dspec: r.pick([
      mv({ name: 'カウンター', anim: 'counter', total: 50, counter: [5, 28] }),
      mv({ name: 'きゅうこうかキック', anim: 'divekick', total: 44, landCancel: true, mv: [{ f0: 1, f1: 7, vy: 0.12 }, { f0: 8, f1: 32, vx: 0.28, vy: -0.36 }], hb: [hb(8, 32, 0.3, 0.05, 0.3, 10, 40, 45, 80)] }),
    ]),
  };
}

// ---- 重量破壊型 ----
function heavyMoves(r) {
  return {
    jab: mv({ name: 'ヘビージャブ', anim: 'jab', total: 26, cancel: 15, hb: [hb(5, 7, 0.5, 0.55, 0.3, 5, 361, 30, 50)] }),
    ftilt: mv({ name: 'ぶちかまし', anim: 'punch', total: 34, hb: [hb(9, 11, 0.6, 0.5, 0.33, 12, 361, 20, 96)] }),
    utilt: mv({ name: 'ふりあげ', anim: 'uppunch', total: 36, hb: [hb(8, 13, 0.15, 1.0, 0.38, 11, 88, 45, 92)] }),
    dtilt: mv({ name: 'しゃがみパンチ', anim: 'sweep', total: 30, crouch: true, hb: [hb(8, 10, 0.6, 0.1, 0.3, 10, 30, 40, 72)] }),
    dash: mv({ name: 'ボディアタック', anim: 'tackle', total: 44, slide: 0.95, hb: [hb(8, 16, 0.45, 0.5, 0.38, 13, 45, 60, 76)] }),
    fsmash: r.pick([
      mv({ name: 'はかいパンチ', anim: 'smashpunch', total: 64, armor: [4, 24], charge: { at: 10, max: 60 }, hb: [hb(22, 25, 0.66, 0.5, 0.4, 23, 361, 30, 96)] }),
      mv({ name: 'ハンマーナックル', anim: 'slam', total: 62, armor: [4, 22], charge: { at: 10, max: 60 }, hb: [hb(20, 23, 0.6, 0.35, 0.42, 22, 50, 35, 94)] }),
    ]),
    usmash: mv({ name: 'てんつきアッパー', anim: 'uppunch', total: 56, charge: { at: 6, max: 60 }, hb: [hb(16, 20, 0.1, 1.1, 0.42, 20, 90, 35, 90)] }),
    dsmash: mv({ name: 'じわれ', anim: 'quake', total: 56, charge: { at: 6, max: 60 }, hb: [hb(15, 18, 0.62, 0.1, 0.38, 18, 25, 35, 92), hb(15, 18, -0.62, 0.1, 0.38, 18, 25, 35, 92, { g: 0 })] }),
    nair: aerial({ name: 'ボディプレス', anim: 'nair', total: 42, landingLag: 10, hb: [hb(6, 20, 0, 0.5, 0.5, 12, 361, 20, 95)] }),
    fair: r.pick([
      aerial({ name: 'たたきおとし', anim: 'slam', total: 50, landingLag: 18, hb: [hb(18, 21, 0.55, 0.4, 0.36, 17, 280, 25, 80)] }),
      aerial({ name: 'ラリアット', anim: 'punch', total: 46, landingLag: 15, hb: [hb(13, 16, 0.6, 0.5, 0.36, 16, 361, 25, 92)] }),
    ]),
    bair: aerial({ name: 'うしろひじ', anim: 'backkick', total: 38, landingLag: 11, hb: [hb(8, 11, -0.55, 0.5, 0.35, 16, 361, 20, 95)] }),
    uair: aerial({ name: 'ずつき', anim: 'headbutt', total: 40, landingLag: 10, hb: [hb(8, 12, 0, 1.1, 0.4, 14, 80, 30, 95)] }),
    dair: aerial({ name: 'ヒッププレス', anim: 'stomp', total: 50, landingLag: 18, hb: [hb(16, 19, 0, -0.05, 0.38, 16, 270, 25, 85)] }),
    nspec: r.pick([
      mv({ name: 'ためパンチ', anim: 'chargepunch', total: 52, charge: { at: 10, max: 120, mult: 1.8, btn: 'b' }, hb: [hb(16, 19, 0.65, 0.55, 0.42, 10, 361, 40, 85)] }),
      mv({ name: 'ばくれつずつき', anim: 'headbutt', total: 56, armor: [5, 20], hb: [hb(20, 23, 0.55, 0.75, 0.42, 18, 361, 40, 86)] }),
    ]),
    sspec: r.pick([
      mv({ name: 'ショルダータックル', anim: 'tackle', total: 48, armor: [6, 26], mv: [{ f0: 10, f1: 26, vx: 0.3 }], hb: [hb(10, 26, 0.5, 0.5, 0.4, 13, 45, 60, 80)] }),
      mv({ name: 'ぶんまわし', anim: 'lariat', total: 52, mv: [{ f0: 8, f1: 38, vx: 0.08 }], hb: [...multi(8, 33, 5, 0, 0.55, 0.62, 2.5, 361, 20, 15), hb(38, 40, 0, 0.55, 0.66, 7, 361, 55, 100, { g: 20 })] }),
    ]),
    uspec: mv({ name: 'ジャンプスラム', anim: 'uppunch', total: 48, helpless: true, steer: 0.05, mv: [{ f0: 4, f1: 18, vy: 0.36 }], hb: [hb(4, 10, 0.2, 0.85, 0.42, 9, 85, 60, 65)] }),
    dspec: mv({ name: 'じしん', anim: 'quake', total: 50, hb: [hb(18, 22, 0.85, 0.05, 0.45, 14, 80, 60, 75), hb(18, 22, -0.85, 0.05, 0.45, 14, 80, 60, 75, { g: 0 })] }),
    dspecAir: mv({ name: 'じしん', anim: 'stomp', total: 90, plunge: 'dspec', mv: [{ f0: 1, f1: 6, vy: 0.08 }, { f0: 7, f1: 90, vy: -0.5, vx: 0 }], hb: [hb(7, 90, 0, -0.05, 0.38, 12, 270, 30, 80)] }),
  };
}

// ---- 射撃型 ----
function shooterMoves(r) {
  const base = lightMoves(r);
  // 通常技は少し弱め
  for (const k of ['jab', 'ftilt', 'utilt', 'dtilt', 'dash', 'fsmash', 'usmash', 'dsmash', 'nair', 'fair', 'bair', 'uair', 'dair']) {
    base[k] = { ...base[k], hb: base[k].hb.map((h) => ({ ...h, dmg: +(h.dmg * 0.88).toFixed(1) })) };
  }
  base.fsmash = mv({ name: 'ゼロきょりバースト', anim: 'shoot', total: 52, charge: { at: 9, max: 60 }, hb: [hb(15, 17, 0.7, 0.55, 0.36, 15, 361, 30, 100)] });
  return {
    ...base,
    nspec: r.pick([
      mv({ name: 'チャージショット', anim: 'shootcharge', total: 34, charge: { at: 8, max: 90, btn: 'b' }, proj: [{ f: 12, kind: 'charge', x: 0.55, y: 0.6, vx: 0.3, r: 0.14, rMax: 0.42, dmg: 4, dmgMax: 26, ang: 361, bkb: 30, kbg: 70, life: 90 }] }),
      mv({ name: 'れんしゃ', anim: 'shoot', total: 38, proj: [6, 14, 22].map((f) => ({ f, kind: 'bullet', x: 0.55, y: 0.62, vx: 0.45, r: 0.12, dmg: 2.4, ang: 361, bkb: 12, kbg: 20, life: 38 })) }),
    ]),
    sspec: r.pick([
      mv({ name: 'ホーミングミサイル', anim: 'missile', total: 46, proj: [{ f: 16, kind: 'missile', x: 0.5, y: 0.65, vx: 0.14, r: 0.18, dmg: 9, ang: 45, bkb: 40, kbg: 72, life: 120, homing: 0.012 }] }),
      mv({ name: 'バウンドボム', anim: 'bomb', total: 44, proj: [{ f: 14, kind: 'bomb', x: 0.4, y: 0.8, vx: 0.17, vy: 0.2, r: 0.2, grav: 0.011, bounces: 2, dmg: 12, ang: 60, bkb: 50, kbg: 72, life: 150, blast: 0.7 }] }),
    ]),
    uspec: mv({ name: 'ロケットジャンプ', anim: 'rocket', total: 46, helpless: true, steer: 0.08, mv: [{ f0: 6, f1: 20, vy: 0.42 }], hb: [hb(6, 9, 0, -0.1, 0.5, 8, 270, 40, 60)] }),
    dspec: r.pick([
      mv({ name: 'じらい', anim: 'mine', total: 34, proj: [{ f: 12, kind: 'mine', x: 0.35, y: 0.05, vx: 0, r: 0.22, dmg: 13, ang: 80, bkb: 55, kbg: 72, life: 900, blast: 0.8, max: 1 }] }),
      mv({ name: 'リフレクター', anim: 'reflect', total: 32, reflect: [4, 24], hb: [hb(4, 5, 0, 0.5, 0.45, 4, 90, 40, 40)] }),
    ]),
  };
}

// ---- 武器キャラ ---- R は描いた武器の長さ（0.6〜1.6）
function weaponMoves(r, R) {
  const tip = 0.42 + 0.5 * R;
  const mid = 0.3 + 0.25 * R;
  const sw = (f0, f1, y, dmg, ang, bkb, kbg, o = {}) => [
    hb(f0, f1, tip, y, 0.26, dmg, ang, bkb, kbg, { g: 0, ...o }),
    hb(f0, f1, mid, y, 0.26, dmg * 0.85, ang, bkb, kbg, { g: 0, ...o }),
  ];
  return {
    jab: mv({ name: 'こぎり', anim: 'slashLow', total: 22, cancel: 13, hb: sw(4, 6, 0.55, 4, 361, 25, 40) }),
    ftilt: mv({ name: 'よこぎり', anim: 'slash', total: 32, hb: sw(8, 11, 0.5, 10, 361, 20, 95) }),
    utilt: mv({ name: 'うえぎり', anim: 'slashUp', total: 32, hb: [hb(6, 12, 0.2, 0.9 + 0.3 * R, 0.38, 9, 90, 40, 105)] }),
    dtilt: mv({ name: 'あしばらい', anim: 'sweep', total: 26, crouch: true, hb: sw(6, 8, 0.12, 7, 75, 45, 55) }),
    dash: mv({ name: 'ダッシュぎり', anim: 'slash', total: 38, slide: 0.95, hb: sw(8, 12, 0.45, 10, 50, 60, 70) }),
    fsmash: mv({ name: 'だいせつだん', anim: 'bigslash', total: 58, charge: { at: 10, max: 60 }, hb: sw(16, 19, 0.5, 18, 361, 35, 100) }),
    usmash: mv({ name: 'てんくうぎり', anim: 'slashUp', total: 50, charge: { at: 6, max: 60 }, hb: [hb(12, 18, 0.1, 1.0 + 0.4 * R, 0.42, 15, 90, 35, 95)] }),
    dsmash: mv({ name: 'りょうぎり', anim: 'splitslash', total: 50, charge: { at: 4, max: 60 }, hb: [hb(8, 9, tip, 0.12, 0.3, 13, 30, 30, 98), hb(16, 17, -tip, 0.12, 0.3, 13, 30, 30, 98, { g: 1 })] }),
    nair: aerial({ name: 'かいてんぎり', anim: 'spinslash', total: 40, landingLag: 9, hb: [hb(5, 14, 0, 0.5, 0.4 + 0.3 * R, 9, 361, 20, 90)] }),
    fair: aerial({ name: 'まえぎり', anim: 'slash', total: 40, landingLag: 10, hb: sw(7, 10, 0.6, 12, 361, 20, 95) }),
    bair: aerial({ name: 'うしろぎり', anim: 'slashBack', total: 38, landingLag: 10, hb: [hb(8, 11, -tip, 0.55, 0.3, 13, 361, 15, 100), hb(8, 11, -mid, 0.55, 0.28, 11, 361, 15, 100, { g: 0 })] }),
    uair: aerial({ name: 'うえつき', anim: 'slashUp', total: 36, landingLag: 8, hb: [hb(6, 12, 0, 1.0 + 0.3 * R, 0.38, 10, 80, 30, 105)] }),
    dair: aerial({ name: 'したつき', anim: 'plunge', total: 44, landingLag: 14, hb: [hb(12, 16, 0, -0.1 - 0.2 * R, 0.32, 13, 270, 20, 90)] }),
    nspec: r.pick([
      mv({ name: 'ブーメラン', anim: 'boomerang', total: 40, proj: [{ f: 12, kind: 'boomerang', x: 0.6, y: 0.6, vx: 0.38, r: 0.3, dmg: 7, ang: 45, bkb: 40, kbg: 50, life: 130 }] }),
      mv({ name: 'ためぎり', anim: 'bigslash', total: 40, charge: { at: 8, max: 120, mult: 1.6, btn: 'b' }, hb: sw(14, 17, 0.55, 10, 361, 40, 88) }),
    ]),
    sspec: mv({ name: 'とっしんづき', anim: 'lunge', total: 46, mv: [{ f0: 10, f1: 22, vx: 0.4 }], hb: sw(10, 22, 0.5, 12, 40, 55, 75) }),
    uspec: mv({ name: 'しょうてんぎり', anim: 'spinslash', total: 50, helpless: true, steer: 0.06, mv: [{ f0: 4, f1: 22, vy: 0.34 }], hb: [...multi(4, 16, 4, 0, 0.7, 0.4 + 0.25 * R, 2, 90, 30, 10), hb(20, 22, 0, 0.8, 0.5 + 0.25 * R, 5, 60, 55, 100, { g: 20 })] }),
    dspec: r.pick([
      mv({ name: 'カウンター', anim: 'counter', total: 52, counter: [6, 28] }),
      mv({ name: 'つきおろし', anim: 'plunge', total: 36, hb: sw(10, 13, 0.1, 11, 80, 50, 70) }),
    ]),
    dspecAir: undefined,
  };
}

const TYPE_POWER = { light: 0.95, heavy: 1.25, shooter: 0.9, weapon: 1.0 };
const DMG_MULT = { light: 1.08, heavy: 0.76, shooter: 1.2, weapon: 1.02 };

/** ラクガキの type/seed から対戦用キャラ定義を作る */
export function buildFighterDef({ type, seed, reach = 1, widthRatio = 0.5, name = '???' }) {
  const r = new RNG(seed);
  const base = STATS[type] || STATS.light;
  const jit = () => r.range(0.94, 1.06);
  const stats = { ...base };
  for (const k of ['walk', 'run', 'air', 'jumpV', 'djV']) stats[k] = +(base[k] * jit()).toFixed(4);
  stats.weight = Math.round(base.weight * r.range(0.95, 1.05));
  if (type === 'light' && r.chance(0.4)) stats.midair = 2;
  // 太めに描いたキャラは横幅が少しだけ広い（その分あたり判定も大きい）
  stats.w = base.w * Math.min(1.25, Math.max(0.8, 0.8 + widthRatio * 0.6));

  let moves;
  const R = Math.min(1.6, Math.max(0.6, reach));
  if (type === 'heavy') moves = heavyMoves(r);
  else if (type === 'shooter') moves = shooterMoves(r);
  else if (type === 'weapon') moves = weaponMoves(r, R);
  else moves = lightMoves(r);
  // タイプ間のバランス調整（AI 同士の総当たりで調整）
  const dm = DMG_MULT[type];
  for (const k in moves) {
    const m = moves[k];
    if (!m) continue;
    moves[k] = {
      ...m,
      hb: m.hb.map((h) => ({ ...h, dmg: +(h.dmg * dm).toFixed(1) })),
      proj: m.proj && m.proj.map((p) => ({ ...p, dmg: +(p.dmg * dm).toFixed(1), dmgMax: p.dmgMax && +(p.dmgMax * dm).toFixed(1) })),
    };
  }
  Object.assign(moves, commonMoves(TYPE_POWER[type]));
  for (const k in moves) if (!moves[k]) delete moves[k];
  for (const k in moves) moves[k].key = k;

  return { type, typeName: TYPES[type].name, name, stats, moves, reach: R };
}
