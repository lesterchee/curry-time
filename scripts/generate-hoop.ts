import { GoogleGenAI } from "@google/genai";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MODEL = "gemini-3-pro-image-preview";

const PROMPT = `A standard basketball hoop viewed from the SIDE perspective of a basketball court, meaning the shooter is on the left and looking AT the hoop on the right. Red rim circle visible as a 3/4 front-facing ellipse so the opening can be seen. White net hanging below the rim. White backboard with blue border behind the rim, backboard faces LEFT toward the shooter (the reflective front of the backboard is what the viewer sees, NOT the back). Chibi cartoon style, thick black outlines, cel-shaded, vibrant saturated colors, transparent background, matches the arcade NBA Jam aesthetic of the existing court art, no pole or stand visible below, just backboard + rim + net. Reference angle: imagine standing at the free throw line looking at the hoop mounted on the wall. The rim opening should be clearly visible to the viewer as an open oval.`;

const VARIANTS = 3;

async function generateOne(
  ai: GoogleGenAI,
  variantIndex: number,
): Promise<Buffer | null> {
  const seedSuffix =
    variantIndex === 0
      ? ""
      : variantIndex === 1
        ? " Variant 2: slightly different angle, rim opening still clearly visible to viewer."
        : " Variant 3: stronger 3/4 front view, more of the rim opening visible as a wide ellipse.";
  const contents = [
    { role: "user" as const, parts: [{ text: PROMPT + seedSuffix }] },
  ];
  const response = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: {
      responseModalities: ["Image"],
      imageConfig: { aspectRatio: "1:1" },
    },
  });
  const cand = response.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  for (const part of parts) {
    const inline = (part as { inlineData?: { data?: string } }).inlineData;
    if (inline?.data) return Buffer.from(inline.data, "base64");
  }
  const finishReason = cand?.finishReason;
  console.warn(`  no image; finishReason=${finishReason}`);
  return null;
}

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("GEMINI_API_KEY missing");
    process.exit(1);
  }
  const ai = new GoogleGenAI({ apiKey: key });
  const outDir = path.resolve(process.cwd(), "public");
  await mkdir(outDir, { recursive: true });
  for (let i = 0; i < VARIANTS; i++) {
    const name =
      i === 0 ? "hoop-new.png" : `hoop-new-v${i + 1}.png`;
    console.log(`[${i + 1}/${VARIANTS}] generating ${name}`);
    const buf = await generateOne(ai, i);
    if (!buf) {
      console.error(`  failed`);
      continue;
    }
    const p = path.join(outDir, name);
    await writeFile(p, buf);
    console.log(`  wrote ${p} (${(buf.length / 1024).toFixed(1)} KB)`);
  }
  console.log(`\nCost estimate: $${(VARIANTS * 0.24).toFixed(2)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
