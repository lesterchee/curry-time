import { GoogleGenAI } from "@google/genai";
import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const MODEL_PRIMARY = "gemini-3-pro-image-preview";
const MODEL_FALLBACK = "gemini-3.1-flash-image-preview";

const OUT_DIR = path.resolve(process.cwd(), "public");

const ART_DIRECTION = `Chibi-style basketball player, 3/4 front view, full body, dynamic basketball shooting pose mid-release with one arm extended upward, thick black outlines, cel-shaded cartoon style, vibrant saturated colors, bold action-figure energy, transparent background, consistent art style across character set, NBA Jam arcade aesthetic, clean flat shading, no text, no logos, high detail on face and pose, feet planted in shooting stance`;

type Job = {
  key: string;
  filename: string;
  prompt: string;
  aspectRatio?: string;
  variants?: number;
  subdir?: string;
  transparent?: boolean;
};

const CHARACTERS: Job[] = [
  {
    key: "kayden-stark",
    filename: "kayden-stark.png",
    subdir: "characters",
    variants: 2,
    transparent: true,
    prompt: `${ART_DIRECTION}. Character: a young boy in a crimson red basketball jersey with bold yellow stripes along the sides and shoulders, matching red shorts with yellow trim, a big confident playful grin, short dark tousled hair, bright brown eyes, orange wristbands, white sneakers with red laces, a small lightning bolt graphic printed on the front of the jersey. Energetic young baller.`,
  },
  {
    key: "owen-panther",
    filename: "owen-panther.png",
    subdir: "characters",
    variants: 2,
    transparent: true,
    prompt: `${ART_DIRECTION}. Character: a young Black boy in a sleek matte black basketball uniform with glowing purple geometric tribal-pattern trim running along the shoulders and shorts, silver claw-shaped accent detailing at the wrists, fierce focused expression, short coiled hair, powerful athletic stance, subtle purple energy aura lines around the limbs. Stealthy warrior-athlete vibe.`,
  },
  {
    key: "stephen-curry",
    filename: "stephen-curry.png",
    subdir: "characters",
    variants: 2,
    transparent: true,
    prompt: `${ART_DIRECTION}. Character: Stephen Curry NBA star, wearing Golden State Warriors blue and yellow #30 basketball jersey and shorts, signature shooting form with perfect mid-release follow-through, mouthpiece visible, focused sharpshooter expression, short dark hair.`,
  },
];

const PROPS: Job[] = [
  {
    key: "court-background",
    filename: "court-background.png",
    variants: 1,
    prompt: `Side elevation view of an indoor basketball arena, looking at the court from the sideline: a polished wooden floor running left-to-right across the lower half of the image, a painted red free-throw-lane key and blue center stripe visible on the floor, and behind it rows of blurred stylized crowd silhouettes in an arena, no hoop visible, no players, no letters, no words, no numbers, no logos, no signage, absolutely no text of any kind on the floor or walls, stylized arcade cartoon art to match a chibi character style, vibrant saturated colors, thick black outlines, cel-shaded, 16:9 widescreen composition, scrolling-game background plate.`,
    aspectRatio: "16:9",
  },
  {
    key: "basketball",
    filename: "basketball.png",
    variants: 1,
    transparent: true,
    prompt: `A single classic orange basketball with black seams, isometric 3D cartoon style, thick black outlines, cel-shaded, transparent background, no shadow, centered on empty canvas.`,
  },
  {
    key: "hoop",
    filename: "hoop.png",
    variants: 1,
    transparent: true,
    prompt: `Basketball hoop with backboard, red rim, white net, side view, chibi cartoon style, thick black outlines, cel-shaded, transparent background, no pole visible below backboard, centered on empty canvas.`,
  },
];

