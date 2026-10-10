// ラクガキ大乱闘：画面の切り替えとゲームの流れ
import { createStore, MAX_CHARS } from './data/store.js';
import { DrawScreen } from './ui/draw.js';
import { Preview } from './ui/preview.js';
import { Match, defFromChar, escapeHtml } from './game/match.js';
import { TYPES, TYPE_KEYS, MOVE_SLOTS } from './game/archetypes.js';
import { drawThumb } from './doodle/model.js';
import { unlockAudio, sfx, soundOn, setSound } from './ui/sound.js';

const app = document.getElementById('app');
let store;
let cleanup = null; // いまの画面の後片付け

function setScreen(html, cls = '') {
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  app.className = cls;
  app.innerHTML = html;
  window.scrollTo(0, 0);
}
const $ = (sel, el = app) => el.querySelector(sel);
const $$ = (sel, el = app) => [...el.querySelectorAll(sel)];
const esc = escapeHtml;

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 2200);
}

function typeBadge(type) {
  const T = TYPES[type];
  return `<span class="badge" style="--bc:${T.color}">${T.name}</span>`;
}

function thumbs(root = app) {
  for (const c of $$('canvas[data-thumb]', root)) {
    const ch = charCache.get(c.dataset.thumb);
    if (ch && ch.doodle) drawThumb(c, ch.doodle, { pad: 6 });
  }
}
const charCache = new Map();
function remember(list) { for (const c of list) charCache.set(c.id, c); return list; }

function charCard(c, extra = '') {
  return `
    <button class="card" data-id="${c.id}">
      <canvas width="120" height="150" data-thumb="${c.id}"></canvas>
      <div class="card-body">
        <div class="card-name">${esc(c.name)}</div>
        ${typeBadge(c.type)}
        <div class="card-sub">レート <b>${Math.round(c.rating)}</b>・${c.wins || 0}勝${c.losses || 0}敗</div>
        ${extra}
      </div>
    </button>`;
}

// ================= タイトル =================
async function title() {
  setScreen(`
    <div class="title">
      <div class="logo"><span>ラクガキ</span><b>大乱闘</b></div>
      <p class="tagline">描いたラクガキが3Dになって戦う！</p>
      <div class="menu">
        <button class="btn btn-big btn-primary" data-go="draw">✏️ ラクガキする</button>
        <button class="btn btn-big" data-go="cpu">🎮 自分で戦う（CPU戦）</button>
        <button class="btn btn-big" data-go="auto">⚔️ オートバトル（レート戦）</button>
        <button class="btn" data-go="ranking">🏆 ランキング</button>
        <button class="btn" data-go="mine">📒 マイキャラ</button>
      </div>
      <div class="title-foot">
        <button class="link name-btn">なまえ：<b>${esc(store.user.name || 'ななし')}</b> ✎</button>
        <button class="link sound-btn">${soundOn() ? '🔊 音あり' : '🔇 音なし'}</button>
        <span class="net ${store.online ? 'on' : ''}">${store.online ? 'オンライン' : 'オフライン（この端末だけ）'}</span>
      </div>
    </div>`, 'screen-title');
  for (const b of $$('[data-go]')) b.onclick = () => { unlockAudio(); sfx('ui'); go(b.dataset.go); };
  $('.name-btn').onclick = async () => { await askName(true); title(); };
  $('.sound-btn').onclick = () => { setSound(!soundOn()); unlockAudio(); title(); };
}

async function askName(force = false) {
  if (store.user.name && !force) return;
  const n = prompt('プレイヤーのなまえ（ランキングに出ます）', store.user.name || '');
  if (n !== null) await store.setName(n.trim().slice(0, 12) || 'ななし');
}

function go(where) {
  if (where === 'draw') return startDraw();
  if (where === 'cpu') return cpuSetup();
  if (where === 'auto') return autoSetup();
  if (where === 'ranking') return ranking();
  if (where === 'mine') return myChars();
  return title();
}

// ================= ラクガキ =================
async function startDraw() {
  const mine = await store.myChars();
  if (mine.length >= MAX_CHARS) {
    alert(`キャラは${MAX_CHARS}体までです。マイキャラから1体消してね。`);
    return myChars();
  }
  await askName();
  setScreen('<div class="draw-root"></div>', 'screen-draw');
  const ds = new DrawScreen($('.draw-root'), {
    onDone: (doodle) => nameAndReveal(doodle),
    onCancel: () => title(),
  });
  cleanup = () => ds.destroy();
}

