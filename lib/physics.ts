export type ShotKind = "free-throw" | "three-pointer";
export type Outcome = "swish" | "rim-in" | "rim-out" | "air-ball";

export const COURT_WIDTH = 1024;
export const COURT_HEIGHT = 600;
export const FLOOR_Y = 545;
export const BALL_RADIUS = 19;
export const RIM_HALF_WIDTH = 55;
export const GREEN_LOW = 58;
export const GREEN_HIGH = 82;

const GRAVITY = 750;
const RIM_TUBE_RADIUS = 4;
const NET_DEPTH = 55;
export const FLIGHT_STEP = 1 / 240;

export type ShotConfig = {
  releaseX: number;
  releaseY: number;
  rimX: number;
  rimY: number;
  angle: number;
  points: number;
};

export function getShotConfig(kind: ShotKind): ShotConfig {
  const long = kind === "three-pointer";
  return {
    releaseX: long ? 200 : 440,
    releaseY: 323,
    rimX: 880,
    rimY: 250,
    angle: (long ? 48 : 52) * Math.PI / 180,
    points: long ? 3 : 1,
  };
}

/** Slow down the needle on green, with another chance on the way back. */
export function shotPowerAt(elapsedMs: number) {
  const peak = 1160;
  const cycle = Math.max(0, elapsedMs) % (peak * 2);
  const risingTime = Math.min(cycle, peak * 2 - cycle);
  if (risingTime <= 430) return Math.round(GREEN_LOW * risingTime / 430);
  if (risingTime <= 930) return Math.round(GREEN_LOW + (GREEN_HIGH - GREEN_LOW) * (risingTime - 430) / 500);
  return Math.round(GREEN_HIGH + (100 - GREEN_HIGH) * (risingTime - 930) / (peak - 930));
}

export type Ball = { x: number; y: number; vx: number; vy: number; rotation: number };
export type ShotEvent = "rim" | "board" | "net" | "floor";
export type Flight = {
  ball: Ball;
  spin: number;
  elapsed: number;
  touches: number;
  inNet: boolean;
  made: boolean;
  floorTime: number | null;
  outcome: Outcome | null;
};

export function createFlight(cfg: ShotConfig, power: number): Flight {
  // Ease the range around green so a wide timing window still fits through a real opening.
  const aim = Math.max(50, power);
  const offset = (aim - 70) * 1.08 - Math.max(0, GREEN_LOW - aim) * 9 + Math.max(0, aim - GREEN_HIGH) * 9 + Math.max(0, aim - 90) * 20;
  const dx = cfg.rimX - cfg.releaseX + offset;
  const dy = cfg.releaseY - cfg.rimY;
  const cos = Math.cos(cfg.angle);
  const speed = Math.sqrt(GRAVITY * dx * dx / (2 * cos * cos * (dx * Math.tan(cfg.angle) - dy))) * Math.min(power / 50, 1);
  return {
    ball: { x: cfg.releaseX, y: cfg.releaseY, vx: speed * cos, vy: -speed * Math.sin(cfg.angle), rotation: 0 },
    spin: -12,
    elapsed: 0,
    touches: 0,
    inNet: false,
    made: false,
    floorTime: null,
    outcome: null,
  };
}

function meetRim(ball: Ball, x: number, y: number) {
  const dx = ball.x - x;
  const dy = ball.y - y;
  const distance = Math.hypot(dx, dy);
  const radius = BALL_RADIUS + RIM_TUBE_RADIUS;
  if (!distance || distance >= radius) return false;
  const nx = dx / distance;
  const ny = dy / distance;
  const approach = ball.vx * nx + ball.vy * ny;
  ball.x = x + nx * radius;
  ball.y = y + ny * radius;
  if (approach >= 0) return false;
  ball.vx = (ball.vx - 1.48 * approach * nx) * 0.83;
  ball.vy = (ball.vy - 1.48 * approach * ny) * 0.83;
  return true;
}

export function stepFlight(flight: Flight, cfg: ShotConfig, duration: number, onContact?: (event: ShotEvent) => void) {
  const b = flight.ball;
  const floor = FLOOR_Y - BALL_RADIUS;
  // The side-on collision plane sits at the rim mounting bracket.
  const board = cfg.rimX + 69 - BALL_RADIUS;
  const rimLeft = cfg.rimX - RIM_HALF_WIDTH;
  const rimRight = cfg.rimX + RIM_HALF_WIDTH;

  for (let remaining = duration; remaining > 0 && !flight.outcome; remaining -= FLIGHT_STEP) {
    const dt = Math.min(remaining, FLIGHT_STEP);
    flight.elapsed += dt;
    const x = b.x;
    const y = b.y;

    if (flight.inNet && !flight.made) {
      // The tapered net absorbs sideways speed and guides the ball toward its exit.
      b.vx += ((cfg.rimX - 8 - b.x) * 130 - b.vx * 34) * dt;
      b.vy *= Math.exp(-3.6 * dt);
      flight.spin *= Math.exp(-6 * dt);
    }
    b.x += b.vx * dt;
    b.y += (b.vy + 0.5 * GRAVITY * dt) * dt;
    b.vy += GRAVITY * dt;
    b.rotation += flight.spin * dt;

    if (!flight.made && flight.floorTime === null) {
      if (b.vx > 0 && x <= board && b.x > board) {
        const hitY = y + (b.y - y) * (board - x) / (b.x - x);
        if (hitY >= cfg.rimY - 98 - BALL_RADIUS && hitY <= cfg.rimY + 28 + BALL_RADIUS) {
          b.x = board;
          b.vx *= -0.6;
          b.vy *= 0.88;
          flight.spin *= -0.56;
          flight.touches++;
          onContact?.("board");
        }
      }

      if (meetRim(b, rimLeft, cfg.rimY) || meetRim(b, rimRight, cfg.rimY)) {
        flight.spin *= -0.62;
        flight.touches++;
        onContact?.("rim");
      }

      if (b.vy > 0 && y < cfg.rimY && b.y >= cfg.rimY) {
        const crossingX = x + (b.x - x) * (cfg.rimY - y) / (b.y - y);
        const opening = RIM_HALF_WIDTH - BALL_RADIUS - RIM_TUBE_RADIUS;
        if (Math.abs(crossingX - cfg.rimX) <= opening) flight.inNet = true;
      }

      if (b.y < cfg.rimY - 2 || Math.abs(b.x - cfg.rimX) > RIM_HALF_WIDTH) flight.inNet = false;
      if (flight.inNet && b.y >= cfg.rimY + NET_DEPTH) {
        flight.made = true;
        onContact?.("net");
      }
    }

    if (b.vy > 0 && b.y >= floor) {
      b.y = floor;
      b.vy = -Math.min(b.vy * 0.46, 243);
      b.vx *= 0.71;
      flight.spin *= 0.59;
      flight.floorTime ??= flight.elapsed;
      onContact?.("floor");
    }

    if (
      (flight.floorTime !== null && flight.elapsed - flight.floorTime > 0.38) ||
      b.x > COURT_WIDTH + 40 ||
      b.x < -40 ||
      flight.elapsed > 4
    ) {
      flight.outcome = flight.made
        ? flight.touches ? "rim-in" : "swish"
        : flight.touches ? "rim-out" : "air-ball";
    }
  }
}
