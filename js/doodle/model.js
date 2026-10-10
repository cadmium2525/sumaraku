// ラクガキのデータ構造と、3D 化のための骨格（リグ）計算。
// 座標は 600 x 900 の仮想キャンバス（y は下向き）。ストロークは {c: 色, w: 太さ, f: 塗り, p: [x0,y0,x1,y1,...]}。
export const VW = 600;
export const VH = 900;

export const PARTS = [
  { key: 'head', label: '頭', hint: '頭をかこう（顔もかいてOK）' },
  { key: 'body', label: '体', hint: '体をかこう' },
  { key: 'arms', label: '腕', hint: '腕を2本かこう（左右に1本ずつ）' },
  { key: 'legs', label: '足', hint: '足を2本かこう（左右に1本ずつ）' },
  { key: 'extra', label: 'その他', hint: '武器・帽子・しっぽなど自由に（なくてもOK）' },
];

// 全身のガイド（下書きシルエット）
export const GUIDE = {
  head: { type: 'circle', cx: 300, cy: 175, r: 105 },
  body: { type: 'rect', x1: 205, y1: 290, x2: 395, y2: 560 },
  arms: { type: 'lines', lines: [[205, 320, 85, 500], [395, 320, 515, 500]], w: 46 },
  legs: { type: 'lines', lines: [[250, 560, 225, 820], [350, 560, 375, 820]], w: 50 },
  extra: { type: 'none' },
};

export function emptyDoodle() {
  return { head: [], body: [], arms: [], legs: [], extra: [] };
}

export function strokeCount(d) {
  return PARTS.reduce((n, p) => n + (d[p.key] ? d[p.key].length : 0), 0);
}

function pts(stroke) {
  const out = [];
  for (let i = 0; i < stroke.p.length; i += 2) out.push([stroke.p[i], stroke.p[i + 1]]);
  return out;
}

export function bboxOf(strokes) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const s of strokes) {
    const r = (s.w || 0) / 2;
    for (let i = 0; i < s.p.length; i += 2) {
      const x = s.p[i], y = s.p[i + 1];
      if (x - r < x1) x1 = x - r; if (x + r > x2) x2 = x + r;
      if (y - r < y1) y1 = y - r; if (y + r > y2) y2 = y + r;
    }
  }
  if (x1 === Infinity) return null;
  return { x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, w: x2 - x1, h: y2 - y1 };
}

function centroid(stroke) {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < stroke.p.length; i += 2) { sx += stroke.p[i]; sy += stroke.p[i + 1]; n++; }
  return [sx / n, sy / n];
}

function distToRect(x, y, b) {
  const dx = Math.max(b.x1 - x, 0, x - b.x2);
  const dy = Math.max(b.y1 - y, 0, y - b.y2);
  return Math.hypot(dx, dy);
}

/** バケツで塗った領域 {t:'fill', c, p:[輪郭の多角形]} */
export function isFill(s) { return s.t === 'fill'; }

/** 閉じた形か（始点と終点が近い）→ 旧データの自動ぬりつぶし用 */
export function isClosed(stroke) {
  const n = stroke.p.length / 2;
  if (n < 6) return false;
  const x0 = stroke.p[0], y0 = stroke.p[1];
  const xn = stroke.p[stroke.p.length - 2], yn = stroke.p[stroke.p.length - 1];
  let len = 0;
  for (let i = 2; i < stroke.p.length; i += 2) len += Math.hypot(stroke.p[i] - stroke.p[i - 2], stroke.p[i + 1] - stroke.p[i - 1]);
  const gap = Math.hypot(xn - x0, yn - y0);
  return len > 60 && gap < Math.max(28, len * 0.12);
}

/** 点が多角形の内側か */
export function insidePoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 左右の腕・足を、体の中心より左か右かで分ける */
function splitLR(strokes, centerX) {
  const L = [], R = [];
  for (const s of strokes) (centroid(s)[0] < centerX ? L : R).push(s);
  return { L, R };
}

/** 付け根（体に一番近い点）と先端（付け根から一番遠い点） */
function limbEnds(strokes, bodyBox, fallback) {
  if (!strokes.length) return null;
  let root = null, best = Infinity;
  for (const s of strokes) for (const [x, y] of pts(s)) {
    const d = bodyBox ? distToRect(x, y, bodyBox) : Math.hypot(x - fallback[0], y - fallback[1]);
    if (d < best) { best = d; root = [x, y]; }
  }
  let tip = root, far = -1;
  for (const s of strokes) for (const [x, y] of pts(s)) {
    const d = Math.hypot(x - root[0], y - root[1]);
    if (d > far) { far = d; tip = [x, y]; }
  }
  // 画面座標（y 下向き）→ 角度（y 上向き）
  const rest = Math.atan2(-(tip[1] - root[1]), tip[0] - root[0]);
  return { root, tip, rest, len: far };
}

