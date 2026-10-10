// CPU：人間と同じ入力（スティック＋ボタン）を作ってファイターを動かす。
import { STAGE, LAUNCH_SPEED } from './constants.js';
import { knockback } from './sim.js';
import { RNG } from './rng.js';

const N = { x: 0, y: 0, a: false, b: false, j: false, s: false, smash: false };
const inp = (o) => ({ ...N, ...o });

const GROUND_KEYS = ['jab', 'ftilt', 'utilt', 'dtilt', 'fsmash', 'usmash', 'dsmash', 'grab', 'nspec', 'sspec', 'dspec'];
const AIR_KEYS = ['nair', 'fair', 'bair', 'uair', 'dair', 'nspec', 'sspec'];

/** 技ごとの届く範囲（右向き基準・ワールド単位）を前計算 */
export function analyzeMoves(def) {
  const H = def.stats.h;
  const out = {};
  for (const [k, m] of Object.entries(def.moves)) {
    const r = { key: k, first: Infinity, x1: Infinity, x2: -Infinity, y1: Infinity, y2: -Infinity, dmg: 0, bkb: 0, kbg: 0, ang: 361, total: m.total, grab: false, proj: false, aerial: !!m.aerial };
    for (const h of m.hb) {
      r.first = Math.min(r.first, h.f0);
      r.x1 = Math.min(r.x1, (h.x - h.r) * H); r.x2 = Math.max(r.x2, (h.x + h.r) * H);
      r.y1 = Math.min(r.y1, (h.y - h.r) * H); r.y2 = Math.max(r.y2, (h.y + h.r) * H);
      if (h.dmg >= r.dmg) { r.dmg = h.dmg; r.bkb = h.bkb; r.kbg = h.kbg; r.ang = h.ang; }
      if (h.grab) r.grab = true;
    }
    if (m.mv) for (const p of m.mv) if (p.vx) r.x2 += p.vx * (p.f1 - p.f0) * 0.8;
    if (m.proj) {
      const p = m.proj[0];
      r.proj = true; r.first = p.f; r.x1 = 0.2; r.x2 = p.kind === 'mine' ? 1.2 : p.kind === 'bomb' ? 6 : 10;
      r.y1 = p.y * H - 0.7; r.y2 = p.y * H + 0.6;
      r.dmg = p.dmgMax ? (p.dmg + p.dmgMax) / 2 : p.dmg; r.bkb = p.bkb; r.kbg = p.kbg; r.ang = p.ang;
      if (m.proj.length > 1) r.dmg *= m.proj.length;
    }
    if (m.counter) { r.counter = true; r.first = m.counter[0]; }
    if (m.reflect) r.reflect = true;
    if (r.first === Infinity) continue;
    out[k] = r;
  }
  return out;
}

const PERSONA = {
  light: { dist: 1.2, aggro: 0.85, jumpy: 0.35 },
  heavy: { dist: 1.6, aggro: 0.65, jumpy: 0.2 },
  shooter: { dist: 5.5, aggro: 0.5, jumpy: 0.3 },
  weapon: { dist: 2.0, aggro: 0.7, jumpy: 0.3 },
};

export class AI {
  constructor(fighter, sim, level = 5, seed = 1) {
    this.f = fighter;
    this.sim = sim;
    this.level = Math.max(1, Math.min(9, level));
    this.rng = new RNG(seed);
    this.queue = [];
    this.wait = 0;
    this.reach = analyzeMoves(fighter.def);
    const t = (this.level - 1) / 8;
    this.react = Math.round(20 - 16 * t); // 反応速度（フレーム）
    this.mistake = 0.4 - 0.37 * t;
    this.defend = 0.1 + 0.55 * t;
    this.tech = 0.1 + 0.7 * t;
    this.evade = 0.35 + 0.6 * t; // 飛び道具をよける確率
    this.rushUntil = 0;
    this.p = PERSONA[fighter.def.type] || PERSONA.light;
    this.nextShot = 0;
  }

  get o() { return this.sim.fighters[1 - this.f.slot]; }

  next() {
    if (this.queue.length) {
      const s = this.queue[0];
      s.n--;
      if (s.n <= 0) this.queue.shift();
      return s.in;
    }
    if (this.wait > 0) { this.wait--; return this.hold || N; }
    this.lastX = this.hold ? this.hold.x : 0;
    this.hold = N;
    this.think();
    if (this.queue.length) return this.next();
    return this.hold;
  }