function nameAndReveal(doodle) {
  setScreen(`
    <div class="panel">
      <h2>キャラのなまえは？</h2>
      <canvas class="big-thumb" width="240" height="300"></canvas>
      <input class="input name-input" maxlength="12" placeholder="なまえ（12文字まで）">
      <button class="btn btn-big btn-primary to-reveal">キャラ化する！</button>
      <button class="btn back-draw">‹ 描きなおす</button>
    </div>`, 'screen-panel');
  drawThumb($('.big-thumb'), doodle);
  $('.to-reveal').onclick = () => {
    const name = $('.name-input').value.trim() || 'ラクガキ';
    reveal(doodle, name);
  };
  $('.back-draw').onclick = () => {
    setScreen('<div class="draw-root"></div>', 'screen-draw');
    const ds = new DrawScreen($('.draw-root'), { initial: doodle, onDone: (d) => nameAndReveal(d), onCancel: () => title() });
    cleanup = () => ds.destroy();
  };
}

function reveal(doodle, name) {
  // タイプはランダムで決まる
  const type = TYPE_KEYS[Math.floor(Math.random() * TYPE_KEYS.length)];
  const seed = (Math.random() * 1e9) | 0;
  const char = { name, type, seed, doodle, rating: 1500 };
  setScreen(`
    <div class="reveal">
      <h2 class="reveal-title">タイプ抽選中…</h2>
      <div class="roulette">${TYPE_KEYS.map((k) => `<div class="rl" data-k="${k}" style="--bc:${TYPES[k].color}">${TYPES[k].name}</div>`).join('')}</div>
      <canvas class="preview-canvas"></canvas>
      <div class="reveal-info hidden"></div>
      <div class="reveal-actions hidden">
        <button class="btn btn-big btn-primary save-char">このキャラで決定！</button>
      </div>
    </div>`, 'screen-reveal');
  const items = $$('.rl');
  let i = 0, n = 0;
  const total = 18 + TYPE_KEYS.indexOf(type) + TYPE_KEYS.length * 2;
  let preview = null;
  cleanup = () => preview && preview.dispose();
  const tick = () => {
    items.forEach((el, k) => el.classList.toggle('on', k === i % items.length));
    sfx('roll');
    n++;
    if (n < total) { i++; setTimeout(tick, 45 + n * 5); return; }
    items.forEach((el) => el.classList.toggle('on', el.dataset.k === type));
    sfx('reveal');
    $('.reveal-title').innerHTML = `<b style="color:${TYPES[type].color}">${TYPES[type].name}</b> に決定！`;
    const def = defFromChar(char);
    preview = new Preview($('.preview-canvas'), char, def);
    showInfo($('.reveal-info'), char, def);
    $('.reveal-info').classList.remove('hidden');
    $('.reveal-actions').classList.remove('hidden');
  };
  tick();
  $('.save-char').onclick = async () => {
    $('.save-char').disabled = true;
    try {
      const saved = await store.saveChar(char);
      charCache.set(saved.id, saved);
      toast('保存しました！');
      charDetail(saved);
    } catch (e) {
      console.error(e);
      alert('保存できませんでした：' + e.message);
      $('.save-char').disabled = false;
    }
  };
}

function statBars(def) {
  const s = def.stats;
  const bar = (label, v) => `<div class="stat"><span>${label}</span><i><b style="width:${Math.max(8, Math.min(100, v))}%"></b></i></div>`;
  return bar('重さ', (s.weight - 70) * 1.6) + bar('スピード', (s.run - 0.12) * 1000) + bar('ジャンプ', (s.jumpV - 0.24) * 1400 + (s.midair - 1) * 25) + bar('リーチ', def.type === 'weapon' ? 40 + def.reach * 35 : def.type === 'shooter' ? 85 : 35);
}

function showInfo(el, char, def) {
  el.innerHTML = `
    <div class="info-head"><b class="info-name">${esc(char.name)}</b> ${typeBadge(char.type)}</div>
    <div class="stats">${statBars(def)}</div>
    <details class="moves" open>
      <summary>ワザ一覧</summary>
      <ul>${MOVE_SLOTS.map(([k, label]) => def.moves[k] ? `<li class="${k.endsWith('spec') ? 'sp' : ''}"><span>${label}</span><b>${esc(def.moves[k].name)}</b></li>` : '').join('')}</ul>
    </details>`;
}

