// ファイター：状態遷移・物理・技の進行。描画とは独立（Node でも動く）。
import { STAGE, SHIELD_MAX, BUFFER_FRAMES } from './constants.js';

const GROUND_FREE = new Set(['idle', 'walk', 'run', 'crouch']);
// 地上でこの状態のときは崖から落ちない（その場で止まる）
const FALL_OFF = new Set(['idle', 'walk', 'run', 'crouch', 'hitstun', 'air']);

export const EMPTY_INPUT = { x: 0, y: 0, a: false, b: false, j: false, s: false, smash: false };

export class Fighter {
  constructor(def, slot, sim, stocks) {
    this.def = def;
    this.st = def.stats;
    this.slot = slot;
    this.sim = sim;
    this.h = this.st.h;
    this.w = this.st.w;
    this.stocks = stocks;
    this.percent = 0;
    this.in = EMPTY_INPUT;
    this.prevIn = EMPTY_INPUT;
    this.buffer = [];
    this.stats = { dealt: 0, kos: 0, falls: 0 };
    const sp = STAGE.spawns[slot];
    this.spawnAt(sp.x, sp.y, slot === 0 ? 1 : -1);
  }

  spawnAt(x, y, facing) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.kbx = 0; this.kby = 0;
    this.facing = facing;
    this.grounded = true;
    this.ground = { x1: STAGE.main.x1, x2: STAGE.main.x2, y: STAGE.main.top, soft: false };
    this.state = 'idle'; this.sf = 0;
    this.move = null; this.mf = 0; this.charge = 0; this.hitSet = new Set();
    this.hitlag = 0; this.hitstun = 0; this.tumble = false;
    this.inv = 0; this.shield = SHIELD_MAX;
    this.jumps = this.st.midair; this.airdodged = false; this.ff = false;
    this.drop = 0; this.ledge = null; this.ledgeCd = 0; this.ledgeTimer = 0;
    this.holding = null; this.heldBy = null; this.holdTimer = 0;
    this.timer = 0; this.lastShieldPress = -999; this.dodgeDir = 0; this.climbOpt = null;
    this.prevX = x; this.prevY = y;
  }

  get frame() { return this.sim.frame; }
  get alive() { return this.state !== 'dead' && this.stocks > 0; }

  // ---------- 入力 ----------
  setInput(inp) {
    this.prevIn = this.in;
    this.in = inp;
    for (const k of ['a', 'b', 'j', 's']) {
      if (inp[k] && !this.prevIn[k]) {
        this.buffer.push({ k, x: inp.x, y: inp.y, smash: inp.smash, t: BUFFER_FRAMES });
        if (k === 's') this.lastShieldPress = this.frame;
      }
    }
    for (const e of this.buffer) e.t--;
    this.buffer = this.buffer.filter((e) => e.t > 0);
  }
  take(k) {
    const i = this.buffer.findIndex((e) => e.k === k);
    if (i < 0) return null;
    return this.buffer.splice(i, 1)[0];
  }
  anyPress() {
    const e = this.buffer.length ? this.buffer.shift() : null;
    return e;
  }

  // ---------- 状態 ----------
  setState(s) {
    this.state = s; this.sf = 0;
    if (s !== 'attack') { this.move = null; this.charge = 0; }
  }
  faceTo(dx) { if (dx > 0.2) this.facing = 1; else if (dx < -0.2) this.facing = -1; }

  startMove(key) {
    let m = this.def.moves[key];
    if (!this.grounded && this.def.moves[key + 'Air']) m = this.def.moves[key + 'Air'];
    if (!m) return false;
    this.state = 'attack'; this.sf = 0;
    this.move = m; this.mf = 0; this.charge = 0; this.charged = false;
    this.hitSet = new Set();
    if (m.proj && m.proj.some((p) => p.max)) {
      // 設置物は上限を超えたら古いものを消す
      const mine = this.sim.projectiles.filter((p) => p.owner === this && p.kind === m.proj[0].kind);
      if (mine.length >= m.proj[0].max) mine[0].dead = true;
    }
    return true;
  }

  isIntangible() {
    if (this.inv > 0) return true;
    const m = this.move;
    const f = this.sf;
    switch (this.state) {
      case 'roll': return f >= 3 && f <= 17;
      case 'spotdodge': return f >= 2 && f <= 16;
      case 'airdodge': return f >= 2 && f <= (this.dodgeDir ? 18 : 26);
      case 'ledgeclimb': case 'tech': case 'getup': case 'respawn': return true;
      case 'ledge': return this.ledgeTimer < 30;
      case 'dead': return true;
      case 'attack':
        if (m && m.intang && this.mf >= m.intang[0] && this.mf <= m.intang[1]) return true;
        return false;
    }
    return false;
  }
  hasArmor() {
    const m = this.move;
    return this.state === 'attack' && m && m.armor && this.mf >= m.armor[0] && this.mf <= m.armor[1];
  }
  isShielding() { return this.state === 'shield' || this.state === 'shieldstun'; }

  // ---------- 行動の判定 ----------
  dirOf(e) {
    const ax = Math.abs(e.x), ay = Math.abs(e.y);
    return { ax, ay, x: e.x, y: e.y };
  }

  doGroundAttack(e) {
    const { ax, ay, x, y } = this.dirOf(e);
    let key;
    if (this.state === 'run' && !e.smash && ay < 0.5 && ax > 0.5) key = 'dash';
    else if (e.smash && (ax > 0.6 || ay > 0.6)) {
      if (ay > ax) key = y > 0 ? 'usmash' : 'dsmash';
      else { this.faceTo(x); key = 'fsmash'; }
    } else if (ax > 0.3 || ay > 0.3) {
      if (ay > ax) key = y > 0 ? 'utilt' : 'dtilt';
      else { this.faceTo(x); key = 'ftilt'; }
    } else key = 'jab';
    this.startMove(key);
  }
  doAerial(e) {
    const { ax, ay, x, y } = this.dirOf(e);
    let key;
    if (ay > ax && ay > 0.35) key = y > 0 ? 'uair' : 'dair';
    else if (ax > 0.35) key = Math.sign(x) === this.facing ? 'fair' : 'bair';
    else key = 'nair';
    this.startMove(key);
  }
  doSpecial(e) {
    const { ax, ay, x, y } = this.dirOf(e);
    let key;
    if (ay > ax && ay > 0.4) { key = y > 0 ? 'uspec' : 'dspec'; this.faceTo(x); }
    else if (ax > 0.4) { this.faceTo(x); key = 'sspec'; }
    else key = 'nspec';
    if (key === 'uspec' && !this.grounded && this.usedUpB) return false;
    if (key === 'uspec') this.usedUpB = true;
    if (key === 'sspec' && !this.grounded) {
      if (this.usedSideB) return false;
      this.usedSideB = true;
    }
    this.startMove(key);
    return true;
  }

  groundActions() {
    const inp = this.in;
    let e;
    if ((e = this.take('j'))) { this.setState('jumpsquat'); return true; }
    if ((e = this.take('b'))) { this.doSpecial(e); return true; }
    if ((e = this.take('a'))) {
      if (inp.s) this.startMove('grab'); else this.doGroundAttack(e);
      return true;
    }
    if (inp.s) {
      if (inp.smash && Math.abs(inp.x) > 0.6) { this.startRoll(Math.sign(inp.x)); return true; }
      if (inp.smash && inp.y < -0.6) { this.setState('spotdodge'); return true; }
      if (this.shield > 1) { this.setState('shield'); return true; }
    }
    if (inp.smash && inp.y < -0.7 && this.ground && this.ground.soft) {
      this.leaveGround(); this.drop = 10; this.y -= 0.05; this.setState('air');
      return true;
    }
    return false;
  }

  airActions() {
    let e;
    if (this.jumps > 0 && (e = this.take('j'))) {
      this.jumps--; this.vy = this.st.djV; this.vx = this.in.x * this.st.air; this.ff = false;
      this.sim.emit({ t: 'jump', x: this.x, y: this.y, slot: this.slot, air: true });
      this.setState('air');
      return true;
    }
    if ((e = this.take('b'))) { if (this.doSpecial(e)) return true; }
    if ((e = this.take('a'))) {
      if (this.in.s && !this.airdodged) { this.startAirdodge(); return true; }
      this.doAerial(e); return true;
    }
    if (!this.airdodged && (e = this.take('s'))) { this.startAirdodge(); return true; }
    return false;
  }

  startRoll(dir) {
    this.setState('roll');
    this.dodgeDir = dir;
  }
  startAirdodge() {
    this.setState('airdodge');
    this.airdodged = true;
    const mag = Math.hypot(this.in.x, this.in.y);
    if (mag > 0.5) {
      this.dodgeDir = 1;
      this.vx = (this.in.x / mag) * 0.27; this.vy = (this.in.y / mag) * 0.27;
    } else {
      this.dodgeDir = 0; this.vx *= 0.5; this.vy = Math.max(this.vy, 0) * 0.3;
    }
    this.ff = false;
  }

  leaveGround() { this.grounded = false; this.ground = null; }

  // ---------- 毎フレーム ----------
  update() {
    if (this.state === 'dead') { this.updateDead(); return; }
    if (this.hitlag > 0) { this.hitlag--; return; }
    this.sf++;
    if (this.inv > 0) this.inv--;
    if (this.ledgeCd > 0) this.ledgeCd--;
    if (this.drop > 0) this.drop--;
    if (!this.isShielding()) this.shield = Math.min(SHIELD_MAX, this.shield + 0.07);

    const st = this.st;
    const inp = this.in;
    let drift = 0; // 空中制御の強さ（0〜1）
    let gravity = true;

    switch (this.state) {
      case 'idle': case 'walk': case 'run': case 'crouch': {
        if (this.groundActions()) break;
        const ax = Math.abs(inp.x);
        if (inp.y < -0.6 && ax < 0.6) {
          this.state = 'crouch';
          this.vx *= 0.75;
        } else if (ax > 0.2) {
          this.faceTo(inp.x);
          const run = ax > 0.75;
          const target = Math.sign(inp.x) * (run ? st.run : st.walk * (ax / 0.75));
          this.vx += clamp(target - this.vx, -0.03, 0.03);
          this.state = run ? 'run' : 'walk';
        } else {
          this.state = 'idle';
          this.vx *= 0.78;
        }
        break;
      }
      case 'jumpsquat': {
        this.vx *= 0.9;
        if (this.sf >= 3) {
          this.leaveGround();
          this.vy = inp.j ? st.jumpV : st.shortV;
          this.vx = this.vx * 0.8 + inp.x * st.air * 0.5;
          this.setState('air');
          this.sim.emit({ t: 'jump', x: this.x, y: this.y, slot: this.slot });
        }
        break;
      }
      case 'air': {
        if (this.airActions()) break;
        drift = 1;
        if (this.vy <= 0.02 && inp.smash && inp.y < -0.6 && !this.ff) this.ff = true;
        break;
      }
      case 'land': {
        this.vx *= 0.8;
        if (this.sf >= this.timer) this.setState('idle');
        break;
      }
      case 'attack': {
        const r = this.updateMove();
        drift = r.drift; gravity = r.gravity;
        break;
      }
      case 'shield': {
        this.vx *= 0.8;
        this.shield -= 0.13;
        if (this.shield <= 0) { this.breakShield(); break; }
        let e;
        if ((e = this.take('j'))) { this.setState('jumpsquat'); break; }
        if ((e = this.take('a'))) { this.startMove('grab'); break; }
        if ((e = this.take('b')) && e.y > 0.5) { this.doSpecial(e); break; }
        if (inp.smash && Math.abs(inp.x) > 0.6) { this.startRoll(Math.sign(inp.x)); break; }
        if (inp.smash && inp.y < -0.6) { this.setState('spotdodge'); break; }
        if (!inp.s && this.sf > 4) { this.setState('land'); this.timer = 7; }
        break;
      }
      case 'shieldstun': {
        this.vx *= 0.88;
        if (this.sf >= this.timer) this.setState(inp.s ? 'shield' : 'idle');
        break;
      }
      case 'roll': {
        const f = this.sf;
        this.vx = f >= 3 && f <= 22 ? this.dodgeDir * 0.105 : 0;
        if (f >= 30) { this.facing = this.dodgeDir * -1; this.setState('idle'); }
        break;
      }
      case 'spotdodge': {
        this.vx = 0;
        if (this.sf >= 24) this.setState('idle');
        break;
      }
      case 'airdodge': {
        if (this.dodgeDir) {
          gravity = this.sf > 18;
          if (this.sf <= 18) { this.vx *= 0.9; this.vy *= 0.9; }
        } else drift = 0.3;
        if (this.sf >= (this.dodgeDir ? 34 : 40)) this.setState('air');
        break;
      }
      case 'helpless': {
        drift = 0.7;
        break;
      }
      case 'hitstun': {
        this.hitstun--;
        drift = 0;
        if (this.grounded) this.kbx *= 0.86;
        if (this.hitstun <= 0) this.setState(this.grounded ? 'idle' : 'air');
        break;
      }
      case 'down': {
        this.vx *= 0.8;
        if (this.sf > 12 && this.anyPress()) { this.setState('getup'); break; }
        if (this.sf >= 50) this.setState('getup');
        break;
      }
      case 'getup': case 'tech': {
        this.vx = 0;
        if (this.sf >= 22) this.setState('idle');
        break;
      }
      case 'ledge': this.updateLedge(); return;
      case 'ledgeclimb': this.updateClimb(); return;
      case 'holding': this.updateHolding(); return;
      case 'grabbed': this.updateGrabbed(); return;
      case 'shieldbreak': {
        drift = 0;
        break;
      }
      case 'dizzy': {
        this.vx *= 0.8;
        if (this.anyPress()) this.timer -= 4;
        if (this.sf >= this.timer) this.setState('idle');
        break;
      }
      case 'respawn': {
        this.vx = 0; this.vy = 0;
        this.inv = Math.max(this.inv, 2);
        const moved = Math.abs(inp.x) > 0.3 || Math.abs(inp.y) > 0.3 || this.buffer.length;
        if ((moved && this.sf > 30) || this.sf > 240) {
          this.inv = 120; this.setState('air'); this.vy = 0;
        }
        return;
      }
    }

    this.integrate(drift, gravity);
  }

  updateMove() {
    const m = this.move;
    const inp = this.in;
    let drift = this.grounded ? 0 : 1;
    let gravity = true;

    // ため
    if (m.charge && this.mf === m.charge.at && !this.charged) {
      const held = m.charge.btn === 'b' ? inp.b : inp.a;
      if (held && this.charge < m.charge.max) {
        this.charge++;
        if (!this.grounded) { this.vy = Math.max(this.vy, -0.05); }
        this.vx *= 0.85;
        return { drift: drift * 0.3, gravity };
      }
      this.charged = true;
    }
    this.mf++;

    // 移動
    if (m.mv) {
      for (const p of m.mv) {
        // 上昇が終わったら勢いを残しすぎない（上必殺の高さを抑える）
        if (this.mf === p.f1 + 1 && p.vy > 0 && this.vy > 0.08) this.vy = 0.08;
        if (this.mf >= p.f0 && this.mf <= p.f1) {
          if (p.vx !== undefined) {
            this.vx = p.vx * this.facing;
            // 空中の横移動ワザは落下しない（横復帰に使える）
            if (p.vy === undefined && !this.grounded) { this.vy = Math.max(this.vy * 0.6, 0); gravity = false; }
          }
          if (p.vy !== undefined) {
            if (p.vy > 0 || !this.grounded) { this.vy = p.vy; gravity = false; if (p.vy > 0 && this.grounded) this.leaveGround(); }
          }
          drift = 0;
        }
      }
    }
    if (m.steer && !this.grounded) this.vx += clamp(inp.x * 0.16 - this.vx, -m.steer * 0.4, m.steer * 0.4);
    if (m.slide && this.grounded) this.vx *= m.slide;
    else if (this.grounded && !m.mv) this.vx *= 0.82;

    // 飛び道具
    if (m.proj) for (const p of m.proj) if (p.f === this.mf) this.sim.spawnProjectile(this, p, m.charge ? this.charge / m.charge.max : 0);

    // 連打キャンセル（ジャブ）
    if (m.cancel && this.mf >= m.cancel && this.grounded) {
      const e = this.take('a');
      if (e) { this.startMove(m.key); return { drift: 0, gravity }; }
    }
    // 投げ
    if (m.thr && this.mf === m.thr.f) this.sim.doThrow(this);

    if (this.mf >= m.total) {
      if (m.helpless && !this.grounded) this.setState('helpless');
      else if (m.key === 'counterAtk' && !this.grounded) this.setState('air');
      else this.setState(this.grounded ? 'idle' : 'air');
    }
    return { drift: drift * 0.8, gravity };
  }

  /** いまのフレームで有効な攻撃判定（ワールド座標） */
  activeHitboxes() {
    if (this.state !== 'attack' || !this.move || !this.move.hb.length) return [];
    if (this.move.charge && !this.charged && this.mf === this.move.charge.at) return [];
    const out = [];
    const m = this.move;
    const cm = m.charge ? 1 + (m.charge.mult || 0.4) * (this.charge / m.charge.max) : 1;
    m.hb.forEach((h, i) => {
      if (this.mf >= h.f0 && this.mf <= h.f1) {
        out.push({
          ...h,
          g: h.g === undefined ? i : h.g,
          wx: this.x + h.x * this.h * this.facing,
          wy: this.y + h.y * this.h,
          wr: h.r * this.h,
          dmg: +(h.dmg * cm).toFixed(1),
        });
      }
    });
    return out;
  }

  hurtbox() {
    const h = this.state === 'crouch' || (this.move && this.move.crouch) ? this.h * 0.62 : this.h;
    return { x1: this.x - this.w / 2, x2: this.x + this.w / 2, y1: this.y, y2: this.y + h };
  }

  // ---------- 物理 ----------
  integrate(drift, gravity) {
    const st = this.st;
    const inp = this.in;
    this.prevX = this.x; this.prevY = this.y;
    if (!this.grounded) {
      if (drift > 0) {
        const target = inp.x * st.air;
        this.vx += clamp(target - this.vx, -st.airAccel * drift, st.airAccel * drift);
      }
      if (gravity) {
        this.vy -= st.grav;
        if (this.ff && this.state !== 'hitstun') this.vy = -st.ffall;
        else if (this.vy < -st.fall) this.vy = Math.max(this.vy, -st.fall - 0.01);
        if (this.vy < -st.fall) this.vy = -st.fall;
      }
    }
    // ふっとばしの減衰
    const sp = Math.hypot(this.kbx, this.kby);
    if (sp > 0) {
      const ns = Math.max(0, sp - 0.0056);
      this.kbx *= ns / sp; this.kby *= ns / sp;
    }
    this.x += this.vx + this.kbx;
    this.y += this.vy + this.kby;
    this.collide();
    this.checkLedge();
  }

  collide() {
    const M = STAGE.main;
    const hw = this.w / 2;
    if (this.grounded) {
      const g = this.ground;
      this.y = g.y;
      if (this.x < g.x1 || this.x > g.x2) {
        if (FALL_OFF.has(this.state) || (this.state === 'attack' && this.move && (this.move.mv || this.move.helpless))) {
          this.leaveGround();
          if (GROUND_FREE.has(this.state)) this.setState('air');
          this.vy = 0;
        } else {
          this.x = clamp(this.x, g.x1, g.x2);
          this.vx = 0; this.kbx = 0;
        }
      }
      return;
    }
    const vy = this.vy + this.kby;
    // 足場（すり抜け床）
    if (vy <= 0 && this.drop <= 0 && !(this.state === 'hitstun' && this.kby > 0.05)) {
      for (const p of STAGE.platforms) {
        if (this.prevY >= p.y - 0.001 && this.y < p.y && this.x >= p.x1 && this.x <= p.x2) {
          this.land({ x1: p.x1, x2: p.x2, y: p.y, soft: true });
          return;
        }
      }
    }
    // メインステージ（箱）
    const overlapX = this.x + hw > M.x1 && this.x - hw < M.x2;
    if (overlapX && this.y < M.top && this.y + this.h > M.bottom) {
      if (this.prevY >= M.top - 0.001 && vy <= 0 && this.x >= M.x1 - hw * 0.4 && this.x <= M.x2 + hw * 0.4) {
        this.x = clamp(this.x, M.x1, M.x2);
        this.land({ x1: M.x1, x2: M.x2, y: M.top, soft: false });
      } else if (this.prevX - hw >= M.x2 - 0.05) {
        this.x = M.x2 + hw; this.wallHit();
      } else if (this.prevX + hw <= M.x1 + 0.05) {
        this.x = M.x1 - hw; this.wallHit();
      } else if (this.prevY + this.h <= M.bottom + 0.05) {
        this.y = M.bottom - this.h; if (this.vy > 0) this.vy = 0; if (this.kby > 0) this.kby *= -0.5;
      } else {
        // めり込み：近い面へ押し出す
        const dl = this.x - (M.x1 - hw), dr = M.x2 + hw - this.x, dt = M.top - this.y;
        const mn = Math.min(dl, dr, dt);
        if (mn === dt) this.land({ x1: M.x1, x2: M.x2, y: M.top, soft: false });
        else if (mn === dl) this.x = M.x1 - hw; else this.x = M.x2 + hw;
      }
    }
  }
  wallHit() {
    if (this.state === 'hitstun' && Math.abs(this.kbx) > 0.15) { this.kbx *= -0.6; this.sim.emit({ t: 'bounce', x: this.x, y: this.y + this.h / 2 }); }
    else { this.kbx = 0; this.vx = 0; }
  }

  land(surface) {
    const vyBefore = this.vy + this.kby;
    this.grounded = true; this.ground = surface; this.y = surface.y;
    this.vy = 0; this.ff = false; this.jumps = this.st.midair; this.airdodged = false; this.usedUpB = false; this.usedSideB = false;
    this.kby = 0;
    const s = this.state;
    if (s === 'air') { this.setState('land'); this.timer = 3; this.sim.emit({ t: 'land', x: this.x, y: this.y }); }
    else if (s === 'attack') {
      const m = this.move;
      if (m.plunge) { this.startMove(m.plunge); this.mf = 14; this.sim.emit({ t: 'quake', x: this.x, y: this.y }); }
      else if (m.aerial) { this.setState('land'); this.timer = m.landingLag; }
      else if (m.helpless || m.landCancel) { this.setState('land'); this.timer = 18; }
    } else if (s === 'helpless') { this.setState('land'); this.timer = 20; }
    else if (s === 'airdodge') { this.setState('land'); this.timer = this.dodgeDir ? 10 : 4; }
    else if (s === 'hitstun') {
      if (this.tumble) {
        this.kbx *= 0.3;
        if (this.frame - this.lastShieldPress <= 20) { this.setState('tech'); this.vx = 0; this.sim.emit({ t: 'tech', x: this.x, y: this.y }); }
        else if (vyBefore < -0.12) { this.setState('down'); this.sim.emit({ t: 'land', x: this.x, y: this.y, hard: true }); }
      }
    } else if (s === 'shieldbreak') { this.setState('dizzy'); this.timer = Math.max(120, 300 - this.percent); }
  }

  breakShield() {
    this.shield = 0;
    this.setState('shieldbreak');
    this.leaveGround();
    this.vy = 0.3; this.vx = 0;
    this.sim.emit({ t: 'shieldbreak', x: this.x, y: this.y + this.h / 2 });
    this.shield = SHIELD_MAX * 0.6;
  }

  // ---------- 崖 ----------
  checkLedge() {
    if (this.grounded || this.ledgeCd > 0) return;
    if (!['air', 'helpless', 'attack'].includes(this.state)) return;
    if (this.state === 'attack' && !(this.move && (this.move.helpless))) return;
    if (this.vy + this.kby > 0.02) return;
    if (this.in.y < -0.6) return;
    for (const L of STAGE.ledges) {
      const hangX = L.x + L.dir * (this.w / 2 + 0.02);
      const dx = (this.x - L.x) * L.dir;
      const top = this.y + this.h;
      if (dx > -0.25 && dx < this.w / 2 + 0.9 && top > L.y - 0.5 && top < L.y + 1.4) {
        if (this.sim.fighters.some((o) => o !== this && o.ledge === L && o.state === 'ledge')) continue;
        this.setState('ledge');
        this.ledge = L; this.ledgeTimer = 0;
        this.x = hangX; this.y = L.y - this.h * 0.85;
        this.vx = this.vy = this.kbx = this.kby = 0;
        this.facing = -L.dir;
        this.jumps = this.st.midair; this.airdodged = false; this.usedUpB = false; this.usedSideB = false; this.ff = false;
        this.sim.emit({ t: 'ledge', x: L.x, y: L.y });
        return;
      }
    }
  }

  updateLedge() {
    const L = this.ledge;
    const inp = this.in;
    this.ledgeTimer++;
    const toward = -inp.x * L.dir; // ステージ方向が正
    let e;
    const release = (opt) => { this.setState('ledgeclimb'); this.climbOpt = opt; };
    if ((e = this.take('j'))) {
      this.setState('air'); this.vy = this.st.jumpV * 1.05; this.vx = -L.dir * 0.05; this.ledge = null; this.ledgeCd = 20; this.inv = 3;
      this.sim.emit({ t: 'jump', x: this.x, y: this.y, slot: this.slot });
      return;
    }
    if ((e = this.take('a'))) return release('attack');
    if ((e = this.take('s'))) return release('roll');
    if (this.ledgeTimer > 8) {
      if (toward > 0.5 || inp.y > 0.5) return release('climb');
      if (toward < -0.5 || inp.y < -0.5) return this.dropLedge();
    }
    if (this.ledgeTimer > 300) this.dropLedge();
  }
  dropLedge() {
    const L = this.ledge;
    this.setState('air'); this.ledge = null; this.ledgeCd = 30;
    this.x += L.dir * 0.12; this.vy = 0;
  }
  updateClimb() {
    const L = this.ledge;
    const dur = this.climbOpt === 'climb' ? 26 : 20;
    const t = Math.min(1, this.sf / dur);
    const sx = L.x + L.dir * (this.w / 2 + 0.02), sy = L.y - this.h * 0.85;
    const ex = L.x - L.dir * (this.w / 2 + 0.25), ey = L.y;
    this.x = sx + (ex - sx) * t;
    this.y = sy + (ey - sy) * Math.min(1, t * 1.6);
    this.vx = this.vy = 0;
    if (this.sf >= dur) {
      this.x = ex; this.y = ey; this.grounded = true;
      this.ground = { x1: STAGE.main.x1, x2: STAGE.main.x2, y: STAGE.main.top, soft: false };
      this.ledge = null;
      const opt = this.climbOpt;
      this.setState('idle');
      if (opt === 'attack') this.startMove('ledgeatk');
      else if (opt === 'roll') { this.startRoll(-L.dir); this.sf = 3; }
    }
  }

  // ---------- つかみ ----------
  beginHold(target) {
    this.setState('holding');
    this.holding = target;
    this.holdTimer = Math.round(70 + target.percent * 0.5);
    target.setState('grabbed');
    target.heldBy = this;
    target.leaveGround();
    target.vx = target.vy = target.kbx = target.kby = 0;
    target.facing = -this.facing;
    this.sim.emit({ t: 'grab', x: target.x, y: target.y + target.h / 2 });
  }
  updateHolding() {
    const t = this.holding;
    if (!t || t.heldBy !== this) { this.holding = null; this.setState('idle'); return; }
    this.vx = 0;
    t.x = this.x + this.facing * (this.w / 2 + t.w / 2 + 0.05);
    t.y = this.y + 0.1;
    this.holdTimer--;
    const inp = this.in;
    let e;
    if (this.sf > 6) {
      const ax = Math.abs(inp.x), ay = Math.abs(inp.y);
      if (ax > 0.5 || ay > 0.5) {
        let key;
        if (ay > ax) key = inp.y > 0 ? 'uthrow' : 'dthrow';
        else key = Math.sign(inp.x) === this.facing ? 'fthrow' : 'bthrow';
        this.startMove(key);
        return;
      }
      if ((e = this.take('a'))) {
        this.pummeling = 8;
        this.sim.applyDamageOnly(this, t, 1.3);
      }
    }
    if (this.holdTimer <= 0) this.sim.releaseGrab(this, t);
  }
  updateGrabbed() {
    const by = this.heldBy;
    if (!by || by.holding !== this) { this.heldBy = null; this.setState('air'); return; }
    if (this.anyPress()) by.holdTimer -= 3;
    const mx = Math.abs(this.in.x - this.prevIn.x) + Math.abs(this.in.y - this.prevIn.y);
    if (mx > 0.8) by.holdTimer -= 2;
  }

  // ---------- 撃墜・復帰 ----------
  updateDead() {
    this.sf++;
    if (this.sf >= 80 && this.stocks > 0) {
      const R = STAGE.respawn;
      this.spawnAt(R.x, R.y, this.facing);
      this.grounded = false; this.ground = null;
      this.state = 'respawn'; this.sf = 0;
      this.inv = 2;
    }
  }
  ko() {
    this.stocks--;
    this.stats.falls++;
    this.sim.emit({ t: 'ko', x: this.x, y: this.y, slot: this.slot, final: this.stocks <= 0 });
    if (this.heldBy) { this.heldBy.holding = null; this.heldBy.setState('idle'); }
    if (this.holding) { this.holding.heldBy = null; this.holding.setState('air'); this.holding = null; }
    this.heldBy = null;
    this.state = 'dead'; this.sf = 0;
    this.move = null;
    this.percent = 0;
    this.vx = this.vy = this.kbx = this.kby = 0;
  }
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