  push(n, o) { this.queue.push({ n, in: inp(o) }); }
  press(btn, o = {}, n = 2) { this.push(n, { ...o, [btn]: true }); this.push(1, { x: o.x || 0, y: o.y || 0 }); }
  idle(n, o = {}) { this.hold = inp(o); this.wait = n; }

  think() {
    const f = this.f, o = this.o, r = this.rng;
    if (f.state === 'dead') return this.idle(10);
    if (f.state === 'respawn') return this.idle(r.int(20, 70), { x: r.chance(0.5) ? 0.5 : -0.5 });
    if (f.state === 'grabbed') { this.push(1, { a: true, x: r.range(-1, 1) }); this.push(1, { x: r.range(-1, 1) }); return; }
    if (f.state === 'holding') return this.chooseThrow();
    if (f.state === 'ledge') return this.ledgeOption();
    if (f.state === 'hitstun') return this.diAndTech();
    if (['attack', 'land', 'jumpsquat', 'roll', 'spotdodge', 'airdodge', 'ledgeclimb', 'shieldstun', 'dizzy', 'shieldbreak', 'getup', 'tech'].includes(f.state)) {
      return this.idle(1, { x: this.isOffstage(f) ? this.recoverDir() : this.lastX * 0.5, a: f.state === 'attack' && f.move && f.move.charge && f.charge < this.chargeWant && f.move.charge.btn !== 'b', b: f.state === 'attack' && f.move && f.move.charge && f.move.charge.btn === 'b' && f.charge < this.chargeWant });
    }
    if (f.state === 'down') return this.press(r.pick(['a', 'j', 's']), {}, 1);

    if (this.isOffstage(f)) return this.recover();
    if (!o.alive || o.state === 'dead' || o.state === 'respawn') return this.center();

    if (r.chance(this.mistake * 0.15)) return this.idle(r.int(4, 18));
    if (this.tryDefend()) return;
    if (this.tryAttack()) return;
    this.move();
  }

  isOffstage(f) {
    const M = STAGE.main;
    if (f.grounded) return false;
    return f.x < M.x1 - 0.1 || f.x > M.x2 + 0.1 || f.y < M.top - 0.2;
  }

  /** 相手が飛び道具を持っているか */
  oppShoots() {
    if (this._oppShoots === undefined) this._oppShoots = this.o.def.type === 'shooter';
    return this._oppShoots;
  }

  // ---- 復帰 ----
  /** 復帰時のスティック左右：ステージの真下なら外側へ出てから崖へ */
  recoverDir() {
    const f = this.f, M = STAGE.main;
    const side = f.x < 0 ? -1 : 1;
    const under = f.y < M.top - 0.2 && Math.abs(f.x) < M.x2 + f.w / 2 + 0.25;
    return under ? side : -side;
  }

  recover() {
    const f = this.f, r = this.rng;
    const M = STAGE.main;
    const side = f.x < 0 ? -1 : 1;
    const ledgeX = side < 0 ? M.x1 : M.x2;
    const dx = ledgeX - f.x; // ステージ側が正
    const toward = this.recoverDir();
    const hd = Math.abs(dx); // 崖までの横距離
    const y = f.y;
    if (f.state === 'helpless' || f.state === 'attack') return this.idle(2, { x: toward });
    // 高い位置ならまずステージへ寄る
    if (y > M.top + 1.2) {
      if (f.jumps > 0 && hd > 7 && f.vy < -0.05) return this.press('j', { x: toward });
      return this.idle(3, { x: toward });
    }
    // 二段ジャンプ
    if (f.jumps > 0 && f.vy < 0.03 && (y < M.top + 0.3 || hd > 4)) {
      this.push(2, { x: toward, j: true });
      this.push(1, { x: toward });
      return this.idle(r.int(4, 10), { x: toward });
    }
    // 横必殺で距離をかせぐ
    const ss = this.reach.sspec;
    if (f.jumps === 0 && hd > 4.5 && y > -4 && !f.usedSideB && ss && !ss.proj && !ss.counter) {
      return this.press('b', { x: toward });
    }
    // 上必殺：崖の下まで落ちてから、届く距離で使う
    const upB = this.reach.uspec;
    if (f.jumps === 0 && f.vy < 0.02 && !f.usedUpB && upB) {
      const reachable = hd < 4 && y < M.top - 0.3;
      const desperate = y < -4.5;
      if (reachable || desperate) {
        const late = this.level < 4 ? r.int(0, 10) : 0;
        if (late) return this.idle(late, { x: toward });
        return this.press('b', { x: toward * (hd > 1.5 ? 0.6 : 0.25), y: 1 });
      }
    }
    return this.idle(2, { x: toward });
  }

