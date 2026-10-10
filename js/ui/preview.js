// キャラの 3D プレビュー（ワザを順番に見せる）
import * as THREE from 'three';
import { buildCharacter } from '../doodle/builder3d.js';
import { applyPose } from '../game/render.js';
import { Fighter, EMPTY_INPUT } from '../game/fighter.js';

const DEMO = ['jab', 'ftilt', 'utilt', 'fsmash', 'usmash', 'nspec', 'sspec', 'dsmash', 'dspec'];

export class Preview {
  constructor(canvas, char, def, { demo = true } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#c8b89a', 1.7));
    const sun = new THREE.DirectionalLight('#ffffff', 1.3);
    sun.position.set(3, 6, 6);
    this.scene.add(sun);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.12, 36), new THREE.MeshToonMaterial({ color: '#fff3c4' }));
    disc.position.y = -0.06;
    this.scene.add(disc);
    const ring = new THREE.LineSegments(new THREE.EdgesGeometry(disc.geometry, 30), new THREE.LineBasicMaterial({ color: '#333' }));
    ring.position.copy(disc.position);
    this.scene.add(ring);

    this.def = def;
    this.model = buildCharacter(char.doodle, def);
    this.model.anim = { armF: 0, armB: 0, legF: 0, legB: 0, lean: 0, facing: 1 };
    this.scene.add(this.model.root);
    // ワザの見本を見せるための、ひとりだけのミニ世界
    const fakeSim = { frame: 0, emit() {}, projectiles: [], spawnProjectile() {}, doThrow() {} };
    this.fsim = fakeSim;
    this.f = new Fighter(def, 0, fakeSim, 1);
    fakeSim.fighters = [this.f];
    this.f.x = 0; this.f.ground = { x1: -50, x2: 50, y: 0, soft: false };
    this.demo = demo;
    this.demoIdx = 0;
    this.wait = 50;
    this.t = 0;
    this.angle = 0;
    this.drag = null;
    canvas.addEventListener('pointerdown', (e) => { this.drag = e.clientX; });
    window.addEventListener('pointerup', this.up = () => { this.drag = null; });
    canvas.addEventListener('pointermove', (e) => { if (this.drag !== null) { this.angle += (e.clientX - this.drag) * 0.01; this.drag = e.clientX; } });
    this.running = true;
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const f = this.f;
    // 60fps で進める
    this.acc = (this.acc || 0) + dt;
    while (this.acc > 1 / 60) {
      this.acc -= 1 / 60;
      this.fsim.frame++;
      f.setInput(EMPTY_INPUT);
      if (this.demo && f.state === 'idle') {
        if (--this.wait <= 0) {
          const key = DEMO[this.demoIdx++ % DEMO.length];
          if (this.def.moves[key]) f.startMove(key);
          this.wait = 35;
        }
      }
      f.update();
      // 移動ワザで画面外に行かないように
      f.x *= 0.9; f.y = Math.max(0, f.y * 0.9);
      if (!f.grounded && f.y < 0.02) { f.grounded = true; f.ground = { x1: -50, x2: 50, y: 0, soft: false }; if (f.state === 'helpless' || f.state === 'air') f.setState('idle'); }
    }
    applyPose(this.model, f, this.t);
    this.model.root.position.x = 0;
    this.model.root.rotation.y += this.angle + Math.sin(this.t * 0.6) * 0.5;
    this.resize();
    const h = this.model.H;
    this.camera.position.set(0, h * 0.7, h * 2.9);
    this.camera.lookAt(0, h * 0.48, 0);
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w !== this.w || h !== this.h) {
      this.w = w; this.h = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    }
  }

  dispose() {
    this.running = false;
    window.removeEventListener('pointerup', this.up);
    this.model.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss && this.renderer.forceContextLoss();
  }
}
