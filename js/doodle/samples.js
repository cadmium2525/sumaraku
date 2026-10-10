// 最初から遊べるように用意したサンプルのラクガキ（プログラムで描いたもの）
const K = '#222222';

function circle(cx, cy, rx, ry = rx, o = {}) {
  const p = [];
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    p.push(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry));
  }
  return { c: o.c || K, w: o.w || 9, f: o.f !== false, p };
}
function poly(points, o = {}) {
  const p = [];
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    if (!o.closed && i === points.length - 1) { p.push(x1, y1); break; }
    for (let t = 0; t < 1; t += 0.2) p.push(Math.round(x1 + (x2 - x1) * t), Math.round(y1 + (y2 - y1) * t));
  }
  if (o.closed) p.push(points[0][0], points[0][1]);
  return { c: o.c || K, w: o.w || 9, f: !!o.closed && o.f !== false, p };
}
const line = (pts, o = {}) => poly(pts, { ...o, closed: false });
const dot = (x, y, o = {}) => ({ c: o.c || K, w: o.w || 14, f: false, p: [x, y, x + 1, y] });

function smile(cx, cy, w = 40, o = {}) {
  const p = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; p.push(Math.round(cx - w / 2 + w * t), Math.round(cy + Math.sin(t * Math.PI) * w * 0.35)); }
  return { c: o.c || K, w: o.w || 7, f: false, p };
}

