export type Character = {
  id: string;
  name: string;
  tagline: string;
  sprite: string;
  accent: string;
  hand: [x: number, y: number];
};

// These IDs also key the existing browser high scores.
export const characters: Character[] = [
  {
    id: "kayden-stark",
    name: "Michelangelo Kayden",
    tagline: "Turtle Crew",
    sprite: "/arcade/kayden.webp",
    accent: "#ff8b42",
    hand: [0.89, 0.13],
  },
  {
    id: "owen-panther",
    name: "Leonardo Owen",
    tagline: "Turtle Crew",
    sprite: "/arcade/owen.webp",
    accent: "#57adff",
    hand: [0.12, 0.16],
  },
  {
    id: "stephen-curry",
    name: "Stephen Curry",
    tagline: "The Chef",
    sprite: "/arcade/curry.webp",
    accent: "#ffc453",
    hand: [0.20, 0.22],
  },
  {
    id: "damian-lillard",
    name: "Damian Lillard",
    tagline: "Dame Time",
    sprite: "/arcade/lillard.webp",
    accent: "#ff677e",
    hand: [0.13, 0.16],
  },
  {
    id: "jayson-tatum",
    name: "Jayson Tatum",
    tagline: "JT",
    sprite: "/arcade/tatum.webp",
    accent: "#5fe4a1",
    hand: [0.15, 0.15],
  },
  {
    id: "jeremy-lin",
    name: "Jeremy Lin",
    tagline: "Linsanity",
    sprite: "/arcade/lin.webp",
    accent: "#ac9cff",
    hand: [0.19, 0.19],
  },
];

export function getCharacter(id: string): Character {
  return characters.find((c) => c.id === id) ?? characters[0];
}