  ledgeOption() {
    const r = this.rng;
    const L = this.f.ledge;
    const toward = -L.dir;
    this.idle(r.int(10, 40 - this.level * 2));
    const c = r.next();
    if (c < 0.35) this.push(3, { x: toward });
    else if (c < 0.55) this.press('j', {});
    else if (c < 0.75) this.press('a', {});
    else this.press('s', {});
  }

  diAndTech() {
    const f = this.f, r = this.rng;
    // 生存ベクトル変更：横にふっとぶときは上＆ステージ方向へ
    const toward = f.x > 0 ? -1 : 1;
    const o = { x: toward * 0.7, y: 0.7 };
    if (f.tumble && f.kby < 0 && f.y < 2.5 && r.chance(this.tech * 0.25)) return this.press('s', o, 1);
    return this.idle(2, o);
  }

  chooseThrow() {
    const f = this.f, o = this.o, r = this.rng;
    const M = STAGE.main;
    const fwd = f.facing;
    const edgeAhead = fwd > 0 ? M.x2 - f.x : f.x - M.x1;
    const edgeBehind = fwd > 0 ? f.x - M.x1 : M.x2 - f.x;
    let dir;
    if (o.percent > 110 && r.chance(0.7)) dir = edgeAhead < edgeBehind ? { x: fwd } : { x: -fwd };
    else if (o.percent < 60 && r.chance(0.6)) dir = r.chance(0.5) ? { y: -1 } : { y: 1 };
    else dir = r.pick([{ x: fwd }, { x: -fwd }, { y: 1 }, { y: -1 }]);
    if (r.chance(0.5)) this.press('a', {}, 1);
    this.idle(r.int(4, 10));
    this.push(3, dir);
  }

  center() {
    const f = this.f;
    const dx = -f.x;
    if (Math.abs(dx) > 2) return this.idle(6, { x: Math.sign(dx) * 0.6 });
    return this.idle(8);
  }

  // ---- 防御 ----
  /** こちらに向かってくる飛び道具のうち、いちばん早く当たるもの（フレーム数） */
  incomingProjectile() {
    const f = this.f, o = this.o;
    let best = null;
    const cy = f.y + f.h / 2;
    for (const p of this.sim.projectiles) {
      if (p.owner === f) continue;
      const dx = f.x - p.x;
      const vx = p.vx || 0;
      if (p.kind === 'mine') continue;
      if (Math.abs(dx) > 7 || Math.abs(cy - p.y) > f.h * 0.8 + p.r) continue;
      if (Math.abs(vx) < 0.02 || Math.sign(vx) !== Math.sign(dx)) { if (Math.abs(dx) > 1.2) continue; }
      const t = Math.abs(dx) / Math.max(0.05, Math.abs(vx));
      if (!best || t < best.t) best = { t, p };
    }
    // 撃つ直前の相手も「もうすぐ飛んでくる」として扱う
    if (o.state === 'attack' && o.move && o.move.proj) {
      const first = o.move.proj[0].f;
      const rel = (f.x - o.x) * o.facing;
      if (o.mf < first && rel > 0 && Math.abs(f.y - o.y) < 1.5) {
        const t = first - o.mf + rel / Math.max(0.15, Math.abs(o.move.proj[0].vx || 0.3));
        if (!best || t < best.t) best = { t, p: null };
      }
    }
    return best;
  }

