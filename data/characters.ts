export type Character = {
  id: string;
  name: string;
  tagline: string;
  sprite: string;
  accent: string;
};

export const characters: Character[] = [
  {
    id: "kayden-stark",
    name: "Kayden Stark",
    tagline: "Iron Man Mode",
    sprite: "/characters/kayden-stark.png",
    accent: "#e23b3b",
  },
  {
    id: "owen-panther",
    name: "Black Panther Owen",
    tagline: "Wakanda Forever",
    sprite: "/characters/owen-panther.png",
    accent: "#8b2df0",
  },
  {
    id: "stephen-curry",
    name: "Stephen Curry",
    tagline: "The Chef",
    sprite: "/characters/stephen-curry.png",
    accent: "#1e73ff",
  },
];

export function getCharacter(id: string): Character {
  return characters.find((c) => c.id === id) ?? characters[0];
}
