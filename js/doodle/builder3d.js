// ラクガキ → 3D キャラ。
// 線はチューブ（3D ペンで描いたような立体の線）、閉じた形はふっくら押し出した立体になる。
// 体のパーツは関節（首・肩・股）ごとにグループ化して、アニメーションで動かせるようにする。
import * as THREE from 'three';
import { mergeGeometries } from '../../lib/BufferGeometryUtils.js';
import { computeRig, isClosed, insidePoly, fillColor, simplifyStroke, PARTS } from './model.js';

let gradientMap = null;

// マテリアルはキャラごとに持つ（被弾フラッシュや透明化を個別にかけるため）
function toonMat(color, matCache) {
  if (!gradientMap) {
    const data = new Uint8Array([90, 170, 255]);
    gradientMap = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
    gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.needsUpdate = true;
  }
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap });
    matCache.set(color, m);
  }
  return m;
}

const FILL_DEPTH = { head: 0.16, body: 0.22, arms: 0.1, legs: 0.11, extra: 0.08 };

/**
 * ストローク群を、origin（仮想キャンバス座標）を原点にしたメッシュにする
 */
function buildStrokes(strokes, origin, s, part, mats) {
  const byColor = new Map();
  const add = (color, geo) => {
    if (!byColor.has(color)) byColor.set(color, []);
    byColor.get(color).push(geo.index ? geo.toNonIndexed() : geo);
  };
  const W = (x, y) => [(x - origin[0]) * s, -(y - origin[1]) * s];
  const depth = FILL_DEPTH[part] || 0.1;
  const bevel = depth * 0.35;
  const fills = [];

  // 塗り（閉じた形）
  for (const st of strokes) {
    if (!st.f || !isClosed(st)) continue;
    const p = simplifyStroke(st.p, 6);
    if (p.length < 8) continue;
    const shape = new THREE.Shape();
    for (let i = 0; i < p.length; i += 2) {
      const [x, y] = W(p[i], p[i + 1]);
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    try {
      const g = new THREE.ExtrudeGeometry(shape, {
        depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: Math.min(0.025, depth * 0.2), bevelSegments: 2, curveSegments: 2,
      });
      g.translate(0, 0, -depth / 2);
      g.deleteAttribute('uv');
      add(fillColor(st.c), g);
      fills.push({ st, poly: p });
    } catch (e) {
      // 自己交差などで三角形分割に失敗したら塗りなし
    }
  }

  // 線（チューブ）
  for (const st of strokes) {
    const p = simplifyStroke(st.p, 5);
    const r = Math.max(0.014, st.w * s * 0.5);
    // 塗りの内側に描いた線（顔など）は表面に出す
    let z = 0;
    const n = p.length / 2;
    let cx = 0, cy = 0;
    for (let i = 0; i < p.length; i += 2) { cx += p[i]; cy += p[i + 1]; }
    cx /= n; cy /= n;
    for (const f of fills) {
      if (f.st !== st && insidePoly(cx, cy, f.poly)) { z = depth / 2 + bevel + r * 0.3; break; }
    }
    if (n < 2 || pathLen(p) < 3) {
      const [x, y] = W(p[0], p[1]);
      const g = new THREE.SphereGeometry(r * 1.1, 8, 6);
      g.translate(x, y, z);
      g.deleteAttribute('uv');
      add(st.c, g);
      continue;
    }
    const pts3 = [];
    for (let i = 0; i < p.length; i += 2) {
      const [x, y] = W(p[i], p[i + 1]);
      pts3.push(new THREE.Vector3(x, y, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts3, false, 'centripetal');
    const segs = Math.min(160, Math.max(8, Math.round(n * 2.2)));
    const g = new THREE.TubeGeometry(curve, segs, r, 7, false);
    g.deleteAttribute('uv');
    add(st.c, g);
    // 端を丸く
    for (const v of [pts3[0], pts3[pts3.length - 1]]) {
      const cap = new THREE.SphereGeometry(r, 8, 6);
      cap.translate(v.x, v.y, v.z);
      cap.deleteAttribute('uv');
      add(st.c, cap);
    }
  }

  const group = new THREE.Group();
  for (const [color, geos] of byColor) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, toonMat(color, mats));
    group.add(mesh);
  }
  return group;
}

function pathLen(p) {
  let l = 0;
  for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return l;
}

/** 一番多く使われている色（エフェクトやUIの色に使う） */
export function mainColor(doodle) {
  const cnt = new Map();
  for (const p of PARTS) for (const s of doodle[p.key] || []) cnt.set(s.c, (cnt.get(s.c) || 0) + s.p.length);
  let best = '#333333', n = -1;
  for (const [c, v] of cnt) if (v > n && c !== '#222222') { n = v; best = c; }
  return n < 0 ? '#333333' : best;
}

/**
 * キャラの 3D モデルを作る。
 * 階層: root(位置・向き) → spinner(回転の中心=体の中央) → content(足元原点・伸び縮み)
 *        content → hips → body → head / armL / armR,  content → legL / legR
 */
export function buildCharacter(doodle, def) {
  const H = def.stats.h;
  const rig = computeRig(doodle, H);
  const s = rig.scale;
  const feet = [rig.cx, rig.feetY];
  const W = (pt, o) => new THREE.Vector3((pt[0] - o[0]) * s, -(pt[1] - o[1]) * s, 0);

  const mats = new Map();
  const root = new THREE.Group();
  const spinner = new THREE.Group();
  spinner.position.y = H / 2;
  root.add(spinner);
  const content = new THREE.Group();
  content.position.y = -H / 2;
  spinner.add(content);

  const hips = new THREE.Group();
  hips.position.copy(W(rig.hip, feet));
  content.add(hips);
  const body = new THREE.Group();
  hips.add(body);
  body.add(buildStrokes(doodle.body, rig.hip, s, 'body', mats));

  const head = new THREE.Group();
  head.position.copy(W(rig.neck, rig.hip));
  head.add(buildStrokes(doodle.head, rig.neck, s, 'head', mats));
  body.add(head);

  const limb = (strokes, ends, parent, parentOrigin, part) => {
    const g = new THREE.Group();
    if (!ends) { parent.add(g); g.userData.rest = null; return g; }
    g.position.copy(W(ends.root, parentOrigin));
    g.add(buildStrokes(strokes, ends.root, s, part, mats));
    g.userData.rest = ends.rest;
    g.userData.root = ends.root;
    g.userData.tip = ends.tip;
    parent.add(g);
    return g;
  };
  const armL = limb(rig.arms.L, rig.armL, body, rig.hip, 'arms');
  const armR = limb(rig.arms.R, rig.armR, body, rig.hip, 'arms');
  const legL = limb(rig.legs.L, rig.legL, content, feet, 'legs');
  const legR = limb(rig.legs.R, rig.legR, content, feet, 'legs');

  // その他パーツ
  let extra = null;
  if (rig.extra) {
    const E = rig.extra;
    const holdWeapon = def.type === 'weapon' && E.holdArm;
    let parent, origin;
    if (holdWeapon) {
      parent = E.holdArm === 'armR' ? armR : armL;
      origin = parent.userData.root;
    } else {
      const map = { head: [head, rig.neck], body: [body, rig.hip], armL: [armL, armL.userData.root], armR: [armR, armR.userData.root], legL: [legL, legL.userData.root], legR: [legR, legR.userData.root] };
      [parent, origin] = map[E.attach] || map.body;
      if (!origin) [parent, origin] = map.body;
    }
    extra = new THREE.Group();
    if (holdWeapon) {
      // 手に持たせる：握りの点を手の位置に合わせる
      extra.position.copy(W(E.hand, origin));
      extra.add(buildStrokes(doodle.extra, E.grip, s, 'extra', mats));
    } else {
      extra.add(buildStrokes(doodle.extra, origin, s, 'extra', mats));
    }
    parent.add(extra);
  }

  // 飛び道具の見た目のもと（射撃型は描いた「その他」を撃つ）
  let projTemplate = null;
  if (doodle.extra.length) {
    const b = rig.extra.box;
    const g = buildStrokes(doodle.extra, [b.cx, b.cy], s, 'extra', new Map());
    const size = Math.max(b.w, b.h) * s;
    g.userData.size = size;
    projTemplate = g;
  }

  return {
    root, spinner, content, hips, body, head, armL, armR, legL, legR, extra,
    rig, H, color: mainColor(doodle), projTemplate, mats: [...mats.values()],
    dispose() {
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      if (projTemplate) projTemplate.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    },
  };
}
