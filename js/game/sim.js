// 対戦シミュレーション：ヒット判定・ふっとばし・飛び道具・撃墜・勝敗。
import { STAGE, LAUNCH_SPEED, KB_MULT, STOCKS, TIME_LIMIT } from './constants.js';
import { Fighter, EMPTY_INPUT, clamp } from './fighter.js';
import { RNG } from './rng.js';

/** スマブラ式ふっとばし力 */
export function knockback(percentAfter, dmg, weight, bkb, kbg) {
  const p = percentAfter;
  return ((((p / 10 + (p * dmg) / 20) * (200 / (weight + 100)) * 1.4) + 18) * (kbg / 100) + bkb) * KB_MULT;
}

export class Sim {
  constructor(defA, defB, { seed = 1, stocks = STOCKS, timeLimit = TIME_LIMIT } = {}) {
    this.frame = 0;
    this.rng = new RNG(seed);
    this.events = [];
    this.projectiles = [];
    this.timeLimit = timeLimit;
    this.fighters = [new Fighter(defA, 0, this, stocks), new Fighter(defB, 1, this, stocks)];
    this.over = false;
    this.winner = -1; // -1: 未決, 0/1, 2: 引き分け
    this.endFrame = 0;
    this.projId = 0;
  }

  emit(e) { this.events.push({ ...e, f: this.frame }); }

  step(inputs) {
    if (this.over) { this.frame++; return; }
    this.frame++;
    const F = this.fighters;
    F.forEach((f, i) => f.setInput(inputs[i] || EMPTY_INPUT));
    // 両者のヒットストップ中に入力だけは受け付けて状態は止める
    for (const f of F) f.update();
    this.updateProjectiles();
    this.checkHits();
    this.pushApart();
    this.checkBlast();
    this.checkEnd();
  }

  // ---------- ヒット ----------
  checkHits() {
    const F = this.fighters;
    const pending = [];
    for (const a of F) {
      if (a.hitlag > 0) continue;
      const hbs = a.activeHitboxes();
      if (!hbs.length) continue;
      const t = F[1 - a.slot];
      if (!t.alive || t.state === 'respawn') continue;
      const hurt = t.hurtbox();
      for (const h of hbs) {
        const key = h.g;
        if (a.hitSet.has(key)) continue;
        if (!circleBox(h.wx, h.wy, h.wr, hurt)) continue;
        if (h.grab) {
          if (t.isIntangible() || !t.grounded || t.state === 'grabbed' || t.state === 'holding') continue;
          a.hitSet.add(key);
          pending.push({ grab: true, a, t });
          break;
        }
        a.hitSet.add(key);
        // 同じグループの他の判定は無効化
        pending.push({ a, t, h: { ...h, key: a.move.key } });
        break;
      }
    }
    for (const p of pending) {
      if (p.grab) { if (p.a.state === 'attack' && p.t.state !== 'holding') p.a.beginHold(p.t); continue; }
      const dirX = Math.sign(p.t.x - p.a.x) || p.a.facing;
      // 後ろ向き判定（空後など）は x の位置で向きが決まる
      this.hit(p.a, p.t, p.h, dirX, false);
    }
  }

