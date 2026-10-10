// 保存先の切り替え：Firebase の設定があれば Firestore、なければ localStorage（この端末だけ）
import { firebaseConfig } from './firebase-config.js';
import { eloDelta, START_RATING } from './rating.js';
import { SAMPLES } from '../doodle/samples.js';

export const REPORT_HIDE = 3; // 通報がこの数に達したら非表示
export const MAX_CHARS = 5; // 1人が作れるキャラ数

const SAMPLE_CHARS = SAMPLES.map((s, i) => ({
  ...s, ownerId: 'sample', rating: START_RATING - 40 + i * 15, wins: 0, losses: 0, draws: 0, battles: 0, reports: 0, hidden: false, createdAt: 0, sample: true,
}));

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function scoreOf(result) { return result === 'win' ? 1 : result === 'draw' ? 0.5 : 0; }

// ---------------- localStorage ----------------
class LocalStore {
  constructor() {
    this.online = false;
    this.key = 'rkg_v1';
    let d = null;
    try { d = JSON.parse(localStorage.getItem(this.key)); } catch (e) { d = null; }
    if (!d) d = { user: { uid: 'local-' + uid(), name: '' }, chars: {}, reported: [] };
    for (const s of SAMPLE_CHARS) if (!d.chars[s.id]) d.chars[s.id] = { ...s };
    this.d = d;
    this.save();
  }
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.d)); } catch (e) { console.warn(e); } }
  get user() { return this.d.user; }
  async setName(name) { this.d.user.name = name; for (const c of Object.values(this.d.chars)) if (c.ownerId === this.user.uid) c.ownerName = name; this.save(); }
  async saveChar(c) {
    const id = c.id || 'c-' + uid();
    const full = { rating: START_RATING, wins: 0, losses: 0, draws: 0, battles: 0, reports: 0, hidden: false, createdAt: Date.now(), ...c, id, ownerId: this.user.uid, ownerName: this.user.name };
    this.d.chars[id] = full;
    this.save();
    return full;
  }
  async myChars() { return Object.values(this.d.chars).filter((c) => c.ownerId === this.user.uid).sort((a, b) => b.createdAt - a.createdAt); }
  async getChar(id) { return this.d.chars[id] || null; }
  async deleteChar(id) { const c = this.d.chars[id]; if (c && c.ownerId === this.user.uid) { delete this.d.chars[id]; this.save(); } }
  async ranking(limit = 50) {
    return Object.values(this.d.chars).filter((c) => !c.hidden).sort((a, b) => b.rating - a.rating).slice(0, limit);
  }
  async others(limit = 40) {
    return Object.values(this.d.chars).filter((c) => !c.hidden && c.ownerId !== this.user.uid).sort((a, b) => b.rating - a.rating).slice(0, limit);
  }
  async findOpponent(me) {
    const pool = Object.values(this.d.chars).filter((c) => !c.hidden && c.ownerId !== this.user.uid && c.id !== me.id);
    return pickNear(pool, me.rating);
  }
  async recordBattle(a, b, result) {
    const A = this.d.chars[a.id], B = this.d.chars[b.id];
    const ra = A ? A.rating : a.rating, rb = B ? B.rating : b.rating;
    const da = eloDelta(ra, rb, scoreOf(result));
    const db = -da;
    for (const [X, d, r] of [[A, da, result], [B, db, result === 'win' ? 'lose' : result === 'lose' ? 'win' : 'draw']]) {
      if (!X) continue;
      X.rating += d; X.battles++;
      if (r === 'win') X.wins++; else if (r === 'lose') X.losses++; else X.draws = (X.draws || 0) + 1;
    }
    this.save();
    return { da, db, ra: ra + da, rb: rb + db };
  }
  async report(id) {
    if (this.d.reported.includes(id)) return { ok: false, msg: 'もう通報ずみです' };
    const c = this.d.chars[id];
    if (!c) return { ok: false, msg: '見つかりません' };
    this.d.reported.push(id);
    c.reports = (c.reports || 0) + 1;
    if (c.reports >= REPORT_HIDE) c.hidden = true;
    this.save();
    return { ok: true, msg: '通報しました' };
  }
}

function pickNear(pool, rating) {
  if (!pool.length) return null;
  const sorted = pool.map((c) => ({ c, d: Math.abs(c.rating - rating) + Math.random() * 120 })).sort((x, y) => x.d - y.d);
  const top = sorted.slice(0, Math.min(5, sorted.length));
  return top[Math.floor(Math.random() * top.length)].c;
}

// ---------------- Firebase ----------------
const FB = 'https://www.gstatic.com/firebasejs/10.12.2';