  /** 飛び道具をよけて、撃ってくる相手に近づく */
  evadeProjectile() {
    const f = this.f, o = this.o, r = this.rng;
    const inc = this.incomingProjectile();
    if (!inc || inc.t > 28) return false;
    if (!r.chance(this.evade)) return false;
    const toward = Math.sign(o.x - f.x) || 1;
    // 撃たれたら一気に間合いをつめる
    this.rushUntil = this.sim.frame + 120;
    const t = inc.t;
    const nearEdge = Math.abs(f.x + toward * 2.2) > 6.6;
    if (!f.grounded) {
      if (t < 7 && !f.airdodged) { this.push(1, { s: true, x: toward, y: 0.3 }); this.push(1, { x: toward }); return true; }
      return false;
    }
    const c = r.next();
    if (t >= 6 && c < 0.55) {
      // 大ジャンプで跳びこえて、空中攻撃で降りる
      this.push(5, { x: toward, j: true });
      this.push(10, { x: toward });
      if (Math.abs(o.x - f.x) < 4.5) this.press('a', { x: toward }, 2);
      return true;
    }
    if (t >= 3 && t <= 14 && c < 0.8 && !nearEdge) {
      // 前回避で弾をすり抜ける
      this.push(1, { s: true }); this.push(2, { s: true, x: toward, smash: true }); this.push(1, {});
      return true;
    }
    if (t <= 5) {
      // ギリギリならジャストシールドをねらう
      this.push(r.int(4, 8), { s: true }); this.push(1, {});
      return true;
    }
    return false;
  }

  tryDefend() {
    const f = this.f, o = this.o, r = this.rng;
    if (this.evadeProjectile()) return true;
    if (!f.grounded) {
      return false;
    }
    let threat = false;
    if (o.state === 'attack' && o.move && !o.move.proj) {
      const R = analyzeMovesCached(o);
      const re = R[o.move.key];
      if (re && o.mf < re.first + 2) {
        const rel = (f.x - o.x) * o.facing;
        if (rel > re.x1 - 0.8 && rel < re.x2 + 0.8 && f.y - o.y < re.y2 + 0.5 && f.y + f.h - o.y > re.y1 - 0.5) threat = true;
      }
    }
    if (!threat || !r.chance(this.defend)) return false;
    const c = r.next();
    const away = Math.sign(f.x - o.x) || 1;
    const nearEdge = Math.abs(f.x + away * 2.2) > 6.6;
    if (c < 0.55 && f.shield > 15) {
      this.push(r.int(10, 22), { s: true });
      this.push(1, {});
    } else if (c < 0.7) {
      this.push(1, { s: true }); this.push(2, { s: true, y: -1, smash: true }); this.push(1, {});
    } else if (c < 0.85 && !nearEdge) {
      this.push(1, { s: true }); this.push(2, { s: true, x: away, smash: true }); this.push(1, {});
    } else {
      this.press('j', { x: away }, 4);
    }
    return true;
  }

