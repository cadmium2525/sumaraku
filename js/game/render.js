// three.js による対戦画面の描画（ステージ・キャラ・飛び道具・エフェクト・カメラ）
import * as THREE from 'three';
import { STAGE } from './constants.js';
import { poseFor, wrapAngle } from './anim.js';
import { buildCharacter } from '../doodle/builder3d.js';

const PLAYER_COLORS = ['#ff4757', '#1e90ff'];

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ノートの紙
function paperTex(w, h, lines = true) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = '#fbf7ec'; g.fillRect(0, 0, w, h);
    if (lines) {
      g.strokeStyle = 'rgba(80,140,220,0.35)'; g.lineWidth = 2;
      for (let y = 24; y < h; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.strokeStyle = 'rgba(230,80,80,0.45)';
      g.beginPath(); g.moveTo(40, 0); g.lineTo(40, h); g.stroke();
    }
  });
}

function starTex() {
  return canvasTex(128, 128, (g) => {
    g.translate(64, 64);
    g.fillStyle = '#fff6a0'; g.strokeStyle = '#ff9f1a'; g.lineWidth = 6;
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const r = i % 2 ? 22 : 58;
      const a = (i / 16) * Math.PI * 2;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath(); g.fill(); g.stroke();
  });
}
function puffTex() {
  return canvasTex(64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 4, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(60,60,60,0.5)'; g.lineWidth = 3; g.beginPath(); g.arc(32, 32, 20, 0, Math.PI * 2); g.stroke();
  });
}
function ringTex() {
  return canvasTex(128, 128, (g) => {
    g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
  });
}

export class Renderer {
  constructor(canvas, { debug = false } = {}) {
    this.canvas = canvas;
    this.debug = debug;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#bfe3ff');
    this.scene.fog = new THREE.Fog('#bfe3ff', 45, 110);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
    this.camPos = new THREE.Vector3(0, 3, 26);
    this.camLook = new THREE.Vector3(0, 2, 0);
    this.shake = 0;
    this.time = 0;
    this.fx = [];
    this.projMeshes = new Map();
    this.models = [];
    this.tex = { star: starTex(), puff: puffTex(), ring: ringTex() };

    const hemi = new THREE.HemisphereLight('#ffffff', '#c8b89a', 1.6);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(4, 10, 8);
    this.scene.add(sun);

    this.buildStage();
    this.resize();
  }

