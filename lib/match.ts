export const SHOTS_PER_PLAYER = 5;

type Player = { score: number; shots: number };
export type Match = { turn: 0 | 1; players: [Player, Player] };

export function newMatch(): Match {
  return { turn: 0, players: [{ score: 0, shots: 0 }, { score: 0, shots: 0 }] };
}

export function recordShot(match: Match, points: number): Match {
  const { score, shots } = match.players[match.turn];
  if (shots >= SHOTS_PER_PLAYER) return match;
  const players: Match["players"] = [...match.players];
  players[match.turn] = { score: score + points, shots: shots + 1 };
  return { ...match, players };
}