  // ---- 攻撃 ----
  tryAttack() {
    const f = this.f, o = this.o, r = this.rng;
    const keys = f.grounded ? GROUND_KEYS : AIR_KEYS;
    let best = null, bestScore = 0;
    const B = STAGE.blast;
    const ow = o.w, oh = o.h;
    for (const k of keys) {
      const R = this.reach[k];
      if (!R) continue;
      if (R.counter || R.reflect) continue;
      // 飛び道具は撃ちっぱなしにしない（間をあける）
      if (R.proj && this.sim.frame < this.nextShot) continue;
      if (k === 'sspec' && !f.grounded && f.usedSideB) continue;
      const s = Math.min(R.first, 30);
      const px = o.x + (o.vx + o.kbx) * s * 0.8;
      const py = o.y + (o.vy + o.kby) * s * 0.6 + (o.grounded ? 0 : -0.004 * s * s);
      const myX = f.x + (f.grounded ? 0 : f.vx * s);
      const myY = f.y + (f.grounded ? 0 : f.vy * s - 0.004 * s * s);
      let face = Math.sign(px - myX) || f.facing;
      if (k === 'bair') face = -f.facing;
      if (k === 'fair') face = f.facing;
      if (!f.grounded && (k === 'nair' || k === 'uair' || k === 'dair')) face = f.facing;
      const relX1 = (px - ow / 2 - myX) * face, relX2 = (px + ow / 2 - myX) * face;
      const rx1 = Math.min(relX1, relX2), rx2 = Math.max(relX1, relX2);
      const ry1 = py - myY, ry2 = py + oh - myY;
      if (rx2 < R.x1 || rx1 > R.x2 || ry2 < R.y1 || ry1 > R.y2) continue;
      if (k === 'bair' && Math.sign(o.x - f.x) === f.facing) continue;
      if (k === 'fair' && Math.sign(o.x - f.x) !== f.facing && Math.abs(o.x - f.x) > 0.4) continue;
      // スコア
      let score = R.dmg * 1.0 + 6 - s * 0.35;
      if (R.grab) score = o.isShielding() ? 30 : (o.state === 'attack' || o.state === 'land' ? 14 : 6);
      else if (o.isShielding()) score *= 0.3;
      if (o.isIntangible()) score *= 0.1;
      if (R.proj) score += 2;
      // 撃墜できそうなら優先
      if (!R.grab) {
        const kb = knockback(o.percent + R.dmg, R.dmg, o.st.weight, R.bkb, R.kbg);
        const v = kb * LAUNCH_SPEED;
        const dist = (v * v) / (2 * 0.0056) * 0.85;
        let room;
        if (R.ang >= 60 && R.ang <= 120) room = B.top - o.y;
        else if (R.ang > 180) room = o.y - B.bottom + (o.grounded ? 99 : 0);
        else room = face > 0 ? B.right - o.x : o.x - B.left;
        const killRatio = dist / Math.max(1, room);
        if (killRatio > 1) score += 30;
        else score += killRatio * 8;
      }
      if (['fsmash', 'usmash', 'dsmash'].includes(k) && o.state === 'hitstun') score *= 0.7;
      score += r.range(0, 6);
      if (score > bestScore) { bestScore = score; best = { k, face, R }; }
    }
    if (!best) {
      // 空中にいる相手へ跳びかかる
      if (f.grounded && this.reach.uair) {
        const dx = o.x - f.x, dy = o.y - f.y;
        if (!o.grounded && Math.abs(dx) < 1.6 && dy > 1.0 && dy < 4.2 && r.chance(this.p.aggro)) {
          const full = dy > 2.2;
          this.push(full ? 4 : 1, { j: true });
          this.push(full ? 7 : 5, { x: Math.sign(dx) * 0.3 });
          this.press('a', { y: 1 }, 2);
          return true;
        }
        if (Math.abs(dx) < 2.6 && Math.abs(dx) > 0.8 && dy > -0.5 && dy < 2.2 && r.chance(this.p.aggro * 0.4)) {
          const key = r.chance(0.5) ? 'fair' : 'nair';
          if (Math.sign(dx) !== f.facing) this.push(1, { x: Math.sign(dx) * 0.4 });
          this.push(1, { j: true });
          this.push(5, { x: Math.sign(dx) });
          this.press('a', key === 'fair' ? { x: Math.sign(dx) } : {}, 2);
          return true;
        }
      }
      return false;
    }
    if (r.chance(this.mistake * 0.4)) return false;
    if (best.R.proj) this.nextShot = this.sim.frame + r.int(60, 120);
    this.execute(best);
    return true;
  }

  execute({ k, face }) {
    const f = this.f, r = this.rng;
    const turn = face !== f.facing;
    const fx = face;
    this.chargeWant = 0;
    switch (k) {
      case 'jab': if (turn) this.push(1, { x: fx * 0.5 }); this.press('a', {}, 1); if (r.chance(0.6)) { this.push(6, {}); this.press('a', {}, 1); this.push(4, {}); this.press('a', {}, 1); } return;
      case 'ftilt': this.press('a', { x: fx * 0.6 }); return;
      case 'utilt': this.press('a', { y: 0.6 }); return;
      case 'dtilt': this.press('a', { y: -0.6 }); return;
      case 'fsmash': this.chargeWant = r.chance(0.3) ? r.int(5, 25) : 0; this.press('a', { x: fx, smash: true }, 2); return;
      case 'usmash': this.chargeWant = r.chance(0.3) ? r.int(5, 20) : 0; this.press('a', { y: 1, smash: true }, 2); return;
      case 'dsmash': this.chargeWant = r.chance(0.3) ? r.int(5, 20) : 0; this.press('a', { y: -1, smash: true }, 2); return;
      case 'grab': this.push(1, { s: true, x: turn ? fx * 0.3 : 0 }); this.push(1, { s: true, a: true }); this.push(1, {}); return;
      case 'nspec': {
        if (turn) this.push(2, { x: fx * 0.5 });
        const m = f.def.moves.nspec;
        this.chargeWant = m && m.charge ? r.int(10, m.charge.max) : 0;
        this.press('b', {}, 2);
        return;
      }
      case 'sspec': this.press('b', { x: fx }); return;
      case 'dspec': this.press('b', { y: -1 }); return;
      case 'nair': this.press('a', {}); return;
      case 'fair': this.press('a', { x: f.facing }); return;
      case 'bair': this.press('a', { x: -f.facing }); return;
      case 'uair': this.press('a', { y: 1 }); return;
      case 'dair': this.press('a', { y: -1 }); return;
    }
  }

