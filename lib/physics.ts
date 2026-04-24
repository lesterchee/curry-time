export type ShotKind = "free-throw" | "three-pointer";

export type ShotConfig = {
  /** release position on canvas */
  releaseX: number;
  releaseY: number;
  /** rim position on canvas */
  rimX: number;
  rimY: number;
  /** rim inner half-width (ball passes through if landing within) */
  rimInner: number;
  /** rim outer half-width (ball touches rim between inner and outer) */
  rimOuter: number;
  /** release angle in radians (from horizontal) */
  angle: number;
  /** gravity px/s^2 */
  gravity: number;
  /** velocity that produces a perfect swish */
  perfectVelocity: number;
  /** points awarded for a make */
  points: number;
  /** display label */
  label: string;
};

const GRAVITY = 750;

function computePerfectVelocity(
  dx: number,
  dy: number,
  angleDeg: number,
): number {
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const tan = Math.tan(a);
  // v^2 = g * dx^2 / (2 * cos^2(a) * (dx*tan(a) - dy))
  const denom = 2 * cos * cos * (dx * tan - dy);
  if (denom <= 0) return 1000;
  return Math.sqrt((GRAVITY * dx * dx) / denom);
}

export function getShotConfig(kind: ShotKind): ShotConfig {
  // Canvas is logical 1024 x 600
  // Floor surface roughly at y ~ 500 (matches court background).
  // Character feet at y ~ 515, height ~220, hand/release point at y ~ 340.
  // Rim sits higher in the scene, at y ~ 250.
  const releaseY = 340;
  const rimY = 250;
  const rimX = 880;
  // Scoring tolerance. Widened to make the 65-75% power band a reliable
  // swish while keeping >78% / <62% firmly outside so the game can't be
  // cheated by just holding the button. Decoupled from the visual rim
  // size in the hoop sprite — the artwork is unchanged.
  const rimInner = 80;
  const rimOuter = 110;

  if (kind === "free-throw") {
    const releaseX = 440;
    const angleDeg = 52;
    const dx = rimX - releaseX;
    const dy = releaseY - rimY;
    const perfectVelocity = computePerfectVelocity(dx, dy, angleDeg);
    return {
      releaseX,
      releaseY,
      rimX,
      rimY,
      rimInner,
      rimOuter,
      angle: (angleDeg * Math.PI) / 180,
      gravity: GRAVITY,
      perfectVelocity,
      points: 1,
      label: "FREE THROW",
    };
  }
  // three pointer: character stands further from hoop
  const releaseX = 200;
  const angleDeg = 48;
  const dx = rimX - releaseX;
  const dy = releaseY - rimY;
  const perfectVelocity = computePerfectVelocity(dx, dy, angleDeg);
  return {
    releaseX,
    releaseY,
    rimX,
    rimY,
    rimInner,
    rimOuter,
    angle: (angleDeg * Math.PI) / 180,
    gravity: GRAVITY,
    perfectVelocity,
    points: 3,
    label: "THREE POINTER",
  };
}

/** Power (0-100) → launch speed. 70% power = perfect swish. */
export function powerToVelocity(power: number, cfg: ShotConfig): number {
  return cfg.perfectVelocity * (power / 70);
}

export type Outcome = "swish" | "rim-in" | "rim-out" | "air-ball";

/**
 * Trajectory-based hit classifier. Called when the ball crosses the rim
 * plane (y = rimY) on a descending frame. Outcome depends on where the
 * ball is horizontally at that crossing relative to the rim ring:
 *
 *   crossX ∈ [rimX - rimInner + margin, rimX + rimInner - margin] → swish
 *   crossX ∈ [rimX - rimOuter, rimX + rimOuter] (outside inner)    → rim roll
 *     └─ RIM_IN_CHANCE of those rolls drop in, rest bounce out
 *   crossX > rimX + rimOuter → hits backboard area → rim-out (brick)
 *   crossX < rimX - rimOuter → short → air-ball
 *
 * If the ball never reaches rimY (its trajectory peaks below the rim),
 * no call is made here — the outer update loop resolves it as air-ball.
 */
export const BALL_RADIUS = 23;
export const RIM_IN_CHANCE = 0.3;
export const SWISH_EDGE_MARGIN = 0;

export type RimHit =
  | { kind: "swish" }
  | { kind: "rim-in" }
  | { kind: "rim-out"; side: "front" | "back" | "backboard" }
  | { kind: "air-ball"; side: "short" };

export function classifyRimCrossing(
  crossX: number,
  cfg: ShotConfig,
  rng: () => number = Math.random,
): RimHit {
  const innerLeft = cfg.rimX - cfg.rimInner + SWISH_EDGE_MARGIN;
  const innerRight = cfg.rimX + cfg.rimInner - SWISH_EDGE_MARGIN;
  const outerLeft = cfg.rimX - cfg.rimOuter;
  const outerRight = cfg.rimX + cfg.rimOuter;

  if (crossX >= innerLeft && crossX <= innerRight) {
    return { kind: "swish" };
  }
  if (crossX >= outerLeft && crossX <= outerRight) {
    if (rng() < RIM_IN_CHANCE) return { kind: "rim-in" };
    return { kind: "rim-out", side: crossX > cfg.rimX ? "back" : "front" };
  }
  if (crossX > outerRight) {
    return { kind: "rim-out", side: "backboard" };
  }
  return { kind: "air-ball", side: "short" };
}