// ================= マイキャラ・詳細 =================
async function myChars() {
  setScreen(`<div class="list-screen"><div class="bar"><button class="btn btn-small back">‹</button><h2>マイキャラ</h2></div><div class="loading">よみこみ中…</div></div>`, 'screen-list');
  $('.back').onclick = title;
  const list = remember(await store.myChars());
  const body = list.length
    ? `<div class="cards">${list.map((c) => charCard(c)).join('')}</div>`
    : '<p class="empty">まだキャラがいません。ラクガキしよう！</p>';
  $('.loading').outerHTML = `${body}<div class="list-foot"><span>${list.length} / ${MAX_CHARS} 体</span>${list.length < MAX_CHARS ? '<button class="btn btn-primary new-draw">✏️ 新しく描く</button>' : ''}</div>`;
  thumbs();
  for (const b of $$('.card')) b.onclick = () => charDetail(charCache.get(b.dataset.id));
  const nd = $('.new-draw');
  if (nd) nd.onclick = startDraw;
}

function charDetail(c) {
  const mine = c.ownerId === store.user.uid;
  setScreen(`
    <div class="detail">
      <div class="bar"><button class="btn btn-small back">‹</button><h2>${esc(c.name)}</h2></div>
      <canvas class="preview-canvas"></canvas>
      <p class="sub">作者：${esc(c.ownerName || 'ななし')}・レート <b>${Math.round(c.rating)}</b>・${c.wins || 0}勝${c.losses || 0}敗</p>
      <div class="detail-actions">
        ${mine
          ? `<button class="btn btn-primary act-cpu">🎮 このキャラで戦う</button>
             <button class="btn btn-primary act-auto">⚔️ オートバトル</button>
             <button class="btn btn-danger act-del">消す</button>`
          : `<button class="btn btn-primary act-challenge">⚔️ このキャラに挑戦（オート）</button>
             <button class="btn act-fight">🎮 自分で戦う</button>
             <button class="btn btn-danger act-report">🚩 通報</button>`}
      </div>
      <div class="detail-info"></div>
    </div>`, 'screen-detail');
  const def = defFromChar(c);
  const preview = new Preview($('.preview-canvas'), c, def);
  cleanup = () => preview.dispose();
  showInfo($('.detail-info'), c, def);
  $('.back').onclick = () => (mine ? myChars() : ranking());
  if (mine) {
    $('.act-cpu').onclick = () => cpuSetup(c);
    $('.act-auto').onclick = () => autoSetup(c);
    $('.act-del').onclick = async () => {
      if (!confirm(`「${c.name}」を消しますか？（もとにもどせません）`)) return;
      await store.deleteChar(c.id);
      toast('消しました');
      myChars();
    };
  } else {
    $('.act-challenge').onclick = () => pickMine((me) => autoSetup(me, c), 'だれで挑戦する？');
    $('.act-fight').onclick = () => pickMine((me) => cpuLevel(me, c), 'だれで戦う？');
    $('.act-report').onclick = async () => {
      if (!confirm('このラクガキを不適切なものとして通報しますか？')) return;
      const r = await store.report(c.id);
      toast(r.msg);
    };
  }
}

/** 自分のキャラを選ぶ */
async function pickMine(next, heading = 'キャラをえらぶ') {
  const list = remember(await store.myChars());
  if (!list.length) {
    if (confirm('まだキャラがいません。ラクガキしますか？')) startDraw();
    return;
  }
  if (list.length === 1) return next(list[0]);
  setScreen(`<div class="list-screen"><div class="bar"><button class="btn btn-small back">‹</button><h2>${heading}</h2></div>
    <div class="cards">${list.map((c) => charCard(c)).join('')}</div></div>`, 'screen-list');
  $('.back').onclick = title;
  thumbs();
  for (const b of $$('.card')) b.onclick = () => next(charCache.get(b.dataset.id));
}

