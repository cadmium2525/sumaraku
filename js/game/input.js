// スマホのタッチ操作（左：スティック / 右：ボタン）とキーボード。
// スティックをすばやくはじくと「スマッシュ入力」（スマッシュ攻撃・ダッシュ・回避・すり抜け・急降下）。
export class InputController {
  constructor(root) {
    this.root = root;
    this.stick = { x: 0, y: 0 };
    this.btn = { a: false, b: false, j: false, s: false };
    this.keys = new Set();
    this.hist = [];
    this.smashTimer = 0;
    this.stickTouch = null;
    this.build();
    this.onKey = (e) => {
      if (e.repeat) return;
      const down = e.type === 'keydown';
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'a', 'd', 'w', 's', 'j', 'k', 'l', 'i'].includes(k)) e.preventDefault();
      if (down) this.keys.add(k); else this.keys.delete(k);
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
  }

  build() {
    const el = document.createElement('div');
    el.className = 'touch-ui';
    el.innerHTML = `
      <div class="stick-zone"><div class="stick-base"><div class="stick-knob"></div></div><div class="stick-hint">スティック<br><small>はじくとスマッシュ</small></div></div>
      <div class="btn-zone">
        <button class="pad-btn pad-a" data-b="a">攻撃</button>
        <button class="pad-btn pad-b" data-b="b">必殺</button>
        <button class="pad-btn pad-j" data-b="j">ジャンプ</button>
        <button class="pad-btn pad-s" data-b="s">ガード</button>
      </div>`;
    this.root.appendChild(el);
    this.el = el;
    const zone = el.querySelector('.stick-zone');
    const base = el.querySelector('.stick-base');
    const knob = el.querySelector('.stick-knob');
    this.base = base; this.knob = knob;
    const R = 55;
    let ox = 0, oy = 0;
    const hint = el.querySelector('.stick-hint');
    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.stickTouch !== null) return;
      const t = e.changedTouches[0];
      this.stickTouch = t.identifier;
      const r = zone.getBoundingClientRect();
      ox = t.clientX; oy = t.clientY;
      base.style.left = `${t.clientX - r.left}px`; base.style.top = `${t.clientY - r.top}px`;
      base.classList.add('active');
      hint.style.opacity = 0;
      knob.style.transform = 'translate(-50%,-50%)';
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== this.stickTouch) continue;
        let dx = t.clientX - ox, dy = t.clientY - oy;
        const d = Math.hypot(dx, dy);
        // 指が遠くまで行ったらスティックの中心もついてくる
        if (d > R * 1.4) { const k = (d - R * 1.4) / d; ox += dx * k; oy += dy * k; dx = t.clientX - ox; dy = t.clientY - oy; const r = zone.getBoundingClientRect(); base.style.left = `${ox - r.left}px`; base.style.top = `${oy - r.top}px`; }
        const m = Math.min(1, Math.hypot(dx, dy) / R);
        const a = Math.atan2(dy, dx);
        this.stick.x = Math.cos(a) * m;
        this.stick.y = -Math.sin(a) * m;
        knob.style.transform = `translate(calc(-50% + ${Math.cos(a) * m * R}px), calc(-50% + ${Math.sin(a) * m * R}px))`;
      }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.stickTouch) continue;
        this.stickTouch = null;
        this.stick.x = this.stick.y = 0;
        base.classList.remove('active');
        knob.style.transform = 'translate(-50%,-50%)';
      }
    };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);
    // ボタン（複数同時押し対応）
    for (const b of el.querySelectorAll('.pad-btn')) {
      const k = b.dataset.b;
      const on = (e) => { e.preventDefault(); this.btn[k] = true; b.classList.add('on'); };
      const off = (e) => { e.preventDefault(); this.btn[k] = false; b.classList.remove('on'); };
      b.addEventListener('touchstart', on, { passive: false });
      b.addEventListener('touchend', off);
      b.addEventListener('touchcancel', off);
      b.addEventListener('mousedown', on);
      b.addEventListener('mouseup', off);
      b.addEventListener('mouseleave', off);
    }
  }

  /** 1フレームぶんの入力を読む */
  read() {
    const K = this.keys;
    let x = this.stick.x, y = this.stick.y;
    const kx = (K.has('arrowright') || K.has('d') ? 1 : 0) - (K.has('arrowleft') || K.has('a') ? 1 : 0);
    const ky = (K.has('arrowup') || K.has('w') ? 1 : 0) - (K.has('arrowdown') || K.has('s') ? 1 : 0);
    if (kx || ky) {
      // キーボードは Shift を押しながらだと弱入力（強攻撃）
      const m = K.has('shift') ? 0.5 : 1;
      x = kx * m; y = ky * m;
    }
    const mag = Math.hypot(x, y);
    if (mag < 0.2) { x = 0; y = 0; }
    // はじき入力の検出：数フレーム以内に小 → 大
    this.hist.push(mag);
    if (this.hist.length > 5) this.hist.shift();
    if (mag > 0.82 && Math.min(...this.hist) < 0.3) this.smashTimer = 7;
    if ((kx || ky) && !K.has('shift') && this.prevKeyMag === 0) this.smashTimer = 7;
    this.prevKeyMag = kx || ky ? 1 : 0;
    if (this.smashTimer > 0) this.smashTimer--;
    const smash = this.smashTimer > 0 && mag > 0.6;
    return {
      x, y, smash,
      a: this.btn.a || K.has('j') || K.has('z'),
      b: this.btn.b || K.has('k') || K.has('x'),
      j: this.btn.j || K.has(' ') || K.has('i') || K.has('c'),
      s: this.btn.s || K.has('l') || K.has('v'),
    };
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.el.remove();
  }
}
