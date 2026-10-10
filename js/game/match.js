// 1試合の進行：ループ・HUD・カウントダウン・GAME SET・結果
import { Sim } from './sim.js';
import { AI } from './ai.js';
import { Renderer, PLAYER_COLORS } from './render.js';
import { InputController } from './input.js';
import { buildFighterDef } from './archetypes.js';
import { computeRig, drawThumb } from '../doodle/model.js';
import { STOCKS, TIME_LIMIT } from './constants.js';
import { sfx } from '../ui/sound.js';

const STEP = 1 / 60;

export function defFromChar(c) {
  const rig = computeRig(c.doodle, 1.8);
  return buildFighterDef({ type: c.type, seed: c.seed, reach: rig.reach, widthRatio: rig.widthRatio, name: c.name });
}

/**
 * opts: { chars:[A,B], mode:'cpu'|'auto', level, seed, onEnd(result), onQuit() }
 * mode 'cpu'：P1 が人間、'auto'：両方 AI
 */
export class Match {
  constructor(container, opts) {
    this.container = container;
    this.opts = opts;
    const [A, B] = opts.chars;
    this.seed = opts.seed || (Math.random() * 1e9) | 0;
    const defs = [defFromChar(A), defFromChar(B)];
    this.sim = new Sim(defs[0], defs[1], { seed: this.seed, stocks: STOCKS, timeLimit: TIME_LIMIT });
    const human = opts.mode === 'cpu';
    this.ais = [
      human ? null : new AI(this.sim.fighters[0], this.sim, opts.levelA || 7, this.seed + 11),
      new AI(this.sim.fighters[1], this.sim, opts.level || 7, this.seed + 23),
    ];

    container.innerHTML = '';
    container.classList.add('battle');
    const canvas = document.createElement('canvas');
    canvas.className = 'battle-canvas';
    container.appendChild(canvas);
    this.renderer = new Renderer(canvas, { debug: /debug/.test(location.search) });
    this.renderer.setFighters([A, B], this.sim);
    if (/debug/.test(location.search)) window.__match = this;
    this.buildHud([A, B]);
    if (human) this.input = new InputController(container);

    this.timeScale = opts.mode === 'auto' ? 1 : 1;
    this.acc = 0;
    this.phase = 'countdown';
    this.phaseT = 0;
    this.last = performance.now();
    this.running = true;
    this.paused = false;
    this.onResize = () => this.renderer.resize();
    window.addEventListener('resize', this.onResize);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    sfx('count');
  }

  buildHud(chars) {
    const hud = document.createElement('div');
    hud.className = 'hud';
    hud.innerHTML = `
      <div class="hud-top">
        <button class="hud-btn hud-pause">II</button>
        <div class="hud-timer"></div>
        ${this.opts.mode === 'auto' ? '<button class="hud-btn hud-speed">×1</button><button class="hud-btn hud-skip">スキップ</button>' : ''}
      </div>
      <div class="hud-center"></div>
      <div class="hud-panels">
        ${chars.map((c, i) => `
          <div class="hud-panel" style="--pc:${PLAYER_COLORS[i]}">
            <canvas class="hud-face" width="72" height="72"></canvas>
            <div class="hud-info">
              <div class="hud-name">${escapeHtml(c.name)}${this.opts.mode === 'cpu' ? (i === 0 ? ' <b>P1</b>' : ' <b>CPU</b>') : ''}</div>
              <div class="hud-pct"><span class="pct">0</span><small>%</small></div>
              <div class="hud-stocks"></div>
            </div>
          </div>`).join('')}
      </div>
      <div class="offscreen"></div><div class="offscreen"></div>
      <div class="pause-menu hidden">
        <div class="pause-box">
          <h2>ポーズ</h2>
          <button class="btn btn-big pause-resume">つづける</button>
          <button class="btn pause-quit">やめる</button>
          ${this.opts.mode === 'cpu' ? `<div class="howto">
            <b>操作</b><br>
            左：スティック（はじく＝スマッシュ攻撃・ダッシュ・回避）<br>
            攻撃：弱・強・スマッシュ・空中攻撃 ／ 必殺：方向＋必殺ワザ<br>
            ジャンプ：長押しで大ジャンプ・空中でもう1回<br>
            ガード：押しっぱなし。ガード＋攻撃＝つかみ、ガード＋はじき＝回避<br>
            空中でガード＝空中回避。崖は近づくと自動でつかまる
          </div>` : ''}
        </div>
      </div>`;
    this.container.appendChild(hud);
    this.hud = hud;
    this.faces = [...hud.querySelectorAll('.hud-face')];
    chars.forEach((c, i) => drawThumb(this.faces[i], c.doodle, { pad: 4 }));
    this.pctEls = [...hud.querySelectorAll('.pct')];
    this.stockEls = [...hud.querySelectorAll('.hud-stocks')];
    this.panelEls = [...hud.querySelectorAll('.hud-panel')];
    this.timerEl = hud.querySelector('.hud-timer');
    this.centerEl = hud.querySelector('.hud-center');
    this.offEls = [...hud.querySelectorAll('.offscreen')];
    this.lastPct = [-1, -1];
    this.lastStocks = [-1, -1];
    hud.querySelector('.hud-pause').onclick = () => this.setPaused(true);
    hud.querySelector('.pause-resume').onclick = () => this.setPaused(false);
    hud.querySelector('.pause-quit').onclick = () => { this.destroy(); this.opts.onQuit && this.opts.onQuit(); };
    const sp = hud.querySelector('.hud-speed');
    if (sp) sp.onclick = () => { this.timeScale = this.timeScale === 1 ? 2 : this.timeScale === 2 ? 4 : 1; sp.textContent = `×${this.timeScale}`; };
    const sk = hud.querySelector('.hud-skip');
    if (sk) sk.onclick = () => this.skip();
  }