  // ---- 移動 ----
  move() {
    const f = this.f, o = this.o, r = this.rng;
    const M = STAGE.main;
    const dx = o.x - f.x, dy = o.y - f.y;
    const adx = Math.abs(dx);
    const toward = Math.sign(dx) || 1;
    const n = Math.max(2, this.react);

    if (!f.grounded) {
      // 空中：相手へ寄る／着地を急ぐ
      let x = toward * (adx > 0.8 ? 1 : 0.3);
      if (Math.abs(f.x + x * 2) > M.x2 + 0.5) x = -Math.sign(f.x);
      const ffall = f.vy < 0 && dy < -1 && r.chance(0.4);
      if (ffall) { this.push(1, { x, y: -1, smash: true }); return this.idle(n, { x }); }
      if (f.jumps > 0 && dy > 2 && adx < 3 && f.vy < 0 && r.chance(0.3)) return this.press('j', { x: toward });
      return this.idle(n, { x });
    }

    // 相手が復帰中なら崖際で待つ（崖狩り）
    if (this.isOffstage(o) && o.state !== 'ledge' && this.level >= 4) {
      const edge = o.x < 0 ? M.x1 + 0.9 : M.x2 - 0.9;
      const d = edge - f.x;
      if (Math.abs(d) > 0.4) return this.idle(Math.min(n, 6), { x: Math.sign(d) * (Math.abs(d) > 1.5 ? 1 : 0.5) });
      if (Math.sign(o.x) !== f.facing) this.push(1, { x: Math.sign(o.x) * 0.4 });
      return this.idle(n);
    }

    // 射撃型：距離をとって撃つ
    const want = this.p.dist;
    if (this.f.def.type === 'shooter' && this.sim.frame > this.nextShot && Math.abs(dy) < 1.4 && adx > 2.5 && adx < 10) {
      this.nextShot = this.sim.frame + r.int(70, 130);
      const key = r.chance(0.6) ? 'nspec' : 'sspec';
      if (this.reach[key]) { this.execute({ k: key, face: toward }); return; }
    }
    // 撃ってくる相手には、跳びながら一気に近づく（遠くで立ち止まると撃たれ続ける）
    const zoner = this.f.def.type !== 'shooter' && this.oppShoots();
    if ((this.rushUntil > this.sim.frame || zoner) && adx > 2.2) {
      if (adx > 3.2 && r.chance(0.35)) {
        this.push(5, { x: toward, j: true });
        this.push(8, { x: toward });
        if (adx < 5.5) this.press('a', { x: toward }, 2);
        return;
      }
      let rx = toward;
      if (Math.abs(f.x + rx * 1.4) > M.x2 - 0.6 && Math.sign(rx) === Math.sign(f.x)) rx = 0;
      return this.idle(Math.min(n, 6), { x: rx });
    }
    let x;
    if (adx > want + 0.4) x = toward * (adx > want + 2.5 ? 1 : 0.6);
    else if (adx < want - 1.2) x = -toward * 0.9;
    else x = 0;
    // 崖から落ちないように
    if (Math.abs(f.x + x * 1.4) > M.x2 - 0.6 && Math.sign(x) === Math.sign(f.x)) x = 0;

    // 上の足場にいる相手へジャンプ
    if (dy > 1.8 && adx < 4 && r.chance(0.5)) {
      this.push(4, { j: true, x: toward * 0.6 });
      return this.idle(10, { x: toward * 0.7 });
    }
    if (r.chance(this.p.jumpy * 0.08)) return this.press('j', { x: toward }, r.chance(0.5) ? 1 : 4);
    if (r.chance(0.04) && f.shield > 20) { this.push(r.int(6, 14), { s: true }); this.push(1, {}); return; }
    // すり抜け床から降りる
    if (f.ground && f.ground.soft && dy < -1 && r.chance(0.3)) { this.push(2, { y: -1, smash: true }); return this.idle(6); }
    return this.idle(n, { x });
  }
}

const cache = new WeakMap();
function analyzeMovesCached(f) {
  let r = cache.get(f.def);
  if (!r) { r = analyzeMoves(f.def); cache.set(f.def, r); }
  return r;
}
