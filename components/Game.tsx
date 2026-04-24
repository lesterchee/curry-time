"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Character } from "../data/characters";
import {
  classifyRimCrossing,
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
const FLOOR_Y = 515;

type Phase = "charging" | "flying" | "resolved" | "idle";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
};

type Trim = { sx: number; sy: number; sw: number; sh: number };

function trimAlpha(img: HTMLImageElement): Trim {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cx = c.getContext("2d");
  if (!cx) return { sx: 0, sy: 0, sw: w, sh: h };
  cx.drawImage(img, 0, 0);
  let data: Uint8ClampedArray;
  try {
    data = cx.getImageData(0, 0, w, h).data;
  } catch {
    return { sx: 0, sy: 0, sw: w, sh: h };
  }
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { sx: 0, sy: 0, sw: w, sh: h };
  // add a small safety border
  minX = Math.max(0, minX - 1);
  minY = Math.max(0, minY - 1);
  maxX = Math.min(w - 1, maxX + 1);
  maxY = Math.min(h - 1, maxY + 1);
  return { sx: minX, sy: minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
}

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
    rimCrossed: false,
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
    trims: {
      ball: null as Trim | null,
      hoop: null as Trim | null,
      char: null as Trim | null,
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
      s.trims = {
        ball: trimAlpha(ball),
        hoop: trimAlpha(hoop),
        char: trimAlpha(char),
      };
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
    s.pendingOutcome = null;
    s.resolvedPending = false;
    s.rimCrossed = false;
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
      const prevY = b.y;
      b.vy += cfg.gravity * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rotation += b.rotationSpeed * dt;

      // Detect the single descending crossing of the rim plane. This is the
      // only place we classify hit/miss — outcome is entirely a function of
      // trajectory, not of the release power bucket.
      if (
        !s.rimCrossed &&
        b.vy > 0 &&
        prevY < cfg.rimY &&
        b.y >= cfg.rimY
      ) {
        s.rimCrossed = true;
        const hit = classifyRimCrossing(b.x, cfg);
        applyRimHit(s, hit);
      }

      // ball out of bounds = finalize outcome
      if (b.y > LOGICAL_H + 40 || b.x < -40 || b.x > LOGICAL_W + 80) {
        if (!s.outcome) {
          // If we never crossed the rim plane (too short / too high), it's an air ball.
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

    // character first (behind ball)
    drawCharacter(ctx, s);
    // ball
    drawBall(ctx, s);
    // hoop drawn AFTER ball so the rim + net occlude the ball as it passes
    // through → ball visibly drops behind the rim ring and net ropes
    drawHoop(ctx, s);
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
    const img = s.imgs.hoop;
    const trim = s.trims.hoop;
    const shake = s.rimShakeT > 0 ? (Math.random() - 0.5) * 8 : 0;
    if (img && trim) {
      // New hoop art: backboard on right, rim opening on left (facing shooter).
      // Rim ring in the trimmed image is at approximately (0.33, 0.50).
      const targetH = 210;
      const aspect = trim.sw / trim.sh;
      const targetW = targetH * aspect;
      const rimFracX = 0.33;
      const rimFracY = 0.5;
      const drawX = cfg.rimX - targetW * rimFracX;
      const drawY = cfg.rimY - targetH * rimFracY;
      ctx.save();
      ctx.translate(shake, shake * 0.4);
      ctx.drawImage(
        img,
        trim.sx,
        trim.sy,
        trim.sw,
        trim.sh,
        drawX,
        drawY,
        targetW,
        targetH,
      );
      ctx.restore();
    } else {
      ctx.fillStyle = "#b02020";
      ctx.fillRect(cfg.rimX - cfg.rimOuter, cfg.rimY - 4, cfg.rimOuter * 2, 6);
    }

    // net wiggle overlay (a few animated lines beneath rim)
    if (s.netWiggleT > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 2;
      const t = performance.now() / 80;
      for (let i = -2; i <= 2; i++) {
        const x = cfg.rimX + i * 6;
        const wiggle = Math.sin(t + i) * 4 * s.netWiggleT;
        ctx.beginPath();
        ctx.moveTo(x, cfg.rimY + 8);
        ctx.quadraticCurveTo(
          x + wiggle,
          cfg.rimY + 22,
          x + wiggle * 0.3,
          cfg.rimY + 40,
        );
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawCharacter(ctx: CanvasRenderingContext2D, s: typeof stateRef.current) {
    const img = s.imgs.char;
    const trim = s.trims.char;
    const cfg = s.cfg;
    if (!img || !trim) return;

    const targetH = 220;
    const aspect = trim.sw / trim.sh;
    const targetW = targetH * aspect;

    // All three character sprites have their ball-hand at roughly
    // (0.22, 0.10) of the trimmed bbox. Position the sprite so this
    // hand anchor lands at (releaseX, releaseY). Then the physics ball
    // drawn at release position lines up with the hand exactly.
    const handFracX = 0.22;
    const handFracY = 0.1;
    const spriteLeft = cfg.releaseX - handFracX * targetW;
    const spriteTop = cfg.releaseY - handFracY * targetH;
    const feetY = spriteTop + targetH;
    const centerX = spriteLeft + targetW / 2;

    // floor drop shadow — sits just below feet
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(centerX, feetY + 6, targetW * 0.38, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    let scaleY = 1;
    let skewX = 0;
    if (s.characterFrame === 1) {
      scaleY = 0.94;
    } else if (s.characterFrame === 2) {
      scaleY = 1.03;
      skewX = -0.03;
    }
    ctx.translate(centerX, feetY);
    ctx.transform(1, 0, skewX, scaleY, 0, 0);
    ctx.drawImage(
      img,
      trim.sx,
      trim.sy,
      trim.sw,
      trim.sh,
      -targetW / 2,
      -targetH,
      targetW,
      targetH,
    );
    ctx.restore();
  }

  function drawBall(ctx: CanvasRenderingContext2D, s: typeof stateRef.current) {
    const b = s.ball;
    const img = s.imgs.ball;
    const trim = s.trims.ball;
    const size = 46;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rotation);
    if (img && trim) {
      ctx.drawImage(
        img,
        trim.sx,
        trim.sy,
        trim.sw,
        trim.sh,
        -size / 2,
        -size / 2,
        size,
        size,
      );
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
    const v = powerToVelocity(power, cfg);

    s.pendingOutcome = null;
    s.outcome = null;
    s.resolvedPending = false;
    s.rimCrossed = false;

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

  function applyRimHit(
    s: typeof stateRef.current,
    hit: ReturnType<typeof classifyRimCrossing>,
  ) {
    const cfg = s.cfg;
    const b = s.ball;
    if (hit.kind === "swish") {
      s.pendingOutcome = "swish";
      // mild center snap + damp vx so ball drops cleanly through the net
      const dx = cfg.rimX - b.x;
      b.x += dx * 0.5;
      b.vx *= 0.25;
      s.netWiggleT = 0.65;
      playNetSwish();
      return;
    }
    if (hit.kind === "rim-in") {
      s.pendingOutcome = "rim-in";
      // ball rattles on rim then drops through
      b.x = cfg.rimX;
      b.vx = 0;
      b.vy = Math.max(Math.abs(b.vy) * 0.3, 80);
      s.netWiggleT = 0.5;
      s.rimShakeT = 0.25;
      playRimClang();
      return;
    }
    if (hit.kind === "rim-out") {
      s.pendingOutcome = "rim-out";
      s.rimShakeT = 0.3;
      playRimClang();
      if (hit.side === "back" || hit.side === "backboard") {
        // bounce back toward the shooter
        b.vx = -Math.abs(b.vx) * 0.55 - 80;
        b.vy = -Math.abs(b.vy) * 0.4;
      } else {
        // front rim — ball deflects forward with reduced speed
        b.vx = Math.abs(b.vx) * 0.35 + 20;
        b.vy = -Math.abs(b.vy) * 0.45;
      }
      return;
    }
    // short — never touched rim ring; leave as air-ball, let physics run out
    s.pendingOutcome = "air-ball";
  }

  const perfectLow = 65;
  const perfectHigh = 75;

  return (
    <div ref={containerRef} className="fixed inset-0 flex items-center justify-center bg-black">
      <div className="relative w-full h-full flex items-center justify-center">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full block"
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
        <div className="pointer-events-none absolute inset-0">
          {/* Top-left control cluster */}
          <div className="absolute top-3 left-3 flex gap-2 pointer-events-auto z-20">
            <button
              onClick={onExit}
              className="btn-arcade bg-yellow-400 text-black rounded-2xl px-4 py-3 text-base md:text-lg font-black"
            >
              ← MENU
            </button>
            <button
              onClick={onChangeShot}
              className="btn-arcade bg-blue-500 text-white rounded-2xl px-4 py-3 text-base md:text-lg font-black"
            >
              {shotKind === "free-throw" ? "FT · 1PT" : "3PT · 3PT"}
            </button>
          </div>

          {/* Top-center scoreboard plate */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex flex-col items-center z-20">
            <div className="btn-arcade bg-black/85 border-4 border-black rounded-2xl px-5 py-2 flex items-center gap-4">
              <div
                className="arcade-text arcade-stroke text-4xl md:text-5xl font-black leading-none"
                style={{ color: "#ffd84a" }}
              >
                {score}
              </div>
              <div className="flex flex-col items-start leading-none gap-0.5">
                <span className="text-[10px] md:text-xs font-black text-white/70 tracking-widest">
                  HIGH
                </span>
                <span className="text-base md:text-lg font-black text-white arcade-stroke">
                  {Math.max(highScore, score)}
                </span>
              </div>
            </div>
            {streak >= 3 && (
              <div className="anim-pop arcade-text text-orange-400 text-xl md:text-2xl font-black mt-2 arcade-stroke">
                🔥 STREAK: {streak}
              </div>
            )}
          </div>

          {/* Power meter — absolute right side, always on-screen */}
          <div
            className="absolute right-4 top-1/2 -translate-y-1/2 w-[72px] md:w-20 h-[55%] bg-black/80 border-4 border-black rounded-2xl overflow-hidden z-10 flex flex-col"
            key={meterShake}
          >
            <div className="pt-2 pb-1 text-center text-white text-xs md:text-sm font-black arcade-stroke border-b-2 border-white/20">
              PWR
            </div>
            <div className="relative flex-1">
              <div
                className="absolute left-0 right-0 bg-green-400/40 border-y-2 border-green-300"
                style={{
                  bottom: `${perfectLow}%`,
                  height: `${perfectHigh - perfectLow}%`,
                }}
              />
              <div
                className="absolute bottom-0 left-0 right-0 transition-none"
                style={{
                  height: `${powerPct}%`,
                  background:
                    powerPct >= perfectLow && powerPct <= perfectHigh
                      ? "linear-gradient(to top, #19e65a, #8cff8c)"
                      : "linear-gradient(to top, #ff8a00, #ffd84a)",
                }}
              />
            </div>
          </div>

          {/* Instructions / status strip */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10">
            {phase === "idle" && (
              <div className="anim-pulse bg-black/80 text-white rounded-2xl px-5 py-3 text-base md:text-xl font-black arcade-stroke border-4 border-black">
                HOLD to charge · RELEASE to shoot
              </div>
            )}
            {phase === "charging" && (
              <div className="bg-black/80 text-yellow-300 rounded-2xl px-5 py-3 text-base md:text-xl font-black arcade-stroke border-4 border-black">
                AIM FOR THE GREEN ZONE
              </div>
            )}
          </div>

          {/* SHOOT AGAIN button */}
          {phase === "resolved" && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 pointer-events-auto z-30">
              <button
                onClick={() => resetBall()}
                className="btn-arcade bg-orange-500 text-white rounded-2xl px-8 py-4 text-2xl md:text-3xl font-black arcade-stroke"
              >
                SHOOT AGAIN
              </button>
            </div>
          )}

          {/* Outcome banner — z-40 so it's on top of character/hoop/ball */}
          {banner && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
              <div className="anim-pop">
                <OutcomeBanner outcome={banner} shotKind={shotKind} />
              </div>
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
      className="arcade-text arcade-stroke text-5xl sm:text-6xl md:text-8xl font-black text-center px-4"
      style={{ color, textShadow: "6px 6px 0 #000, -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000" }}
    >
      {text}
    </div>
  );
}
