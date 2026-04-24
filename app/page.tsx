"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { characters, getCharacter, type Character } from "../data/characters";
import { isMuted, primeAudio, setMuted, startMusic } from "../lib/sounds";
import type { ShotKind } from "../lib/physics";
import { getHighScore } from "../lib/scoring";

const Game = dynamic(() => import("../components/Game"), { ssr: false });

type Screen = "title" | "character" | "shot" | "play";

export default function Home() {
  const [screen, setScreen] = useState<Screen>("title");
  const [characterId, setCharacterId] = useState<string>(characters[0].id);
  const [shotKind, setShotKind] = useState<ShotKind>("free-throw");
  const [muted, setMutedState] = useState(false);

  function toggleMute() {
    const next = !muted;
    setMutedState(next);
    setMuted(next);
  }

  function start() {
    primeAudio();
    if (!isMuted()) startMusic();
    setScreen("character");
  }

  return (
    <div className="w-full h-full">
      {screen === "title" && <Title onPlay={start} muted={muted} onToggleMute={toggleMute} />}
      {screen === "character" && (
        <CharacterSelect
          onPick={(c) => {
            setCharacterId(c.id);
            setScreen("shot");
          }}
          onBack={() => setScreen("title")}
        />
      )}
      {screen === "shot" && (
        <ShotSelect
          character={getCharacter(characterId)}
          onPick={(s) => {
            setShotKind(s);
            setScreen("play");
          }}
          onBack={() => setScreen("character")}
        />
      )}
      {screen === "play" && (
        <Game
          character={getCharacter(characterId)}
          shotKind={shotKind}
          onExit={() => setScreen("title")}
          onChangeShot={() => setScreen("shot")}
        />
      )}
      {/* persistent mute button */}
      <button
        aria-label={muted ? "Unmute" : "Mute"}
        onClick={toggleMute}
        className="fixed top-2 right-2 z-50 bg-black/70 text-white rounded-full w-12 h-12 flex items-center justify-center text-2xl border-4 border-black"
      >
        {muted ? "🔇" : "🔊"}
      </button>
    </div>
  );
}

function Title({
  onPlay,
  muted,
  onToggleMute,
}: {
  onPlay: () => void;
  muted: boolean;
  onToggleMute: () => void;
}) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-8 p-6 overflow-hidden">
      {/* bouncing basketballs background */}
      <BasketballBackground />
      <div className="relative z-10 flex flex-col items-center gap-4 text-center">
        <div className="flex items-center justify-center gap-3">
          <img
            src="/basketball.png"
            alt=""
            className="w-16 h-16 md:w-24 md:h-24 anim-spin"
          />
          <h1
            className="arcade-text arcade-stroke text-6xl md:text-9xl font-black"
            style={{
              color: "#ffd84a",
              textShadow:
                "6px 6px 0 #000, -4px -4px 0 #000, 4px -4px 0 #000, -4px 4px 0 #000, 0 0 40px rgba(255,138,0,0.8)",
            }}
          >
            CURRY TIME
          </h1>
          <img
            src="/basketball.png"
            alt=""
            className="w-16 h-16 md:w-24 md:h-24 anim-spin"
          />
        </div>
        <p className="text-white text-2xl md:text-4xl font-black arcade-stroke">
          ARCADE HOOPS
        </p>
      </div>

      <button
        onClick={onPlay}
        className="relative z-10 btn-arcade bg-orange-500 text-white rounded-3xl px-16 py-8 text-4xl md:text-6xl font-black arcade-stroke anim-pulse"
      >
        ▶ PLAY
      </button>

      <p className="relative z-10 text-white/80 text-sm md:text-lg font-bold text-center max-w-md">
        Hold the screen to charge your shot. Release in the green zone for a SWISH!
      </p>
    </div>
  );
}

