"use client";

import Image from "next/image";
import { useEffect, useState, useRef, type FormEvent, type ReactNode } from "react";
import { getCharacter } from "../data/characters";
import { isSession, SEATS, type OnlineRoom, type RoomAction, type RoomRequest, type Seat, type Session } from "../lib/online";
import Game from "./Game";

const SESSION_KEY = "curry-time:online-seat";

function readSession(): Session | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    return isSession(value) ? value : null;
  } catch {
    return null;
  }
}

function remember(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // The in-memory session still works when browser storage is unavailable.
  }
}

async function send(request: RoomRequest): Promise<OnlineRoom> {
  const response = await fetch("/api/online", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(7_000),
    body: JSON.stringify(request),
  });
  const data = await response.json() as OnlineRoom | { error?: string };
  if (!response.ok) {
    throw Object.assign(new Error("error" in data && data.error ? data.error : "The room is reconnecting."), { status: response.status });
  }
  return data as OnlineRoom;
}

function message(error: unknown): string {
  return error instanceof Error && "status" in error ? error.message : "Couldn’t reach the room. Check your connection and try again.";
}

function lostSeat(error: unknown) {
  return error instanceof Error && "status" in error && error.status === 401;
}

export default function OnlineDuel({ soundControl, onBack }: { soundControl: ReactNode; onBack: () => void }) {
  const [session, setSession] = useState(readSession);
  const [room, setRoom] = useState<OnlineRoom | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const actionPending = useRef(false);
  const joinToken = useRef<Session | null>(null);

  function accept(next: OnlineRoom) {
    setRoom((previous) => previous && previous.revision > next.revision ? previous : next);
    setConnected(true);
  }

  function clearSeat() {
    remember(null);
    setSession(null);
    setRoom(null);
    setConnected(false);
    joinToken.current = null;
  }

  useEffect(() => {
    if (!session) return;
    let stopped = false;
    let busy = false;
    let delay = 1600;
    let timer: ReturnType<typeof setTimeout>;
    let lastActivity = Date.now();

    async function sync() {
      if (stopped || busy || document.hidden || Date.now() - lastActivity > 5 * 60_000) return;
      busy = true;
      try {
        const next = await send({ ...session!, action: "sync" });
        if (stopped) return;
        accept(next);
        delay = next.phase === "playing" ? 950 : 1800;
      } catch (failure) {
        if (stopped) return;
        if (lostSeat(failure)) {
          clearSeat();
          setError(message(failure));
          return;
        }
        setConnected(false);
        delay = 2600;
      } finally {
        busy = false;
        if (!stopped) timer = setTimeout(sync, delay);
      }
    }

    function wake() {
      lastActivity = Date.now();
      if (!busy) {
        clearTimeout(timer);
        void sync();
      }
    }

    void sync();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [session]);

  async function act(action: RoomAction, identity = session) {
    if (!identity || actionPending.current) return;
    actionPending.current = true;
    setPending(true);
    setError("");
    try {
      const next = await send({ ...identity, ...action });
      if (action.action === "join") {
        remember(identity);
        setSession(identity);
      }
      if (action.action !== "leave") accept(next);
    } catch (failure) {
      if (lostSeat(failure)) clearSeat();
      setError(message(failure));
    } finally {
      setPending(false);
      actionPending.current = false;
    }
  }

  function join(event: FormEvent) {
    event.preventDefault();
    if (seat === null || !code.trim()) return;
    if (joinToken.current?.seat !== seat) {
      joinToken.current = { seat, token: crypto.randomUUID().replaceAll("-", "") };
    }
    void act({ action: "join", code }, joinToken.current);
  }

  async function leave() {
    if (session) await act({ action: "leave" });
    clearSeat();
    onBack();
  }

  if (session && room && room.phase !== "lobby") {
    return (
      <Game
        key={room.id}
        character={getCharacter(SEATS[0].characterId)}
        opponent={getCharacter(SEATS[1].characterId)}
        shotKind={room.shotKind}
        soundControl={soundControl}
        onExit={() => void leave()}
        online={{
          seat: session.seat,
          room,
          connected,
          pending,
          message: error,
          onShoot: (power) => act({ action: "shoot", id: room.id, number: (room.lastShot?.number ?? 0) + 1, power }),
          onRematch: () => void act({ action: "rematch", id: room.id }),
        }}
      />
    );
  }

  return (
    <div className="arcade-shell">
      <header className="site-header">
        <button className="back-button" type="button" disabled={pending} onClick={() => void leave()}>{session ? "Leave room" : "← Back"}</button>
        {soundControl}
      </header>
      <main className="online-panel screen-in">
        <h1 className="display">{session ? "Online shootout" : "Play on two phones"}</h1>
        {error && <p className="online-error" role="alert">{error}</p>}
        {session ? room ? (
          <>
            <p className="online-note">Room <strong>{room.code}</strong> · You’re {SEATS[session.seat].name}</p>
            <div className="online-roster">
                {SEATS.map(({ name, characterId }, index) => (
                  <div className="online-seat" key={name}>
                    <Image src={getCharacter(characterId).sprite} alt="" width={48} height={52} unoptimized />
                    <span><strong>{name}</strong><small>{room.seats[index].ready ? "Ready" : room.seats[index].present ? "Joined" : "Waiting to join"}</small></span>
                  </div>
                ))}
            </div>
            <div className="online-modes" aria-label="Shot type">
              {(["free-throw", "three-pointer"] as const).map((kind) => (
                <button
                  key={kind}
                  className="game-nav-button"
                  type="button"
                  aria-pressed={room.shotKind === kind}
                  disabled={session.seat !== 1 || pending || !connected}
                  onClick={() => void act({ action: "mode", shotKind: kind })}
                >
                  {kind === "free-throw" ? "Free throws" : "3-pointers"}
                </button>
              ))}
            </div>
            {!connected && <p className="online-note" role="status">Reconnecting to the room…</p>}
            <button
              className="primary-button"
              type="button"
              disabled={pending || !connected || room.seats[session.seat].ready}
              onClick={() => void act({ action: "ready" })}
            >
              {room.seats[session.seat].ready ? `Waiting for ${SEATS[1 - session.seat].name}` : "Ready"}
            </button>
          </>
        ) : <p className="online-note" role="status">Reconnecting to your room…</p> : (
          <form className="online-form" onSubmit={join}>
            <div className="online-roster" aria-label="Choose your player">
              {SEATS.map(({ name, characterId }, index) => (
                <button
                  className="online-seat"
                  key={name}
                  type="button"
                  aria-pressed={seat === index}
                  onClick={() => setSeat(index === 0 ? 0 : 1)}
                >
                  <Image src={getCharacter(characterId).sprite} alt="" width={48} height={52} unoptimized />
                  <strong>{name}</strong>
                </button>
              ))}
            </div>
            <label htmlFor="online-code">Room code</label>
            <input id="online-code" value={code} onChange={(event) => setCode(event.target.value)} maxLength={16} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            <button className="primary-button" type="submit" disabled={seat === null || !code.trim() || pending}>
              {pending ? "Joining…" : "Join game"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
