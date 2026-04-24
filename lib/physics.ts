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
  const rimInner = 22;
  const rimOuter = 32;

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
 * Predict the outcome given the power. Landing-based classification tied to
 * where the ball crosses the rim plane.
 *
 * Perfect zone 65–78 → guaranteed swish.
 * 55–65 / 78–85 → rim roll (60% in, 40% out).
 * 40–55 / 85–95 → rim bounce out.
 * else → air ball.
 */
export function classifyOutcome(
  power: number,
  rng: () => number = Math.random,
): Outcome {
  if (power >= 63 && power <= 78) return "swish";
  if ((power >= 56 && power < 63) || (power > 78 && power <= 85)) {
    return rng() < 0.6 ? "rim-in" : "rim-out";
  }
  if ((power >= 40 && power < 56) || (power > 85 && power <= 95)) {
    return "rim-out";
  }
  return "air-ball";
}
