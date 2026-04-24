import sharp from "sharp";
import path from "node:path";

/**
 * The Gemini-generated PNGs have fully-opaque backgrounds (white for characters
 * and basketball, dark gray for the hoop), even though the prompt asked for
 * transparent backgrounds. Post-process:
 *   1. Sample the 4 corners to identify the background color.
 *   2. Flood-fill from each corner, clearing pixels whose color distance from
 *      the background is below a tolerance. Flood fill stops at the thick
 *      black outlines, leaving interior "white" pixels (teeth, eye whites)
 *      intact.
 *   3. Soft-edge: any pixel within a small tolerance of the bg color that
 *      is reachable by flood fill gets alpha=0.
 *   4. Crop to the tight alpha bounding box.
 */

type RGBA = [number, number, number, number];

const FLOOD_TOLERANCE = 65; // initial flood fill
const ERODE_TOLERANCE = 85; // iterative erosion against transparent neighbors
const SOFT_EDGE_BAND = 20;
const ERODE_ITERATIONS = 50;

function colorDist(a: RGBA, b: RGBA): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function px(data: Buffer, w: number, x: number, y: number): RGBA {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

async function clean(file: string) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (channels !== 4) return;
  const buf = Buffer.from(data);

  // identify bg color from 4 corners (average)
  const corners = [
    px(buf, width, 2, 2),
    px(buf, width, width - 3, 2),
    px(buf, width, 2, height - 3),
    px(buf, width, width - 3, height - 3),
  ];
  const bgR = Math.round(corners.reduce((s, c) => s + c[0], 0) / 4);
  const bgG = Math.round(corners.reduce((s, c) => s + c[1], 0) / 4);
  const bgB = Math.round(corners.reduce((s, c) => s + c[2], 0) / 4);
  const bg: RGBA = [bgR, bgG, bgB, 255];

  // BFS flood fill from all 4 corners
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const pushCorner = (x: number, y: number) => {
    const idx = y * width + x;
    if (!visited[idx]) {
      const p = px(buf, width, x, y);
      if (colorDist(p, bg) <= FLOOD_TOLERANCE) {
        queue.push(idx);
        visited[idx] = 1;
      }
    }
  };
  // seed flood from all 4 corners AND along the top/bottom/left/right edges
  for (let x = 0; x < width; x++) {
    pushCorner(x, 0);
    pushCorner(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    pushCorner(0, y);
    pushCorner(width - 1, y);
  }

  while (queue.length > 0) {
    const idx = queue.pop()!;
    const x = idx % width;
    const y = Math.floor(idx / width);
    buf[idx * 4 + 3] = 0;
    const neighbors = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nidx = ny * width + nx;
      if (visited[nidx]) continue;
      const p = px(buf, width, nx, ny);
      if (colorDist(p, bg) <= FLOOD_TOLERANCE) {
        visited[nidx] = 1;
        queue.push(nidx);
      }
    }
  }

  // Iterative erosion: any opaque pixel adjacent to a transparent one whose
  // color is close to bg becomes transparent too. Repeat until stable.
  let changed = true;
  for (let iter = 0; iter < ERODE_ITERATIONS && changed; iter++) {
    changed = false;
    const frontier: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (buf[i + 3] === 0) continue;
        const adjTransparent =
          (x > 0 && buf[(y * width + (x - 1)) * 4 + 3] === 0) ||
          (x < width - 1 && buf[(y * width + (x + 1)) * 4 + 3] === 0) ||
          (y > 0 && buf[((y - 1) * width + x) * 4 + 3] === 0) ||
          (y < height - 1 && buf[((y + 1) * width + x) * 4 + 3] === 0);
        if (!adjTransparent) continue;
        const p: RGBA = [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
        if (colorDist(p, bg) <= ERODE_TOLERANCE) {
          frontier.push(i);
        }
      }
    }
    if (frontier.length > 0) {
      changed = true;
      for (const i of frontier) buf[i + 3] = 0;
    }
  }

  // soft-edge pass: any pixel adjacent to an alpha=0 pixel that is close to bg
  // color gets its alpha reduced proportionally.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (buf[i + 3] === 0) continue;
      // check if any 4-neighbor is transparent
      const anyAdjTransparent =
        (x > 0 && buf[(y * width + (x - 1)) * 4 + 3] === 0) ||
        (x < width - 1 && buf[(y * width + (x + 1)) * 4 + 3] === 0) ||
        (y > 0 && buf[((y - 1) * width + x) * 4 + 3] === 0) ||
        (y < height - 1 && buf[((y + 1) * width + x) * 4 + 3] === 0);
      if (!anyAdjTransparent) continue;
      const p: RGBA = [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
      const d = colorDist(p, bg);
      if (d < ERODE_TOLERANCE + SOFT_EDGE_BAND) {
        const t = Math.max(
          0,
          Math.min(1, (d - ERODE_TOLERANCE) / SOFT_EDGE_BAND),
        );
        buf[i + 3] = Math.round(p[3] * t);
      }
    }
  }

  // crop to bbox
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (buf[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    console.warn(`  empty: ${file}`);
    return;
  }
  const pad = 2;
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const sw = Math.min(width - sx, maxX - sx + 1 + pad);
  const sh = Math.min(height - sy, maxY - sy + 1 + pad);

  const out = await sharp(buf, { raw: { width, height, channels: 4 } })
    .extract({ left: sx, top: sy, width: sw, height: sh })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await sharp(out).toFile(file);
  console.log(
    `  ${path.basename(file)}: bg=rgb(${bgR},${bgG},${bgB})  ${width}x${height} → ${sw}x${sh}`,
  );
}

async function main() {
  const root = path.resolve(process.cwd(), "public");
  const targets = [
    "basketball.png",
    "hoop.png",
    "characters/kayden-stark.png",
    "characters/owen-panther.png",
    "characters/stephen-curry.png",
  ];
  for (const t of targets) {
    const full = path.join(root, t);
    console.log(`cleaning ${t}`);
    await clean(full);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