export const SAMPLES = [
  {
    id: 'sample-maru', name: 'まるまるくん', type: 'light', seed: 1201, ownerName: 'サンプル',
    doodle: {
      head: [circle(300, 180, 100, 95, { c: '#e67e22' }), dot(265, 165), dot(335, 165), smile(300, 205)],
      body: [circle(300, 420, 95, 125, { c: '#e67e22' })],
      arms: [line([[210, 380], [150, 440], [100, 500]], { c: '#e67e22', w: 14 }), line([[390, 380], [450, 440], [500, 500]], { c: '#e67e22', w: 14 })],
      legs: [line([[260, 540], [250, 680], [230, 800]], { c: '#e67e22', w: 16 }), line([[340, 540], [350, 680], [370, 800]], { c: '#e67e22', w: 16 })],
      extra: [],
    },
  },
  {
    id: 'sample-robo', name: 'ロボ太', type: 'heavy', seed: 3407, ownerName: 'サンプル',
    doodle: {
      head: [poly([[220, 90], [380, 90], [380, 250], [220, 250]], { closed: true, c: '#7f8c8d', w: 10 }), poly([[250, 140], [350, 140], [350, 180], [250, 180]], { closed: true, c: '#e74c3c', w: 6 }), line([[300, 90], [300, 40]], { w: 8 }), dot(300, 35, { c: '#e74c3c', w: 22 })],
      body: [poly([[180, 270], [420, 270], [400, 570], [200, 570]], { closed: true, c: '#7f8c8d', w: 12 }), circle(300, 400, 40, 40, { c: '#f1c40f', w: 7 })],
      arms: [line([[180, 300], [110, 400], [95, 520]], { c: '#555555', w: 26 }), line([[420, 300], [490, 400], [505, 520]], { c: '#555555', w: 26 })],
      legs: [line([[240, 570], [235, 820]], { c: '#555555', w: 34 }), line([[360, 570], [365, 820]], { c: '#555555', w: 34 })],
      extra: [],
    },
  },
  {
    id: 'sample-neko', name: 'ネコけんし', type: 'weapon', seed: 9001, ownerName: 'サンプル',
    doodle: {
      head: [circle(300, 190, 90, 80, { c: '#8e44ad' }), line([[225, 140], [235, 70], [270, 115]], { c: '#8e44ad', w: 9 }), line([[330, 115], [365, 70], [375, 140]], { c: '#8e44ad', w: 9 }), dot(270, 180), dot(330, 180), line([[285, 215], [300, 225], [315, 215]], { w: 6 })],
      body: [circle(300, 400, 70, 115, { c: '#8e44ad' })],
      arms: [line([[235, 340], [170, 420], [130, 480]], { c: '#8e44ad', w: 13 }), line([[365, 340], [430, 420], [470, 470]], { c: '#8e44ad', w: 13 })],
      legs: [line([[270, 510], [255, 660], [240, 800]], { c: '#8e44ad', w: 15 }), line([[330, 510], [345, 660], [360, 800]], { c: '#8e44ad', w: 15 })],
      extra: [line([[470, 470], [520, 330], [555, 190]], { c: '#95a5a6', w: 14 }), line([[440, 455], [500, 485]], { c: '#c0392b', w: 12 })],
    },
  },
  {
    id: 'sample-hoshi', name: 'ほしのすけ', type: 'shooter', seed: 5555, ownerName: 'サンプル',
    doodle: {
      head: [poly([[300, 70], [330, 150], [410, 150], [345, 200], [370, 280], [300, 230], [230, 280], [255, 200], [190, 150], [270, 150]], { closed: true, c: '#f1c40f', w: 9 }), dot(280, 180), dot(320, 180)],
      body: [poly([[240, 300], [360, 300], [380, 540], [220, 540]], { closed: true, c: '#2e86de', w: 10 })],
      arms: [line([[240, 320], [160, 400], [110, 420]], { c: '#2e86de', w: 13 }), line([[360, 320], [440, 380], [500, 380]], { c: '#2e86de', w: 13 })],
      legs: [line([[260, 540], [245, 800]], { c: '#2e86de', w: 16 }), line([[340, 540], [355, 800]], { c: '#2e86de', w: 16 })],
      extra: [poly([[490, 350], [570, 350], [570, 395], [490, 395]], { closed: true, c: '#34495e', w: 8 })],
    },
  },
  {
    id: 'sample-toge', name: 'トゲトゲ', type: 'light', seed: 777, ownerName: 'サンプル',
    doodle: {
      head: [poly([[300, 60], [340, 120], [400, 100], [380, 170], [430, 220], [360, 250], [300, 290], [240, 250], [170, 220], [220, 170], [200, 100], [260, 120]], { closed: true, c: '#27ae60', w: 9 }), dot(275, 185), dot(325, 185), line([[280, 225], [320, 225]], { w: 6 })],
      body: [circle(300, 420, 80, 110, { c: '#27ae60' })],
      arms: [line([[225, 380], [170, 330], [120, 300]], { c: '#27ae60', w: 12 }), line([[375, 380], [430, 330], [480, 300]], { c: '#27ae60', w: 12 })],
      legs: [line([[265, 520], [240, 650], [220, 800]], { c: '#27ae60', w: 13 }), line([[335, 520], [360, 650], [380, 800]], { c: '#27ae60', w: 13 })],
      extra: [line([[380, 460], [450, 500], [500, 470], [530, 520]], { c: '#27ae60', w: 11 })],
    },
  },
  {
    id: 'sample-obake', name: 'おばけドン', type: 'heavy', seed: 4242, ownerName: 'サンプル',
    doodle: {
      head: [circle(300, 200, 120, 110, { c: '#34495e' }), circle(255, 190, 22, 28, { c: '#222222', w: 6 }), circle(345, 190, 22, 28, { c: '#222222', w: 6 }), smile(300, 250, 70, { w: 8 })],
      body: [poly([[190, 320], [410, 320], [430, 580], [380, 550], [340, 590], [300, 555], [260, 590], [220, 550], [170, 580]], { closed: true, c: '#34495e', w: 10 })],
      arms: [line([[190, 350], [110, 420], [80, 500]], { c: '#34495e', w: 20 }), line([[410, 350], [490, 420], [520, 500]], { c: '#34495e', w: 20 })],
      legs: [line([[250, 580], [245, 810]], { c: '#34495e', w: 24 }), line([[350, 580], [355, 810]], { c: '#34495e', w: 24 })],
      extra: [],
    },
  },
];
