import type { Match } from "./match";
import type { Outcome, ShotKind } from "./physics";

export const SEATS = [
  { name: "Kayden", characterId: "kayden-stark" },
  { name: "Owen", characterId: "owen-panther" },
] as const;

export type Seat = 0 | 1;
export type Session = { seat: Seat; token: string };
export type OnlineShot = { number: number; seat: Seat; power: number; outcome: Outcome };
export type OnlineRoom = {
  code: string;
  id: string;
  revision: number;
  phase: "lobby" | "playing" | "finished";
  shotKind: ShotKind;
  match: Match;
  lastShot: OnlineShot | null;
  seats: [{ present: boolean; ready: boolean }, { present: boolean; ready: boolean }];
};

export type RoomAction =
  | { action: "join"; code: string }
  | { action: "sync" | "ready" | "leave" }
  | { action: "mode"; shotKind: ShotKind }
  | { action: "shoot"; id: string; number: number; power: number }
  | { action: "rematch"; id: string };

export type RoomRequest = Session & RoomAction;

export function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<Session>;
  return (data.seat === 0 || data.seat === 1) && typeof data.token === "string" && /^[a-f0-9]{32}$/.test(data.token);
}
