"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Character } from "../data/characters";
import {
  classifyOutcome,
  getShotConfig,
  powerToVelocity,
  type Outcome,
  type ShotKind,
} from "../lib/physics";
import {
  playBoo,
  playCheer,
  playNetSwish,
  playRelease,
  playRimClang,
  playTickTock,
} from "../lib/sounds";
import { getHighScore, updateHighScore } from "../lib/scoring";

const LOGICAL_W = 1024;
const LOGICAL_H = 600;

type Phase = "charging" | "flying" | "resolved" | "idle";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
};

type Props = {
  character: Character;
  shotKind: ShotKind;
  onExit: () => void;
  onChangeShot: () => void;
};

export default function Game({ character, shotKind, onExit, onChangeShot }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number>(0);

  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [banner, setBanner] = useState<Outcome | null>(null);
  const [powerPct, setPowerPct] = useState(0);
  const [meterShake, setMeterShake] = useState(0);

  // refs for the game loop (avoid stale closures)
  const stateRef = useRef({
    phase: "idle" as Phase,
    charging: false,
    chargeStart: 0,
    releasePower: 0,
    ball: { x: 0, y: 0, vx: 0, vy: 0, rotation: 0, rotationSpeed: 0 },
    outcome: null as Outcome | null,
    pendingOutcome: null as Outcome | null,
    resolvedPending: false,
    outcomeT: 0,
    particles: [] as Particle[],
    netWiggleT: 0,
    rimShakeT: 0,
    releaseTime: 0,
    cfg: getShotConfig(shotKind),
    characterFrame: 0, // 0 idle, 1 crouch, 2 release
    imgs: {
      court: null as HTMLImageElement | null,
      ball: null as HTMLImageElement | null,
      hoop: null as HTMLImageElement | null,
      char: null as HTMLImageElement | null,
    },
    lastTickSoundT: 0,
  });

  // load images
  useEffect(() => {
    const s = stateRef.current;
    const load = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    void Promise.all([
      load("/court-background.png"),
      load("/basketball.png"),
      load("/hoop.png"),
      load(character.sprite),
    ]).then(([court, ball, hoop, char]) => {
      s.imgs = { court, ball, hoop, char };
    });
  }, [character.sprite]);

  // update cfg when shotKind changes
  useEffect(() => {
    stateRef.current.cfg = getShotConfig(shotKind);
    resetBall();
  }, [shotKind]);

  // load high score
  useEffect(() => {
    setHighScore(getHighScore(character.id));
  }, [character.id]);

  const resetBall = useCallback(() => {
    const s = stateRef.current;
    const cfg = s.cfg;
    s.ball = {
      x: cfg.releaseX,
      y: cfg.releaseY,
      vx: 0,
      vy: 0,
      rotation: 0,
      rotationSpeed: 0,
    };
    s.phase = "idle";
    s.outcome = null;
    s.particles = [];
    s.characterFrame = 0;
    setPhase("idle");
    setBanner(null);
    setPowerPct(0);
  }, []);

  useEffect(() => {
    resetBall();
  }, [resetBall, character.id, shotKind]);

  // main loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastT = performance.now();
    let running = true;

    function resize() {
      const c = canvasRef.current;
      if (!c) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min(rect.width / LOGICAL_W, rect.height / LOGICAL_H);
      const w = Math.floor(LOGICAL_W * scale);
      const h = Math.floor(LOGICAL_H * scale);
      c.width = Math.floor(w * dpr);
      c.height = Math.floor(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      ctx!.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);

    const tick = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.033, (now - lastT) / 1000);
      lastT = now;
      update(dt, now);
      draw(ctx);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function currentPower(t: number): number {
    // oscillate 0→100→0 over 1.4s cycle
    const s = stateRef.current;
    if (!s.charging) return 0;
    const elapsed = (t - s.chargeStart) / 1000;
    const period = 1.4;
    const phaseF = (elapsed % period) / period;
    // triangle wave: 0→1→0
    const v = phaseF < 0.5 ? phaseF * 2 : 2 - phaseF * 2;
    return Math.round(v * 100);
  }

  function update(dt: number, nowMs: number) {
    const s = stateRef.current;
    const cfg = s.cfg;

    if (s.charging) {
      const p = currentPower(nowMs);
      setPowerPct(p);
      s.characterFrame = 1; // crouch
      if (nowMs - s.lastTickSoundT > 120) {
        s.lastTickSoundT = nowMs;
        playTickTock();
      }
    }

    if (s.phase === "flying") {
      const b = s.ball;
      b.vy += cfg.gravity * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rotation += b.rotationSpeed * dt;

      const outcome = s.pendingOutcome;

      // For a swish shot, guide the ball through the rim center cosmetically
      // if it strayed: as it crosses rim height, nudge x toward rim center.
      if (outcome === "swish" && b.vy > 0 && !s.resolvedPending) {
        if (b.y >= cfg.rimY - 4 && b.y <= cfg.rimY + 20) {
          const dx = cfg.rimX - b.x;
          b.x += dx * 0.35; // snap toward rim center
        }
        if (b.y > cfg.rimY + 10) {
          s.resolvedPending = true;
          s.netWiggleT = 0.6;
          playNetSwish();
        }
      }

      // Rim-in: hit front rim once, bounce, then drop through
      if (outcome === "rim-in" && !s.resolvedPending && b.vy > 0) {
        if (b.y >= cfg.rimY - 4 && b.x >= cfg.rimX - cfg.rimOuter - 10) {
          b.vx = -Math.abs(b.vx) * 0.2 + 30;
          b.vy = -Math.abs(b.vy) * 0.45;
          b.x = cfg.rimX - cfg.rimOuter;
          playRimClang();
          s.rimShakeT = 0.3;
          s.pendingOutcome = "swish";
          // don't mark resolvedPending yet — swish branch will play net
        }
      }

      // Rim-out: hit rim, bounce back, no score
      if (outcome === "rim-out" && !s.resolvedPending && b.vy > 0) {
        if (b.y >= cfg.rimY - 4 && b.x >= cfg.rimX - cfg.rimOuter - 10) {
          b.vx = -Math.abs(b.vx) * 0.6 - 60;
          b.vy = -Math.abs(b.vy) * 0.5;
          b.x = cfg.rimX - cfg.rimOuter - 4;
          playRimClang();
          s.rimShakeT = 0.3;
          s.resolvedPending = true;
        }
      }

      // ball out of bounds = finalize outcome
      if (b.y > LOGICAL_H + 40 || b.x < -40 || b.x > LOGICAL_W + 80) {
        if (!s.outcome) {
          const final: Outcome = s.pendingOutcome ?? "air-ball";
          resolveOutcome(final);
        }
      }
    }

    // net wiggle / rim shake decay
    if (s.netWiggleT > 0) s.netWiggleT = Math.max(0, s.netWiggleT - dt);
    if (s.rimShakeT > 0) s.rimShakeT = Math.max(0, s.rimShakeT - dt);

    // particles
    for (const p of s.particles) {
      p.vy += 600 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    s.particles = s.particles.filter((p) => p.life > 0);
  }

  function resolveOutcome(outcome: Outcome) {
    const s = stateRef.current;
    s.outcome = outcome;
    s.phase = "resolved";
    setPhase("resolved");
    setBanner(outcome);

    if (outcome === "swish" || outcome === "rim-in") {
      playCheer();
      confettiBurst();
      const points = s.cfg.points;
      setScore((x) => {
        const next = x + points;
        const hi = updateHighScore(character.id, next);
        setHighScore(hi);
        return next;
      });
      setStreak((x) => x + 1);
    } else {
      playBoo();
      setStreak(0);
    }
  }

  function confettiBurst() {
    const s = stateRef.current;
    const cx = s.cfg.rimX;
    const cy = s.cfg.rimY + 40;
    const colors = ["#ffd84a", "#ff8a00", "#1e73ff", "#e23b3b", "#8b2df0", "#19e65a"];
    for (let i = 0; i < 60; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 160 + Math.random() * 200;
      s.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 100,
        life: 0.9 + Math.random() * 0.4,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  // draw frame
  function draw(ctx: CanvasRenderingContext2D) {
    const s = stateRef.current;
    const cfg = s.cfg;

    // background
    if (s.imgs.court) {
      ctx.drawImage(s.imgs.court, 0, 0, LOGICAL_W, LOGICAL_H);
    } else {
      ctx.fillStyle = "#7a3b1a";
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    }

    // hoop
    drawHoop(ctx, s);
    // character
    drawCharacter(ctx, s);
    // ball
    drawBall(ctx, s);
    // particles
    for (const p of s.particles) {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
    }

    // trajectory preview during charging
    if (s.charging) {
      const power = Math.max(currentPower(performance.now()), 1);
      const v = powerToVelocity(power, cfg);
      drawTrajectory(ctx, cfg, v);
    }

    void cfg;
  }

  function drawHoop(ctx: CanvasRenderingContext2D, s: typeof stateRef.current) {
    const cfg = s.cfg;
    // hoop image centered on rim
    const img = s.imgs.hoop;
    const shake = s.rimShakeT > 0 ? (Math.random() - 0.5) * 8 : 0;
    if (img) {
      const hoopW = 220;
      const hoopH = 220;
      // rim (hole) is approximately at 60% down, 55% across in the png
      const drawX = cfg.rimX - hoopW * 0.50;
      const drawY = cfg.rimY - hoopH * 0.26;
      ctx.save();
      ctx.translate(shake, shake * 0.4);
      ctx.drawImage(img, drawX, drawY, hoopW, hoopH);
      ctx.restore();
    } else {
      ctx.fillStyle = "#b02020";
      ctx.fillRect(cfg.rimX - cfg.rimOuter, cfg.rimY - 4, cfg.rimOuter * 2, 6);
    }

    // net wiggle overlay (a few animated lines beneath rim)
    if (s.netWiggleT > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 2.2;
      const t = performance.now() / 80;
      for (let i = -3; i <= 3; i++) {
        const x = cfg.rimX + i * 9;
        const wiggle = Math.sin(t + i) * 5 * s.netWiggleT;
        ctx.beginPath();
        ctx.moveTo(x, cfg.rimY + 8);
        ctx.quadraticCurveTo(x + wiggle, cfg.rimY + 30, x + wiggle * 0.3, cfg.rimY + 58);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawCharacter(ctx: CanvasRenderingContext2D, s: typeof stateRef.current) {
    const img = s.imgs.char;
    const cfg = s.cfg;
    if (!img) return;
    // draw character with feet at releaseY + 80 (floor)
    const targetH = 280;
    const aspect = img.naturalWidth / img.naturalHeight;
    const targetW = targetH * aspect;
    const cx = cfg.releaseX - targetW * 0.15;
    const floorY = cfg.releaseY + 120;

    ctx.save();
    // subtle crouch/release frame transforms
    let scaleY = 1;
    let skewX = 0;
    if (s.characterFrame === 1) {
      // crouch
      scaleY = 0.92;
    } else if (s.characterFrame === 2) {
      // release (arm extended already in sprite)
      scaleY = 1.04;
      skewX = -0.04;
    }
    ctx.translate(cx, floorY);
    ctx.transform(1, 0, skewX, scaleY, 0, 0);
    ctx.drawImage(img, -targetW / 2, -targetH, targetW, targetH);
    ctx.restore();
  }

  function drawBall(ctx: CanvasRenderingContext2D, s: typeof stateRef.current) {
    const b = s.ball;
    const img = s.imgs.ball;
    const size = 52;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rotation);
    if (img) {
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = "#e07b1b";
      ctx.beginPath();
      ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawTrajectory(
    ctx: CanvasRenderingContext2D,
    cfg: ReturnType<typeof getShotConfig>,
    v: number,
  ) {
    ctx.save();
    ctx.setLineDash([8, 10]);
    ctx.strokeStyle = "rgba(255, 216, 74, 0.7)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    const cos = Math.cos(cfg.angle);
    const sin = Math.sin(cfg.angle);
    for (let t = 0; t < 2.4; t += 0.05) {
      const x = cfg.releaseX + v * cos * t;
      const y = cfg.releaseY - v * sin * t + 0.5 * cfg.gravity * t * t;
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      if (y > LOGICAL_H || x > LOGICAL_W + 40) break;
    }
    ctx.stroke();
    ctx.restore();
  }

  // input handlers
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const s = stateRef.current;
    if (s.phase === "flying") return;
    if (s.phase === "resolved") {
      // tap to shoot again
      resetBall();
      return;
    }
    s.charging = true;
    s.chargeStart = performance.now();
    s.phase = "charging";
    setPhase("charging");
    s.characterFrame = 1;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    e.preventDefault();
    const s = stateRef.current;
    if (!s.charging) return;
    const p = currentPower(performance.now());
    s.charging = false;
    s.releasePower = p;
    setPowerPct(p);
    s.characterFrame = 2;
    setMeterShake(Date.now());
    launch(p);
  };

  function launch(power: number) {
    const s = stateRef.current;
    const cfg = s.cfg;
    const outcome = classifyOutcome(power);
    s.pendingOutcome = outcome as Outcome;
    s.outcome = null;
    const v = powerToVelocity(power, cfg);

    s.ball = {
      x: cfg.releaseX,
      y: cfg.releaseY,
      vx: v * Math.cos(cfg.angle),
      vy: -v * Math.sin(cfg.angle),
      rotation: 0,
      rotationSpeed: -14,
    };
    s.phase = "flying";
    setPhase("flying");
    playRelease();
  }

  const perfectLow = 65;
  const perfectHigh = 75;

  return (
    <div ref={containerRef} className="fixed inset-0 flex items-center justify-center bg-black">
      <div className="relative w-full h-full flex items-center justify-center">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={(e) => {
            const s = stateRef.current;
            if (s.charging) onPointerUp(e);
          }}
          style={{ touchAction: "none" }}
        />
        {/* HUD overlay */}
        <div className="pointer-events-none absolute inset-0 flex flex-col">
          <div className="flex justify-between items-start p-3 gap-3">
            <div className="pointer-events-auto flex gap-2">
              <button
                onClick={onExit}
                className="btn-arcade bg-yellow-400 text-black rounded-xl px-4 py-2 text-sm font-black"
              >
                ← MENU
              </button>
              <button
                onClick={onChangeShot}
                className="btn-arcade bg-blue-500 text-white rounded-xl px-4 py-2 text-sm font-black"
              >
                SHOT: {shotKind === "free-throw" ? "FT" : "3PT"}
              </button>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div
                className="arcade-text arcade-stroke text-white text-4xl md:text-5xl font-black leading-none"
                style={{ color: "#ffd84a" }}
              >
                {score}
              </div>
              <div className="text-xs font-black text-white/90 arcade-stroke">
                HIGH: {Math.max(highScore, score)}
              </div>
              {streak >= 3 && (
                <div className="anim-pop arcade-text text-orange-400 text-2xl font-black">
                  🔥 STREAK: {streak}
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 flex items-center justify-end pr-4">
            {/* power meter */}
            <div
              className="pointer-events-none relative w-12 md:w-16 h-[55%] bg-black/60 border-4 border-black rounded-xl overflow-hidden"
              key={meterShake}
            >
              {/* perfect zone highlight */}
              <div
                className="absolute left-0 right-0 bg-green-400/30 border-y-2 border-green-300"
                style={{
                  bottom: `${perfectLow}%`,
                  height: `${perfectHigh - perfectLow}%`,
                }}
              />
              {/* fill */}
              <div
                className="absolute bottom-0 left-0 right-0 transition-none"
                style={{
                  height: `${powerPct}%`,
                  background: powerPct >= perfectLow && powerPct <= perfectHigh
                    ? "linear-gradient(to top, #19e65a, #8cff8c)"
                    : "linear-gradient(to top, #ff8a00, #ffd84a)",
                }}
              />
              <div className="absolute inset-x-0 top-1 text-center text-white text-[10px] md:text-xs font-black">
                PWR
              </div>
            </div>
          </div>

          {/* instructions / banner */}
          <div className="flex justify-center pb-6">
            {phase === "idle" && (
              <div className="anim-pulse bg-black/70 text-white rounded-2xl px-6 py-3 text-lg md:text-2xl font-black arcade-stroke">
                HOLD to charge · RELEASE to shoot
              </div>
            )}
            {phase === "charging" && (
              <div className="bg-black/70 text-yellow-300 rounded-2xl px-6 py-3 text-lg md:text-2xl font-black arcade-stroke">
                AIM FOR THE GREEN ZONE
              </div>
            )}
          </div>

          {/* Outcome banner */}
          {banner && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="anim-pop">
                <OutcomeBanner outcome={banner} shotKind={shotKind} />
              </div>
            </div>
          )}

          {phase === "resolved" && (
            <div className="absolute bottom-20 left-0 right-0 flex justify-center pointer-events-auto">
              <button
                onClick={() => resetBall()}
                className="btn-arcade bg-orange-500 text-white rounded-2xl px-8 py-4 text-2xl md:text-3xl font-black arcade-stroke"
              >
                SHOOT AGAIN
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OutcomeBanner({
  outcome,
  shotKind,
}: {
  outcome: Outcome;
  shotKind: ShotKind;
}) {
  const isMake = outcome === "swish" || outcome === "rim-in";
  const color = isMake ? "#19e65a" : "#ff3b3b";
  const text =
    outcome === "swish"
      ? shotKind === "three-pointer"
        ? "SPLASH! +3"
        : "SWISH! +1"
      : outcome === "rim-in"
        ? "LUCKY!"
        : outcome === "rim-out"
          ? "SO CLOSE!"
          : "AIR BALL!";
  return (
    <div
      className="arcade-text arcade-stroke text-7xl md:text-9xl font-black"
      style={{ color, textShadow: "6px 6px 0 #000, -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000" }}
    >
      {text}
    </div>
  );
}
