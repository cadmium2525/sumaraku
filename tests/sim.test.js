// AI 同士の対戦をヘッドレスで回して、試合が成立するか（撃墜が起きる・終わる・止まらない）を確認する
import { buildFighterDef, TYPE_KEYS } from '../js/game/archetypes.js';
import { Sim } from '../js/game/sim.js';
import { AI } from '../js/game/ai.js';

export function runMatch(typeA, typeB, seed, level = 7, verbose = false) {
  const A = buildFighterDef({ type: typeA, seed: seed * 7 + 1 });
  const B = buildFighterDef({ type: typeB, seed: seed * 13 + 5 });
  const sim = new Sim(A, B, { seed });
  const ais = [new AI(sim.fighters[0], sim, level, seed + 1), new AI(sim.fighters[1], sim, level, seed + 2)];
  const koPercents = [];
  const lastPct = [0, 0];
  const stateCount = {};
  while (!sim.over && sim.frame < 60 * 60 * 6) {
    sim.step(ais.map((a) => a.next()));
    for (const f of sim.fighters) { if (f.state !== 'dead') lastPct[f.slot] = f.percent; stateCount[f.state] = (stateCount[f.state] || 0) + 1; }
    for (const e of sim.events) if (e.t === 'ko') koPercents.push(Math.round(lastPct[e.slot]));
    sim.events.length = 0;
  }
  return { winner: sim.winner, frames: sim.frame, reason: sim.endReason, koPercents, stateCount, stats: sim.fighters.map((f) => f.stats) };
}

if (import.meta.url === `file://${process.argv[1]}`) main();

function main() {
const N = Number(process.argv[2] || 3);
const results = [];
let fails = 0;
const wins = {};
for (const a of TYPE_KEYS) for (const b of TYPE_KEYS) {
  for (let s = 1; s <= N; s++) {
    const r = runMatch(a, b, s * 101 + a.length * 7 + b.length);
    results.push({ a, b, ...r });
    if (r.winner === 0) wins[a] = (wins[a] || 0) + 1; else if (r.winner === 1) wins[b] = (wins[b] || 0) + 1;
    if (!r.reason) fails++;
  }
}
const all = results.flatMap((r) => r.koPercents);
const avg = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const secs = results.map((r) => r.frames / 60);
console.log('matches', results.length, 'timeouts', results.filter((r) => r.reason === 'time').length, 'unfinished', fails);
console.log('avg match sec', avg(secs).toFixed(1), 'min', Math.min(...secs).toFixed(1), 'max', Math.max(...secs).toFixed(1));
console.log('avg KO %', avg(all).toFixed(1), 'min', Math.min(...all), 'max', Math.max(...all));
console.log('wins by type', wins);
const sc = {};
for (const r of results) for (const [k, v] of Object.entries(r.stateCount)) sc[k] = (sc[k] || 0) + v;
const tot = Object.values(sc).reduce((s, x) => s + x, 0);
console.log('state share', Object.fromEntries(Object.entries(sc).sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, (v / tot * 100).toFixed(1) + '%'])));
if (fails) { console.error('FAIL: unfinished matches'); process.exit(1); }
}
