// ラクガキ画面：頭 → 体 → 腕 → 足 → その他 の順に、全身のガイドを見ながら描く
import { PARTS, GUIDE, VW, VH, emptyDoodle, renderStrokes, simplifyStroke, strokeCount } from '../doodle/model.js';
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
    this.fill = true;
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
            ${WIDTHS.map((w) => `<button class="tool width" data-w="${w.w}"><span style="width:${w.w}px;height:${w.w}px"></span>${w.label}</button>`).join('')}
            <button class="tool fill-toggle" title="とじた形をぬりつぶす">ぬり</button>
            <button class="tool undo">↶ もどす</button>
            <button class="tool clear">けす</button>
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
    r.querySelector('.fill-toggle').onclick = () => { this.fill = !this.fill; this.refreshTools(); };
    r.querySelector('.undo').onclick = () => { this.part.pop(); this.redraw(); };
    r.querySelector('.clear').onclick = () => { if (this.part.length && confirm(`「${PARTS[this.step].label}」をぜんぶ消しますか？`)) { this.part.length = 0; this.redraw(); } };
    r.querySelector('.draw-prev').onclick = () => this.go(this.step - 1);
    r.querySelector('.draw-next').onclick = () => this.next();
    for (const s of r.querySelectorAll('.step')) s.onclick = () => this.go(+s.dataset.i);

    // 描画
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (this.cur) return;
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      this.pid = e.pointerId;
      const [x, y] = this.toV(e);
      this.cur = { c: this.color, w: this.width, f: this.fill, p: [x, y] };
      this.redraw();
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.cur || e.pointerId !== this.pid) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) {
        const [x, y] = this.toV(ev);
        const p = this.cur.p;
        if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) >= 2) p.push(x, y);
      }
      this.redraw();
    });
    const up = (e) => {
      if (!this.cur || e.pointerId !== this.pid) return;
      const s = this.cur;
      this.cur = null;
      s.p = simplifyStroke(s.p, 3);
      if (s.p.length > 600) s.p = simplifyStroke(s.p, 6);
      this.part.push(s);
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
    r.querySelector('.fill-toggle').classList.toggle('sel', this.fill);
    for (const b of r.querySelectorAll('.width span')) b.style.background = this.color;
  }

  go(i) {
    if (i < 0) return;
    if (i >= PARTS.length) return;
    this.step = i;
    const r = this.root;
    r.querySelectorAll('.step').forEach((s, k) => {
      s.classList.toggle('cur', k === i);
      s.classList.toggle('done', (this.doodle[PARTS[k].key] || []).length > 0);
    });
    this.hintEl.innerHTML = `<b style="color:${PART_COLORS[PARTS[i].key]}">${PARTS[i].label}</b>：${PARTS[i].hint}`;
    r.querySelector('.draw-prev').disabled = i === 0;
    r.querySelector('.draw-next').textContent = i === PARTS.length - 1 ? 'できた！' : 'つぎへ ›';
    sfx('ui');
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
    // ストローク：いまのパーツ以外は少しうすく
    PARTS.forEach((p, i) => {
      renderStrokes(g, this.doodle[p.key], { alpha: i === this.step ? 1 : 0.55 });
    });
    if (this.cur) renderStrokes(g, [this.cur]);
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