class FirebaseStore {
  async init() {
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(`${FB}/firebase-app.js`), import(`${FB}/firebase-auth.js`), import(`${FB}/firebase-firestore.js`),
    ]);
    this.fs = fs;
    const app = initializeApp(firebaseConfig);
    this.auth = auth.getAuth(app);
    this.db = fs.getFirestore(app);
    const cred = await auth.signInAnonymously(this.auth);
    this.online = true;
    const uidv = cred.user.uid;
    let name = '';
    try { name = localStorage.getItem('rkg_name') || ''; } catch (e) { /* ignore */ }
    this._user = { uid: uidv, name };
    return this;
  }
  get user() { return this._user; }
  col() { return this.fs.collection(this.db, 'characters'); }
  ref(id) { return this.fs.doc(this.db, 'characters', id); }
  fromDoc(snap) {
    const d = snap.data();
    let doodle = null;
    try { doodle = JSON.parse(d.doodleJson); } catch (e) { doodle = null; }
    return { ...d, id: snap.id, doodle, doodleJson: undefined };
  }
  async setName(name) {
    this._user.name = name;
    try { localStorage.setItem('rkg_name', name); } catch (e) { /* ignore */ }
  }
  async saveChar(c) {
    const { fs } = this;
    const data = {
      name: c.name, type: c.type, seed: c.seed, doodleJson: JSON.stringify(c.doodle),
      ownerId: this.user.uid, ownerName: this.user.name || 'ななし',
      rating: START_RATING, wins: 0, losses: 0, draws: 0, battles: 0, reports: 0, hidden: false,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    const ref = await fs.addDoc(this.col(), data);
    return { ...data, id: ref.id, doodle: c.doodle };
  }
  async myChars() {
    const { fs } = this;
    const q = fs.query(this.col(), fs.where('ownerId', '==', this.user.uid));
    const s = await fs.getDocs(q);
    return s.docs.map((d) => this.fromDoc(d)).sort((a, b) => b.createdAt - a.createdAt);
  }
  async getChar(id) {
    if (id.startsWith('sample-')) return SAMPLE_CHARS.find((s) => s.id === id) || null;
    const s = await this.fs.getDoc(this.ref(id));
    return s.exists() ? this.fromDoc(s) : null;
  }
  async deleteChar(id) { await this.fs.deleteDoc(this.ref(id)); }
  async ranking(limit = 50) {
    const { fs } = this;
    const s = await fs.getDocs(fs.query(this.col(), fs.orderBy('rating', 'desc'), fs.limit(limit + 20)));
    const list = s.docs.map((d) => this.fromDoc(d)).filter((c) => !c.hidden && c.doodle);
    return list.slice(0, limit);
  }
  async others(limit = 40) {
    const list = (await this.ranking(limit + 10)).filter((c) => c.ownerId !== this.user.uid);
    if (list.length < 6) list.push(...SAMPLE_CHARS);
    return list.slice(0, limit);
  }
  async findOpponent(me) {
    const { fs } = this;
    const r = me.rating || START_RATING;
    const [lo, hi] = await Promise.all([
      fs.getDocs(fs.query(this.col(), fs.where('rating', '<=', r), fs.orderBy('rating', 'desc'), fs.limit(12))),
      fs.getDocs(fs.query(this.col(), fs.where('rating', '>', r), fs.orderBy('rating', 'asc'), fs.limit(12))),
    ]);
    const pool = [...lo.docs, ...hi.docs].map((d) => this.fromDoc(d)).filter((c) => !c.hidden && c.doodle && c.ownerId !== this.user.uid);
    if (pool.length < 3) pool.push(...SAMPLE_CHARS);
    return pickNear(pool, r);
  }
  async recordBattle(a, b, result) {
    const { fs } = this;
    const score = scoreOf(result);
    return fs.runTransaction(this.db, async (tx) => {
      const ra0 = a.sample ? a.rating : (await tx.get(this.ref(a.id))).data().rating;
      const rb0 = b.sample ? b.rating : (await tx.get(this.ref(b.id))).data().rating;
      const da = eloDelta(ra0, rb0, score);
      const db = -da;
      const upd = (c, d, r) => {
        if (c.sample) return;
        const f = { rating: fs.increment(d), battles: fs.increment(1), updatedAt: Date.now() };
        if (r === 'win') f.wins = fs.increment(1); else if (r === 'lose') f.losses = fs.increment(1); else f.draws = fs.increment(1);
        tx.update(this.ref(c.id), f);
      };
      upd(a, da, result);
      upd(b, db, result === 'win' ? 'lose' : result === 'lose' ? 'win' : 'draw');
      return { da, db, ra: ra0 + da, rb: rb0 + db };
    });
  }
  async report(id) {
    if (id.startsWith('sample-')) return { ok: false, msg: 'サンプルは通報できません' };
    const { fs } = this;
    try {
      await fs.runTransaction(this.db, async (tx) => {
        const rep = fs.doc(this.db, 'characters', id, 'reports', this.user.uid);
        const already = await tx.get(rep);
        if (already.exists()) throw new Error('dup');
        const c = (await tx.get(this.ref(id))).data();
        const n = (c.reports || 0) + 1;
        tx.set(rep, { at: Date.now() });
        tx.update(this.ref(id), { reports: n, hidden: n >= REPORT_HIDE });
      });
      return { ok: true, msg: '通報しました' };
    } catch (e) {
      return { ok: false, msg: e.message === 'dup' ? 'もう通報ずみです' : '通報できませんでした' };
    }
  }
}

export async function createStore() {
  if (firebaseConfig && firebaseConfig.apiKey) {
    try {
      return await new FirebaseStore().init();
    } catch (e) {
      console.warn('Firebase に接続できないのでオフラインで動きます', e);
    }
  }
  return new LocalStore();
}
