// ラクガキ画面：頭 → 体 → 腕 → 足 → その他 の順に、全身のガイドを見ながら描く
import { PARTS, GUIDE, VW, VH, emptyDoodle, renderStrokes, simplifyStroke, strokeCount, fillRegion, eraseAt, isFill, insidePoly } from '../doodle/model.js';
import { sfx } from './sound.js';

const COLORS = ['#222222', '#e74c3c', '#e67e22', '#f1c40f', '#27ae60', '#2e86de', '#8e44ad', '#ff7eb6', '#8b5a2b', '#7f8c8d'];
const WIDTHS = [{ w: 7, label: '細' }, { w: 13, label: '中' }, { w: 22, label: '太' }];
const PART_COLORS = { head: '#ff6b6b', body: '#4dabf7', arms: '#51cf66', legs: '#fcc419', extra: '#b197fc' };

export class DrawScreen {
  constructor(root, { onDone, onCancel, initial = null }) {
    this.root = root;
    this.onDone = onDone;
    this.onCancel = onCancel;
    this.doodle = initial ? JSON.parse(JSON.stringify(initial)) : emptyDoodle();
    this.step = 0;
    this.color = COLORS[0];
    this.width = WIDTHS[1].w;
    this.tool = 'pen'; // pen | eraser | bucket
    this.history = [];
    this.cur = null;
    this.build();
  }