  /** 攻撃を当てる。戻り値: 'hit' | 'shield' | 'counter' | 'miss' */
  hit(a, t, h, dirX, isProj) {
    if (t.isIntangible()) return 'miss';
    // ワンパターン相殺：最近当てたワザほど弱くなる
    if (h.key) {
      const dmg = +(h.dmg * staleMult(a, h.key)).toFixed(1);
      a.stale.unshift(h.key);
      if (a.stale.length > 9) a.stale.pop();
      h = { ...h, dmg };
    }
    const m = t.move;
    // カウンター
    if (t.state === 'attack' && m && m.counter && t.mf >= m.counter[0] && t.mf <= m.counter[1]) {
      this.emit({ t: 'counter', x: t.x, y: t.y + t.h / 2 });
      t.startMove('counterAtk');
      t.facing = isProj ? t.facing : Math.sign(a.x - t.x) || t.facing;
      if (!isProj && a.alive) {
        const dmg = Math.max(8, h.dmg * 1.3);
        this.hit(t, a, { dmg, ang: 361, bkb: 60, kbg: 85 }, t.facing, false);
      }
      return 'counter';
    }
    // シールド
    // ジャストシールド：ガードを出した直後に受けると、削られずにすぐ動ける
    if (t.state === 'shield' && t.sf <= 5 && !h.grab) {
      t.hitlag = Math.floor(h.dmg * 0.3 + 3);
      if (!isProj) a.hitlag = t.hitlag;
      this.emit({ t: 'perfect', x: t.x, y: t.y + t.h / 2 });
      return 'shield';
    }
    if (t.isShielding() && !h.grab && (h.unblockable !== true)) {
      t.shield -= h.dmg * 1.15;
      t.setState('shieldstun');
      t.timer = Math.floor(h.dmg * 0.6) + 3;
      t.vx = dirX * (0.03 + h.dmg * 0.005);
      const hl = Math.floor(h.dmg * 0.35 + 4);
      t.hitlag = hl;
      if (!isProj) a.hitlag = hl;
      this.emit({ t: 'shield', x: t.x, y: t.y + t.h / 2, dmg: h.dmg });
      if (t.shield <= 0) t.breakShield();
      return 'shield';
    }
    // つかみを解除
    if (t.heldBy) { const by = t.heldBy; by.holding = null; by.setState('idle'); t.heldBy = null; }
    if (t.holding) { const hd = t.holding; hd.heldBy = null; hd.setState('air'); t.holding = null; }

    t.percent = Math.min(999, t.percent + h.dmg);
    a.stats.dealt += h.dmg;
    t.lastHitBy = a.slot;
    const kb = knockback(t.percent, h.dmg, t.st.weight, h.bkb, h.kbg);
    const hl = Math.min(20, Math.floor(h.dmg * 0.65 + 5));

    if (t.hasArmor()) {
      t.hitlag = hl;
      if (!isProj) a.hitlag = hl;
      this.emit({ t: 'hit', x: t.x, y: t.y + t.h * 0.6, dmg: h.dmg, kb: 0, armor: true, slot: t.slot });
      return 'hit';
    }

    let ang = h.ang;
    if (ang === 361) ang = t.grounded ? (kb < 60 ? 0 : 40) : 40;
    if (ang > 180 && ang < 360 && t.grounded) ang = 360 - ang; // 地上メテオは上に
    let rad = (ang * Math.PI) / 180;
    // ベクトル変更（DI）
    const sx = t.in.x, sy = t.in.y;
    if (Math.hypot(sx, sy) > 0.5 && kb > 50) {
      const lx = Math.cos(rad) * dirX, ly = Math.sin(rad);
      const perp = sx * -ly + sy * lx; // 進行方向に対する横成分
      rad += (perp * 15 * Math.PI) / 180 * (dirX);
    }
    const speed = kb * LAUNCH_SPEED;
    t.kbx = Math.cos(rad) * dirX * speed;
    t.kby = Math.sin(rad) * speed;
    if (t.grounded && t.kby > 0.01) { t.leaveGround(); t.y += 0.01; }
    if (t.grounded && kb < 80) t.kby = 0;
    t.vx = 0; t.vy = 0; t.ff = false; t.usedUpB = false; t.usedSideB = false;
    t.setState('hitstun');
    t.hitstun = Math.floor(kb * 0.4);
    t.tumble = kb >= 80;
    t.hitlag = hl;
    if (!isProj) a.hitlag = hl;
    if (kb > 30 && h.dmg >= 2 && !t.grounded) t.facing = -Math.sign(t.kbx) || t.facing;
    this.emit({ t: 'hit', x: (t.x + (h.wx ?? t.x)) / 2, y: h.wy ?? t.y + t.h / 2, dmg: h.dmg, kb, slot: t.slot, by: a.slot, proj: isProj });
    return 'hit';
  }

  applyDamageOnly(a, t, dmg) {
    t.percent = Math.min(999, t.percent + dmg);
    a.stats.dealt += dmg;
    t.hitlag = 4; a.hitlag = 4;
    this.emit({ t: 'hit', x: t.x, y: t.y + t.h / 2, dmg, kb: 0, slot: t.slot, small: true });
  }

  doThrow(a) {
    const t = a.holding;
    const T = a.move.thr;
    if (!t) return;
    a.holding = null; t.heldBy = null;
    if (T.back) { a.facing *= -1; t.x = a.x + a.facing * (a.w / 2 + t.w / 2); }
    t.setState('air');
    t.y = a.y + 0.15;
    t.leaveGround();
    this.hit(a, t, { dmg: T.dmg, ang: T.ang, bkb: T.bkb, kbg: T.kbg, wx: t.x, wy: t.y + t.h / 2 }, a.facing, true);
  }

  releaseGrab(a, t) {
    a.holding = null; t.heldBy = null;
    a.setState('idle'); a.vx = -a.facing * 0.1;
    t.setState('air'); t.vx = a.facing * 0.1; t.vy = 0.12;
    t.leaveGround();
  }

