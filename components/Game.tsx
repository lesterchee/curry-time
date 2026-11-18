"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
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
const PERFECT_LOW = 65;
const PERFECT_HIGH = 75;

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
  soundControl: ReactNode;
  onExit: () => void;
  onChangeShot: () => void;
};

export default function Game({ character, shotKind, soundControl, onExit, onChangeShot }: Props) {
  const gameRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<number | "keyboard" | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number>(0);

  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [highScore, setHighScore] = useState(() => getHighScore(character.id));
  const cfg = getShotConfig(shotKind);
  const [phase, setPhase] = useState<Phase>("idle");
  const [banner, setBanner] = useState<Outcome | null>(null);
  const [powerPct, setPowerPct] = useState(0);
  const [newBest, setNewBest] = useState(false);

  // refs for the game loop (avoid stale closures)
  const stateRef = useRef({
    phase: "idle" as Phase,
    charging: false,
    chargeStart: 0,
    ball: { x: cfg.releaseX, y: cfg.releaseY, vx: 0, vy: 0, rotation: 0, rotationSpeed: 0 },
    outcome: null as Outcome | null,
    pendingOutcome: null as Outcome | null,
    rimCrossed: false,
    particles: [] as Particle[],
    trail: [] as { x: number; y: number }[],
    score: 0,
    best: highScore,
    reduceMotion: false,
    portrait: false,
    spriteScaleX: 1,
    spriteScaleY: 1,
    netWiggleT: 0,
    rimShakeT: 0,
    cfg,
    characterFrame: 0, // 0 idle, 1 crouch, 2 release
    imgs: {
      court: null as HTMLImageElement | null,
      ball: null as HTMLImageElement | null,
      hoop: null as HTMLImageElement | null,
      char: null as HTMLImageElement | null,
    },
    lastTickSoundT: 0,
  });

  useEffect(() => {
    const s = stateRef.current;
    const sources = {
      court: "/arcade/night-court.webp",
      ball: "/arcade/ball.webp",
      hoop: "/arcade/hoop.webp",
      char: character.sprite,
    } as const;
    const images = (Object.keys(sources) as (keyof typeof sources)[]).map((key) => {
      const img = new window.Image();
      img.onload = () => { s.imgs[key] = img; };
      img.src = sources[key];
      return img;
    });
    return () => images.forEach((img) => { img.onload = null; });
  }, [character.sprite]);

  const resetBall = useCallback(() => {
    const s = stateRef.current;
    const cfg = s.cfg;
    inputRef.current = null;
    s.charging = false;
    s.ball = { x: cfg.releaseX, y: cfg.releaseY, vx: 0, vy: 0, rotation: 0, rotationSpeed: 0 };
    s.phase = "idle";
    s.outcome = null;
    s.pendingOutcome = null;
    s.rimCrossed = false;
    s.particles = [];
    s.trail = [];
    s.characterFrame = 0;
    setPhase("idle");
    setBanner(null);
    setPowerPct(0);
    setNewBest(false);
  }, []);

  useEffect(() => {
    gameRef.current?.focus({ preventScroll: true });
  }, []);

  function currentPower(t: number): number {
    // oscillate 0→100→0 over 1.4s cycle
    const s = stateRef.current;
    if (!s.charging) return 0;
    const elapsed = Math.max(0, t - s.chargeStart) / 1000;
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
      if (!s.reduceMotion && !s.rimCrossed) {
        s.trail.push({ x: b.x, y: b.y });
        if (s.trail.length > 12) s.trail.shift();
      } else if (s.trail.length) {
        s.trail.shift();
      }

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
    if (s.particles.length) {
      s.particles = s.particles.flatMap((p) => {
        const life = p.life - dt;
        if (life <= 0) return [];
        const vy = p.vy + 600 * dt;
        return [{ ...p, life, vy, x: p.x + p.vx * dt, y: p.y + vy * dt }];
      });
    }
  }

  function resolveOutcome(outcome: Outcome) {
    const s = stateRef.current;
    s.outcome = outcome;
    s.phase = "resolved";
    setPhase("resolved");
    setBanner(outcome);

    if (outcome === "swish" || outcome === "rim-in") {
      playCheer();
      if (!s.reduceMotion) confettiBurst();
      s.score += s.cfg.points;
      setNewBest(s.score > s.best);
      s.best = Math.max(s.best, updateHighScore(character.id, s.score));
      setScore(s.score);
      setHighScore(s.best);
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
    const colors = ["#d4fb72", "#ffc06e", "#ff9353", "#65b7ff", "#f5f6fb"];
    for (let i = 0; i < 38; i++) {
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
  function draw(ctx: CanvasRenderingContext2D, now: number) {
    const s = stateRef.current;
    const cfg = s.cfg;

    if (s.imgs.court) {
      if (s.portrait) {
        const { width, height } = ctx.canvas;
        const sourceWidth = s.imgs.court.height * width / height;
        ctx.save();
        ctx.resetTransform();
        ctx.drawImage(s.imgs.court, (s.imgs.court.width - sourceWidth) / 2, 0, sourceWidth, s.imgs.court.height, 0, 0, width, height);
        ctx.restore();
      } else {
        ctx.drawImage(s.imgs.court, 0, 0, LOGICAL_W, LOGICAL_H);
      }
    } else {
      ctx.fillStyle = "#101b30";
      ctx.save();
      ctx.resetTransform();
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    }

    if (s.charging) {
      const power = Math.max(currentPower(now), 1);
      drawTrajectory(ctx, cfg, powerToVelocity(power, cfg), power >= PERFECT_LOW && power <= PERFECT_HIGH);
    }

    drawCharacter(ctx, s);
    s.trail.forEach(({ x, y }, index) => {
      const weight = (index + 1) / s.trail.length;
      ctx.fillStyle = `rgba(255, 149, 77, ${weight * 0.22})`;
      ctx.beginPath();
      ctx.ellipse(x, y, weight * 18 * s.spriteScaleX, weight * 18 * s.spriteScaleY, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    drawBall(ctx, s);
    drawHoop(ctx, s, now);

    ctx.save();
    for (const p of s.particles) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      const radius = 2.5 + p.life;
      ctx.ellipse(p.x, p.y, radius * s.spriteScaleX, radius * s.spriteScaleY, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHoop(ctx: CanvasRenderingContext2D, s: typeof stateRef.current, now: number) {
    const cfg = s.cfg;
    const img = s.imgs.hoop;
    const shake = s.rimShakeT > 0 && !s.reduceMotion ? (Math.random() - 0.5) * 8 : 0;
    if (img) {
      // Align the center of the rim artwork to the physics rim.
      const targetH = s.portrait ? 148 : 172;
      const aspect = img.naturalWidth / img.naturalHeight;
      const targetW = targetH * aspect;
      const rimFracX = 0.30;
      const rimFracY = 0.58;
      ctx.save();
      ctx.translate(cfg.rimX + shake, cfg.rimY + shake * 0.4);
      ctx.scale(s.spriteScaleX, s.spriteScaleY);
      ctx.drawImage(
        img,
        -targetW * rimFracX,
        -targetH * rimFracY,
        targetW,
        targetH,
      );
      ctx.restore();
    } else {
      ctx.fillStyle = "#b02020";
      ctx.fillRect(cfg.rimX - cfg.rimOuter, cfg.rimY - 4, cfg.rimOuter * 2, 6);
    }

    if (s.netWiggleT > 0 && !s.reduceMotion) {
      ctx.save();
      ctx.translate(cfg.rimX, cfg.rimY);
      ctx.scale(s.spriteScaleX, s.spriteScaleY);
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 2;
      const t = now / 80;
      for (let i = -2; i <= 2; i++) {
        const x = i * 6;
        const wiggle = Math.sin(t + i) * 4 * s.netWiggleT;
        ctx.beginPath();
        ctx.moveTo(x, 8);
        ctx.quadraticCurveTo(
          x + wiggle,
          22,
          x + wiggle * 0.3,
          40,
        );
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawCharacter(ctx: CanvasRenderingContext2D, s: typeof stateRef.current) {
    const img = s.imgs.char;
    const cfg = s.cfg;
    if (!img) return;

    const targetH = 220;
    const aspect = img.naturalWidth / img.naturalHeight;
    const targetW = targetH * aspect;

    const [handFracX, handFracY] = character.hand;
    const feetY = cfg.releaseY + (1 - handFracY) * targetH * s.spriteScaleY;
    const centerX = cfg.releaseX + (0.5 - handFracX) * targetW * s.spriteScaleX;

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
    ctx.scale(s.spriteScaleX, s.spriteScaleY);
    ctx.transform(1, 0, skewX, scaleY, 0, 0);
    ctx.drawImage(
      img,
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
    const size = 46;
    ctx.save();
    const crouchOffset = s.charging ? 220 * (1 - character.hand[1]) * 0.06 : 0;
    ctx.translate(b.x, b.y + crouchOffset * s.spriteScaleY);
    ctx.scale(s.spriteScaleX, s.spriteScaleY);
    ctx.rotate(b.rotation);
    if (img) {
      ctx.drawImage(
        img,
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
    perfect: boolean,
  ) {
    ctx.save();
    ctx.setLineDash([3, 12]);
    ctx.lineCap = "round";
    ctx.strokeStyle = perfect ? "#d4fb72" : "#ffd0a0c9";
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

  function startCharge(now: number) {
    const s = stateRef.current;
    if (s.phase === "resolved") {
      resetBall();
      return false;
    }
    if (s.phase !== "idle") return false;
    s.charging = true;
    s.chargeStart = now;
    s.phase = "charging";
    s.characterFrame = 1;
    setPhase("charging");
    return true;
  }

  function releaseCharge(now: number) {
    const s = stateRef.current;
    const power = currentPower(now);
    s.charging = false;
    s.characterFrame = 2;
    setPowerPct(power);
    launch(power);
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement | HTMLButtonElement>) {
    if (event.button !== 0 || inputRef.current !== null) return;
    if (event.currentTarget instanceof HTMLCanvasElement) event.preventDefault();
    if (!startCharge(event.timeStamp)) return;
    inputRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerUp(event: PointerEvent<HTMLCanvasElement | HTMLButtonElement>) {
    if (inputRef.current !== event.pointerId) return;
    inputRef.current = null;
    releaseCharge(event.timeStamp);
  }

  function onPointerCancel(event: PointerEvent<HTMLCanvasElement | HTMLButtonElement>) {
    if (inputRef.current === event.pointerId) resetBall();
  }

  function onShootKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== gameRef.current && !(event.target as HTMLElement).closest(".shoot-button")) return;
    if (event.code !== "Space" && event.code !== "Enter") return;
    event.preventDefault();
    if (event.repeat || inputRef.current !== null) return;
    if (startCharge(event.timeStamp)) inputRef.current = "keyboard";
  }

  function onShootKeyUp(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.code !== "Space" && event.code !== "Enter") || inputRef.current !== "keyboard") return;
    event.preventDefault();
    inputRef.current = null;
    releaseCharge(event.timeStamp);
  }

  const shotInput = { onPointerDown, onPointerUp, onPointerCancel, onLostPointerCapture: onPointerCancel };

  function launch(power: number) {
    const s = stateRef.current;
    const cfg = s.cfg;
    const v = powerToVelocity(power, cfg);

    s.pendingOutcome = null;
    s.outcome = null;
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

  const renderFrame = useEffectEvent((ctx: CanvasRenderingContext2D, dt: number, now: number) => {
    update(dt, now);
    draw(ctx, now);
  });

  // main loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const s = stateRef.current;
    const updateMotion = () => { s.reduceMotion = motion.matches; };
    updateMotion();
    motion.addEventListener("change", updateMotion);

    let lastT = performance.now();
    let running = true;

    function resize() {
      const c = canvasRef.current;
      if (!c) return;
      const container = containerRef.current;
      if (!container) return;
      const { clientWidth, clientHeight } = container;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min(clientWidth / LOGICAL_W, clientHeight / LOGICAL_H);
      s.portrait = clientWidth < clientHeight;
      const w = s.portrait ? clientWidth : Math.floor(LOGICAL_W * scale);
      const h = s.portrait ? clientHeight : Math.floor(LOGICAL_H * scale);
      c.width = Math.max(1, Math.floor(w * dpr));
      c.height = Math.max(1, Math.floor(h * dpr));
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      const xScale = c.width / LOGICAL_W;
      const yScale = c.height / LOGICAL_H;
      // Open up the vertical shot path on portrait screens while keeping the sprites proportional.
      s.spriteScaleX = s.portrait ? 1.2 : 1;
      s.spriteScaleY = s.portrait ? 1.2 * xScale / yScale : 1;
      ctx!.setTransform(xScale, 0, 0, yScale, 0, s.portrait ? c.height * 0.13 : 0);
    }
    resize();
    const observer = new ResizeObserver(resize);
    if (containerRef.current) observer.observe(containerRef.current);

    const tick = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.033, (now - lastT) / 1000);
      lastT = now;
      renderFrame(ctx, dt, now);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      observer.disconnect();
      motion.removeEventListener("change", updateMotion);
    };
  }, []);

  const inZone = powerPct >= PERFECT_LOW && powerPct <= PERFECT_HIGH;
  const modeLabel = shotKind === "free-throw" ? "Free throw" : "Three-pointer";
  const hint = phase === "charging"
    ? inZone ? "Release now!" : "Aim for the green zone"
    : phase === "flying" ? "Ball in flight"
    : phase === "resolved" ? "Ready for another?"
    : "Hold to charge · Release in the green zone";

  return (
    <main
      ref={gameRef}
      className="game-shell"
      tabIndex={-1}
      onKeyDown={onShootKeyDown}
      onKeyUp={onShootKeyUp}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && inputRef.current === "keyboard") resetBall();
      }}
    >
      <header className="game-topbar">
        <div className="game-nav">
          <button className="game-nav-button" onClick={onExit}><span aria-hidden="true">←</span> Menu</button>
          <button className="game-nav-button" aria-label={`Change shot (${modeLabel})`} onClick={onChangeShot}>
            {shotKind === "free-throw" ? "FT · 1 PT" : "3 PT"}
          </button>
        </div>
        <span className="display game-court-name">Night Court</span>
        {soundControl}
      </header>
      <div className="scoreboard" aria-label="Scoreboard">
        <div className="score-player" style={{ "--player-color": character.accent } as CSSProperties}>
          <span className="quick-portrait">
            <Image src={character.sprite} alt="" fill sizes="43px" unoptimized />
          </span>
          <span className="display">{character.name}</span>
        </div>
        <div className="score-numbers">
          <div className="score-stat"><small>Score</small><b className="display" data-score>{score}</b></div>
          <div className="score-stat"><small>Best</small><b className="display" data-best>{highScore}</b></div>
          <div className={`score-stat${streak >= 3 ? " is-heating" : ""}`}>
            <small>Streak</small><b className="display" data-streak>{streak}</b>
          </div>
        </div>
      </div>
      <div className="arena" ref={containerRef}>
        <canvas ref={canvasRef} aria-label="Basketball court" {...shotInput} />
        {banner && <OutcomeBanner outcome={banner} points={shotKind === "free-throw" ? 1 : 3} newBest={newBest} />}
      </div>
      <div className="controls">
        <div>
          <div className="meter-head">
            <span className="meter-label">Shot power</span>
            <output aria-live="off">{powerPct}%</output>
          </div>
          <div
            className="power-track"
            role="meter"
            aria-label="Shot power, aim for 65 to 75 percent"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={powerPct}
          >
            <div className={`power-fill${inZone ? " is-perfect" : ""}`} style={{ width: `${powerPct}%` }} />
            <div className="power-zone" />
            {powerPct > 0 && <div className="power-needle" style={{ left: `${powerPct}%` }} />}
          </div>
          <p className="control-hint" id="shoot-hint">{hint}</p>
        </div>
        <button
          className={`primary-button shoot-button${phase === "charging" ? " is-charging" : ""}`}
          aria-describedby="shoot-hint"
          aria-keyshortcuts="Space Enter"
          aria-disabled={phase === "flying" || undefined}
          {...shotInput}
          onClick={(event) => {
            if (event.detail === 0 && stateRef.current.phase === "resolved") resetBall();
          }}
        >
          {phase === "resolved" ? "Shoot again" : phase === "charging" ? "Release to shoot" : phase === "flying" ? "Shooting…" : "Hold to shoot"}
        </button>
      </div>
    </main>
  );
}

function OutcomeBanner({ outcome, points, newBest }: { outcome: Outcome; points: number; newBest: boolean }) {
  const isMake = outcome === "swish" || outcome === "rim-in";
  const title = {
    swish: points === 3 ? "SPLASH!" : "SWISH!",
    "rim-in": "LUCKY!",
    "rim-out": "SO CLOSE!",
    "air-ball": "AIR BALL!",
  }[outcome];
  const detail = isMake
    ? `+${points} ${points === 1 ? "point" : "points"}${newBest ? " · New best" : ""}`
    : "Try the green zone";

  return (
    <div className="result-wrap" role="status">
      <div className="result-banner" data-made={isMake}>
        <div className="display">{title}</div>
        <p>{detail}</p>
      </div>
    </div>
  );
}