  buildStage() {
    const S = STAGE.main;
    const g = new THREE.Group();
    // メインステージ：ノートを切り取ったような台
    const w = S.x2 - S.x1, h = S.top - S.bottom, d = 3.2;
    const top = paperTex(512, 256);
    top.wrapS = top.wrapT = THREE.RepeatWrapping;
    const side = paperTex(512, 128, false);
    const mats = [
      new THREE.MeshToonMaterial({ map: side, color: '#efe6cf' }), new THREE.MeshToonMaterial({ map: side, color: '#efe6cf' }),
      new THREE.MeshToonMaterial({ map: top }), new THREE.MeshToonMaterial({ color: '#d9cba8' }),
      new THREE.MeshToonMaterial({ map: side }), new THREE.MeshToonMaterial({ map: side }),
    ];
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
    box.position.set((S.x1 + S.x2) / 2, (S.top + S.bottom) / 2, 0);
    g.add(box);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: '#333' }));
    edges.position.copy(box.position);
    g.add(edges);
    // 下にぶら下がる鉛筆の削りかすっぽい三角
    const under = new THREE.Mesh(new THREE.ConeGeometry(w * 0.36, 4.5, 4), new THREE.MeshToonMaterial({ color: '#e8d9b5' }));
    under.rotation.z = Math.PI; under.rotation.y = Math.PI / 4;
    under.position.set(0, S.bottom - 2.2, 0);
    g.add(under);
    // すり抜け床
    for (const p of STAGE.platforms) {
      const pw = p.x2 - p.x1;
      const m = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.22, 2.4), new THREE.MeshToonMaterial({ color: '#ffd166' }));
      m.position.set((p.x1 + p.x2) / 2, p.y - 0.11, 0);
      g.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: '#7a5a00' }));
      e.position.copy(m.position);
      g.add(e);
    }
    // 背景：大きなノート
    const bgTex = paperTex(1024, 512);
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), new THREE.MeshBasicMaterial({ map: bgTex, color: '#e9f4ff' }));
    bg.position.set(0, 4, -28);
    g.add(bg);
    // 背景のラクガキ雲
    const cloudTex = canvasTex(256, 128, (c) => {
      c.fillStyle = '#ffffff'; c.strokeStyle = '#6c8fb3'; c.lineWidth = 5;
      c.beginPath();
      [[70, 75, 40], [120, 55, 48], [175, 72, 40], [125, 85, 40]].forEach(([x, y, r]) => { c.moveTo(x + r, y); c.arc(x, y, r, 0, Math.PI * 2); });
      c.fill(); c.stroke();
    });
    for (let i = 0; i < 7; i++) {
      const cl = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true }));
      cl.position.set(-40 + i * 13 + (i % 2) * 4, 10 + (i % 3) * 5, -20 - (i % 2) * 4);
      g.add(cl);
    }
    this.scene.add(g);

    // 復活台
    this.respawnPlat = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.6, 0.18, 20), new THREE.MeshToonMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }));
    this.respawnPlat.visible = false;
    this.respawnPlat2 = this.respawnPlat.clone();
    this.scene.add(this.respawnPlat, this.respawnPlat2);
  }

  /** 対戦するキャラのモデルを作る */
  setFighters(chars, sim) {
    for (const m of this.models) { this.scene.remove(m.root); m.dispose(); }
    this.models = chars.map((c, i) => {
      const model = buildCharacter(c.doodle, sim.fighters[i].def);
      model.anim = { armF: 0, armB: 0, legF: 0, legB: 0, lean: 0, facing: sim.fighters[i].facing };
      this.scene.add(model.root);
      // シールド
      const sh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: PLAYER_COLORS[i], transparent: true, opacity: 0.35, depthWrite: false }));
      sh.visible = false;
      this.scene.add(sh);
      model.shieldMesh = sh;
      // 影
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.22, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      this.scene.add(shadow);
      model.shadow = shadow;
      // プレイヤー表示（頭上の三角）
      const tag = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 3), new THREE.MeshBasicMaterial({ color: PLAYER_COLORS[i] }));
      tag.rotation.z = Math.PI;
      this.scene.add(tag);
      model.tag = tag;
      if (this.debug) {
        model.dbg = [];
      }
      return model;
    });
    this.sim = sim;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- 毎フレーム ----------
  render(dt) {
    this.time += dt;
    const sim = this.sim;
    if (sim) {
      sim.fighters.forEach((f, i) => this.updateFighter(f, this.models[i], dt));
      this.updateProjectiles(sim);
      for (const e of sim.events) this.onEvent(e);
      sim.events.length = 0;
      this.updateCamera(dt);
    }
    this.updateFx(dt);
    this.renderer.render(this.scene, this.camera);
  }

  updateFighter(f, M, dt) {
    const visible = f.state !== 'dead' && f.stocks > 0;
    M.root.visible = visible;
    M.shadow.visible = visible && !f.grounded ? true : visible;
    M.tag.visible = visible;
    if (!visible) { M.shieldMesh.visible = false; return; }
    applyPose(M, f, this.time);
    // シールド
    const sh = M.shieldMesh;
    if (f.isShielding()) {
      sh.visible = true;
      const r = 0.35 + 0.75 * (f.shield / 50) * (f.h / 1.8);
      sh.scale.setScalar(r);
      sh.position.set(f.x, f.y + f.h * 0.5, 0);
      sh.material.opacity = 0.25 + 0.2 * (1 - f.shield / 50);
    } else sh.visible = false;
    // 影：真下の床
    const gy = this.groundBelow(f.x, f.y);
    if (gy === null) M.shadow.visible = false;
    else {
      M.shadow.visible = true;
      M.shadow.position.set(f.x, gy + 0.02, 0.3);
      const hgt = f.y - gy;
      M.shadow.scale.setScalar(Math.max(0.3, 1 - hgt * 0.08) * (f.w / 0.8));
      M.shadow.material.opacity = Math.max(0.05, 0.25 - hgt * 0.02);
    }
    M.tag.position.set(f.x, f.y + f.h + 0.45 + Math.sin(this.time * 4) * 0.05, 0);
    // 復活台
    const plat = f.slot === 0 ? this.respawnPlat : this.respawnPlat2;
    plat.visible = f.state === 'respawn';
    if (plat.visible) plat.position.set(f.x, f.y - 0.1, 0);
    if (f.state === 'run' && Math.random() < 0.15) this.puff(f.x - f.facing * 0.3, f.y + 0.1, 0.3, 0.4);
    if (f.state === 'hitstun' && Math.hypot(f.kbx, f.kby) > 0.25 && Math.random() < 0.7) this.puff(f.x, f.y + f.h / 2, 0.45, 0.5, '#bbbbbb');
    if (this.debug) this.drawDebug(f, M);
  }

  groundBelow(x, y) {
    let best = null;
    const S = STAGE.main;
    if (x >= S.x1 && x <= S.x2 && y >= S.top - 0.05) best = S.top;
    for (const p of STAGE.platforms) if (x >= p.x1 && x <= p.x2 && y >= p.y - 0.05 && (best === null || p.y > best)) best = p.y;
    return best;
  }

  drawDebug(f, M) {
    for (const m of M.dbg) this.scene.remove(m);
    M.dbg = [];
    for (const h of f.activeHitboxes()) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(h.wr, 10, 8), new THREE.MeshBasicMaterial({ color: h.grab ? '#a855f7' : '#ff0000', transparent: true, opacity: 0.4 }));
      s.position.set(h.wx, h.wy, 0.5);
      this.scene.add(s); M.dbg.push(s);
    }
    const hb = f.hurtbox();
    const b = new THREE.Mesh(new THREE.PlaneGeometry(hb.x2 - hb.x1, hb.y2 - hb.y1), new THREE.MeshBasicMaterial({ color: f.isIntangible() ? '#3b82f6' : '#facc15', transparent: true, opacity: 0.25 }));
    b.position.set((hb.x1 + hb.x2) / 2, (hb.y1 + hb.y2) / 2, 0.4);
    this.scene.add(b); M.dbg.push(b);
  }

  updateProjectiles(sim) {
    const alive = new Set();
    for (const p of sim.projectiles) {
      alive.add(p.id);
      let m = this.projMeshes.get(p.id);
      if (!m) {
        m = this.makeProjMesh(p);
        this.projMeshes.set(p.id, m);
        this.scene.add(m);
      }
      m.position.set(p.x, p.y, 0.2);
      if (p.kind === 'boomerang') m.rotation.z += 0.45;
      else if (p.kind === 'missile') m.rotation.z = Math.atan2(p.vy, p.vx);
      else if (p.kind === 'bomb') m.rotation.z -= 0.15;
      else if (p.kind === 'mine') m.scale.y = p.armed > 0 ? 0.6 : 0.6 + (Math.sin(this.time * 12) > 0 ? 0.1 : 0);
      else m.rotation.z += 0.2;
    }
    for (const [id, m] of this.projMeshes) if (!alive.has(id)) { this.scene.remove(m); this.projMeshes.delete(id); }
    // 武器キャラはブーメランを投げている間は手の武器を消す
    sim.fighters.forEach((f, i) => {
      const M = this.models[i];
      if (M.extra && f.def.type === 'weapon') M.extra.visible = !sim.projectiles.some((p) => p.owner === f && p.kind === 'boomerang');
    });
  }

  makeProjMesh(p) {
    const owner = this.models[p.owner.slot];
    const tpl = owner && owner.projTemplate;
    const g = new THREE.Group();
    if (tpl && (p.kind !== 'mine')) {
      const c = tpl.clone();
      const size = tpl.userData.size || 1;
      const want = p.kind === 'boomerang' ? 1.2 * (owner.rig.extra ? owner.rig.extra.len * owner.rig.scale : 1) : p.r * 2.6;
      c.scale.setScalar(want / Math.max(0.1, size));
      g.add(c);
      if (p.kind === 'charge') {
        const glow = new THREE.Mesh(new THREE.SphereGeometry(p.r, 14, 10), new THREE.MeshBasicMaterial({ color: '#7fd3ff', transparent: true, opacity: 0.45 }));
        g.add(glow);
      }
    } else {
      const color = p.kind === 'mine' ? '#e74c3c' : p.kind === 'charge' ? '#7fd3ff' : owner ? owner.color : '#ffcc00';
      const m = new THREE.Mesh(new THREE.SphereGeometry(p.r, 14, 10), new THREE.MeshToonMaterial({ color, emissive: '#333' }));
      g.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(p.r * 1.02, 0)), new THREE.LineBasicMaterial({ color: '#222' }));
      g.add(e);
    }
    return g;
  }

  // ---------- エフェクト ----------
  sprite(tex, x, y, size, life, o = {}) {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: o.color || '#ffffff' });
    const s = new THREE.Sprite(mat);
    s.position.set(x, y, o.z ?? 0.8);
    s.scale.setScalar(size);
    this.scene.add(s);
    this.fx.push({ obj: s, life, max: life, grow: o.grow ?? 1.5, size, vx: o.vx || 0, vy: o.vy || 0, spin: o.spin || 0 });
    return s;
  }
  puff(x, y, size, life, color) { this.sprite(this.tex.puff, x, y, size, life, { grow: 1.8, color, vy: 0.3 }); }

  onEvent(e) {
    switch (e.t) {
      case 'hit': {
        const big = Math.min(1, (e.kb || 0) / 160);
        this.sprite(this.tex.star, e.x, e.y, 0.6 + big * 1.4, 0.18 + big * 0.2, { spin: 6 });
        if (!e.small) this.sprite(this.tex.ring, e.x, e.y, 0.4 + big, 0.25, { grow: 3, color: big > 0.6 ? '#ff5e5e' : '#ffffff' });
        this.shake = Math.max(this.shake, e.armor ? 0.1 : 0.05 + big * 0.4);
        break;
      }
      case 'shield': this.sprite(this.tex.ring, e.x, e.y, 1, 0.2, { grow: 2, color: '#9ad0ff' }); break;
      case 'perfect': this.sprite(this.tex.star, e.x, e.y, 1.4, 0.3, { grow: 2, color: '#b8f5ff' }); this.sprite(this.tex.ring, e.x, e.y, 1.2, 0.3, { grow: 3, color: '#ffffff' }); break;
      case 'shieldbreak': this.sprite(this.tex.star, e.x, e.y, 3, 0.5, { color: '#ffd166' }); this.shake = 0.5; break;
      case 'counter': this.sprite(this.tex.ring, e.x, e.y, 1.5, 0.35, { grow: 3, color: '#7fffd4' }); break;
      case 'reflect': this.sprite(this.tex.ring, e.x, e.y, 0.8, 0.25, { grow: 3, color: '#7fd3ff' }); break;
      case 'explode':
        this.sprite(this.tex.star, e.x, e.y, e.r * 3, 0.35, { color: '#ff9f43', grow: 2 });
        this.sprite(this.tex.puff, e.x, e.y, e.r * 2.5, 0.6, { color: '#888888', grow: 2 });
        this.shake = Math.max(this.shake, 0.3);
        break;
      case 'clank': case 'fizzle': this.sprite(this.tex.ring, e.x, e.y, 0.4, 0.15, { grow: 2 }); break;
      case 'jump': this.puff(e.x, e.y + 0.1, e.air ? 0.6 : 0.45, 0.35); break;
      case 'land': this.puff(e.x - 0.3, e.y + 0.1, 0.4, 0.3); this.puff(e.x + 0.3, e.y + 0.1, 0.4, 0.3); if (e.hard) this.shake = Math.max(this.shake, 0.1); break;
      case 'quake': for (let i = -2; i <= 2; i++) this.puff(e.x + i * 0.5, e.y + 0.15, 0.7, 0.45, '#d9b38c'); this.shake = 0.35; break;
      case 'tech': this.sprite(this.tex.ring, e.x, e.y + 0.5, 0.8, 0.2, { grow: 2.5, color: '#fff3a0' }); break;
      case 'ledge': this.sprite(this.tex.ring, e.x, e.y, 0.5, 0.15, { grow: 2 }); break;
      case 'grab': this.sprite(this.tex.ring, e.x, e.y, 0.5, 0.15, { grow: 2, color: '#d6a4ff' }); break;
      case 'ko': this.koBlast(e); break;
    }
  }

  /** 撃墜の爆発：画面外からステージへ向かう光の柱 */
  koBlast(e) {
    const B = STAGE.blast;
    const x = Math.max(B.left + 1, Math.min(B.right - 1, e.x));
    const y = Math.max(B.bottom + 1, Math.min(B.top - 1, e.y));
    const color = PLAYER_COLORS[e.slot];
    const dir = new THREE.Vector2(-x, 3 - y).normalize();
    const len = 16;
    const geo = new THREE.PlaneGeometry(len, 2.4);
    geo.translate(len / 2, 0, 0);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(geo, mat);
    beam.position.set(x, y, 1);
    beam.rotation.z = Math.atan2(dir.y, dir.x);
    this.scene.add(beam);
    this.fx.push({ obj: beam, life: 0.9, max: 0.9, grow: 0, beam: true });
    for (let i = 0; i < 6; i++) this.sprite(this.tex.star, x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2, 2.5, 0.6, { color, grow: 1.5 });
    this.shake = 1.0;
  }

  updateFx(dt) {
    for (const f of this.fx) {
      f.life -= dt;
      const t = 1 - f.life / f.max;
      if (f.beam) {
        f.obj.scale.y = 1 + t * 1.5;
        f.obj.material.opacity = 0.9 * (1 - t);
      } else {
        f.obj.scale.setScalar(f.size * (1 + t * (f.grow - 1)));
        f.obj.material.opacity = 1 - t;
        f.obj.material.rotation += (f.spin || 0) * dt;
        f.obj.position.x += f.vx * dt; f.obj.position.y += f.vy * dt;
      }
    }
    for (const f of this.fx) if (f.life <= 0) { this.scene.remove(f.obj); f.obj.material.dispose(); if (f.obj.geometry && f.beam) f.obj.geometry.dispose(); }
    this.fx = this.fx.filter((f) => f.life > 0);
  }

  updateCamera(dt) {
    const sim = this.sim;
    const pts = [];
    for (const f of sim.fighters) {
      if (f.state === 'dead' || f.stocks <= 0) continue;
      pts.push([Math.max(-19, Math.min(19, f.x)), Math.max(-9, Math.min(15, f.y + f.h / 2))]);
    }
    if (!pts.length) pts.push([0, 2]);
    let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
    for (const [x, y] of pts) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y); }
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    // 2人が近いときはぐっと寄る。キャラ1人ぶんの余白をとる
    const needW = Math.max(6.5, x2 - x1 + 5), needH = Math.max(4.6, y2 - y1 + 4.2);
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    // 注視点を中心より LOOK だけ下げる（HUD を避ける）ぶん、上側が切れないように距離をとる
    const LOOK = 0.07;
    let d = Math.max(needH / (2 * (tan - LOOK)), needW / (2 * tan * this.camera.aspect));
    d = Math.max(7.5, Math.min(48, d));
    // ズームインはゆっくり、ズームアウトは速く（ふっとんだ相手を見失わないように）
    const k = 1 - Math.pow(0.04, dt);
    const kz = 1 - Math.pow(d > this.camPos.z ? 0.02 : 0.12, dt);
    this.camPos.x += (cx - this.camPos.x) * k;
    this.camPos.y += (cy - this.camPos.y) * k;
    this.camPos.z += (d - this.camPos.z) * kz;
    // 少し上から見下ろす。注視点を下げるとキャラが画面の上寄りになり HUD とかぶらない
    const z = this.camPos.z;
    this.camLook.set(this.camPos.x, this.camPos.y - z * LOOK, 0);
    const s = this.shake;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.camera.position.set(this.camPos.x + (Math.random() - 0.5) * s, this.camPos.y + z * 0.04 + (Math.random() - 0.5) * s, this.camPos.z);
    this.camera.lookAt(this.camLook);
  }

  /** 画面上の位置（画面外インジケータ用） */
  project(x, y) {
    const v = new THREE.Vector3(x, y, 0).project(this.camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, inside: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  }

  dispose() {
    for (const m of this.models) { this.scene.remove(m.root); m.dispose(); }
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.renderer.dispose();
    // スマホは WebGL コンテキストの数に上限があるので確実に手放す
    if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
  }
}



