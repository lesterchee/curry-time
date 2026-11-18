import { createHash, randomUUID } from "node:crypto";
import { newMatch, recordShot, SHOTS_PER_PLAYER } from "./match";
import { isSession, SEATS, type OnlineRoom, type RoomRequest } from "./online";
import { createFlight, FLIGHT_STEP, getShotConfig, stepFlight } from "./physics";

const ROOM_CODE = "owen";
const ROOM_KEY = "curry-time:online:owen:v1";
const ROOM_TTL_SECONDS = 2 * 60 * 60;
const PRESENCE_MS = 45_000;
const HEARTBEAT_MS = 12_000;

type Member = { tokenHash: string; lastSeen: number; ready: boolean };
type StoredRoom = Omit<OnlineRoom, "code" | "seats"> & { members: [Member | null, Member | null] };

export class RoomError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function readRoomRequest(value: unknown): RoomRequest {
  if (!isSession(value)) throw new RoomError(400, "Choose a player and enter the room code.");
  const request = value as RoomRequest;
  switch (request.action) {
    case "join":
      if (typeof request.code !== "string" || request.code.trim().toLowerCase() !== ROOM_CODE) {
        throw new RoomError(400, "That room code didn’t match.");
      }
      break;
    case "sync": case "ready": case "leave":
      break;
    case "mode":
      if (request.shotKind !== "free-throw" && request.shotKind !== "three-pointer") {
        throw new RoomError(400, "Pick a shot type.");
      }
      break;
    case "shoot":
      if (!Number.isInteger(request.number) || request.number < 1 || request.number > SHOTS_PER_PLAYER * 2 ||
          !Number.isInteger(request.power) || request.power < 0 || request.power > 100) {
        throw new RoomError(400, "That shot couldn’t be read.");
      }
      // Both match actions validate the match ID.
      if (typeof request.id !== "string" || request.id.length !== 36) throw new RoomError(400, "Reopen the match.");
      break;
    case "rematch":
      if (typeof request.id !== "string" || request.id.length !== 36) throw new RoomError(400, "Reopen the match.");
      break;
    default:
      throw new RoomError(400, "That room action wasn’t recognised.");
  }
  return request;
}

function newRoom(revision = 0): StoredRoom {
  return { id: randomUUID(), revision, phase: "lobby", shotKind: "free-throw", match: newMatch(), lastShot: null, members: [null, null] };
}

function isPresent(member: Member | null, now: number): boolean {
  return member !== null && member.lastSeen > 0 && now - member.lastSeen < PRESENCE_MS;
}

function snapshot(room: StoredRoom, now: number): OnlineRoom {
  const { members, ...publicRoom } = room;
  const seat = (member: Member | null) => {
    const present = isPresent(member, now);
    return { present, ready: present && member!.ready };
  };
  return { ...publicRoom, code: ROOM_CODE, seats: [seat(members[0]), seat(members[1])] };
}

export interface RoomStore {
  read(): Promise<string | null>;
  save(previous: string | null, next: string): Promise<boolean>;
}

export class MemoryRoomStore implements RoomStore {
  private value: string | null = null;
  async read() { return this.value; }
  async save(previous: string | null, next: string) {
    if (this.value !== previous) return false;
    this.value = next;
    return true;
  }
}

export class RedisRoomStore implements RoomStore {
  constructor(private url: string, private token: string) {}

  private async command(command: (string | number)[]) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) throw new RoomError(503, "The room is reconnecting. Try again.");
    const data = await response.json() as { result: unknown; error?: string };
    if (data.error) throw new RoomError(503, "The room is reconnecting. Try again.");
    return data.result;
  }

  async read() { return await this.command(["GET", ROOM_KEY]) as string | null; }

  async save(previous: string | null, next: string) {
    const result = await this.command([
      "EVAL",
      "if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1",
      1, ROOM_KEY, previous ?? "", next, ROOM_TTL_SECONDS,
    ]);
    return result === 1;
  }
}

export class RoomService {
  constructor(private store: RoomStore, private clock = Date.now) {}

  async handle(request: RoomRequest): Promise<OnlineRoom> {
    const tokenHash = createHash("sha256").update(request.token).digest("hex");
    for (let attempt = 0; attempt < 6; attempt++) {
      const previous = await this.store.read();
      const now = this.clock();
      let room = previous ? JSON.parse(previous) as StoredRoom : newRoom();
      const member = room.members[request.seat];

      if (request.action === "join") {
        if (member?.tokenHash !== tokenHash) {
          if (isPresent(member, now)) throw new RoomError(409, `${SEATS[request.seat].name} already joined on another phone.`);
          if (!room.members.some((player) => isPresent(player, now))) room = newRoom(room.revision);
          room.members[request.seat] = { tokenHash, lastSeen: now, ready: false };
        } else {
          member.lastSeen = now;
        }
      } else {
        if (!member || member.tokenHash !== tokenHash) {
          throw new RoomError(401, "Your seat expired. Join the room again.");
        }
        if (request.action === "sync" && now - member.lastSeen < HEARTBEAT_MS) return snapshot(room, now);
        member.lastSeen = now;

        switch (request.action) {
          case "ready":
            if (room.phase === "lobby") member.ready = true;
            break;
          case "mode":
            if (request.seat !== 1 || room.phase !== "lobby") throw new RoomError(409, "Owen can pick the shot type in the lobby.");
            if (room.shotKind !== request.shotKind) {
              room.shotKind = request.shotKind;
              for (const player of room.members) if (player) player.ready = false;
            }
            break;
          case "shoot": {
            if (request.id !== room.id) throw new RoomError(409, "That match has moved on.");
            const last = room.lastShot;
            if (last && last.number === request.number && last.seat === request.seat && last.power === request.power) {
              return snapshot(room, now);
            }
            if (room.phase !== "playing" || request.seat !== room.match.turn || request.number !== (last?.number ?? 0) + 1) {
              throw new RoomError(409, "Wait for your turn to shoot.");
            }
            if (!room.members.every((player) => isPresent(player, now))) {
              throw new RoomError(409, "Wait for the other phone to reconnect.");
            }
            const config = getShotConfig(room.shotKind);
            const flight = createFlight(config, request.power);
            while (!flight.outcome) stepFlight(flight, config, FLIGHT_STEP);
            const made = flight.outcome === "swish" || flight.outcome === "rim-in";
            const match = recordShot(room.match, made ? config.points : 0);
            const finished = match.players.every((player) => player.shots === SHOTS_PER_PLAYER);
            room.match = { ...match, turn: request.seat === 0 ? 1 : 0 };
            room.lastShot = { number: request.number, seat: request.seat, power: request.power, outcome: flight.outcome };
            if (finished) room.phase = "finished";
            break;
          }
          case "rematch":
            if (request.id !== room.id || room.phase !== "finished") return snapshot(room, now);
            room = { ...newRoom(room.revision), members: room.members, shotKind: room.shotKind };
            for (const player of room.members) if (player) player.ready = false;
            break;
          case "leave":
            room.members[request.seat] = null;
            if (room.members.every((player) => !isPresent(player, now))) room = newRoom(room.revision);
            break;
        }
      }

      if (room.phase === "lobby" && room.members.every((player) => player?.ready && isPresent(player, now))) {
        room.phase = "playing";
      }
      room.revision++;
      if (await this.store.save(previous, JSON.stringify(room))) return snapshot(room, now);
    }
    throw new RoomError(503, "The room is busy. Try again.");
  }
}