// ================= CPU戦 =================
async function cpuSetup(me) {
  if (!me) return pickMine((m) => cpuSetup(m), 'だれで戦う？');
  setScreen(`<div class="list-screen"><div class="bar"><button class="btn btn-small back">‹</button><h2>あいてをえらぶ</h2></div>
    <button class="btn btn-primary random-opp">🎲 ランダム</button>
    <div class="loading">よみこみ中…</div></div>`, 'screen-list');
  $('.back').onclick = title;
  const others = remember(await store.others(40));
  const mine = remember(await store.myChars()).filter((c) => c.id !== me.id);
  const all = [...others, ...mine];
  $('.loading').outerHTML = `<div class="cards">${all.map((c) => charCard(c)).join('')}</div>`;
  thumbs();
  for (const b of $$('.card')) b.onclick = () => cpuLevel(me, charCache.get(b.dataset.id));
  $('.random-opp').onclick = () => all.length && cpuLevel(me, all[Math.floor(Math.random() * all.length)]);
}

function cpuLevel(me, opp) {
  let level = 5;
  try { level = +(localStorage.getItem('rkg_level') || 5); } catch (e) { /* ignore */ }
  setScreen(`
    <div class="vs-screen">
      <div class="vs">
        <div class="vs-side"><canvas width="160" height="200" data-thumb="${me.id}"></canvas><b>${esc(me.name)}</b>${typeBadge(me.type)}<small>あなた</small></div>
        <div class="vs-mark">VS</div>
        <div class="vs-side"><canvas width="160" height="200" data-thumb="${opp.id}"></canvas><b>${esc(opp.name)}</b>${typeBadge(opp.type)}<small>CPU</small></div>
      </div>
      <label class="level">CPUのつよさ：<b class="lv">${level}</b><input type="range" min="1" max="9" value="${level}"></label>
      <p class="rule">1on1・ストック3・アイテムなし</p>
      <p class="landscape-hint">📱 スマホは横向きがおすすめ</p>
      <button class="btn btn-big btn-primary start">たたかう！</button>
      <button class="btn back">‹ もどる</button>
    </div>`, 'screen-vs');
  remember([me, opp]);
  thumbs();
  const r = $('input[type=range]');
  r.oninput = () => { level = +r.value; $('.lv').textContent = level; try { localStorage.setItem('rkg_level', level); } catch (e) { /* ignore */ } };
  $('.back').onclick = () => cpuSetup(me);
  $('.start').onclick = () => {
    unlockAudio();
    startMatch({ chars: [me, opp], mode: 'cpu', level }, (res) => result(res, { mode: 'cpu', me, opp, level }));
  };
}

function startMatch(opts, onEnd) {
  setScreen('<div class="battle-root"></div>', 'screen-battle');
  requestFullscreenLandscape();
  const m = new Match($('.battle-root'), { ...opts, onEnd, onQuit: () => { exitFullscreen(); title(); } });
  cleanup = () => m.destroy();
}

function requestFullscreenLandscape() {
  const el = document.documentElement;
  if (!matchMedia('(pointer: coarse)').matches) return;
  try {
    const p = el.requestFullscreen ? el.requestFullscreen() : null;
    if (p && p.then) p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
  } catch (e) { /* 対応していない端末は無視 */ }
}
function exitFullscreen() {
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* ignore */ }
}

// ================= オートバトル =================
async function autoSetup(me, opp) {
  if (!me) return pickMine((m) => autoSetup(m), 'だれを戦わせる？');
  setScreen(`<div class="vs-screen"><h2>対戦あいてをさがしています…</h2><div class="spinner"></div></div>`, 'screen-vs');
  if (!opp) opp = await store.findOpponent(me);
  if (!opp) { alert('対戦あいてが見つかりませんでした'); return title(); }
  remember([me, opp]);
  setScreen(`
    <div class="vs-screen">
      <h2>オートバトル</h2>
      <div class="vs">
        <div class="vs-side"><canvas width="160" height="200" data-thumb="${me.id}"></canvas><b>${esc(me.name)}</b>${typeBadge(me.type)}<small>レート ${Math.round(me.rating)}</small></div>
        <div class="vs-mark">VS</div>
        <div class="vs-side"><canvas width="160" height="200" data-thumb="${opp.id}"></canvas><b>${esc(opp.name)}</b>${typeBadge(opp.type)}<small>${esc(opp.ownerName || '')}・レート ${Math.round(opp.rating)}</small></div>
      </div>
      <p class="rule">キャラが自動で戦います。勝てばレートアップ！</p>
      <button class="btn btn-big btn-primary start">観戦する</button>
      <button class="btn reroll">🎲 ほかの相手</button>
      <button class="btn back">‹ もどる</button>
    </div>`, 'screen-vs');
  thumbs();
  $('.back').onclick = title;
  $('.reroll').onclick = () => autoSetup(me);
  $('.start').onclick = () => {
    unlockAudio();
    startMatch({ chars: [me, opp], mode: 'auto', level: 7, levelA: 7 }, async (res) => {
      const r = res.winner === 0 ? 'win' : res.winner === 1 ? 'lose' : 'draw';
      let delta = null;
      try { delta = await store.recordBattle(me, opp, r); } catch (e) { console.error(e); }
      if (delta) { me.rating = delta.ra; opp.rating = delta.rb; }
      result(res, { mode: 'auto', me, opp, delta });
    });
  };
}