async function generateOne(
  ai: GoogleGenAI,
  model: string,
  job: Job,
  variantIndex: number
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const config: Record<string, unknown> = {
    responseModalities: ["Image"],
  };
  if (job.aspectRatio) {
    config.imageConfig = { aspectRatio: job.aspectRatio };
  } else {
    config.imageConfig = { aspectRatio: "1:1" };
  }

  const promptWithSeed =
    variantIndex === 0 ? job.prompt : `${job.prompt} Variant ${variantIndex + 1}: slightly different angle/expression but same character identity and outfit.`;

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: promptWithSeed }] }],
    config,
  });

  const candidates = response.candidates ?? [];
  for (const cand of candidates) {
    const parts = cand.content?.parts ?? [];
    for (const part of parts) {
      const inline = (part as { inlineData?: { data?: string; mimeType?: string } }).inlineData;
      if (inline?.data) {
        return {
          bytes: Buffer.from(inline.data, "base64"),
          mimeType: inline.mimeType ?? "image/png",
        };
      }
    }
  }
  // No image — log why
  const firstCand = candidates[0];
  const finishReason = firstCand?.finishReason;
  const safety = firstCand?.safetyRatings;
  console.warn(`  no image returned. finishReason=${finishReason} safety=${JSON.stringify(safety)}`);
  const promptFeedback = (response as unknown as { promptFeedback?: unknown }).promptFeedback;
  if (promptFeedback) console.warn(`  promptFeedback=${JSON.stringify(promptFeedback)}`);
  return null;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY not set");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  await mkdir(path.join(OUT_DIR, "characters"), { recursive: true });

  const allJobs = [...CHARACTERS, ...PROPS];
  let imagesGenerated = 0;
  let model = MODEL_PRIMARY;
  let didFallback = false;

  for (const job of allJobs) {
    const variants = job.variants ?? 1;
    const subdir = job.subdir ? path.join(OUT_DIR, job.subdir) : OUT_DIR;

    for (let i = 0; i < variants; i++) {
      const variantName =
        i === 0
          ? job.filename
          : job.filename.replace(/\.png$/, `-v${i + 1}.png`);

      const outPath = path.join(subdir, variantName);
      // Skip if already exists (resume mode)
      try {
        const s = await stat(outPath);
        if (s.size > 1024) {
          console.log(`[skip] ${variantName} exists (${(s.size / 1024).toFixed(1)} KB)`);
          continue;
        }
      } catch {
        // not found, generate
      }
      console.log(`[${imagesGenerated + 1}] Generating ${job.key} variant ${i + 1}/${variants} with ${model}...`);
      let result: { bytes: Buffer; mimeType: string } | null = null;
      try {
        result = await generateOne(ai, model, job, i);
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        console.warn(`  primary model failed: ${msg}`);
        if (!didFallback && (msg.includes("billing") || msg.includes("NOT_FOUND") || msg.includes("not found") || msg.includes("permission") || msg.includes("PERMISSION"))) {
          console.warn(`  switching to fallback model ${MODEL_FALLBACK}`);
          model = MODEL_FALLBACK;
          didFallback = true;
          try {
            result = await generateOne(ai, model, job, i);
          } catch (err2) {
            console.error(`  fallback also failed: ${(err2 as Error).message}`);
          }
        } else {
          // try once more
          try {
            console.warn(`  retrying once...`);
            result = await generateOne(ai, model, job, i);
          } catch (err3) {
            console.error(`  retry failed: ${(err3 as Error).message}`);
          }
        }
      }

      if (!result) {
        console.error(`  ! FAILED to generate ${job.key} variant ${i + 1}`);
        continue;
      }

      await writeFile(outPath, result.bytes);
      console.log(`  -> wrote ${outPath} (${(result.bytes.length / 1024).toFixed(1)} KB)`);
      imagesGenerated++;
    }
  }

  // Pricing: Nano Banana Pro ~$0.24 per 2K image; Flash variant ~$0.039 per image
  const perImage = didFallback ? 0.039 : 0.24;
  console.log(`\n=== Summary ===`);
  console.log(`Model used: ${model}`);
  console.log(`Images generated: ${imagesGenerated}`);
  console.log(`Estimated cost: $${(imagesGenerated * perImage).toFixed(2)}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