  // ---------- 飛び道具 ----------
  spawnProjectile(f, p, chargeRatio) {
    // 同じ種類の飛び道具は出せる数に上限がある
    const LIMIT = { bullet: 3, charge: 1, missile: 2, bomb: 2, boomerang: 1, mine: 1 };
    const live = this.projectiles.filter((q) => q.owner === f && q.kind === p.kind && !q.dead).length;
    if (live >= (LIMIT[p.kind] || 2)) return;
    const ratio = clamp(chargeRatio || 0, 0, 1);
    const r = p.rMax ? p.r + (p.rMax - p.r) * ratio : p.r;
    const dmg = p.dmgMax ? p.dmg + (p.dmgMax - p.dmg) * ratio : p.dmg;
    const pr = {
      id: ++this.projId, owner: f, kind: p.kind, key: f.move ? f.move.key : undefined,
      x: f.x + p.x * f.h * f.facing, y: f.y + p.y * f.h,
      vx: (p.vx || 0) * f.facing, vy: p.vy || 0,
      r, dmg: +dmg.toFixed(1), ang: p.ang, bkb: p.bkb, kbg: p.kbg,
      life: p.life, age: 0, grav: p.grav || 0, bounces: p.bounces || 0, homing: p.homing || 0,
      blast: p.blast || 0, facing: f.facing, returning: false, hits: new Set(), dead: false,
    };
    if (pr.kind === 'mine') { pr.y = f.grounded ? f.y + 0.1 : f.y; pr.vy = f.grounded ? 0 : -0.05; pr.armed = 30; }
    this.projectiles.push(pr);
    this.emit({ t: 'shoot', x: pr.x, y: pr.y, kind: pr.kind });
  }