/**
 * ラクガキから骨格を計算する。
 * 返り値の座標は仮想キャンバス座標のまま。scale を掛けるとワールド単位になる。
 */
export function computeRig(d, heightWorld) {
  const all = PARTS.flatMap((p) => d[p.key] || []);
  const allBox = bboxOf(all) || { x1: 200, y1: 100, x2: 400, y2: 800, cx: 300, cy: 450, w: 200, h: 700 };
  const bodyBox = bboxOf(d.body) || bboxOf([...d.head, ...d.arms, ...d.legs]) || allBox;
  const headBox = bboxOf(d.head);
  const legBox = bboxOf(d.legs);
  // 足元 = 足（なければ体）の一番下、頭のてっぺん = 体・頭・腕・足の一番上（その他は含めない）
  const coreBox = bboxOf([...d.head, ...d.body, ...d.arms, ...d.legs]) || allBox;
  const feetY = legBox ? legBox.y2 : bodyBox.y2;
  const topY = coreBox.y1;
  const scale = heightWorld / Math.max(80, feetY - topY);
  const cx = bodyBox.cx;

  const arms = splitLR(d.arms, cx);
  const legs = splitLR(d.legs, cx);
  const armL = limbEnds(arms.L, bodyBox);
  const armR = limbEnds(arms.R, bodyBox);
  const legL = limbEnds(legs.L, bodyBox);
  const legR = limbEnds(legs.R, bodyBox);

  const hip = [cx, bodyBox.y2];
  const neck = headBox ? [headBox.cx, headBox.y2] : [cx, bodyBox.y1];

  // その他（武器など）の取り付け先
  let extra = null;
  if (d.extra.length) {
    const eb = bboxOf(d.extra);
    const hand = armR ? armR.tip : armL ? armL.tip : [bodyBox.x2, bodyBox.cy];
    let grip = null, best = Infinity;
    for (const s of d.extra) for (const [x, y] of pts(s)) {
      const dd = Math.hypot(x - hand[0], y - hand[1]);
      if (dd < best) { best = dd; grip = [x, y]; }
    }
    let far = 0;
    for (const s of d.extra) for (const [x, y] of pts(s)) far = Math.max(far, Math.hypot(x - grip[0], y - grip[1]));
    // 武器でないときは近いパーツにくっつける
    const cands = [
      ['head', headBox], ['body', bboxOf(d.body)], ['armL', bboxOf(arms.L)], ['armR', bboxOf(arms.R)], ['legL', bboxOf(legs.L)], ['legR', bboxOf(legs.R)],
    ].filter(([, b]) => b);
    let attach = 'body', bd = Infinity;
    for (const [k, b] of cands) {
      const dd = distToRect(eb.cx, eb.cy, b);
      if (dd < bd) { bd = dd; attach = k; }
    }
    extra = { box: eb, grip, hand, len: far, attach, holdArm: armR ? 'armR' : armL ? 'armL' : null };
  }

  return {
    scale, cx, feetY, topY, hip, neck, bodyBox, headBox, allBox,
    arms, legs, armL, armR, legL, legR, extra,
    widthRatio: bodyBox.w / Math.max(80, feetY - topY),
    // 武器の長さ（身長比）→ archetypes の reach（1 で身長の約半分）
    reach: extra ? (extra.len / Math.max(80, feetY - topY)) / 0.5 : 1,
  };
}

/** ストロークの点を間引く（保存サイズと 3D の負荷を減らす） */
export function simplifyStroke(p, minDist = 4) {
  if (p.length <= 4) return p.slice();
  const out = [p[0], p[1]];
  let lx = p[0], ly = p[1];
  for (let i = 2; i < p.length - 2; i += 2) {
    if (Math.hypot(p[i] - lx, p[i + 1] - ly) >= minDist) { out.push(p[i], p[i + 1]); lx = p[i]; ly = p[i + 1]; }
  }
  out.push(p[p.length - 2], p[p.length - 1]);
  return out;
}

/** 2D のサムネイル（一覧・HUD 用） */
export function drawThumb(canvas, d, { pad = 8, bg = null } = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
  const all = PARTS.flatMap((p) => d[p.key] || []);
  const b = bboxOf(all);
  if (!b) return;
  const s = Math.min((W - pad * 2) / b.w, (H - pad * 2) / b.h);
  ctx.save();
  ctx.translate(W / 2 - b.cx * s, H / 2 - b.cy * s);
  ctx.scale(s, s);
  renderStrokes(ctx, all);
  ctx.restore();
}

