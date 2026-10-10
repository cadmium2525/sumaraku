// ゲーム全体の定数。単位は「キャラの身長 ≒ 1.8」のワールド単位、時間は 60fps のフレーム。
export const FPS = 60;

// スマブラのふっとばし計算をこの世界の単位に合わせるスケール
export const U = 0.11;
export const LAUNCH_SPEED = 0.03 * U; // ふっとばし力 1 あたりの初速
export const LAUNCH_DECAY = 0.051 * U; // ふっとばし速度の毎フレーム減衰
export const KB_MULT = 1.0; // 1on1 補正

export const STAGE = {
  main: { x1: -7, x2: 7, top: 0, bottom: -2.4 },
  platforms: [
    { x1: -5.2, x2: -1.9, y: 2.4 },
    { x1: 1.9, x2: 5.2, y: 2.4 },
    { x1: -1.6, x2: 1.6, y: 4.7 },
  ],
  ledges: [
    { x: -7, y: 0, dir: -1 },
    { x: 7, y: 0, dir: 1 },
  ],
  blast: { left: -21, right: 21, top: 18.5, bottom: -11.5 },
  spawns: [{ x: -4, y: 0 }, { x: 4, y: 0 }],
  respawn: { x: 0, y: 7.5 },
};

export const SHIELD_MAX = 50;
export const BUFFER_FRAMES = 8;
export const STOCKS = 3;
export const TIME_LIMIT = 60 * 60 * 5; // 5分
