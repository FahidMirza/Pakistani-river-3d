// Captures the rotating 3D scene from the running dev server into a looping GIF.
// Usage: node scripts/make-gif.mjs  (dev server must be running on :3000)
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { mkdirSync, writeFileSync } from "node:fs";

const URL = "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "docs/orbit.gif";

const FRAMES = 48; // number of captured frames
const INTERVAL_MS = 520; // real-time spacing between captures (controls how far it rotates)
const GIF_WIDTH = 640; // output width (px); height scales to viewport ratio
const GIF_DELAY = 80; // ms per frame in the gif (~12.5 fps)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
    "--window-size=1280,720",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
console.log("loading", URL);
await page.goto(URL, { waitUntil: "networkidle2", timeout: 60_000 });
await page.waitForSelector("canvas", { timeout: 30_000 });

// Give the terrain tiles + snapshot time to load and the orbit to settle
console.log("warming up (terrain tiles)…");
await sleep(8_000);

const raws = [];
for (let i = 0; i < FRAMES; i++) {
  const png = await page.screenshot({ type: "png" });
  const { data, info } = await sharp(png)
    .resize({ width: GIF_WIDTH })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  raws.push({ data, width: info.width, height: info.height });
  process.stdout.write(`\rframe ${i + 1}/${FRAMES}`);
  await sleep(INTERVAL_MS);
}
console.log("\nencoding gif…");

await browser.close();

const { width, height } = raws[0];
const gif = GIFEncoder();
for (const { data } of raws) {
  const palette = quantize(data, 256);
  const index = applyPalette(data, palette);
  gif.writeFrame(index, width, height, { palette, delay: GIF_DELAY });
}
gif.finish();

mkdirSync("docs", { recursive: true });
writeFileSync(OUT, gif.bytes());
console.log(`wrote ${OUT} (${width}x${height}, ${FRAMES} frames)`);