export function renderStrokes(ctx, strokes, { alpha = 1 } = {}) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha;
  for (const s of strokes) {
    if (isFill(s)) {
      ctx.fillStyle = s.c;
      ctx.beginPath();
      for (const poly of [s.p, ...(s.h || [])]) {
        for (let i = 0; i < poly.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, poly[i], poly[i + 1]);
        ctx.closePath();
      }
      ctx.fill('evenodd');
    } else if (s.f && isClosed(s)) {
      ctx.fillStyle = fillColor(s.c);
      ctx.beginPath();
      for (let i = 0; i < s.p.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, s.p[i], s.p[i + 1]);
      ctx.closePath();
      ctx.fill();
    }
  }
  for (const s of strokes) {
    if (isFill(s)) continue;
    ctx.strokeStyle = s.c;
    ctx.lineWidth = s.w;
    ctx.beginPath();
    if (s.p.length === 2) { ctx.moveTo(s.p[0], s.p[1]); ctx.lineTo(s.p[0] + 0.1, s.p[1]); }
    for (let i = 0; i < s.p.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, s.p[i], s.p[i + 1]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** 塗りの色：ペン色を白に寄せる */
export function fillColor(hex, t = 0.62) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (r + g + b < 150) return '#fbf8f0'; // 黒っぽいペンは白で塗る
  r = Math.round(r + (255 - r) * t); g = Math.round(g + (255 - g) * t); b = Math.round(b + (255 - b) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// ---------------- バケツ（塗りつぶし） ----------------
const FS = 0.5; // 塗り判定用のラスタの縮尺（仮想キャンバスの半分）

/**
 * (x, y) を囲む線の内側の領域を求めて、輪郭の多角形（仮想キャンバス座標）を返す。
 * 線は全パーツのものを壁にする（見えている絵のとおりに塗れる）。
 * すきまがあって外までつながっているときは null。
 */
export function fillRegion(doodle, x, y) {
  const W = Math.round(VW * FS), H = Math.round(VH * FS);
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.scale(FS, FS);
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = '#000';
  for (const p of PARTS) for (const s of doodle[p.key] || []) {
    if (isFill(s)) continue;
    g.lineWidth = s.w + 6; // 小さなすきまはふさぐ
    g.beginPath();
    if (s.p.length === 2) { g.moveTo(s.p[0], s.p[1]); g.lineTo(s.p[0] + 0.1, s.p[1]); }
    for (let i = 0; i < s.p.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, s.p[i], s.p[i + 1]);
    g.stroke();
  }
  const data = g.getImageData(0, 0, W, H).data;
  const wall = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) wall[i] = data[i * 4 + 3] > 40 ? 1 : 0;
  const sx = Math.floor(x * FS), sy = Math.floor(y * FS);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H || wall[sy * W + sx]) return { error: 'line' };
  // 塗りつぶし
  const reg = new Uint8Array(W * H);
  const stack = [sy * W + sx];
  reg[sy * W + sx] = 1;
  let n = 0;
  while (stack.length) {
    const i = stack.pop();
    n++;
    const px = i % W, py = (i / W) | 0;
    if (px === 0 || py === 0 || px === W - 1 || py === H - 1) return { error: 'open' };
    for (const j of [i - 1, i + 1, i - W, i + W]) if (!reg[j] && !wall[j]) { reg[j] = 1; stack.push(j); }
  }
  if (n < 12) return { error: 'small' };
  // 線の下までのばす（3D で線と塗りのあいだにすきまができないように）
  const grow = 3;
  let cur = reg;
  for (let k = 0; k < grow; k++) {
    const nx = cur.slice();
    for (let py = 1; py < H - 1; py++) for (let px = 1; px < W - 1; px++) {
      const i = py * W + px;
      if (!cur[i] && (cur[i - 1] || cur[i + 1] || cur[i - W] || cur[i + W])) nx[i] = 1;
    }
    cur = nx;
  }
  const poly = traceOutline(cur, W, H);
  if (!poly || poly.length < 6) return { error: 'small' };
  const toV = (pp) => { const o = []; for (let i = 0; i < pp.length; i += 2) o.push(Math.round(pp[i] / FS), Math.round(pp[i + 1] / FS)); return rdp(o, 2.5); };
  return { poly: toV(poly), holes: findHoles(cur, wall, W, H).map(toV).filter((h) => h.length >= 6) };
}

/**
 * 塗った領域の中にある「別の囲まれた部分」（ドーナツの穴、大きな目の中など）を探す。
 * 線だけでできたすきま（顔のパーツの線など）は穴にしない。
 */
function findHoles(reg, wall, W, H) {
  const lab = new Int32Array(W * H); // 0: 未調査, -1: 外, 1..: 穴
  const flood = (start, id) => {
    const st = [start]; lab[start] = id; const cells = [start];
    while (st.length) {
      const i = st.pop();
      const px = i % W, py = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!reg[j] && !lab[j]) { lab[j] = id; st.push(j); cells.push(j); }
      }
    }
    return cells;
  };
  for (let x = 0; x < W; x++) { if (!reg[x] && !lab[x]) flood(x, -1); const b = (H - 1) * W + x; if (!reg[b] && !lab[b]) flood(b, -1); }
  for (let y = 0; y < H; y++) { const a = y * W, b = y * W + W - 1; if (!reg[a] && !lab[a]) flood(a, -1); if (!reg[b] && !lab[b]) flood(b, -1); }
  const holes = [];
  let id = 1;
  for (let i = 0; i < W * H; i++) {
    if (reg[i] || lab[i]) continue;
    const cells = flood(i, ++id);
    let open = 0;
    for (const c of cells) if (!wall[c]) open++;
    if (open < 15) continue;
    const m = new Uint8Array(W * H);
    for (const c of cells) m[c] = 1;
    const h = traceOutline(m, W, H);
    if (h && h.length >= 6) holes.push(h);
  }
  return holes;
}