// ================= 結果 =================
function result(res, ctx) {
  exitFullscreen();
  const { me, opp } = ctx;
  const win = res.winner === 0, draw = res.winner === 2;
  const head = draw ? 'ひきわけ' : win ? `${esc(me.name)} の勝ち！` : `${esc(opp.name)} の勝ち…`;
  const f = res.fighters;
  const sec = Math.round(res.frames / 60);
  setScreen(`
    <div class="result ${win ? 'win' : draw ? '' : 'lose'}">
      <h1>${head}</h1>
      <div class="vs">
        <div class="vs-side ${win ? 'winner' : ''}"><canvas width="160" height="200" data-thumb="${me.id}"></canvas><b>${esc(me.name)}</b>
          <small>撃墜 ${f[0].kos}・与えたダメージ ${Math.round(f[0].dealt)}%</small>
          ${ctx.delta ? `<div class="delta ${ctx.delta.da >= 0 ? 'up' : 'down'}">レート ${Math.round(ctx.delta.ra)}（${ctx.delta.da >= 0 ? '+' : ''}${ctx.delta.da}）</div>` : ''}
        </div>
        <div class="vs-side ${res.winner === 1 ? 'winner' : ''}"><canvas width="160" height="200" data-thumb="${opp.id}"></canvas><b>${esc(opp.name)}</b>
          <small>撃墜 ${f[1].kos}・与えたダメージ ${Math.round(f[1].dealt)}%</small>
          ${ctx.delta ? `<div class="delta ${ctx.delta.db >= 0 ? 'up' : 'down'}">レート ${Math.round(ctx.delta.rb)}（${ctx.delta.db >= 0 ? '+' : ''}${ctx.delta.db}）</div>` : ''}
        </div>
      </div>
      <p class="sub">試合時間 ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}${res.reason === 'time' ? '（時間切れ）' : ''}</p>
      <button class="btn btn-big btn-primary again">${ctx.mode === 'auto' ? 'つぎの相手と戦う' : 'もう一回'}</button>
      <button class="btn to-title">タイトルへ</button>
    </div>`, 'screen-result');
  thumbs();
  $('.again').onclick = () => (ctx.mode === 'auto' ? autoSetup(me) : startMatch({ chars: [me, opp], mode: 'cpu', level: ctx.level }, (r) => result(r, ctx)));
  $('.to-title').onclick = title;
}

// ================= ランキング =================
async function ranking() {
  setScreen(`<div class="list-screen"><div class="bar"><button class="btn btn-small back">‹</button><h2>🏆 ランキング</h2></div><div class="loading">よみこみ中…</div></div>`, 'screen-list');
  $('.back').onclick = title;
  const list = remember(await store.ranking(50));
  $('.loading').outerHTML = `<ol class="rank">${list.map((c, i) => `
    <li><button class="rank-row" data-id="${c.id}">
      <span class="rank-no">${i + 1}</span>
      <canvas width="64" height="80" data-thumb="${c.id}"></canvas>
      <span class="rank-main"><b>${esc(c.name)}</b><small>${esc(c.ownerName || '')}</small></span>
      <span class="rank-type">${typeBadge(c.type)}</span>
      <span class="rank-rate"><b>${Math.round(c.rating)}</b><small>${c.wins || 0}勝${c.losses || 0}敗</small></span>
    </button></li>`).join('')}</ol>${store.online ? '' : '<p class="note">※オフラインなので、この端末の中だけのランキングです</p>'}`;
  thumbs();
  for (const b of $$('.rank-row')) b.onclick = () => charDetail(charCache.get(b.dataset.id));
}

// ================= 起動 =================
(async function boot() {
  app.innerHTML = '<div class="boot">よみこみ中…</div>';
  store = await createStore();
  title();
})();

// iOS のダブルタップ拡大などを抑止
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