/** ファイターの状態からモデルの関節を動かす（対戦画面とプレビューで共通） */
export function applyPose(M, f, time) {
    const P = poseFor(f, time);
    const A = M.anim;
    const lerp = (a, b, k) => a + (b - a) * k;
    const k = f.state === 'attack' ? 0.7 : 0.3;

    // 向き：くるっと回る
    A.facing = lerp(A.facing, f.facing, 0.35);
    const sx = Math.abs(A.facing) < 0.05 ? 0.05 * Math.sign(A.facing || 1) : A.facing;
    M.spinner.scale.x = sx;
    M.root.rotation.y = 0.42 * Math.sign(sx) + (P.spinY || 0);
    const shake = P.shake ? (Math.random() - 0.5) * P.shake : 0;
    const hl = f.hitlag > 0 && f.state === 'hitstun' ? (Math.random() - 0.5) * 0.12 : 0;
    M.root.position.set(f.x + shake + hl, f.y + P.offY, 0);
    M.spinner.rotation.z = (P.spin || 0) * Math.sign(sx);
    const sq = P.squash || 1;
    M.content.scale.set(1 / Math.sqrt(sq), sq, 1);
    A.lean = lerp(A.lean, P.lean || 0, k);
    M.body.rotation.z = -A.lean;

    // 手足
    const limbs = [['armF', M.armR, P.armSwing], ['armB', M.armL, -P.armSwing], ['legF', M.legR, P.swing], ['legB', M.legL, -P.swing]];
    for (const [key, g, sway] of limbs) {
      const rest = g.userData.rest;
      let target = sway || 0;
      if (rest !== null && rest !== undefined && P[key] !== null) {
        const w = P[key + 'W'] === undefined ? 1 : P[key + 'W'];
        target = wrapAngle(P[key] - rest) * w + (sway || 0) * (1 - w);
      }
      const cur = A[key];
      A[key] = cur + wrapAngle(target - cur) * k;
      g.rotation.z = A[key];
    }
    // 色（無敵の点滅・アーマー・ため）
    const flash = P.flash || 0;
    const alpha = P.alpha === undefined ? 1 : P.alpha;
    for (const m of M.mats) {
      m.emissive.setRGB(flash + (P.armorGlow ? 0.35 : 0), flash + (P.counterGlow ? 0.3 : 0), flash);
      m.transparent = alpha < 1; m.opacity = alpha;
    }
}

export { PLAYER_COLORS };
