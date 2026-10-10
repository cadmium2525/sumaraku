// イロレーティング
export const START_RATING = 1500;
const K = 32;

/** score: A から見た結果（勝ち 1 / 引き分け 0.5 / 負け 0） */
export function eloDelta(ra, rb, score) {
  const expected = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  return Math.round(K * (score - expected));
}