/** マスクの外周をたどる（ムーア近傍） */
export function traceOutline(m, W, H) {
  let start = -1;
  for (let i = 0; i < W * H; i++) if (m[i]) { start = i; break; }
  if (start < 0) return null;
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x];
  let x = start % W, y = (start / W) | 0;
  const sx = x, sy = y;
  const out = [x + 0.5, y + 0.5];
  let d = 6; // 上から来たことにする
  for (let step = 0; step < W * H * 2; step++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const nd = (d + 6 + k) % 8; // 左回りに探す
      const nx = x + dirs[nd][0], ny = y + dirs[nd][1];
      if (at(nx, ny)) { x = nx; y = ny; d = nd; found = true; break; }
    }
    if (!found) break;
    if (x === sx && y === sy) break;
    out.push(x + 0.5, y + 0.5);
  }
  return out;
}

/** 折れ線の間引き（ラマー・ダグラス・ポーカー）。閉じた多角形として扱う */
function rdp(p, eps) {
  const n = p.length / 2;
  if (n < 4) return p;
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = p[a * 2], ay = p[a * 2 + 1], bx = p[b * 2], by = p[b * 2 + 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let best = -1, bd = 0;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - p[i * 2 + 1]) - (ax - p[i * 2]) * (by - ay)) / len;
      if (d > bd) { bd = d; best = i; }
    }
    if (bd > eps) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  // 始点と終点が同じ点なので、真ん中も必ず残す
  keep[(n / 2) | 0] = 1;
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}

/** 点から多角形の辺までの最短距離 */
export function distToPoly(x, y, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const ax = poly[j], ay = poly[j + 1], bx = poly[i], by = poly[i + 1];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return best;
}

// ---------------- 消しゴム ----------------
/**
 * 線の、(x, y) から半径 r の中にある部分を消す（線は途中で分かれる）。
 * 消えたら true。
 */
export function eraseAt(list, x, y, r) {
  let changed = false;
  for (let k = list.length - 1; k >= 0; k--) {
    const s = list[k];
    if (isFill(s)) continue;
    const rr = r + s.w / 2;
    // 点のあいだが離れていると消し残すので、細かく補間してから判定する
    const pts = [];
    for (let i = 0; i < s.p.length; i += 2) {
      if (i > 0) {
        const ax = s.p[i - 2], ay = s.p[i - 1], bx = s.p[i], by = s.p[i + 1];
        const steps = Math.floor(Math.hypot(bx - ax, by - ay) / 3);
        for (let t = 1; t < steps; t++) pts.push(Math.round(ax + ((bx - ax) * t) / steps), Math.round(ay + ((by - ay) * t) / steps));
      }
      pts.push(s.p[i], s.p[i + 1]);
    }
    let hit = false;
    for (let i = 0; i < pts.length; i += 2) if (Math.hypot(pts[i] - x, pts[i + 1] - y) <= rr) { hit = true; break; }
    if (!hit) continue;
    changed = true;
    const pieces = [];
    let cur = [];
    for (let i = 0; i < pts.length; i += 2) {
      if (Math.hypot(pts[i] - x, pts[i + 1] - y) <= rr) { if (cur.length) pieces.push(cur); cur = []; }
      else cur.push(pts[i], pts[i + 1]);
    }
    if (cur.length) pieces.push(cur);
    list.splice(k, 1, ...pieces.map((p) => ({ c: s.c, w: s.w, f: false, p: simplifyStroke(p, 3) })));
  }
  return changed;
}
