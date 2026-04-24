const KEY = "curry-time:high-scores";

type HighScores = Record<string, number>;

function read(): HighScores {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as HighScores;
  } catch {
    return {};
  }
}

function write(v: HighScores) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // ignore
  }
}

export function getHighScore(characterId: string): number {
  return read()[characterId] ?? 0;
}

export function updateHighScore(characterId: string, score: number): number {
  const all = read();
  const prev = all[characterId] ?? 0;
  if (score > prev) {
    all[characterId] = score;
    write(all);
    return score;
  }
  return prev;
}
