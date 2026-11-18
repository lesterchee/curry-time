"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useState, type CSSProperties } from "react";
import { characters, getCharacter, type Character } from "../data/characters";
import { isMuted, primeAudio, setMuted, startMusic } from "../lib/sounds";
import type { ShotKind } from "../lib/physics";
import { getHighScore } from "../lib/scoring";

const Game = dynamic(() => import("../components/Game"), {
  ssr: false,
  loading: () => <p className="court-loading" role="status">Loading the court…</p>,
});

type Screen = "title" | "character" | "shot" | "play";

export default function Home() {
  const [screen, setScreen] = useState<Screen>("title");
  const [characterId, setCharacterId] = useState(characters[0].id);
  const [shotKind, setShotKind] = useState<ShotKind>("free-throw");
  const [muted, setMutedState] = useState(false);

  function toggleMute() {
    setMuted(!muted);
    setMutedState(!muted);
  }

  function changeScreen(next: Screen) {
    setScreen(next);
    window.scrollTo(0, 0);
  }

  function start(character?: Character) {
    primeAudio();
    if (!isMuted()) startMusic();
    if (character) {
      setCharacterId(character.id);
      changeScreen("shot");
    } else {
      changeScreen("character");
    }
  }

  const sound = (
    <button
      className="sound-toggle"
      aria-label={muted ? "Unmute" : "Mute"}
      onClick={toggleMute}
    >
      <span className={muted ? "sound-bars is-muted" : "sound-bars"} aria-hidden="true">
        <i /><i /><i /><i /><i />
      </span>
      <span>Sound {muted ? "off" : "on"}</span>
    </button>
  );

  if (screen === "play") {
    return (
      <Game
        key={`${characterId}:${shotKind}`}
        character={getCharacter(characterId)}
        shotKind={shotKind}
        soundControl={sound}
        onExit={() => changeScreen("title")}
        onChangeShot={() => changeScreen("shot")}
      />
    );
  }

  return (
    <div className="arcade-shell">
      <header className="site-header">
        <button className="brand" aria-label="Curry Time home" onClick={() => changeScreen("title")}>
          <span className="brand-mark" aria-hidden="true">CT</span>
          <span>CURRY <em>TIME</em></span>
        </button>
        {sound}
      </header>
      {screen === "title" && <Title onPlay={() => start()} onPick={start} />}
      {screen === "character" && <CharacterSelect onPick={start} onBack={() => changeScreen("title")} />}
      {screen === "shot" && (
        <ShotSelect
          character={getCharacter(characterId)}
          onPick={(shot) => {
            setShotKind(shot);
            changeScreen("play");
          }}
          onBack={() => changeScreen("character")}
        />
      )}
    </div>
  );
}

function Title({ onPlay, onPick }: { onPlay: () => void; onPick: (c: Character) => void }) {
  return (
    <main className="title-screen screen-in">
      <section className="hero">
        <div className="hero-art" aria-hidden="true">
          <Image src="/arcade/night-court-cover.webp" alt="" fill preload unoptimized />
        </div>
        <div className="hero-content">
          <p className="eyebrow"><span className="live-dot" /> Night Court Arcade</p>
          <h1 className="display hero-title">CURRY<br /><em>TIME<span>.</span></em></h1>
          <p className="hero-description">Pick your baller. Find your release.<br /> Light up the night court.</p>
          <button className="primary-button hero-play" onClick={onPlay}>
            <span className="play-mark" aria-hidden="true" /> Play now <span className="button-arrow" aria-hidden="true">↗</span>
          </button>
        </div>
      </section>
      <section className="quick-lineup" aria-labelledby="lineup-title">
        <div className="quick-heading">
          <h2 id="lineup-title" className="display">THE LINEUP</h2>
          <span>Pick a player to jump in</span>
        </div>
        <div className="quick-grid">
          {characters.map((character) => (
            <button
              className="quick-player"
              key={character.id}
              style={playerColor(character)}
              onClick={() => onPick(character)}
            >
              <span className="quick-portrait">
                <Image src={character.sprite} alt="" fill sizes="52px" unoptimized />
              </span>
              <span className="quick-name">{character.name}</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

function PlayerHeader({ title, onBack, children }: {
  title: string;
  onBack: () => void;
  children?: React.ReactNode;
}) {
  return (
    <header className="selection-header">
      <button className="back-button" onClick={onBack}><span aria-hidden="true">←</span> Back</button>
      <h1 className="display selection-title">{title}</h1>
      {children}
    </header>
  );
}

function playerColor(character: Character) {
  return { "--player-color": character.accent } as CSSProperties;
}

function CharacterSelect({ onPick, onBack }: { onPick: (c: Character) => void; onBack: () => void }) {
  const [scores] = useState(() => Object.fromEntries(characters.map(({ id }) => [id, getHighScore(id)])));

  return (
    <main className="selection screen-in">
      <PlayerHeader title="PICK YOUR BALLER" onBack={onBack} />
      <div className="player-grid">
        {characters.map((character) => (
          <button
            key={character.id}
            className="player-card"
            style={playerColor(character)}
            onClick={() => onPick(character)}
          >
            <span className="player-art">
              <span className="player-halo" aria-hidden="true" />
              <Image src={character.sprite} alt="" fill sizes="(max-width: 620px) 43vw, 300px" unoptimized />
            </span>
            <span className="player-info">
              <span className="player-tag">{character.tagline}</span>
              <span className="display player-name">{character.name}</span>
              <span className="player-best">Best <strong>{scores[character.id] ?? 0}</strong></span>
              <span aria-hidden="true" className="player-arrow">↗</span>
            </span>
          </button>
        ))}
      </div>
    </main>
  );
}

const shots = [
  { id: "free-throw", label: "Free throw", points: 1, description: "Step up to the line." },
  { id: "three-pointer", label: "Three-pointer", points: 3, description: "Take it from downtown." },
] as const;

function ShotSelect({ character, onPick, onBack }: {
  character: Character;
  onPick: (shot: ShotKind) => void;
  onBack: () => void;
}) {
  return (
    <main className="selection shot-screen screen-in">
      <PlayerHeader title="PICK YOUR SHOT" onBack={onBack}>
        <span className="selected-player" style={playerColor(character)}>
          <span className="quick-portrait">
            <Image src={character.sprite} alt="" fill sizes="56px" unoptimized />
          </span>
          {character.name}
        </span>
      </PlayerHeader>
      <div className="shot-grid">
        {shots.map(({ id, label, points, description }) => (
          <button className="shot-card" key={id} data-shot={id} onClick={() => onPick(id)}>
            <span className="shot-graphic" aria-hidden="true">
              <span className="court-diagram"><i /></span>
              <span className="shot-number display">{points}</span>
            </span>
            <span className="shot-info">
              <span className="player-tag">+{points} {points === 1 ? "point" : "points"}</span>
              <span className="display shot-name">{label}</span>
              <span className="shot-description">{description}</span>
              <span aria-hidden="true" className="player-arrow">↗</span>
            </span>
          </button>
        ))}
      </div>
      <p className="shot-instructions">Hold to charge. Release in the green zone.</p>
    </main>
  );
}
