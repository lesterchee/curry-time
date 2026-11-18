export type Character = {
  id: string;
  name: string;
  tagline: string;
  sprite: string;
  accent: string;
  hand: [x: number, y: number];
  shot: {
    art: string;
    set: [x: number, y: number];
    follow: [x: number, y: number];
    setScale: number;
  };
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
    shot: { art: "kayden", set: [0.801, 0.076], follow: [0.905, 0.067], setScale: 0.897 },
  },
  {
    id: "owen-panther",
    name: "Leonardo Owen",
    tagline: "Turtle Crew",
    sprite: "/arcade/owen.webp",
    accent: "#57adff",
    hand: [0.12, 0.16],
    shot: { art: "owen", set: [0.88, 0.083], follow: [0.897, 0.01], setScale: 0.833 },
  },
  {
    id: "stephen-curry",
    name: "Stephen Curry",
    tagline: "The Chef",
    sprite: "/arcade/curry.webp",
    accent: "#ffc453",
    hand: [0.20, 0.22],
    shot: { art: "curry", set: [0.812, 0.179], follow: [0.858, 0.073], setScale: 0.875 },
  },
  {
    id: "damian-lillard",
    name: "Damian Lillard",
    tagline: "Dame Time",
    sprite: "/arcade/lillard.webp",
    accent: "#ff677e",
    hand: [0.13, 0.16],
    shot: { art: "lillard", set: [0.814, 0.153], follow: [0.874, 0.082], setScale: 0.874 },
  },
  {
    id: "jayson-tatum",
    name: "Jayson Tatum",
    tagline: "JT",
    sprite: "/arcade/tatum.webp",
    accent: "#5fe4a1",
    hand: [0.15, 0.15],
    shot: { art: "tatum", set: [0.815, 0.121], follow: [0.873, 0.023], setScale: 0.89 },
  },
  {
    id: "jeremy-lin",
    name: "Jeremy Lin",
    tagline: "Linsanity",
    sprite: "/arcade/lin.webp",
    accent: "#ac9cff",
    hand: [0.19, 0.19],
    shot: { art: "lin", set: [0.818, 0.178], follow: [0.883, 0.095], setScale: 0.889 },
  },
];

export function getCharacter(id: string): Character {
  return characters.find((c) => c.id === id) ?? characters[0];
}
