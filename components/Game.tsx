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
  BALL_RADIUS,
  COURT_HEIGHT,
  COURT_WIDTH,
  FLOOR_Y,
  GREEN_HIGH,
  GREEN_LOW,
  RIM_HALF_WIDTH,
  createFlight,
  getShotConfig,
  shotPowerAt,
  stepFlight,
  type Ball,
  type Flight,
  type Outcome,
  type ShotKind,
} from "../lib/physics";
import {
  playBallBounce,
  playBoo,
  playCheer,
  playNetSwish,
  playRelease,
  playRimClang,
  playTickTock,
} from "../lib/sounds";
import { getHighScore, updateHighScore } from "../lib/scoring";
import { newMatch, recordShot, SHOTS_PER_PLAYER } from "../lib/match";

const INITIAL_LIFT = 12;
const FOLLOW_TIME = 0.75;
const PORTRAIT_COURT_HEIGHT = 1.33;

type PlayerArt = { portrait?: HTMLImageElement; set?: HTMLImageElement; follow?: HTMLImageElement };

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
  opponent?: Character;
  shotKind: ShotKind;
  soundControl: ReactNode;
  onExit: () => void;
  onChangeShot: () => void;
};

export default function Game({ character, opponent, shotKind, soundControl, onExit, onChangeShot }: Props) {
  const gameRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<number | "keyboard" | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number>(0);

  const [match, setMatch] = useState(newMatch);
  const shooter = match.turn === 1 && opponent ? opponent : character;
  const matchOver = Boolean(opponent && match.players[1].shots === SHOTS_PER_PLAYER);
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
    flight: null as Flight | null,
    replayHold: false,
    particles: [] as Particle[],
    trail: [] as { x: number; y: number }[],
    score: 0,
    best: highScore,
    reduceMotion: false,
    portrait: false,

    rimShakeT: 0,
    cfg,
    imgs: {
      court: null as HTMLImageElement | null,
      ball: null as HTMLImageElement | null,
      hoop: null as HTMLImageElement | null,

    },
    art: {} as Record<string, PlayerArt>,
    lastTickSoundT: 0,
  });

  useEffect(() => {
    const s = stateRef.current;
    const images: HTMLImageElement[] = [];
    function load(src: string, onLoad: (image: HTMLImageElement) => void) {
      const img = new window.Image();
      images.push(img);
      img.onload = () => onLoad(img);
      img.src = src;
    }

    load("/arcade/night-court.webp", (img) => { s.imgs.court = img; });
    load("/arcade/ball.webp", (img) => { s.imgs.ball = img; });
    load("/arcade/hoop.webp", (img) => { s.imgs.hoop = img; });
    for (const player of new Set([character, opponent])) {
      if (!player) continue;
      const art: PlayerArt = {};
      s.art[player.id] = art;
      load(player.sprite, (img) => { art.portrait = img; });
      load(`/arcade/shots/${player.shot.art}-set.webp`, (img) => { art.set = img; });
      load(`/arcade/shots/${player.shot.art}-follow.webp`, (img) => { art.follow = img; });
    }
    return () => images.forEach((img) => { img.onload = null; });
  }, [character, opponent]);

  const resetBall = useCallback(() => {
    const s = stateRef.current;
    inputRef.current = null;
    s.charging = false;
    s.flight = null;
    s.phase = "idle";
    s.replayHold = false;
    s.particles = [];
    s.trail = [];
    s.rimShakeT = 0;
    setPhase("idle");
    setBanner(null);
    setPowerPct(0);
    setNewBest(false);
  }, []);

  useEffect(() => {
    gameRef.current?.focus({ preventScroll: true });
  }, []);

  function currentPower(t: number): number {
    const s = stateRef.current;
    return s.charging ? shotPowerAt(t - s.chargeStart) : 0;
  }

  function update(dt: number, nowMs: number) {
    const s = stateRef.current;
    if (s.charging) {
      const p = currentPower(nowMs);
      setPowerPct(p);
      if (nowMs - s.lastTickSoundT > 120) {
        s.lastTickSoundT = nowMs;
        playTickTock();
      }
    }

    const flight = s.flight;
    if (s.phase === "flying" && flight) {
      stepFlight(flight, s.cfg, dt, (event) => {
        if (event === "rim" || event === "board") {
          if (s.rimShakeT < 0.14) playRimClang();
          s.rimShakeT = 0.22;
        } else if (event === "net") {
          playNetSwish();
        } else {
          playBallBounce();
        }
      });

      if (!s.reduceMotion && !flight.inNet && flight.touches === 0 && flight.floorTime === null) {
        s.trail.push({ x: flight.ball.x, y: flight.ball.y });
        if (s.trail.length > 8) s.trail.shift();
      } else if (s.trail.length) {
        s.trail.shift();
      }
      if (flight.outcome) resolveOutcome(flight.outcome);
    }

    s.rimShakeT = Math.max(0, s.rimShakeT - dt);

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
    s.phase = "resolved";
    setPhase("resolved");
    setBanner(outcome);

    const made = outcome === "swish" || outcome === "rim-in";
    if (made) {
      playCheer();
      if (!s.reduceMotion) confettiBurst();
    } else {
      playBoo();
    }

    if (opponent) {
      setMatch((previous) => recordShot(previous, made ? s.cfg.points : 0));
    } else if (made) {
      s.score += s.cfg.points;
      setNewBest(s.score > s.best);
      s.best = Math.max(s.best, updateHighScore(character.id, s.score));
      setScore(s.score);
      setHighScore(s.best);
      setStreak((x) => x + 1);
    } else {
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
        ctx.drawImage(s.imgs.court, 0, 0, COURT_WIDTH, COURT_HEIGHT);
      }
    } else {
      ctx.fillStyle = "#101b30";
      ctx.save();
      ctx.resetTransform();
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    }

    if (s.charging) {
      const power = currentPower(now);
      drawTrajectory(ctx, cfg, power, power >= GREEN_LOW && power <= GREEN_HIGH);
    }

    drawHoop(ctx, s, now);
    const hand = drawCharacter(ctx, s);
    const ballAspect = s.portrait ? 1 / PORTRAIT_COURT_HEIGHT : 1;
    s.trail.forEach(({ x, y }, index) => {
      const weight = (index + 1) / s.trail.length;
      ctx.fillStyle = `rgba(255, 149, 77, ${weight * 0.15})`;
      ctx.beginPath();
      const radius = weight * BALL_RADIUS * 0.7;
      ctx.ellipse(x, y, radius, radius * ballAspect, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    if (s.phase === "flying" && s.flight) {
      const { ball, inNet } = s.flight;
      drawBall(ctx, ball, s.imgs.ball, ballAspect);
      if (inNet && ball.y - BALL_RADIUS < cfg.rimY + 67) drawHoop(ctx, s, now, true);
    } else if (s.phase !== "resolved") {
      drawBall(ctx, hand, s.imgs.ball, ballAspect);
    }

    ctx.save();
    for (const p of s.particles) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      const radius = 2.5 + p.life;
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHoop(ctx: CanvasRenderingContext2D, s: typeof stateRef.current, now: number, frontNet = false) {
    const { rimX, rimY } = s.cfg;
    const img = s.imgs.hoop;
    if (!img) {
      if (!frontNet) {
        ctx.fillStyle = "#f18544";
        ctx.fillRect(rimX - RIM_HALF_WIDTH, rimY, RIM_HALF_WIDTH * 2, 4);
      }
      return;
    }

    const shake = s.reduceMotion ? 0 : Math.sin(now * 0.07) * s.rimShakeT * 12;
    const height = 172;
    const width = height * img.naturalWidth / img.naturalHeight;
    ctx.save();
    ctx.translate(rimX + shake, rimY);
    if (frontNet) {
      // Only the near lip and the front net strands cover the ball during a make.
      ctx.beginPath();
      ctx.moveTo(-57, 5);
      ctx.quadraticCurveTo(0, 19, 57, 5);
      ctx.lineTo(23, 69);
      ctx.lineTo(-27, 69);
      ctx.closePath();
      ctx.clip();
    }
    ctx.drawImage(img, -width * 0.3, -height * 0.58, width, height);
    ctx.restore();
  }

  function drawCharacter(ctx: CanvasRenderingContext2D, s: typeof stateRef.current): Pick<Ball, "x" | "y" | "rotation"> {
    const { releaseX, releaseY } = s.cfg;
    const art = s.art[shooter.id];
    if (!art?.portrait && !art?.set && !art?.follow) return { x: releaseX, y: releaseY, rotation: 0 };

    const follow = art?.follow;
    const elapsed = s.flight?.elapsed ?? 0;
    const isFollowing = Boolean(follow && s.phase === "flying" && elapsed < FOLLOW_TIME);
    const img = (isFollowing ? follow : art?.set) ?? art?.portrait ?? follow;
    if (!img) return { x: releaseX, y: releaseY, rotation: 0 };
    const widthScale = s.portrait ? PORTRAIT_COURT_HEIGHT : 1;
    const [releaseHandX, releaseHandY] = follow ? shooter.shot.follow : shooter.hand;
    const releaseHeight = (FLOOR_Y - INITIAL_LIFT - releaseY) / (1 - releaseHandY);
    const releaseWidth = releaseHeight * widthScale * ((follow ?? img).naturalWidth / (follow ?? img).naturalHeight);
    const center = releaseX + releaseWidth * (0.5 - releaseHandX);
    const hand = isFollowing ? shooter.shot.follow : art?.set ? shooter.shot.set : shooter.hand;
    const height = isFollowing
      ? releaseHeight + (s.reduceMotion ? INITIAL_LIFT / (1 - releaseHandY) : 0)
      : releaseHeight * shooter.shot.setScale;
    const width = height * widthScale * img.naturalWidth / img.naturalHeight;
    const rise = elapsed < 0.37 ? Math.max(0, INITIAL_LIFT * (1 - elapsed / 0.37) + 18 * Math.sin(Math.PI * elapsed / 0.37)) : 0;
    const lift = isFollowing && !s.reduceMotion ? rise : 0;
    const crouch = s.charging && !s.reduceMotion ? 3 : 0;
    const drawnHeight = height - crouch;
    const feet = FLOOR_Y - lift;

    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.beginPath();
    ctx.ellipse(center, FLOOR_Y + 3, width * 0.4, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(img, center - width / 2, feet - drawnHeight, width, drawnHeight);
    return { x: center + (hand[0] - 0.5) * width, y: feet - (1 - hand[1]) * drawnHeight, rotation: 0 };
  }

  function drawBall(
    ctx: CanvasRenderingContext2D,
    ball: Pick<Ball, "x" | "y" | "rotation">,
    img: HTMLImageElement | null,
    aspect: number,
  ) {
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.scale(1, aspect);
    ctx.rotate(ball.rotation);
    if (img) {
      ctx.drawImage(img, -BALL_RADIUS, -BALL_RADIUS, BALL_RADIUS * 2, BALL_RADIUS * 2);
    } else {
      ctx.fillStyle = "#e07b1b";
      ctx.beginPath();
      ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawTrajectory(ctx: CanvasRenderingContext2D, cfg: ReturnType<typeof getShotConfig>, power: number, perfect: boolean) {
    const guide = createFlight(cfg, power);
    ctx.save();
    ctx.setLineDash([2, 11]);
    ctx.lineCap = "round";
    ctx.strokeStyle = perfect ? "#d4fb72" : "#ffd0a0c9";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(guide.ball.x, guide.ball.y);
    for (let i = 0; i < 60; i++) {
      stepFlight(guide, cfg, 1 / 30);
      const { x, y } = guide.ball;
      if (guide.touches || guide.inNet || guide.floorTime !== null || x > COURT_WIDTH) break;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function startCharge(now: number) {
    const s = stateRef.current;
    const replay = s.phase === "resolved";
    if (replay && !opponent) resetBall();
    if (s.phase !== "idle") return false;
    s.replayHold = replay;
    s.charging = true;
    s.chargeStart = now;
    s.phase = "charging";
    setPhase("charging");
    return true;
  }

  function releaseCharge(now: number) {
    const s = stateRef.current;
    if (s.replayHold && now - s.chargeStart < 140) {
      resetBall();
      return;
    }
    const power = currentPower(now);
    s.charging = false;
    s.flight = createFlight(s.cfg, power);
    s.phase = "flying";
    setPowerPct(power);
    setPhase("flying");
    playRelease();
  }

  function passOrRematch() {
    if (stateRef.current.phase !== "resolved") return;
    setMatch((previous) => matchOver ? newMatch() : { ...previous, turn: previous.turn === 0 ? 1 : 0 });
    resetBall();
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
    if (opponent && stateRef.current.phase === "resolved") {
      if (event.target === gameRef.current && !event.repeat) {
        event.preventDefault();
        passOrRematch();
      }
      return;
    }
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
      const scale = Math.min(clientWidth / COURT_WIDTH, clientHeight / COURT_HEIGHT);
      s.portrait = clientWidth < clientHeight;
      const w = s.portrait ? clientWidth : Math.floor(COURT_WIDTH * scale);
      const h = s.portrait ? clientHeight : Math.floor(COURT_HEIGHT * scale);
      c.width = Math.max(1, Math.floor(w * dpr));
      c.height = Math.max(1, Math.floor(h * dpr));
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      const xScale = c.width / COURT_WIDTH;
      const yScale = s.portrait ? xScale * PORTRAIT_COURT_HEIGHT : c.height / COURT_HEIGHT;
      const offset = s.portrait ? c.height * 0.87 - FLOOR_Y * yScale : 0;
      ctx!.setTransform(xScale, 0, 0, yScale, 0, offset);
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

  const inZone = powerPct >= GREEN_LOW && powerPct <= GREEN_HIGH;
  const modeLabel = shotKind === "free-throw" ? "Free throw" : "Three-pointer";
  const passing = Boolean(opponent && phase === "resolved");
  const [first, second] = match.players;
  const winner = first.score === second.score ? null : first.score > second.score ? character : opponent;
  const winnerLabel = character.id === opponent?.id ? `Player ${first.score > second.score ? 1 : 2}` : winner?.name;
  const hint = phase === "charging"
    ? inZone ? "Green zone" : "Hold until the meter turns green"
    : phase === "flying" ? "Ball in flight"
    : matchOver ? "Play again with the same players"
    : passing ? `Pass the device to ${match.turn === 0 ? opponent?.name : character.name}`
    : opponent ? `Player ${match.turn + 1} · Shot ${match.players[match.turn].shots + 1} of ${SHOTS_PER_PLAYER}`
    : "Hold, then let go on green";

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
          {opponent ? (
            <span className="game-mode-label">{shotKind === "free-throw" ? "FREE THROWS" : "3-POINTERS"}</span>
          ) : (
            <button className="game-nav-button" aria-label={`Change shot (${modeLabel})`} onClick={onChangeShot}>
              {shotKind === "free-throw" ? "FT · 1 PT" : "3 PT"}
            </button>
          )}
        </div>
        <span className="display game-court-name">Night Court</span>
        {soundControl}
      </header>
      {opponent ? (
        <div className="duel-scoreboard" aria-label="Two-player scoreboard">
          {[character, opponent].map((player, index) => (
            <div
              key={index}
              className="duel-score"
              data-player={index + 1}
              data-turn={!matchOver && index === match.turn}
              aria-current={!matchOver && index === match.turn ? "true" : undefined}
            >
              <div>
                <small>Player {index + 1} · {match.players[index].shots}/{SHOTS_PER_PLAYER} shots</small>
                <span className="display">{player.name}</span>
              </div>
              <b className="display" data-duel-score>{match.players[index].score}</b>
            </div>
          ))}
        </div>
      ) : (
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
      )}
      <div className="arena" ref={containerRef}>
        <canvas ref={canvasRef} aria-label="Basketball court" {...shotInput} />
        {matchOver ? (
          <div className="result-wrap" role="status">
            <div className="result-banner match-result" data-made="true">
              <div className="display">{winner ? `${winnerLabel} wins!` : "Tie game!"}</div>
              <p>Final score · {first.score}–{second.score}</p>
            </div>
          </div>
        ) : banner && <OutcomeBanner outcome={banner} points={shotKind === "free-throw" ? 1 : 3} newBest={newBest} />}
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
            aria-label={`Shot power, aim for ${GREEN_LOW} to ${GREEN_HIGH} percent`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={powerPct}
          >
            <div className={`power-fill${inZone ? " is-perfect" : ""}`} style={{ width: `${powerPct}%` }} />
            <div className="power-zone" style={{ left: `${GREEN_LOW}%`, width: `${GREEN_HIGH - GREEN_LOW}%` }} />
            {powerPct > 0 && <div className="power-needle" style={{ left: `${powerPct}%` }} />}
          </div>
          <p className="control-hint" id="shoot-hint">{hint}</p>
        </div>
        <button
          className={`primary-button shoot-button${phase === "charging" ? inZone ? " is-release-ready" : " is-charging" : ""}`}
          aria-describedby="shoot-hint"
          aria-keyshortcuts="Space Enter"
          aria-disabled={phase === "flying" || undefined}
          {...(!passing ? shotInput : {})}
          onClick={(event) => {
            if (passing) passOrRematch();
            else if (event.detail === 0 && stateRef.current.phase === "resolved") resetBall();
          }}
        >
          {matchOver ? "Rematch" : passing ? "Next player" : phase === "resolved" ? "Shoot again" : phase === "charging" ? inZone ? "Let go now!" : "Keep holding" : phase === "flying" ? "Shooting…" : "Hold to shoot"}
        </button>
      </div>
    </main>
  );
}

function OutcomeBanner({ outcome, points, newBest }: { outcome: Outcome; points: number; newBest: boolean }) {
  const isMake = outcome === "swish" || outcome === "rim-in";
  const title = {
    swish: points === 3 ? "SPLASH!" : "SWISH!",
    "rim-in": "IT DROPS!",
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
