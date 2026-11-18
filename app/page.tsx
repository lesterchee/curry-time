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

const OnlineDuel = dynamic(() => import("../components/OnlineDuel"), {
  ssr: false,
  loading: () => <p className="court-loading" role="status">Opening the online court…</p>,
});

type Screen = "title" | "versus" | "online" | "character" | "shot" | "play";
type Mode = "solo" | "duel";

export default function Home() {
  const [screen, setScreen] = useState<Screen>("title");
  const [characterId, setCharacterId] = useState(characters[0].id);
  const [opponentId, setOpponentId] = useState(characters[1].id);
  const [mode, setMode] = useState<Mode>("solo");
  const [selecting, setSelecting] = useState<1 | 2>(1);
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

  function start(nextMode: Mode, character?: Character) {
    primeAudio();
    if (!isMuted()) startMusic();
    setMode(nextMode);
    setSelecting(1);
    if (character) setCharacterId(character.id);
    changeScreen(character ? "shot" : "character");
  }

  function pick(character: Character) {
    if (mode === "duel" && selecting === 2) {
      setOpponentId(character.id);
      changeScreen("shot");
      return;
    }
    setCharacterId(character.id);
    if (mode === "duel") {
      setSelecting(2);
      window.scrollTo(0, 0);
    } else {
      changeScreen("shot");
    }
  }

  const character = getCharacter(characterId);
  const opponent = mode === "duel" ? getCharacter(opponentId) : undefined;

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

  if (screen === "online") return <OnlineDuel soundControl={sound} onBack={() => changeScreen("versus")} />;

  if (screen === "play") {
    return (
      <Game
        key={`${characterId}:${shotKind}`}
        character={character}
        opponent={opponent}
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
      {screen === "title" && (
        <Title onPlay={() => start("solo")} onDuel={() => changeScreen("versus")} onPick={(player) => start("solo", player)} />
      )}
      {screen === "versus" && (
        <main className="online-panel screen-in">
          <button className="back-button" onClick={() => changeScreen("title")}>← Back</button>
          <h1 className="display">Two players</h1>
          <div className="versus-choices">
            <button className="primary-button" onClick={() => {
              primeAudio();
              if (!isMuted()) startMusic();
              changeScreen("online");
            }}>Two phones</button>
            <button className="game-nav-button" onClick={() => start("duel")}>Same phone</button>
          </div>
        </main>
      )}
      {screen === "character" && (
        <CharacterSelect
          playerNumber={mode === "duel" ? selecting : undefined}
          firstPlayer={selecting === 2 ? character : undefined}
          onPick={pick}
          onBack={() => {
            if (selecting === 2) setSelecting(1);
            else changeScreen("title");
          }}
        />
      )}
      {screen === "shot" && (
        <ShotSelect
          character={character}
          opponent={opponent}
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

function Title({ onPlay, onDuel, onPick }: {
  onPlay: () => void;
  onDuel: () => void;
  onPick: (c: Character) => void;
}) {
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
          <div className="hero-actions">
            <button className="primary-button hero-play" onClick={onPlay}>
              <span className="play-mark" aria-hidden="true" /> Play now <span className="button-arrow" aria-hidden="true">↗</span>
            </button>
            <button className="duel-button" onClick={onDuel}>2 players</button>
          </div>
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

function CharacterSelect({ playerNumber, firstPlayer, onPick, onBack }: {
  playerNumber?: 1 | 2;
  firstPlayer?: Character;
  onPick: (c: Character) => void;
  onBack: () => void;
}) {
  const [scores] = useState(() => Object.fromEntries(characters.map(({ id }) => [id, getHighScore(id)])));

  return (
    <main className="selection screen-in">
      <PlayerHeader title={playerNumber ? `PLAYER ${playerNumber}, PICK YOUR BALLER` : "PICK YOUR BALLER"} onBack={onBack} />
      {playerNumber && (
        <p className="duel-instructions">
          {firstPlayer ? `Player 1 picked ${firstPlayer.name}. Now pick Player 2.` : "Take five shots each and pass the device after every shot."}
        </p>
      )}
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

function ShotSelect({ character, opponent, onPick, onBack }: {
  character: Character;
  opponent?: Character;
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
          {opponent ? `${character.name} vs. ${opponent.name}` : character.name}
        </span>
      </PlayerHeader>
      {opponent && <p className="duel-instructions">Both players shoot from the same spot.</p>}
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