  updateProjectiles() {
    const M = STAGE.main;
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.age++;
      const owner = p.owner;
      const enemy = this.fighters[1 - owner.slot];
      switch (p.kind) {
        case 'missile': {
          if (enemy.alive && p.age > 10) {
            const ty = enemy.y + enemy.h / 2 - p.y;
            p.vy += clamp(ty * 0.01, -p.homing, p.homing);
            p.vy *= 0.97;
          }
          p.vx += Math.sign(p.vx) * 0.006;
          p.vx = clamp(p.vx, -0.34, 0.34);
          break;
        }
        case 'boomerang': {
          if (!p.returning) {
            p.vx -= p.facing * 0.009;
            if (Math.sign(p.vx) !== p.facing || p.age > 50) { p.returning = true; p.hits.clear(); }
          } else {
            const dx = owner.x - p.x, dy = owner.y + owner.h * 0.6 - p.y;
            const d = Math.hypot(dx, dy) || 1;
            p.vx += (dx / d) * 0.03; p.vy += (dy / d) * 0.03;
            const sp = Math.hypot(p.vx, p.vy);
            if (sp > 0.4) { p.vx *= 0.4 / sp; p.vy *= 0.4 / sp; }
            if (d < 0.6 || !owner.alive) p.dead = true;
          }
          break;
        }
        case 'mine': {
          if (p.armed > 0) p.armed--;
          if (p.vy !== 0) { p.vy -= 0.01; }
          break;
        }
      }
      if (p.grav) p.vy -= p.grav;
      p.x += p.vx; p.y += p.vy;
      // 地形
      const inMain = p.x > M.x1 && p.x < M.x2 && p.y - p.r < M.top && p.y > M.bottom;
      if (inMain) {
        if (p.kind === 'bomb' && p.vy < 0 && p.y > M.top - 0.3) {
          p.y = M.top + p.r; p.vy = -p.vy * 0.7;
          if (p.bounces-- <= 0) this.explode(p);
        } else if (p.kind === 'mine') { p.y = M.top + 0.08; p.vy = 0; }
        else if (p.kind !== 'boomerang') { p.dead = true; this.emit({ t: 'fizzle', x: p.x, y: p.y }); }
      }
      if (p.kind === 'mine' && p.vy !== 0) {
        for (const pl of STAGE.platforms) if (p.vy < 0 && p.y <= pl.y + 0.08 && p.y > pl.y - 0.3 && p.x > pl.x1 && p.x < pl.x2) { p.y = pl.y + 0.08; p.vy = 0; }
      }
      if (--p.life <= 0) { if (p.kind === 'bomb' || p.kind === 'mine') this.explode(p); else p.dead = true; }
      const B = STAGE.blast;
      if (p.x < B.left || p.x > B.right || p.y < B.bottom || p.y > B.top) p.dead = true;
      if (p.dead) continue;

      // 相手に当たる
      for (const t of this.fighters) {
        if (t === owner || !t.alive || t.state === 'respawn' || p.dead) continue;
        if (p.hits.has(t.slot)) continue;
        const hurt = t.hurtbox();
        const trigger = p.kind === 'mine' ? (p.armed <= 0 && circleBox(p.x, p.y, p.r * 2.2, hurt)) : circleBox(p.x, p.y, p.r, hurt);
        if (!trigger) continue;
        const tm = t.move;
        if (t.state === 'attack' && tm && tm.reflect && t.mf >= tm.reflect[0] && t.mf <= tm.reflect[1]) {
          p.owner = t; p.vx = -p.vx * 1.2; p.vy = -p.vy * 0.5; p.dmg = +(p.dmg * 1.25).toFixed(1); p.facing = -p.facing; p.life = Math.max(p.life, 60);
          p.hits.clear();
          this.emit({ t: 'reflect', x: p.x, y: p.y });
          continue;
        }
        if (p.blast) { this.explode(p); break; }
        const res = this.hit(owner, t, { dmg: p.dmg, ang: p.ang, bkb: p.bkb, kbg: p.kbg, wx: p.x, wy: p.y, key: p.key }, Math.sign(p.vx) || p.facing, true);
        if (res === 'miss') continue;
        p.hits.add(t.slot);
        if (p.kind !== 'boomerang') { p.dead = true; this.emit({ t: 'fizzle', x: p.x, y: p.y }); }
      }
    }
    // 飛び道具どうしの相殺
    const ps = this.projectiles.filter((p) => !p.dead);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      if (a.owner === b.owner || a.dead || b.dead) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) {
        if (a.dmg > b.dmg * 1.8) b.dead = true; else if (b.dmg > a.dmg * 1.8) a.dead = true; else { a.dead = b.dead = true; }
        this.emit({ t: 'clank', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  explode(p) {
    if (p.dead) return;
    p.dead = true;
    this.emit({ t: 'explode', x: p.x, y: p.y, r: p.blast || 0.6 });
    for (const t of this.fighters) {
      if (!t.alive || t.state === 'respawn') continue;
      const hurt = t.hurtbox();
      if (circleBox(p.x, p.y, p.blast || 0.6, hurt)) {
        const dirX = Math.sign(t.x - p.x) || p.facing;
        const self = t === p.owner;
        this.hit(p.owner, t, { dmg: self ? p.dmg * 0.5 : p.dmg, ang: p.ang, bkb: p.bkb, kbg: self ? p.kbg * 0.5 : p.kbg, wx: p.x, wy: p.y }, dirX, true);
      }
    }
  }

  pushApart() {
    const [a, b] = this.fighters;
    if (!a.alive || !b.alive || !a.grounded || !b.grounded) return;
    if (a.state === 'holding' || b.state === 'holding' || a.state === 'grabbed' || b.state === 'grabbed') return;
    if (a.isIntangible() && (a.state === 'roll')) return;
    if (b.isIntangible() && (b.state === 'roll')) return;
    if (Math.abs(a.y - b.y) > 0.3) return;
    const minD = (a.w + b.w) / 2 * 0.8;
    const d = b.x - a.x;
    if (Math.abs(d) < minD) {
      const push = Math.min(0.04, (minD - Math.abs(d)) * 0.25) * (Math.sign(d) || 1);
      a.x -= push; b.x += push;
      for (const f of [a, b]) if (f.ground) f.x = clamp(f.x, f.ground.x1, f.ground.x2);
    }
  }

  checkBlast() {
    const B = STAGE.blast;
    for (const f of this.fighters) {
      if (f.state === 'dead' || f.stocks <= 0) continue;
      if (f.x < B.left || f.x > B.right || f.y < B.bottom || f.y > B.top) {
        const killer = this.fighters[1 - f.slot];
        if (f.lastHitBy === killer.slot) killer.stats.kos++;
        f.lastHitBy = undefined;
        f.ko();
      }
    }
  }

  checkEnd() {
    const F = this.fighters;
    const out = F.map((f) => f.stocks <= 0);
    if (out[0] || out[1]) {
      this.over = true;
      this.endFrame = this.frame;
      this.winner = out[0] && out[1] ? 2 : out[0] ? 1 : 0;
      this.endReason = 'stock';
      return;
    }
    if (this.timeLimit && this.frame >= this.timeLimit) {
      this.over = true;
      this.endFrame = this.frame;
      this.endReason = 'time';
      const [a, b] = F;
      if (a.stocks !== b.stocks) this.winner = a.stocks > b.stocks ? 0 : 1;
      else if (Math.abs(a.percent - b.percent) >= 1) this.winner = a.percent < b.percent ? 0 : 1;
      else this.winner = 2;
    }
  }
}

const STALE_W = [0.08, 0.075, 0.07, 0.065, 0.06, 0.055, 0.05, 0.045, 0.04];
/** ワンパターン相殺の倍率（使っていないワザは少しだけ強い） */
export function staleMult(f, key) {
  let m = 1;
  let found = false;
  f.stale.forEach((k, i) => { if (k === key) { m -= STALE_W[i]; found = true; } });
  return found ? m : 1.05;
}

export function circleBox(cx, cy, r, b) {
  const nx = clamp(cx, b.x1, b.x2), ny = clamp(cy, b.y1, b.y2);
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}