  build() {
    const r = this.root;
    r.innerHTML = `
      <div class="draw">
        <div class="draw-head">
          <button class="btn btn-small draw-cancel">✕</button>
          <div class="steps">${PARTS.map((p, i) => `<div class="step" data-i="${i}" style="--sc:${PART_COLORS[p.key]}"><span>${p.label}</span></div>`).join('<i>›</i>')}</div>
        </div>
        <div class="draw-hint"></div>
        <div class="canvas-wrap"><canvas class="draw-canvas"></canvas></div>
        <div class="tools">
          <div class="colors">${COLORS.map((c) => `<button class="swatch" data-c="${c}" style="background:${c}"></button>`).join('')}</div>
          <div class="tool-row">
            <button class="tool mode" data-t="pen">✏️ ペン</button>
            <button class="tool mode" data-t="eraser">🧽 けしゴム</button>
            <button class="tool mode" data-t="bucket">🪣 バケツ</button>
          </div>
          <div class="tool-row">
            ${WIDTHS.map((w) => `<button class="tool width" data-w="${w.w}"><span style="width:${w.w}px;height:${w.w}px"></span>${w.label}</button>`).join('')}
            <button class="tool undo">↶ もどす</button>
            <button class="tool clear">ぜんぶ消す</button>
          </div>
        </div>
        <div class="draw-nav">
          <button class="btn draw-prev">‹ まえ</button>
          <button class="btn btn-primary draw-next">つぎへ ›</button>
        </div>
      </div>`;
    this.canvas = r.querySelector('.draw-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.hintEl = r.querySelector('.draw-hint');
    r.querySelector('.draw-cancel').onclick = () => { if (strokeCount(this.doodle) === 0 || confirm('ラクガキをやめますか？')) this.onCancel(); };
    for (const b of r.querySelectorAll('.swatch')) b.onclick = () => { this.color = b.dataset.c; this.refreshTools(); };
    for (const b of r.querySelectorAll('.width')) b.onclick = () => { this.width = +b.dataset.w; this.refreshTools(); };
    for (const b of r.querySelectorAll('.mode')) b.onclick = () => { this.tool = b.dataset.t; this.refreshTools(); if (this.tool === 'bucket') this.flash('線でかこまれた所をタップすると塗れるよ'); if (this.tool === 'eraser') this.flash(`「${PARTS[this.step].label}」の線を消せるよ。塗りはタップで消える`); };
    r.querySelector('.undo').onclick = () => this.undo();
    r.querySelector('.clear').onclick = () => { if (this.part.length && confirm(`「${PARTS[this.step].label}」をぜんぶ消しますか？`)) { this.snapshot(); this.part.length = 0; this.redraw(); } };
    r.querySelector('.draw-prev').onclick = () => this.go(this.step - 1);
    r.querySelector('.draw-next').onclick = () => this.next();
    for (const s of r.querySelectorAll('.step')) s.onclick = () => this.go(+s.dataset.i);

    // 描画
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (this.pid !== undefined && this.pid !== null) return;
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      const [x, y] = this.toV(e);
      if (this.tool === 'bucket') { this.bucket(x, y); return; }
      this.pid = e.pointerId;
      this.snapshot();
      if (this.tool === 'eraser') {
        this.erase = { x, y, sx: x, sy: y, changed: eraseAt(this.part, x, y, this.eraserR) };
      } else {
        this.cur = { c: this.color, w: this.width, f: false, p: [x, y] };
      }
      this.redraw();
    });
    c.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pid) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) {
        const [x, y] = this.toV(ev);
        if (this.erase) {
          // 速く動かしても消し残さないように、あいだも消す
          const E = this.erase;
          const d = Math.hypot(x - E.x, y - E.y);
          const steps = Math.max(1, Math.ceil(d / (this.eraserR * 0.5)));
          for (let k = 1; k <= steps; k++) {
            if (eraseAt(this.part, E.x + ((x - E.x) * k) / steps, E.y + ((y - E.y) * k) / steps, this.eraserR)) E.changed = true;
          }
          E.x = x; E.y = y;
        } else if (this.cur) {
          const p = this.cur.p;
          if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) >= 2) p.push(x, y);
        }
      }
      this.redraw();
    });
    const up = (e) => {
      if (e.pointerId !== this.pid) return;
      this.pid = null;
      if (this.erase) {
        const E = this.erase;
        this.erase = null;
        // 線にふれずにタップしたら、そこの塗りを消す
        if (!E.changed && Math.hypot(E.x - E.sx, E.y - E.sy) < 12) E.changed = this.removeFillAt(E.sx, E.sy);
        if (!E.changed) this.history.pop();
      } else if (this.cur) {
        const st = this.cur;
        this.cur = null;
        st.p = simplifyStroke(st.p, 3);
        if (st.p.length > 600) st.p = simplifyStroke(st.p, 6);
        this.part.push(st);
      }
      this.redraw();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    this.onResize = () => this.layout();
    window.addEventListener('resize', this.onResize);
    this.layout();
    this.go(0);
    this.refreshTools();
  }

  get part() { return this.doodle[PARTS[this.step].key]; }
  get eraserR() { return this.width * 1.6 + 6; }

  snapshot() {
    this.history.push(JSON.stringify(this.doodle));
    if (this.history.length > 60) this.history.shift();
  }
  undo() {
    const prev = this.history.pop();
    if (!prev) return;
    this.doodle = JSON.parse(prev);
    this.go(this.step, true);
  }

  flash(msg) {
    this.hintEl.innerHTML = `<span class="hint-flash">${msg}</span>`;
    clearTimeout(this.flashT);
    this.flashT = setTimeout(() => this.showHint(), 2200);
  }

  /** (x, y) をふくむ、いまのパーツの塗りを消す */
  removeFillAt(x, y) {
    const list = this.part;
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i];
      if (isFill(f) && insidePoly(x, y, f.p) && !(f.h || []).some((h) => insidePoly(x, y, h))) { list.splice(i, 1); return true; }
    }
    return false;
  }

  bucket(x, y) {
    const res = fillRegion(this.doodle, x, y);
    if (res.error) {
      sfx('ui');
      this.flash(res.error === 'open' ? 'すきまがあって塗れないよ。線でぐるっとかこんでね' : res.error === 'line' ? '線の上は塗れないよ。かこまれた内側をタップしてね' : 'せまくて塗れないよ');
      return;
    }
    this.snapshot();
    // 同じ場所の古い塗りは置きかえる
    this.removeFillAt(x, y);
    // 塗りは線より先に描くので、パーツの先頭に入れる
    const list = this.part;
    let at = 0;
    while (at < list.length && isFill(list[at])) at++;
    list.splice(at, 0, { t: 'fill', c: this.color, p: res.poly, h: res.holes });
    sfx('ui');
    this.redraw();
  }

  toV(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * VW;
    const y = ((e.clientY - r.top) / r.height) * VH;
    return [Math.round(Math.max(0, Math.min(VW, x))), Math.round(Math.max(0, Math.min(VH, y)))];
  }

  layout() {
    const wrap = this.root.querySelector('.canvas-wrap');
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const s = Math.min(W / VW, H / VH);
    const cw = Math.floor(VW * s), ch = Math.floor(VH * s);
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = ch + 'px';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(cw * dpr);
    this.canvas.height = Math.floor(ch * dpr);
    this.scale = (cw * dpr) / VW;
    this.redraw();
  }

  refreshTools() {
    const r = this.root;
    for (const b of r.querySelectorAll('.swatch')) b.classList.toggle('sel', b.dataset.c === this.color);
    for (const b of r.querySelectorAll('.width')) b.classList.toggle('sel', +b.dataset.w === this.width);
    for (const b of r.querySelectorAll('.mode')) b.classList.toggle('sel', b.dataset.t === this.tool);
    for (const b of r.querySelectorAll('.width')) b.disabled = this.tool === 'bucket';
    this.canvas.dataset.tool = this.tool;
    for (const b of r.querySelectorAll('.width span')) b.style.background = this.color;
  }

  showHint() {
    const P = PARTS[this.step];
    this.hintEl.innerHTML = `<b style="color:${PART_COLORS[P.key]}">${P.label}</b>：${P.hint}`;
  }

  go(i, silent = false) {
    if (i < 0) return;
    if (i >= PARTS.length) return;
    this.step = i;
    const r = this.root;
    r.querySelectorAll('.step').forEach((s, k) => {
      s.classList.toggle('cur', k === i);
      s.classList.toggle('done', (this.doodle[PARTS[k].key] || []).length > 0);
    });
    clearTimeout(this.flashT);
    this.showHint();
    r.querySelector('.draw-prev').disabled = i === 0;
    r.querySelector('.draw-next').textContent = i === PARTS.length - 1 ? 'できた！' : 'つぎへ ›';
    if (!silent) sfx('ui');
    this.redraw();
  }

  next() {
    const key = PARTS[this.step].key;
    if (this.step < PARTS.length - 1) {
      if ((key === 'head' || key === 'body') && !this.part.length && !confirm(`「${PARTS[this.step].label}」をかかずに進みますか？`)) return;
      this.go(this.step + 1);
      return;
    }
    if (!this.doodle.head.length && !this.doodle.body.length) { alert('頭か体はかいてね！'); return; }
    this.finish();
  }

  finish() {
    window.removeEventListener('resize', this.onResize);
    this.onDone(this.doodle);
  }

  destroy() { window.removeEventListener('resize', this.onResize); }

  redraw() {
    const g = this.ctx;
    const s = this.scale || 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#fffdf6';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(s, 0, 0, s, 0, 0);
    // 方眼
    g.strokeStyle = 'rgba(80,140,220,0.12)';
    g.lineWidth = 1 / s;
    for (let y = 30; y < VH; y += 30) { g.beginPath(); g.moveTo(0, y); g.lineTo(VW, y); g.stroke(); }
    // ガイド（全身）
    PARTS.forEach((p, i) => this.drawGuide(p.key, i === this.step));
    // 塗り → 線 の順に描く（ほかのパーツの塗りで線が隠れないように）。いまのパーツ以外は少しうすく
    PARTS.forEach((p, i) => renderStrokes(g, this.doodle[p.key].filter(isFill), { alpha: i === this.step ? 1 : 0.55 }));
    PARTS.forEach((p, i) => renderStrokes(g, this.doodle[p.key].filter((st) => !isFill(st)), { alpha: i === this.step ? 1 : 0.55 }));
    if (this.cur) renderStrokes(g, [this.cur]);
    if (this.erase) {
      g.setLineDash([6, 5]);
      g.lineWidth = 2;
      g.strokeStyle = '#555';
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath(); g.arc(this.erase.x, this.erase.y, this.eraserR, 0, Math.PI * 2); g.fill(); g.stroke();
      g.setLineDash([]);
    }
  }

  drawGuide(key, active) {
    const G = GUIDE[key];
    const g = this.ctx;
    const col = PART_COLORS[key];
    g.save();
    g.setLineDash(active ? [14, 10] : [8, 10]);
    g.lineWidth = active ? 4 : 2;
    g.strokeStyle = active ? col : 'rgba(0,0,0,0.13)';
    g.fillStyle = active ? col + '22' : 'rgba(0,0,0,0.025)';
    if (G.type === 'circle') { g.beginPath(); g.arc(G.cx, G.cy, G.r, 0, Math.PI * 2); g.fill(); g.stroke(); }
    else if (G.type === 'rect') { g.beginPath(); roundRect(g, G.x1, G.y1, G.x2 - G.x1, G.y2 - G.y1, 40); g.fill(); g.stroke(); }
    else if (G.type === 'lines') {
      for (const [x1, y1, x2, y2] of G.lines) {
        g.save();
        g.lineCap = 'round';
        g.setLineDash([]);
        g.lineWidth = G.w;
        g.strokeStyle = active ? col + '30' : 'rgba(0,0,0,0.035)';
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        g.restore();
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      }
    } else if (active) {
      g.setLineDash([]);
      g.font = 'bold 30px sans-serif';
      g.fillStyle = col;
      g.textAlign = 'center';
      g.fillText('ぶき・ぼうし・しっぽ…', VW / 2, 60);
      g.font = '22px sans-serif';
      g.fillText('（武器キャラになると手に持つよ）', VW / 2, 92);
    }
    g.restore();
  }
}

function roundRect(g, x, y, w, h, r) {
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