  setPaused(p) {
    this.paused = p;
    this.hud.querySelector('.pause-menu').classList.toggle('hidden', !p);
    this.last = performance.now();
  }

  showCenter(text, cls = '') {
    this.centerEl.innerHTML = text ? `<div class="center-text ${cls}">${text}</div>` : '';
  }

  loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    let dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.paused) { this.renderer.render(0); return; }
    this.phaseT += dt;

    if (this.phase === 'countdown') {
      const n = 3 - Math.floor(this.phaseT / 0.7);
      if (n !== this.lastCount) { this.lastCount = n; if (n > 0) { this.showCenter(String(n), 'count'); if (n < 3) sfx('count'); } else { this.showCenter('GO!', 'go'); sfx('go'); } }
      if (this.phaseT > 2.1) { this.phase = 'play'; this.phaseT = 0; }
    } else if (this.phase === 'play') {
      if (this.phaseT > 0.6 && this.centerEl.innerHTML.includes('GO')) this.showCenter('');
      this.acc += dt * this.timeScale * (this.slowmo > 0 ? 0.25 : 1);
      if (this.slowmo > 0) this.slowmo -= dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 12) {
        this.acc -= STEP;
        steps++;
        const inputs = [this.input ? this.input.read() : this.ais[0].next(), this.ais[1].next()];
        this.sim.step(inputs);
        this.handleSounds();
        if (this.sim.over) break;
      }
      if (this.sim.over) { this.phase = 'gameset'; this.phaseT = 0; this.showCenter('GAME SET', 'gameset'); sfx('gameset'); }
    } else if (this.phase === 'gameset') {
      if (this.phaseT > 2.2) { this.finish(); return; }
    }
    this.renderer.render(dt);
    this.updateHud();
  }

  handleSounds() {
    for (const e of this.sim.events) {
      if (e.t === 'hit') sfx(e.kb > 120 ? 'smash' : e.small ? 'tap' : 'hit', e.kb);
      else if (e.t === 'ko') { sfx('ko'); if (e.final) this.slowmo = 1.2; }
      else if (e.t === 'shield') sfx('shield');
      else if (e.t === 'jump') sfx('jump');
      else if (e.t === 'shoot') sfx('shoot');
      else if (e.t === 'explode') sfx('boom');
      else if (e.t === 'shieldbreak') sfx('break');
      else if (e.t === 'counter') sfx('counter');
    }
  }

  updateHud() {
    const sim = this.sim;
    sim.fighters.forEach((f, i) => {
      const p = Math.floor(f.state === 'dead' ? 0 : f.percent);
      if (p !== this.lastPct[i]) {
        const up = p > this.lastPct[i];
        this.lastPct[i] = p;
        this.pctEls[i].textContent = p;
        // 0%=白 → 黄 → 赤 → 暗い赤
        const t = Math.min(1, p / 150);
        const hue = 55 - t * 55;
        const light = 100 - Math.min(1, p / 60) * 45 - Math.max(0, (p - 150) / 150) * 25;
        this.pctEls[i].style.color = `hsl(${hue}, 100%, ${light}%)`;
        if (up) { this.pctEls[i].classList.remove('bump'); void this.pctEls[i].offsetWidth; this.pctEls[i].classList.add('bump'); }
      }
      if (f.stocks !== this.lastStocks[i]) {
        this.lastStocks[i] = f.stocks;
        this.stockEls[i].innerHTML = Array.from({ length: STOCKS }, (_, k) => `<span class="stock ${k < f.stocks ? '' : 'lost'}"></span>`).join('');
      }
      this.panelEls[i].classList.toggle('out', f.stocks <= 0);
      // 画面外インジケータ
      const off = this.offEls[i];
      if (f.state !== 'dead' && f.stocks > 0) {
        const pr = this.renderer.project(f.x, f.y + f.h / 2);
        if (!pr.inside) {
          off.style.display = 'block';
          off.style.left = `${Math.max(4, Math.min(96, pr.x * 100))}%`;
          off.style.top = `${Math.max(8, Math.min(80, pr.y * 100))}%`;
          off.style.borderColor = PLAYER_COLORS[i];
        } else off.style.display = 'none';
      } else off.style.display = 'none';
    });
    const remain = Math.max(0, Math.ceil((sim.timeLimit - sim.frame) / 60));
    const t = `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, '0')}`;
    if (t !== this.lastTime) { this.lastTime = t; this.timerEl.textContent = t; }
  }

  /** オートバトルのスキップ：残りを一気に計算 */
  skip() {
    let n = 0;
    while (!this.sim.over && n < 60 * 60 * 10) {
      this.sim.step([this.ais[0].next(), this.ais[1].next()]);
      this.sim.events.length = 0;
      n++;
    }
    this.phase = 'gameset'; this.phaseT = 1.2;
    this.showCenter('GAME SET', 'gameset');
  }

  finish() {
    const sim = this.sim;
    const res = {
      winner: sim.winner, reason: sim.endReason, frames: sim.frame, seed: this.seed,
      fighters: sim.fighters.map((f) => ({ stocks: f.stocks, percent: f.percent, ...f.stats })),
    };
    this.destroy();
    this.opts.onEnd && this.opts.onEnd(res);
  }

  destroy() {
    if (!this.running) return;
    this.running = false;
    window.removeEventListener('resize', this.onResize);
    if (this.input) this.input.dispose();
    this.renderer.dispose();
    this.container.innerHTML = '';
    this.container.classList.remove('battle');
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