function CharacterSelect({
  onPick,
  onBack,
}: {
  onPick: (c: Character) => void;
  onBack: () => void;
}) {
  return (
    <div className="fixed inset-0 flex flex-col items-center p-4 md:p-8 gap-4 overflow-auto">
      <div className="w-full flex items-center justify-between">
        <button
          onClick={onBack}
          className="btn-arcade bg-yellow-400 text-black rounded-xl px-5 py-3 text-base font-black"
        >
          ← BACK
        </button>
        <h2 className="arcade-text arcade-stroke text-3xl md:text-5xl font-black text-white">
          PICK YOUR BALLER
        </h2>
        <div className="w-20" />
      </div>

      <div className="flex-1 w-full flex flex-col md:flex-row items-center justify-center gap-4 md:gap-6 flex-wrap">
        {characters.map((c) => (
          <CharacterCard key={c.id} character={c} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function CharacterCard({
  character: c,
  onPick,
}: {
  character: Character;
  onPick: (c: Character) => void;
}) {
  const hi = typeof window !== "undefined" ? getHighScore(c.id) : 0;
  return (
    <button
      onClick={() => onPick(c)}
      className="btn-arcade rounded-3xl p-4 md:p-6 flex flex-col items-center gap-2 min-w-[220px] max-w-[280px] w-full md:w-auto"
      style={{
        background: `linear-gradient(160deg, ${c.accent}, #0a0a2a)`,
      }}
    >
      <div className="w-40 h-40 md:w-52 md:h-52 rounded-2xl bg-black/30 flex items-center justify-center overflow-hidden">
        <img src={c.sprite} alt={c.name} className="w-full h-full object-contain" />
      </div>
      <div
        className="arcade-text arcade-stroke text-xl md:text-2xl font-black text-white text-center"
      >
        {c.name}
      </div>
      <div className="text-yellow-300 font-black text-sm md:text-base arcade-stroke">
        {c.tagline}
      </div>
      {hi > 0 && (
        <div className="text-white/90 text-xs font-bold">HIGH: {hi}</div>
      )}
    </button>
  );
}

function ShotSelect({
  character,
  onPick,
  onBack,
}: {
  character: Character;
  onPick: (s: ShotKind) => void;
  onBack: () => void;
}) {
  return (
    <div className="fixed inset-0 flex flex-col items-center p-4 md:p-8 gap-6 overflow-auto">
      <div className="w-full flex items-center justify-between">
        <button
          onClick={onBack}
          className="btn-arcade bg-yellow-400 text-black rounded-xl px-5 py-3 text-base font-black"
        >
          ← BACK
        </button>
        <h2 className="arcade-text arcade-stroke text-3xl md:text-5xl font-black text-white">
          PICK YOUR SHOT
        </h2>
        <div className="w-20" />
      </div>

      <div className="flex items-center gap-3">
        <img
          src={character.sprite}
          alt={character.name}
          className="w-24 h-24 md:w-32 md:h-32 object-contain"
        />
        <div>
          <div className="arcade-stroke text-white text-xl md:text-3xl font-black">
            {character.name}
          </div>
          <div className="text-yellow-300 font-black text-sm md:text-lg">
            {character.tagline}
          </div>
        </div>
      </div>

      <div className="flex-1 w-full flex flex-col md:flex-row gap-6 items-center justify-center">
        <button
          data-shot="free-throw"
          onClick={() => onPick("free-throw")}
          className="btn-arcade bg-gradient-to-br from-blue-400 to-blue-700 text-white rounded-3xl p-8 md:p-12 min-w-[260px] min-h-[200px] flex flex-col items-center justify-center gap-3"
        >
          <div className="text-5xl md:text-7xl">🏀</div>
          <div className="arcade-text arcade-stroke text-3xl md:text-5xl font-black">
            FREE THROW
          </div>
          <div className="text-yellow-300 font-black arcade-stroke text-xl md:text-2xl">
            +1 POINT
          </div>
        </button>
        <button
          data-shot="three-pointer"
          onClick={() => onPick("three-pointer")}
          className="btn-arcade bg-gradient-to-br from-purple-500 to-red-600 text-white rounded-3xl p-8 md:p-12 min-w-[260px] min-h-[200px] flex flex-col items-center justify-center gap-3"
        >
          <div className="text-5xl md:text-7xl">🎯</div>
          <div className="arcade-text arcade-stroke text-3xl md:text-5xl font-black">
            THREE POINTER
          </div>
          <div className="text-yellow-300 font-black arcade-stroke text-xl md:text-2xl">
            +3 POINTS
          </div>
        </button>
      </div>
    </div>
  );
}

function BasketballBackground() {
  // decorative floating balls
  const balls = Array.from({ length: 8 }, (_, i) => i);
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {balls.map((i) => (
        <img
          key={i}
          src="/basketball.png"
          alt=""
          className="absolute anim-spin opacity-20"
          style={{
            top: `${(i * 13 + 5) % 90}%`,
            left: `${(i * 27 + 10) % 90}%`,
            width: `${40 + (i % 3) * 20}px`,
            height: `${40 + (i % 3) * 20}px`,
            animationDuration: `${2 + (i % 4)}s`,
          }}
        />
      ))}
    </div>
  );
}
