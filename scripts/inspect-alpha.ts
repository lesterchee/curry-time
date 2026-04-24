import sharp from "sharp";
import path from "node:path";

async function inspect(file: string) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (channels !== 4) return;
  const hist = new Array(17).fill(0);
  let zero = 0,
    solid = 0,
    semi = 0;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    hist[Math.min(16, Math.floor(a / 16))]++;
    if (a === 0) zero++;
    else if (a >= 250) solid++;
    else semi++;
  }
  const total = width * height;
  console.log(path.basename(file), `${width}x${height}`);
  console.log(
    `  zero=${((zero / total) * 100).toFixed(1)}%  solid=${((solid / total) * 100).toFixed(1)}%  semi=${((semi / total) * 100).toFixed(1)}%`,
  );
  console.log(
    `  alpha hist (16 bins): ${hist.map((v) => ((v / total) * 100).toFixed(1)).join(" ")}`,
  );
  const corner = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return `rgba(${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]})`;
  };
  console.log(
    `  TL=${corner(5, 5)}  TR=${corner(width - 5, 5)}  BL=${corner(5, height - 5)}  BR=${corner(width - 5, height - 5)}  CENTER=${corner(width / 2, height / 2)}`,
  );
}

async function main() {
  const files = [
    "public/basketball.png",
    "public/hoop.png",
    "public/characters/kayden-stark.png",
    "public/characters/owen-panther.png",
    "public/characters/stephen-curry.png",
  ];
  for (const f of files) await inspect(f);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
